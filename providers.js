/**
 * Provider 装配层 —— ASR / TTS 可插拔（LLM 走 llm.js，OpenAI 兼容天然可配）
 *
 * 选择优先级（高 → 低）：
 *   1. data/providers.json  用户设置（将来插件设置页写这里），如 { "asr": "doubao" }
 *   2. 环境变量             ASR_PROVIDER / TTS_PROVIDER
 *   3. 默认                 asr=local（免 key）, tts=doubao（人设音质优先）
 *
 * 接口契约：
 *   asr.recognizeOnce(pcm: Buffer<s16le 16k mono>) → Promise<string>
 *   tts.synthesize(text, opts?) → AsyncGenerator<Buffer<PCM s16le 24k mono>>
 *
 * 新增供应商：写一个符合契约的模块，在下面的表里登记即可。
 */

'use strict';
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'data', 'providers.json');

function userConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}

function pick(kind, def) {
  // 优先级：插件设置（经启动器注入的 env）> .env > data/providers.json > 默认
  // 注意 env 里已包含插件配置（启动器注入）与 .env（agent-env 加载，不覆盖已有值），
  // 两者都在 env 层，插件更高（先注入、.env 不覆盖）。providers.json 降为兜底。
  const envVal = process.env[`${kind.toUpperCase()}_PROVIDER`];
  if (envVal) return envVal.toLowerCase();
  const cfg = userConfig();
  return (cfg[kind] || def).toLowerCase();
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
  const which = pick('tts', 'doubao');
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
