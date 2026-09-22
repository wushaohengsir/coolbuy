/**
 * 本地 TTS（Kokoro-82M，sherpa-onnx CPU 推理，免火山 key）
 * 模型：models/kokoro-multi-lang-v1_0/（333MB，53 音色，含中文）
 * 下载：https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models
 *   → kokoro-multi-lang-v1_0.tar.bz2 解压到 models/
 * 输出：PCM s16le 24k mono（与 speaker 播放器 -f s16le -ar 24000 一致）
 * 许可：Apache-2.0（可商用）
 */

'use strict';
const path = require('path');
const fs = require('fs');

const MODEL_DIR = path.join(__dirname, 'models', 'kokoro-multi-lang-v1_0');

class LocalTts {
  constructor({ modelDir = MODEL_DIR, sid, speed = 1.0 } = {}) {
    this.name = 'local/kokoro';
    this.modelDir = modelDir;
    // 中文音色：kokoro-multi-lang v1.0 里 45-48 为女声（xiaobei/xiaoni/xiaoxiao/xiaoyi），49-52 男声
    this.sid = Number(sid ?? process.env.TTS_SPEAKER_ID ?? 46);
    this.speed = speed;
    this._tts = null; // 懒加载：首次 synthesize 才 require sherpa + 载模型
  }

  /** 懒加载 sherpa + 模型。必须推迟到首次调用：sherpa-onnx-node 与 onnxruntime-node
   *  各自捆绑了不同版本 onnxruntime DLL，sherpa 先加载会导致 onnxruntime-node
   *  dlopen 失败（ERR_DLOPEN_FAILED）。先让 vad/turn 载入 onnxruntime-node，再
   *  轮到本模块载 sherpa，两者才能共存。 */
  _ensure() {
    if (this._tts) return this._tts;
    const model = path.join(this.modelDir, 'model.onnx');
    const voices = path.join(this.modelDir, 'voices.bin');
    const tokens = path.join(this.modelDir, 'tokens.txt');
    const dataDir = path.join(this.modelDir, 'espeak-ng-data');
    if (!fs.existsSync(model) || !fs.existsSync(voices) || !fs.existsSync(tokens)) {
      throw new Error(`本地 TTS 模型缺失：${this.modelDir}\n` +
        '下载 https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models 的 kokoro-multi-lang-v1_0.tar.bz2 解压到 models/');
    }
    const sherpa = require('sherpa-onnx-node');
    this._tts = new sherpa.OfflineTts({
      model: {
        kokoro: {
          model,
          voices,
          tokens,
          dataDir,
          lexicon: path.join(this.modelDir, 'lexicon-zh.txt'), // 必须加载，否则中文全 OOV 被忽略
          lang: 'cmn',
        },
      },
      numThreads: 2,
      provider: 'cpu',
    });
    this.sampleRate = this._tts.sampleRate; // 应为 24000
    return this._tts;
  }

  /** 合成一句，边合成边 yield PCM s16le 24k mono（接口与云端 tts.js 一致） */
  async *synthesize(text, { speed = this.speed, sid = this.sid } = {}) {
    const tts = this._ensure();
    const chunks = [];
    let ended = false;
    let err = null;
    let notifier = null;
    const wake = () => { if (notifier) { const n = notifier; notifier = null; n(); } };

    tts.generateAsync({
      text,
      sid: Number(sid),
      speed,
      onProgress: (info) => { // 流式：每产出一段就转 s16le 入队
        chunks.push(float32ToS16le(info.samples));
        wake();
      },
    }).then(() => { ended = true; wake(); })
      .catch((e) => { err = e; ended = true; wake(); });

    while (true) {
      while (chunks.length) yield chunks.shift();
      if (ended) { if (err) throw err; return; }
      await new Promise((r) => { notifier = r; });
    }
  }
}

function float32ToS16le(samples) {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  return buf;
}

module.exports = { LocalTts };
