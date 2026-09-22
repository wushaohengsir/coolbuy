/**
 * Silero VAD（ONNX 本地神经网络推理）
 * 参考 pipecat-ai/pipecat 的实现：模型 2.3MB，CPU 单帧亚毫秒。
 * 输入：512 样本（32ms @ 16kHz）float32；输出：该帧含人声的概率。
 * 状态机：连续 hit 起判 / 连续 miss 判停 / 预缓冲保句首。
 */

'use strict';
const path = require('path');
const ort = require('onnxruntime-node');

const FRAME_SAMPLES = 512;       // Silero 要求 512 @ 16kHz
const START_HITS = 4;            // ~0.13s 连续人声起判
const END_MISSES = 16;           // ~0.5s 无声判停
const PRE_BUFFER_FRAMES = 25;    // ~0.8s 句首预缓冲
const PROB_THRESHOLD = 0.35;     // 人声概率阈值（0.7 太严：远麦/小声/合成音都偏低）

class SileroVad {
  constructor({ onSpeechStart, onSpeechEnd, modelPath } = {}) {
    this.onSpeechStart = onSpeechStart;
    this.onSpeechEnd = onSpeechEnd;
    this.state = 'idle';
    this.hitCount = 0;
    this.missCount = 0;
    this.speechBuf = [];
    this.preBuffer = [];
    this.speaking = false;
    this._pending = Buffer.alloc(0);
    this.ready = false;
    this._init(modelPath || path.join(__dirname, 'silero_vad.onnx')).catch((e) => {
      console.error('Silero VAD 初始化失败:', e.message);
      process.exit(1);
    });
  }

  async _init(modelPath) {
    this.session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    });
    // pipecat 版 Silero v5：输入 [input, state, sr]，输出 [output, stateN]
    this.ready = true;
  }

  async _processFrame(frame) {
    // s16le → float32
    const floats = new Float32Array(FRAME_SAMPLES);
    for (let i = 0; i < FRAME_SAMPLES; i++) floats[i] = frame.readInt16LE(i * 2) / 32768;

    const feeds = {
      input: new ort.Tensor('float32', floats, [1, FRAME_SAMPLES]),
      state: this.lstmState || new ort.Tensor('float32', new Float32Array(256), [2, 1, 128]),
      sr: new ort.Tensor('int64', BigInt64Array.from([16000n]), []),
    };
    const out = await this.session.run(feeds);
    const prob = out.output.data[0];
    this.lstmState = out.stateN;

    this._onProb(prob, frame);
  }

  /** 喂 PCM（16k s16le mono）*/
  write(pcm) {
    this._pending = Buffer.concat([this._pending, pcm]);
    this._drain();
  }

  // 串行处理帧队列（onnx 推理是异步的，必须排队防竞态）
  _drain() {
    if (this._busy) return;
    if (!this.ready && this.session) return;
    this._busy = true;
    const step = async () => {
      if (!this.ready) { this._busy = false; return; }
      if (this.speaking) { this._pending = Buffer.alloc(0); this._busy = false; return; }
      while (this._pending.length >= FRAME_SAMPLES * 2) {
        const frame = this._pending.slice(0, FRAME_SAMPLES * 2);
        this._pending = this._pending.slice(FRAME_SAMPLES * 2);
        await this._processFrame(frame);
      }
      this._busy = false;
    };
    step().catch(() => { this._busy = false; });
  }

  async _processFrame(frame) {
    // s16le → float32
    const floats = new Float32Array(FRAME_SAMPLES);
    for (let i = 0; i < FRAME_SAMPLES; i++) floats[i] = frame.readInt16LE(i * 2) / 32768;

    const feeds = {
      input: new ort.Tensor('float32', floats, [1, FRAME_SAMPLES]),
      state: this.lstmState || new ort.Tensor('float32', new Float32Array(256), [2, 1, 128]),
      sr: new ort.Tensor('int64', BigInt64Array.from([16000n]), []),
    };
    const out = await this.session.run(feeds);
    const prob = out.output.data[0];
    this.lstmState = out.stateN;

    this._onProb(prob, frame);
  }

  _onProb(prob, frame) {
    const isVoice = prob >= PROB_THRESHOLD;
    if (this.state === 'idle') {
      this.preBuffer.push(frame);
      if (this.preBuffer.length > PRE_BUFFER_FRAMES) this.preBuffer.shift();
      if (isVoice) {
        this.hitCount += 1;
        if (this.hitCount >= START_HITS) {
          this.state = 'active';
          this.speechBuf = [...this.preBuffer];
          this.preBuffer = [];
          this.hitCount = 0;
          this.missCount = 0;
          this.onSpeechStart?.();
        }
      } else {
        this.hitCount = 0;
      }
    } else if (this.state === 'active') {
      this.speechBuf.push(frame);
      if (isVoice) {
        this.missCount = 0;
      } else {
        this.missCount += 1;
        if (this.missCount >= END_MISSES) {
          const audio = Buffer.concat(this.speechBuf);
          this.state = 'idle';
          this.speechBuf = [];
          this.missCount = 0;
          this.onSpeechEnd?.(audio);
        }
      }
    }
  }

  pause() {
    this.speaking = true;
    // 丢弃积压，防恢复后处理旧音频
    this._pending = Buffer.alloc(0);
  }
  resume() {
    this.speaking = false;
    this.state = 'idle';
    this.speechBuf = [];
    this.preBuffer = [];
    this.hitCount = 0;
    this.missCount = 0;
    this.state_tensor = null; // （保留兼容）LSTM 状态重置
    this.lstmState = null;
  }
}

module.exports = { SileroVad };
