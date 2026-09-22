/**
 * Smart Turn 语义判停（pipecat-ai/smart-turn v3.2，本地 ONNX 推理）
 * 模型：Whisper Tiny 底座 + 分类头，8MB int8 量化，支持中文等 23 种语言。
 * 职责：VAD 检测到静音时，判断用户这轮话"说完了没有"——靠语调/韵律/语义线索，
 *       而不是静音时长。用户在组织理由时的思考停顿不会被误切断。
 *
 * 输入：16kHz 单声道 PCM，固定 8 秒窗（短了前补零、长了从头截断）
 * 输出：sigmoid 概率，>0.5 判"说完"
 * 成本：只在静音瞬间跑一次，CPU 约 10-100ms
 */

'use strict';
const path = require('path');
const ort = require('onnxruntime-node');

const SR = 16000;
const WINDOW_SAMPLES = 8 * SR; // 128000，模型固定 8 秒窗

class SmartTurn {
  constructor({ modelPath } = {}) {
    this.ready = false;
    this._extractor = null;
    this._initPromise = this._init(modelPath || path.join(__dirname, 'smart-turn-v3.2-cpu.onnx'));
  }

  async _init(modelPath) {
    this.session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    });
    // transformers.js 是 ESM，CJS 项目里用动态 import
    const { WhisperFeatureExtractor } = await import('@huggingface/transformers');
    // 构造函数不从 chunk_length 推导 n_samples/nb_max_frames（正常来自 preprocessor_config.json），
    // 必须显式给全：8 秒窗 = 128000 样本 = 800 帧
    this._extractor = new WhisperFeatureExtractor({
      feature_size: 80,
      sampling_rate: SR,
      n_fft: 400,
      hop_length: 160,
      chunk_length: 8,
      n_samples: WINDOW_SAMPLES,
      nb_max_frames: 800,
      padding_value: 0,
    });
    this.ready = true;
  }

  /** pcm: Buffer（s16le 16k mono，VAD 攒下的本轮语音）
   *  返回 { complete: bool, probability: 0-1 } */
  async predict(pcm) {
    await this._initPromise;

    // s16le → float32，取最后 8 秒（模型要的是"最近的话"，头部截断）
    const total = Math.min(Math.floor(pcm.length / 2), WINDOW_SAMPLES);
    const off = pcm.length - total * 2;
    const floats = new Float32Array(WINDOW_SAMPLES);
    let peak = 0;
    for (let i = 0; i < total; i++) {
      const v = pcm.readInt16LE(off + i * 2) / 32768;
      floats[WINDOW_SAMPLES - total + i] = v; // 不足 8 秒前面补零
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    // 波形峰值归一化（对齐 Python 参考实现 do_normalize=True）：
    // 麦克风增益差异巨大（实测远麦峰值仅 -40dB），不归一化特征会塌成全静音
    if (peak > 0) for (let i = 0; i < floats.length; i++) floats[i] /= peak;

    // Whisper log-mel 特征 [1, 80, 800]
    const { input_features } = await this._extractor(floats);
    const out = await this.session.run({
      input_features: new ort.Tensor('float32', input_features.data, input_features.dims),
    });
    const probability = out.logits.data[0];
    return { complete: probability > 0.5, probability };
  }
}

module.exports = { SmartTurn };
