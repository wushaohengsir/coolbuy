/**
 * 火山引擎(豆包)语音 WebSocket 二进制帧协议 (JS 版)
 * 帧 = 4字节 header + 可选扩展字段(event/session_id/sequence/error_code)
 *     + 4字节 payload 长度 + payload
 *
 * byte0: protocol_version(高4) | header_size(低4, 单位4字节)
 * byte1: message_type(高4)     | flags(低4)
 * byte2: serialization(高4)    | compression(低4)
 * byte3: reserved 0x00
 *
 * 多字节整数字段一律大端(参考 Python 实现的 struct.pack ">i / >I")，
 * 音频 PCM 本身按小端采样。
 */

'use strict';

const zlib = require('zlib');

// ---- 常量 ----
const PROTOCOL_VERSION = 0b0001;
const HEADER_SIZE = 0b0001; // 单位 4 字节

// message_type (byte1 高4位)
const MSG_FULL_CLIENT = 0b0001; // 客户端完整请求(JSON)
const MSG_AUDIO_CLIENT = 0b0010; // 客户端纯音频
const MSG_FULL_SERVER = 0b1001; // 服务端完整响应
const MSG_AUDIO_SERVER = 0b1011; // 服务端纯音频 / ACK
const MSG_ERROR = 0b1111; // 服务端错误

// flags (byte1 低4位)
const FLAG_NO_SEQ = 0b0000;
const FLAG_POS_SEQ = 0b0001;
const FLAG_LAST_NO_SEQ = 0b0010;
const FLAG_NEG_SEQ = 0b0011;
const FLAG_WITH_EVENT = 0b0100;

// serialization (byte2 高4位)
const SERIAL_RAW = 0b0000;
const SERIAL_JSON = 0b0001;

// compression (byte2 低4位)
const COMPRESS_NONE = 0b0000;
const COMPRESS_GZIP = 0b0001;

// ---- 事件枚举 ----
const EV = {
  START_CONNECTION: 1,
  FINISH_CONNECTION: 2,
  CONNECTION_STARTED: 50,
  CONNECTION_FAILED: 51,
  CONNECTION_FINISHED: 52,
  START_SESSION: 100,
  CANCEL_SESSION: 101,
  FINISH_SESSION: 102,
  SESSION_STARTED: 150,
  SESSION_FINISHED: 152,
  SESSION_FAILED: 153,
  TASK_REQUEST: 200,
  SAY_HELLO: 300,
  TTS_SENTENCE_START: 350,
  TTS_SENTENCE_END: 351,
  TTS_RESPONSE: 352, // payload 是裸音频
  TTS_ENDED: 359,
  ASR_INFO: 450,
  ASR_RESPONSE: 451,
  ASR_ENDED: 459,
  CHAT_TTS_TEXT: 500,
  CHAT_RESPONSE: 550,
  CHAT_ENDED: 559,
};

// 连接级事件：不携带 session_id
const CONNECTION_EVENTS = new Set([
  EV.START_CONNECTION, EV.FINISH_CONNECTION,
  EV.CONNECTION_STARTED, EV.CONNECTION_FAILED, EV.CONNECTION_FINISHED,
]);

// ---- 构帧 ----
function buildFrame({
  messageType,
  flags = FLAG_WITH_EVENT,
  serialization = SERIAL_JSON,
  compression = COMPRESS_GZIP,
  event = null,
  sessionId = null,
  sequence = null,
  errorCode = null,
  payload = Buffer.alloc(0),
}) {
  const out = [];
  out.push(Buffer.from([
    (PROTOCOL_VERSION << 4) | HEADER_SIZE,
    (messageType << 4) | flags,
    (serialization << 4) | compression,
    0x00,
  ]));
  if (flags & FLAG_WITH_EVENT && event !== null) {
    const b = Buffer.alloc(4);
    b.writeInt32BE(event);
    out.push(b);
    if (!CONNECTION_EVENTS.has(event) && sessionId !== null) {
      const sid = Buffer.from(sessionId, 'utf8');
      const len = Buffer.alloc(4);
      len.writeUInt32BE(sid.length);
      out.push(len, sid);
    }
  }
  if (sequence !== null && flags & (FLAG_POS_SEQ | FLAG_NEG_SEQ)) {
    const b = Buffer.alloc(4);
    b.writeInt32BE(sequence);
    out.push(b);
  }
  if (errorCode !== null && messageType === MSG_ERROR) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(errorCode);
    out.push(b);
  }
  const size = Buffer.alloc(4);
  size.writeUInt32BE(payload.length);
  out.push(size, payload);
  return Buffer.concat(out);
}

/** 客户端 JSON 事件帧（gzip 压缩） */
function jsonFrame(event, obj, sessionId) {
  return buildFrame({
    messageType: MSG_FULL_CLIENT,
    flags: FLAG_WITH_EVENT,
    serialization: SERIAL_JSON,
    compression: COMPRESS_GZIP,
    event,
    sessionId: CONNECTION_EVENTS.has(event) ? undefined : sessionId,
    payload: zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8')),
  });
}

/** 客户端音频帧（gzip 压缩，与参考实现一致） */
function audioFrame(pcm, sessionId) {
  return buildFrame({
    messageType: MSG_AUDIO_CLIENT,
    flags: FLAG_WITH_EVENT,
    serialization: SERIAL_RAW,
    compression: COMPRESS_GZIP,
    event: EV.TASK_REQUEST,
    sessionId,
    payload: zlib.gzipSync(pcm),
  });
}

// ---- 解帧 ----
function parseFrame(raw) {
  const headerSize = (raw[0] & 0x0f) * 4;
  const messageType = raw[1] >> 4;
  const flags = raw[1] & 0x0f;
  const serialization = raw[2] >> 4;
  const compression = raw[2] & 0x0f;

  let off = headerSize;
  let event = null;
  let sessionId = null;
  let sequence = null;
  let errorCode = null;

  if (flags & FLAG_WITH_EVENT) {
    event = raw.readInt32BE(off);
    off += 4;
    if (!CONNECTION_EVENTS.has(event)) {
      const sl = raw.readUInt32BE(off);
      off += 4;
      if (sl > 0) {
        sessionId = raw.slice(off, off + sl).toString('utf8');
        off += sl;
      }
    }
  }
  if (flags & (FLAG_POS_SEQ | FLAG_NEG_SEQ)) {
    sequence = raw.readInt32BE(off);
    off += 4;
  }
  if (messageType === MSG_ERROR) {
    errorCode = raw.readUInt32BE(off);
    off += 4;
  }
  const size = raw.readUInt32BE(off);
  off += 4;
  let payload = raw.slice(off, off + size);
  if (compression === COMPRESS_GZIP && payload.length > 0) {
    try { payload = zlib.gunzipSync(payload); } catch { /* 保留原样 */ }
  }
  return { messageType, flags, serialization, compression, event, sessionId, sequence, errorCode, payload };
}

module.exports = {
  PROTOCOL_VERSION, HEADER_SIZE,
  MSG_FULL_CLIENT, MSG_AUDIO_CLIENT, MSG_FULL_SERVER, MSG_AUDIO_SERVER, MSG_ERROR,
  FLAG_NO_SEQ, FLAG_POS_SEQ, FLAG_LAST_NO_SEQ, FLAG_NEG_SEQ, FLAG_WITH_EVENT,
  SERIAL_RAW, SERIAL_JSON, COMPRESS_NONE, COMPRESS_GZIP,
  EV, CONNECTION_EVENTS,
  buildFrame, jsonFrame, audioFrame, parseFrame,
};
