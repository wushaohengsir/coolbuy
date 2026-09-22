/**
 * 豆包语音合成 2.0（Seed-TTS 2.0）—— 双向流式 WebSocket 版，常驻连接
 * 文档：wss://openspeech.bytedance.com/api/v3/tts/bidirection
 * 鉴权：X-Api-Key（控制台 API Key 管理页）+ X-Api-Resource-Id: seed-tts-2.0
 *
 * 连接模型（v2，2026-09-23 改）：
 *   旧版每句话新建一条 WS（握手+StartConnection+StartSession 全套），多句回复
 *   每句白付 100-300ms 握手税。现改为：StartConnection 一次常驻，之后每句只
 *   开一个 session（StartSession → TaskRequest → FinishSession → 收音频）。
 *   - 同连接上 session 串行（模块级锁；我们的 TTS 本来就按句排队，无并发需求）
 *   - 被打断/出错/超时 → 销毁连接，下一句自动重连（保证不残留半句帧）
 *   - 正常结束 → 连接保活复用
 */

'use strict';
const crypto = require('crypto');
const WebSocket = require('ws');
const P = require('./protocol');
require('./agent-env')();

const TTS_URL = 'wss://openspeech.bytedance.com/api/v3/tts/bidirection';
const RESOURCE_ID = process.env.TTS_RESOURCE_ID || 'seed-tts-2.0';
const SPEAKER = process.env.TTS_SPEAKER || 'zh_female_vv_uranus_bigtts';
const SESSION_TIMEOUT = 30000; // 单句兜底：30s 没合成完判定连接坏死

// ---- 常驻连接状态 ----
let shared = null;      // { ws }
let lock = Promise.resolve(); // session 串行锁

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(TTS_URL, {
      headers: {
        Authorization: `Bearer; ${process.env.DOUBAO_ACCESS_KEY}`,
        'X-Api-App-Key': process.env.DOUBAO_APP_ID,
        'X-Api-Access-Key': process.env.DOUBAO_ACCESS_KEY,
        'X-Api-Resource-Id': RESOURCE_ID,
        'X-Api-Connect-Id': crypto.randomUUID(),
      },
      handshakeTimeout: 15000,
    });
    ws.once('open', () => resolve(ws));
    ws.once('unexpected-response', (q, r) => { r.resume(); reject(new Error(`TTS 握手 HTTP ${r.statusCode}`)); });
    ws.once('error', reject);
  });
}

function destroyShared() {
  if (!shared) return;
  try { shared.ws.close(); } catch {}
  shared = null;
}

async function getConn() {
  if (shared && shared.ws.readyState === WebSocket.OPEN) return shared.ws;
  destroyShared();
  const ws = await connect();
  shared = { ws };
  ws.on('close', () => { if (shared?.ws === ws) shared = null; });
  ws.on('error', () => { if (shared?.ws === ws) shared = null; });
  // StartConnection（连接级事件，无 session_id），只建连时发一次
  ws.send(P.buildFrame({
    messageType: P.MSG_FULL_CLIENT,
    flags: P.FLAG_WITH_EVENT,
    serialization: P.SERIAL_JSON,
    compression: P.COMPRESS_NONE,
    event: P.EV.START_CONNECTION,
    payload: Buffer.from(JSON.stringify({ event: P.EV.START_CONNECTION }), 'utf8'),
  }));
  await waitEvent(ws, P.EV.CONNECTION_STARTED);
  return ws;
}

function recvFrame(ws) {
  return new Promise((resolve, reject) => {
    const onMsg = (raw) => { cleanup(); resolve(P.parseFrame(raw)); };
    const onErr = (e) => { cleanup(); reject(e); };
    const onClose = () => { cleanup(); reject(new Error('TTS 连接被关闭')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('TTS 会话超时')); }, SESSION_TIMEOUT);
    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMsg); ws.off('error', onErr); ws.off('close', onClose);
    };
    ws.on('message', onMsg);
    ws.on('error', onErr);
    ws.on('close', onClose);
  });
}

async function waitEvent(ws, event) {
  while (true) {
    const f = await recvFrame(ws);
    if (f.messageType === P.MSG_ERROR) {
      throw new Error(`TTS 错误帧: ${f.payload.toString('utf8').slice(0, 300)}`);
    }
    if (f.event === event) return f;
    if (f.event === P.EV.CONNECTION_FAILED || f.event === P.EV.SESSION_FAILED) {
      throw new Error(`TTS 失败: ${f.payload.toString('utf8').slice(0, 300)}`);
    }
    // 其余帧（如上一句残留的音频帧）丢弃
  }
}

function sendEvent(ws, event, sid, payload) {
  ws.send(P.buildFrame({
    messageType: P.MSG_FULL_CLIENT,
    flags: P.FLAG_WITH_EVENT,
    serialization: P.SERIAL_JSON,
    compression: P.COMPRESS_NONE,
    event,
    sessionId: sid,
    payload: Buffer.from(JSON.stringify(payload), 'utf8'),
  }));
}

/** 在共享连接上合成一句，yield PCM s16le 24k mono Buffer。
 *  正常合成完 → 连接保活；中途 break（打断）或出错 → 销毁连接，下句重连。 */
async function* synthesizeOnce(text, { speaker = SPEAKER, format = 'pcm', sampleRate = 24000, speechRate = 0 } = {}) {
  const ws = await getConn();
  const sid = crypto.randomUUID();
  const req = {
    speaker,
    audio_params: { format, sample_rate: sampleRate, speech_rate: speechRate },
  };

  sendEvent(ws, P.EV.START_SESSION, sid, { event: P.EV.START_SESSION, session_id: sid, req_params: req });
  await waitEvent(ws, P.EV.SESSION_STARTED);

  sendEvent(ws, P.EV.TASK_REQUEST, sid, { event: P.EV.TASK_REQUEST, session_id: sid, req_params: { ...req, text } });
  sendEvent(ws, P.EV.FINISH_SESSION, sid, { event: P.EV.FINISH_SESSION, session_id: sid });

  while (true) {
    const f = await recvFrame(ws);
    if (f.messageType === P.MSG_ERROR) {
      throw new Error(`TTS 错误帧: ${f.payload.toString('utf8').slice(0, 300)}`);
    }
    if (f.messageType === P.MSG_AUDIO_SERVER && f.payload.length) {
      yield f.payload;
    }
    if (f.event === P.EV.TTS_SENTENCE_END || f.event === P.EV.TTS_ENDED
      || f.event === P.EV.SESSION_FINISHED) {
      break;
    }
  }
}

/** 对外接口（签名不变）：流式合成一段文本。模块级锁保证共享连接上只有一个活跃 session。 */
async function* synthesize(text, opts) {
  // 排队拿锁
  let release;
  const acquired = new Promise((r) => { release = r; });
  const prev = lock;
  lock = lock.then(() => acquired);
  await prev;

  let completed = false;
  try {
    yield* (async function* () {
      for await (const chunk of synthesizeOnce(text, opts)) yield chunk;
      completed = true;
    })();
  } finally {
    release();
    if (!completed) destroyShared(); // 被打断/出错：销毁连接，下句重连
  }
}

module.exports = { synthesize, TTS_URL, RESOURCE_ID };
