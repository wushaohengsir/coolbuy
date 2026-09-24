'use strict';
// 录 5 秒语音 → 直接送 ASR 识别
const fs = require('fs');
const { AsrSession } = require('./asr');
const { spawnAudioCapture } = require('./audio');

console.log('=== 录音 5 秒，请对麦克风说一句话（如：我想买这个耳机）===');
const ff = spawnAudioCapture(process.env.MIC_DEVICE, {
  stdio: ['ignore', 'pipe', 'inherit'],
});
const chunks = [];
ff.stdout.on('data', (chunk) => chunks.push(chunk));
setTimeout(() => { try { ff.kill('SIGINT'); } catch {} }, 5000);

ff.on('exit', () => {
  const buf = Buffer.concat(chunks);
  fs.writeFileSync('mic_live.pcm', buf);
  let max = 0;
  for (let i = 0; i < buf.length; i += 2) { const a = Math.abs(buf.readInt16LE(i)); if (a > max) max = a; }
  console.log(`录音峰值: ${max} ${max > 3000 ? '✔' : '（偏弱，建议离麦克风近一点/大声点）'}`);

  const asr = new AsrSession({
    onResult: (r) => console.log(`识别${r.definite ? '(定稿)' : '(中间)'}: ${r.text}`),
    onEnd: () => { console.log('== ASR 识别完成 =='); process.exit(0); },
    onError: (e) => { console.log('ASR 错误:', e.message); process.exit(1); },
  });
  let off = 0;
  const feed = () => {
    if (off >= buf.length) { asr.finish(); return; }
    asr.write(buf.slice(off, off + 3200));
    off += 3200;
    setTimeout(feed, 50);
  };
  setTimeout(feed, 300);
  setTimeout(() => { console.log('超时退出'); process.exit(0); }, 30000);
});
