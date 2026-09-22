/**
 * 豆包流式语音识别 2.0（双向流式，边说边出字）
 * 端点: wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async
 * 鉴权: X-Api-Key（API Key 管理页）+ X-Api-Resource-Id: volc.seedasr.sauc.duration
 * 请求体: { audio: {format:'pcm',codec:'raw',rate:16000,bits:16,channel:1},
 *           request: {model_name:'bigmodel', enable_punc:true, enable_itn:true,
 *                     show_utterances:true, result_type:'single'} }
 * 帧协议同 protocol.js。音频包用 sequence 驱动，尾包负序号。
 */

'use strict';
const crypto = require('crypto');
const zlib = require('zlib');
const WebSocket = require('ws');
const P = require('./protocol');
require('./agent-env')();

const ASR_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';

class AsrSession {
  constructor({ onResult, onEnd, onError } = {}) {
    this.seq = 1;
    this.onResult = onResult;
    this.onEnd = onEnd;
    this.onError = onError;
    this.ended = false;
    this.ws = new WebSocket(ASR_URL, {
      headers: {
        Authorization: `Bearer; ${process.env.DOUBAO_ACCESS_KEY}`,
        'X-Api-App-Key': process.env.DOUBAO_APP_ID,
        'X-Api-Access-Key': process.env.DOUBAO_ACCESS_KEY,
        'X-Api-Resource-Id': process.env.ASR_RESOURCE_ID || 'volc.seedasr.sauc.duration',
        'X-Api-Request-Id': crypto.randomUUID(),
      },
      handshakeTimeout: 15000,
    });
    this.ws.on('open', () => {
      this.ws.send(P.buildFrame({
        messageType: P.MSG_FULL_CLIENT,
        flags: P.FLAG_POS_SEQ,
        serialization: P.SERIAL_JSON,
        compression: P.COMPRESS_GZIP,
        sequence: this.seq,
        payload: zlib.gzipSync(Buffer.from(JSON.stringify({
          audio: { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 },
          request: {
            model_name: 'bigmodel',
            enable_punc: true,
            enable_itn: true,
            show_utterances: true,
            result_type: 'single',
          },
        }), 'utf8')),
      }));
    });
    this.ws.on('message', (raw) => this._handle(raw));
    this.ws.on('error', (e) => this.onError?.(e));
  }

  write(pcm) {
    if (this.ws.readyState !== WebSocket.OPEN || this.ended) return;
    this.seq += 1;
    this.ws.send(P.buildFrame({
      messageType: P.MSG_AUDIO_CLIENT,
      flags: P.FLAG_POS_SEQ,
      serialization: P.SERIAL_RAW,
      compression: P.COMPRESS_GZIP,
      sequence: this.seq,
      payload: zlib.gzipSync(pcm),
    }));
  }

  finish() {
    if (this.ended || this.ws.readyState !== WebSocket.OPEN) return;
    this.ended = true;
    // 尾包负序号：服务端期望 -(已发正序号数+1)（实测 -seq 会 mismatch）
    this.seq += 1;
    this.ws.send(P.buildFrame({
      messageType: P.MSG_AUDIO_CLIENT,
      flags: P.FLAG_NEG_SEQ,
      serialization: P.SERIAL_RAW,
      compression: P.COMPRESS_GZIP,
      sequence: -this.seq,
      payload: zlib.gzipSync(Buffer.alloc(0)),
    }));
  }

  _handle(raw) {
    const f = P.parseFrame(raw);
    if (f.messageType === P.MSG_ERROR) {
      this.onError?.(new Error(`ASR 错误 code=${f.errorCode}: ${f.payload.toString('utf8').slice(0, 200)}`));
      return;
    }
    // 尾包标志（flags 0b0010/0b0011）= 音频流结束，结果已全部返回
    if (f.flags & P.FLAG_LAST_NO_SEQ) {
      this._emit(f);
      this.onEnd?.();
      return;
    }
    if (f.serialization !== P.SERIAL_JSON || !f.payload.length) return;
    this._emit(f);
  }

  _emit(f) {
    let j;
    try { j = JSON.parse(f.payload.toString('utf8')); } catch { return; }
    // result 为对象：{ additions, text?, utterances?: [{text, definite}] }
    const r = j.result;
    if (r && typeof r === 'object') {
      if (Array.isArray(r.utterances)) {
        for (const u of r.utterances) {
          if (u.text) this.onResult?.({ text: u.text, definite: !!u.definite });
        }
      } else if (r.text) {
        this.onResult?.({ text: r.text, definite: !r.is_interim });
      }
    }
  }

  close() { try { this.ws.close(); } catch {} }
}

/** 一次性识别一段完整音频（VAD 切好的语音段），resolve 识别文本 */
function recognizeOnce(pcm, { timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => { try { asr.close(); } catch {} resolve(text); }, timeout);
    const asr = new AsrSession({
      onResult: (r) => { if (r.text) text = r.text; },
      onEnd: () => { clearTimeout(timer); resolve(text); },
      onError: (e) => { clearTimeout(timer); reject(e); },
    });
    let off = 0;
    const step = 3200; // 100ms
    const feed = () => {
      if (off >= pcm.length) { asr.finish(); return; }
      asr.write(pcm.slice(off, off + step));
      off += step;
      setTimeout(feed, 30); // 稍快于实时推完
    };
    // 等 WS open 后再喂（write 内部已检查 readyState，但首块要等 open）
    asr.ws.once('open', () => setTimeout(feed, 100));
  });
}

module.exports = { AsrSession, recognizeOnce, ASR_URL };
