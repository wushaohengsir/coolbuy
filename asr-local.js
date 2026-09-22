/**
 * 本地 ASR（SenseVoice-small，sherpa-onnx CPU 推理，免 API key）
 * 模型：models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09/（int8 ~230MB）
 * 下载：https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models
 *   → sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2 解压到 models/
 *
 * 特点：中英日韩粤多语、CPU 几百毫秒出结果、自带逆文本规范化（数字/标点转书面形）。
 * 输出原始带标签 <|zh|><|HAPPY|><|Speech|>…——情绪标签先剥离存着，
 * 将来可以喂给大脑（用户语气是协商的重要信号）。
 */

'use strict';
const path = require('path');
const fs = require('fs');

const MODEL_DIR = path.join(__dirname, 'models', 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09');

class LocalAsr {
  constructor({ modelDir = MODEL_DIR } = {}) {
    this.name = 'local/sense-voice';
    const model = path.join(modelDir, 'model.int8.onnx');
    const tokens = path.join(modelDir, 'tokens.txt');
    if (!fs.existsSync(model) || !fs.existsSync(tokens)) {
      throw new Error(
        `本地 ASR 模型缺失：${modelDir}\n` +
        '下载 sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2 解压到 models/\n' +
        '（https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models）'
      );
    }
    // 延迟 require：sherpa-onnx-node 是原生模块，不用本地 ASR 时不加载
    const sherpa = require('sherpa-onnx-node');
    this.recognizer = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        senseVoice: { model, useInverseTextNormalization: 1 },
        tokens,
        numThreads: 2,
        provider: 'cpu',
        debug: 0,
      },
    });
  }

  /** 整段识别：pcm = Buffer（s16le 16k mono）→ { text, emotion } */
  async recognize(pcm) {
    const n = Math.floor(pcm.length / 2);
    const samples = new Float32Array(n);
    for (let i = 0; i < n; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;

    const stream = this.recognizer.createStream();
    stream.acceptWaveform({ sampleRate: 16000, samples });
    await this.recognizer.decodeAsync(stream);
    const raw = this.recognizer.getResult(stream).text || '';

    // 剥标签：<|zh|><|HAPPY|><|Speech|><|woitn|>文本… → 文本 + 情绪
    const tags = [...raw.matchAll(/<\|([^|]+)\|>/g)].map((m) => m[1]);
    const EMOTIONS = ['HAPPY', 'SAD', 'ANGRY', 'NEUTRAL', 'FEARFUL', 'DISGUSTED', 'SURPRISED'];
    const emotion = tags.find((t) => EMOTIONS.includes(t)) || null;
    const text = raw.replace(/<\|[^|]+\|>/g, '').trim();
    return { text, emotion };
  }

  /** 与云端 ASR 对齐的便捷接口：只取文本 */
  async recognizeOnce(pcm) {
    return (await this.recognize(pcm)).text;
  }
}

module.exports = { LocalAsr };
