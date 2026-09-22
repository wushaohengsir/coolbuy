/**
 * 豆包语音合成 2.0（Seed-TTS 2.0）—— 双向流式 WebSocket 版
 * 文档：wss://openspeech.bytedance.com/api/v3/tts/bidirection
 * 鉴权：X-Api-Key（控制台 API Key 管理页）+ X-Api-Resource-Id: seed-tts-2.0
 * 事件：StartConnection → StartSession(session_id+req_params) → TaskRequest(text)
 *       → TTSResponse(音频流) → TTSSentenceEnd → FinishSession
 * 二进制帧协议同 protocol.js（event id + JSON payload）。
 */

'use strict';
const crypto = require('crypto');
const WebSocket = require('ws');
const P = require('./protocol');
require('./agent-env')();

const TTS_URL = 'wss://openspeech.bytedance.com/api/v3/tts/bidirection';
const RESOURCE_ID = process.env.TTS_RESOURCE_ID || 'seed-tts-2.0';
const SPEAKER = process.env.TTS_SPEAKER || 'zh_female_vv_uranus_bigtts';

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

function recvFrame(ws) {
  return new Promise((resolve, reject) => {
    const onMsg = (raw) => { cleanup(); resolve(P.parseFrame(raw)); };
    const onErr = (e) => { cleanup(); reject(e); };
    const cleanup = () => { ws.off('message', onMsg); ws.off('error', onErr); };
    ws.on('message', onMsg);
    ws.on('error', onErr);
  });
}

async function waitEvent(ws, event) {
  while (true) {
    const f = await recvFrame(ws);
    if (f.messageType === P.MSG_ERROR) {
      throw new Error(`TTS 错误帧: ${f.payload.toString('utf8').slice(0, 300)}`);
    }
    if (f.event === event) return f;
    if (f.event === 51 /* ConnectionFailed */ || f.event === 153 /* SessionFailed */) {
      throw new Error(`TTS 失败: ${f.payload.toString('utf8').slice(0, 300)}`);
    }
  }
}

/** 流式合成一段文本，yield PCM s16le 24k mono Buffer */
async function* synthesize(text, { speaker = SPEAKER, format = 'pcm', sampleRate = 24000, speechRate = 0 } = {}) {
  const sid = crypto.randomUUID();
  const ws = await connect();
  try {
    // 1. StartConnection（连接级事件，无 session_id）
    ws.send(P.buildFrame({
      messageType: P.MSG_FULL_CLIENT,
      flags: P.FLAG_WITH_EVENT,
      serialization: P.SERIAL_JSON,
      compression: P.COMPRESS_NONE,
      event: P.EV.START_CONNECTION,
      payload: Buffer.from(JSON.stringify({ event: P.EV.START_CONNECTION }), 'utf8'),
    }));
    await waitEvent(ws, P.EV.CONNECTION_STARTED);

    // 2. StartSession（speaker + audio_params）
    ws.send(P.buildFrame({
      messageType: P.MSG_FULL_CLIENT,
      flags: P.FLAG_WITH_EVENT,
      serialization: P.SERIAL_JSON,
      compression: P.COMPRESS_NONE,
      event: P.EV.START_SESSION,
      sessionId: sid,
      payload: Buffer.from(JSON.stringify({
        event: P.EV.START_SESSION,
        session_id: sid,
        req_params: {
          speaker,
          audio_params: { format, sample_rate: sampleRate, speech_rate: speechRate },
        },
      }), 'utf8'),
    }));
    await waitEvent(ws, P.EV.SESSION_STARTED);

    // 3. TaskRequest（text 放 req_params 内 + 立即 FinishSession，实测此组合出音频）
    ws.send(P.buildFrame({
      messageType: P.MSG_FULL_CLIENT,
      flags: P.FLAG_WITH_EVENT,
      serialization: P.SERIAL_JSON,
      compression: P.COMPRESS_NONE,
      event: P.EV.TASK_REQUEST,
      sessionId: sid,
      payload: Buffer.from(JSON.stringify({
        event: P.EV.TASK_REQUEST,
        session_id: sid,
        req_params: {
          speaker,
          audio_params: { format, sample_rate: sampleRate, speech_rate: speechRate },
          text,
        },
      }), 'utf8'),
    }));
    // 4. FinishSession（告知文本输入完毕，触发合成输出）
    ws.send(P.buildFrame({
      messageType: P.MSG_FULL_CLIENT,
      flags: P.FLAG_WITH_EVENT,
      serialization: P.SERIAL_JSON,
      compression: P.COMPRESS_NONE,
      event: P.EV.FINISH_SESSION,
      sessionId: sid,
      payload: Buffer.from(JSON.stringify({ event: P.EV.FINISH_SESSION, session_id: sid }), 'utf8'),
    }));

    // 5. 收音频流直到会话结束
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
  } finally {
    try { ws.close(); } catch {}
  }
}

module.exports = { synthesize, TTS_URL, RESOURCE_ID };
