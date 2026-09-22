'use strict';
// 用已有 mic_live.pcm 测试不同 ASR 参数组合
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const WebSocket = require('ws');
const P = require('./protocol');
require('./agent-env')();

const pcm = fs.readFileSync('mic_live.pcm');

const variants = [
  ['A: 去掉 result_type(single→默认full)', { model_name: 'bigmodel', enable_punc: true, enable_itn: true, show_utterances: true }],
  ['B: 加 enable_nonstream', { model_name: 'bigmodel', enable_punc: true, enable_itn: true, show_utterances: true, enable_nonstream: true }],
  ['C: 最简配置', { model_name: 'bigmodel' }],
];

function run(label, request) {
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async', {
      headers: {
        Authorization: `Bearer; ${process.env.DOUBAO_ACCESS_KEY}`,
        'X-Api-App-Key': process.env.DOUBAO_APP_ID,
        'X-Api-Access-Key': process.env.DOUBAO_ACCESS_KEY,
        'X-Api-Resource-Id': process.env.ASR_RESOURCE_ID || 'volc.seedasr.sauc.duration',
        'X-Api-Request-Id': crypto.randomUUID(),
      },
      handshakeTimeout: 10000,
    });
    let seq = 1;
    let texts = [];
    ws.on('open', () => {
      ws.send(P.buildFrame({
        messageType: P.MSG_FULL_CLIENT, flags: P.FLAG_POS_SEQ,
        serialization: P.SERIAL_JSON, compression: P.COMPRESS_GZIP, sequence: seq,
        payload: zlib.gzipSync(Buffer.from(JSON.stringify({
          audio: { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 },
          request,
        }))),
      }));
      let off = 0;
      const feed = () => {
        if (off >= pcm.length) { finish(); return; }
        seq += 1;
        ws.send(P.buildFrame({
          messageType: P.MSG_AUDIO_CLIENT, flags: P.FLAG_POS_SEQ,
          serialization: P.SERIAL_RAW, compression: P.COMPRESS_GZIP, sequence: seq,
          payload: zlib.gzipSync(pcm.slice(off, off + 3200)),
        }));
        off += 3200;
        setTimeout(feed, 40);
      };
      const finish = () => {
        seq += 1;
        ws.send(P.buildFrame({
          messageType: P.MSG_AUDIO_CLIENT, flags: P.FLAG_NEG_SEQ,
          serialization: P.SERIAL_RAW, compression: P.COMPRESS_GZIP, sequence: -seq,
          payload: zlib.gzipSync(Buffer.alloc(0)),
        }));
      };
      setTimeout(feed, 200);
    });
    ws.on('message', (raw) => {
      const f = P.parseFrame(raw);
      if (f.serialization === 1 && f.payload.length) {
        try {
          const j = JSON.parse(f.payload.toString());
          const t = j?.result?.text;
          if (t) texts.push(t);
          if (j?.result?.utterances) for (const u of j.result.utterances) if (u.text) texts.push(u.text);
        } catch {}
      }
      if (f.flags & P.FLAG_LAST_NO_SEQ) {
        console.log(`${label} => ${texts.length ? '识别: ' + texts.join(' | ') : '（无文本）'}`);
        try { ws.close(); } catch {}
        resolve();
      }
    });
    ws.on('error', (e) => { console.log(`${label} => 错误: ${e.message}`); resolve(); });
    ws.on('unexpected-response', (q, r) => { console.log(`${label} => HTTP ${r.statusCode}`); r.resume(); resolve(); });
    setTimeout(() => { console.log(`${label} => 超时`); try { ws.close(); } catch {}; resolve(); }, 25000);
  });
}

(async () => {
  for (const [label, request] of variants) await run(label, request);
  process.exit(0);
})();
