/**
 * Provider 装配层 —— ASR / TTS 可插拔（LLM 走 llm.js，OpenAI 兼容天然可配）
 *
 * 选择优先级（高 → 低）：
 *   1. 环境变量             ASR_PROVIDER / TTS_PROVIDER（插件经启动器注入）
 *   2. 默认                 asr=local（免 key）, tts=doubao（人设音质优先）
 *
 * 环境配置只认插件传进来的（经 native 启动器作为 env 注入），不再读 .env / providers.json。
 *
 * 接口契约：
 *   asr.recognizeOnce(pcm: Buffer<s16le 16k mono>) → Promise<string>
 *   tts.synthesize(text, opts?) → AsyncGenerator<Buffer<PCM s16le 24k mono>>
 *
 * 新增供应商：写一个符合契约的模块，在下面的表里登记即可。
 */

'use strict';

function pick(kind, def) {
  const envVal = process.env[`${kind.toUpperCase()}_PROVIDER`];
  return (envVal || def).toLowerCase();
}

function getAsr() {
  const which = pick('asr', 'local');
  switch (which) {
    case 'local': {
      const { LocalAsr } = require('./asr-local');
      return new LocalAsr();
    }
    case 'doubao': {
      const { recognizeOnce } = require('./asr');
      return { name: 'doubao/seed-asr', recognizeOnce };
    }
    default:
      throw new Error(`未知 ASR provider: ${which}（可选 local / doubao）`);
  }
}

function getTts() {
  const which = pick('tts', 'local');
  switch (which) {
    case 'doubao': {
      const { synthesize } = require('./tts');
      return { name: 'doubao/seed-tts-2.0', synthesize };
    }
    case 'local': {
      const { LocalTts } = require('./tts-local');
      return new LocalTts();
    }
    default:
      throw new Error(`未知 TTS provider: ${which}（可选 doubao / local）`);
  }
}

module.exports = { getAsr, getTts };
