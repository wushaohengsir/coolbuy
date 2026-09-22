'use strict';
// 录 5 秒语音 → 直接送 ASR 识别
const { spawn } = require('child_process');
const fs = require('fs');
const { AsrSession } = require('./asr');

console.log('=== 录音 5 秒，请对麦克风说一句话（如：我想买这个耳机）===');
const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'dshow',
  '-i', 'audio=麦克风阵列 (Realtek(R) Audio)', '-ar', '16000', '-ac', '1',
  '-f', 's16le', '-t', '5', '-y', 'mic_live.pcm'], { stdio: ['ignore', 'ignore', 'inherit'] });

ff.on('exit', () => {
  const buf = fs.readFileSync('mic_live.pcm');
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
