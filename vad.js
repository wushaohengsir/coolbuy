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
const END_MISSES = 16;           // ~0.5s 无声判停（无语义判停时的默认）
const PRE_BUFFER_FRAMES = 25;    // ~0.8s 句首预缓冲
const PROB_THRESHOLD = 0.35;     // 人声概率阈值（0.7 太严：远麦/小声/合成音都偏低）

// barge 模式（AI 播放中）：扬声器回声会串进麦克风，起判门槛抬高防误打断
const BARGE_START_HITS = 12;     // ~0.4s 连续人声才算用户抢话
const BARGE_THRESHOLD = 0.55;

// 语义判停（接入 onMaybeEnd 时生效，参考 pipecat smart-turn 参数）：
// 检测到 ~0.2s 静音先把已攒语音交给语义模型判"说完没有"；
// 判"未完"继续听，连续静音超 ~3s 兜底判停
const PAUSE_MISSES = 6;          // ~0.19s 静音 → 触发语义判停
const TURN_FALLBACK_MISSES = 94; // ~3.0s 连续静音 → 兜底判停

class SileroVad {
  constructor({ onSpeechStart, onSpeechEnd, onMaybeEnd, modelPath } = {}) {
    this.onSpeechStart = onSpeechStart;
    this.onSpeechEnd = onSpeechEnd;
    // 语义判停钩子：VAD 检测到 ~0.2s 静音时调用，给已攒的本轮语音，
    // 返回 true=说完了（立即判停）/ false=没说完（继续听，3s 静音兜底）。
    // 不传则退回纯 VAD 静音时长判停。
    this.onMaybeEnd = onMaybeEnd || null;
    this.state = 'idle';
    this.hitCount = 0;
    this.missCount = 0;
    this.speechBuf = [];
    this.preBuffer = [];
    this.speaking = false;
    this.barge = false;          // barge 模式：播放中抬门槛
    this._analyzed = false;      // 本轮静音是否已送语义判停
    this._turnGen = 0;           // 轮次代际：作废迟到的判停结果
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
    const threshold = this.barge ? BARGE_THRESHOLD : PROB_THRESHOLD;
    const startHits = this.barge ? BARGE_START_HITS : START_HITS;
    const isVoice = prob >= threshold;
    if (this.state === 'idle') {
      this.preBuffer.push(frame);
      if (this.preBuffer.length > PRE_BUFFER_FRAMES) this.preBuffer.shift();
      if (isVoice) {
        this.hitCount += 1;
        if (this.hitCount >= startHits) {
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
        this._analyzed = false;  // 用户又开口：下次静音重新判
        this._turnGen += 1;      // 作废可能还在路上的旧判停结果
      } else {
        this.missCount += 1;
        if (this.onMaybeEnd && !this._analyzed && this.missCount >= PAUSE_MISSES) {
          this._analyzed = true;
          this._analyze(); // 异步，不阻塞帧处理
        }
        // 有语义判停：说完由模型裁决，3s 连续静音兜底；无语义判停：固定静音时长
        const limit = this.onMaybeEnd ? TURN_FALLBACK_MISSES : END_MISSES;
        if (this.missCount >= limit) this._emitEnd();
      }
    }
  }

  /** 语义判停：把本轮已攒语音交给 onMaybeEnd。判"说完"且期间用户没再开口 → 判停 */
  async _analyze() {
    const gen = this._turnGen;
    const audio = Buffer.concat(this.speechBuf);
    let complete;
    try {
      complete = await this.onMaybeEnd(audio);
    } catch (e) {
      // 判停模型坏了不能拖垮对话：摘钩子，退回纯 VAD 静音判停
      console.error('语义判停失败，退回 VAD 静音判停:', e.message);
      this.onMaybeEnd = null;
      return;
    }
    if (!complete) return;                              // 没说完：继续听（静音兜底在 _onProb）
    if (gen !== this._turnGen || this.state !== 'active') return; // 期间用户又开口了
    this._emitEnd();
  }

  _emitEnd() {
    const audio = Buffer.concat(this.speechBuf);
    this.state = 'idle';
    this._turnGen += 1;
    this.speechBuf = [];
    this.missCount = 0;
    this._analyzed = false;
    this.onSpeechEnd?.(audio);
  }

  pause() {
    this.speaking = true;
    // 丢弃积压，防恢复后处理旧音频
    this._pending = Buffer.alloc(0);
  }
  /** barge 模式开关：AI 播放语音时打开，人声起判门槛抬高（抗扬声器回声） */
  setBargeMode(on) {
    this.barge = !!on;
    // 切换瞬间清计数，防旧计数跨模式误触发
    this.hitCount = 0;
    this.missCount = 0;
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
