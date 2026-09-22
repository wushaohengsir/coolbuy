/**
 * 麦克风采集诊断：录 1 秒 16kHz PCM，验证 dshow 设备名可用
 * 运行：node mic-test.js [设备名]
 * 不带参数则依次尝试：配置的 MIC_DEVICE / 两个 Realtek 设备 alternative name / 中文名
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
require('./agent-env')(); // 复用 .env 加载

const candidates = [
  process.env.MIC_DEVICE,
  'audio=麦克风 (Realtek(R) Audio)',
  'audio=麦克风阵列 (Realtek(R) Audio)',
  process.argv[2],
].filter(Boolean);

(async () => {
  for (const dev of candidates) {
    process.stdout.write(`尝试 ${dev} ... `);
    const ok = await tryDevice(dev);
    if (ok) { console.log(`\n可用设备：${dev}\n把它填到 .env 的 MIC_DEVICE 即可`); process.exit(0); }
  }
  console.error('\n所有候选设备均失败，运行 ffmpeg -list_devices true -f dshow -i dummy 检查');
  process.exit(1);
})();

function tryDevice(dev) {
  return new Promise((resolve) => {
    const out = 'mic_test.pcm';
    try { fs.unlinkSync(out); } catch {}
    const ff = spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'dshow', '-i', dev,
      '-ar', '16000', '-ac', '1', '-f', 's16le', '-t', '1', out,
    ], { stdio: ['ignore', 'ignore', 'ignore'] });
    ff.on('exit', () => {
      const ok = fs.existsSync(out) && fs.statSync(out).size > 16000;
      console.log(ok ? `OK (${fs.statSync(out).size} 字节)` : '失败');
      resolve(ok);
    });
  });
}
