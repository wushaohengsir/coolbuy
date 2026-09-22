/**
 * coolbuy · 冲动消费降温 Agent（A 路线：豆包端到端 Realtime）
 *
 * 用法：
 *   1. 复制 .env.example 为 .env，填入火山引擎 APP_ID / ACCESS_KEY
 *   2. node agent.js            # 实时语音协商
 *   3. node agent.js --list-dev # 列出音频设备（换麦克风用）
 *
 * 音频链路：
 *   上行：ffmpeg dshow 抓麦克风 → 16kHz mono s16le → WS
 *   下行：WS → 24kHz mono f32le → ffplay 播放
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const P = require('./protocol');
const { systemRole, purchaseContext } = require('./scenario');

// ---- .env 手动解析 ----
function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

const APP_ID = process.env.DOUBAO_APP_ID;
const ACCESS_KEY = process.env.DOUBAO_ACCESS_KEY;
const URL = 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue';
const PUBLIC_APP_KEY = 'PlgvMymc7f3tQnJ6'; // 该产品固定公共 App-Key

// 默认麦克风：Realtek（dshow 友好名，node spawn 传中文无编码问题）
const MIC_DEVICE = process.env.MIC_DEVICE || 'audio=麦克风 (Realtek(R) Audio)';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPLAY = process.env.FFPLAY_PATH || 'ffplay';

// ---- 工具 ----
const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};
const log = {
  sys: (s) => console.log(c.dim(`  [系统] ${s}`)),
  user: (s) => console.log(c.yellow(`  你: ${s}`)),
  agent: (s) => console.log(c.cyan(`  小冷: ${s}`)),
};

// ---- 列设备模式 ----
if (process.argv.includes('--list-dev')) {
  const ff = spawn(FFMPEG, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { stdio: ['ignore', 'pipe', 'pipe'] });
  ff.stderr.on('data', (d) => process.stdout.write(d));
  ff.on('exit', () => log.sys('把想要的设备 alternative name 填到 .env 的 MIC_DEVICE（audio= 前缀保留）'));
  return;
}

if (!APP_ID || !ACCESS_KEY) {
  console.log('缺少 DOUBAO_APP_ID / DOUBAO_ACCESS_KEY。');
  console.log('  1) 打开火山引擎控制台 → 语音技术 → 端到端实时语音大模型，开通并获取 App ID 和 Access Token');
  console.log('  2) 复制 .env.example 为 .env 填入');
  console.log('  3) 重新运行 node agent.js');
  process.exit(1);
}

// ---- 状态 ----
const connectId = crypto.randomUUID();
const sessionId = crypto.randomUUID();
let sessionReady = false;
let lastMicAt = 0;

// ---- 播放器：ffplay 24kHz mono f32le（注意：ffplay 用 -ch_layout，不认 ffmpeg 的 -ac） ----
const player = spawn(FFPLAY, [
  '-nodisp', '-autoexit', '-loglevel', 'quiet',
  '-f', 'f32le', '-ar', '24000', '-ch_layout', 'mono', '-',
], { stdio: ['pipe', 'inherit', 'inherit'] });
player.stdin.on('error', () => {}); // 播放器退出后忽略写入错误，避免进程崩溃
player.on('exit', (code) => { if (!exiting) log.sys(`播放器已退出（code ${code}），语音将无法播放`); });

// ---- 麦克风：ffmpeg dshow → 16kHz mono s16le ----
const mic = spawn(FFMPEG, [
  '-hide_banner', '-loglevel', 'error',
  '-f', 'dshow', '-i', MIC_DEVICE,
  '-ar', '16000', '-ac', '1', '-f', 's16le', '-',
], { stdio: ['ignore', 'pipe', 'inherit'] });

// ---- WS 连接 ----
const ws = new WebSocket(URL, {
  headers: {
    'X-Api-App-ID': APP_ID,
    'X-Api-Access-Key': ACCESS_KEY,
    'X-Api-Resource-Id': 'volc.speech.dialog',
    'X-Api-App-Key': PUBLIC_APP_KEY,
    'X-Api-Connect-Id': connectId,
  },
  handshakeTimeout: 15000,
});

ws.on('unexpected-response', (req, res) => {
  console.log(c.red(`握手失败 HTTP ${res.statusCode}`));
  res.resume();
  process.exit(1);
});

ws.on('open', () => {
  log.sys(`连接已建立（connect ${connectId.slice(0, 8)}…）`);
  ws.send(P.jsonFrame(P.EV.START_CONNECTION, {}));

  // StartSession：注入协商剧本 + 下行 PCM 24kHz
  ws.send(P.jsonFrame(P.EV.START_SESSION, {
    dialog: {
      bot_name: '小冷',
      system_role: systemRole,
      dialog_id: `cooldown-${Date.now()}`,
    },
    tts: {
      audio_config: { channel: 1, format: 'pcm', sample_rate: 24000 },
    },
  }, sessionId));
});

ws.on('message', (raw, isBinary) => {
  if (!isBinary) { log.sys(`非二进制消息: ${raw.toString().slice(0, 200)}`); return; }
  const f = P.parseFrame(raw);

  switch (f.event) {
    case P.EV.CONNECTION_STARTED:
      log.sys('服务端确认连接');
      break;
    case P.EV.SESSION_STARTED:
      sessionReady = true;
      console.log();
      log.sys('会话已启动，小冷上线');
      console.log(c.dim(`  ── 本次拦截：${purchaseContext.商品} ¥${purchaseContext.价格}（${purchaseContext.促销话术}）──`));
      console.log(c.dim('  ── 按 Ctrl+C 结束。开口说话即可 ──'));
      console.log();
      // 麦克风数据接管
      mic.stdout.on('data', (chunk) => {
        if (!sessionReady || ws.readyState !== WebSocket.OPEN) return;
        lastMicAt = Date.now();
        ws.send(P.audioFrame(chunk, sessionId));
      });
      break;
    case P.EV.SESSION_FAILED:
      console.log(c.red(`会话失败: ${safeJson(f.payload)}`));
      shutdown(1);
      break;
    case P.EV.ASR_RESPONSE: {
      const j = safeJson(f.payload);
      const t = j?.results?.map((r) => r.text).join('') ?? '';
      if (t) log.user(t);
      break;
    }
    case P.EV.CHAT_RESPONSE: {
      const j = safeJson(f.payload);
      if (j?.content) log.agent(j.content);
      break;
    }
    case P.EV.TTS_RESPONSE:
      if (f.payload && f.payload.length) player.stdin.write(f.payload);
      break;
    case P.EV.SESSION_FINISHED:
    case P.EV.CHAT_ENDED:
      break;
    default:
      if (f.messageType === P.MSG_ERROR) {
        console.log(c.red(`错误帧 code=${f.errorCode}: ${safeJson(f.payload)}`));
      }
  }
});

ws.on('error', (e) => { console.log(c.red(`WS 错误: ${e.message}`)); shutdown(1); });
ws.on('close', (code, reason) => { log.sys(`连接关闭 ${code} ${reason || ''}`); shutdown(0); });

// ---- 保活：静默 5 秒补 100ms 静音（16k mono s16 = 3200 字节） ----
const keepalive = setInterval(() => {
  if (sessionReady && ws.readyState === WebSocket.OPEN && Date.now() - lastMicAt > 5000) {
    ws.send(P.audioFrame(Buffer.alloc(3200), sessionId));
  }
}, 3000);

// ---- 退出 ----
let exiting = false;
function shutdown(code) {
  if (exiting) return;
  exiting = true;
  clearInterval(keepalive);
  try { if (sessionReady) ws.send(P.jsonFrame(P.EV.FINISH_SESSION, {}, sessionId)); } catch {}
  setTimeout(() => {
    try { ws.send(P.jsonFrame(P.EV.FINISH_CONNECTION, {})); } catch {}
    try { ws.close(); } catch {}
    try { mic.kill(); } catch {}
    try { player.kill(); } catch {}
    console.log(c.green('\n  会话结束。这单冷静住了吗？'));
    process.exit(code);
  }, 300);
}
process.on('SIGINT', () => { console.log(); shutdown(0); });

function safeJson(buf) {
  try { return JSON.parse(buf.toString('utf8')); } catch { return buf?.slice(0, 120).toString('utf8'); }
}
