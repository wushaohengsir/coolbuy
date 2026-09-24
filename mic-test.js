/**
 * 麦克风采集诊断：录 1 秒 16kHz PCM，验证当前系统音频设备名可用
 * 运行：node mic-test.js [设备名]
 * 不带参数则尝试配置的 MIC_DEVICE、当前平台默认设备和命令行参数
 */
'use strict';
const fs = require('fs');
const { spawnAudioCapture } = require('./audio');
require('./agent-env')(); // 复用 .env 加载

const candidates = [
  process.env.MIC_DEVICE,
  process.platform === 'win32' ? 'audio=default' : process.platform === 'darwin' ? ':0' : 'default',
  process.argv[2],
].filter(Boolean);

(async () => {
  for (const dev of candidates) {
    process.stdout.write(`尝试 ${dev} ... `);
    const ok = await tryDevice(dev);
    if (ok) { console.log(`\n可用设备：${dev}\n把它填到 .env 的 MIC_DEVICE 即可`); process.exit(0); }
  }
  console.error('\n所有候选设备均失败。Windows 运行 list-dev.js；macOS/Linux 检查系统麦克风权限和 ffmpeg 音频后端。');
  process.exit(1);
})();

function tryDevice(dev) {
  return new Promise((resolve) => {
    const out = 'mic_test.pcm';
    try { fs.unlinkSync(out); } catch {}
    const ff = spawnAudioCapture(dev, { stdio: ['ignore', 'ignore', 'ignore'] });
    const timer = setTimeout(() => { try { ff.kill(); } catch {} }, 3000);
    ff.on('exit', () => {
      clearTimeout(timer);
      const ok = fs.existsSync(out) && fs.statSync(out).size > 16000;
      console.log(ok ? `OK (${fs.statSync(out).size} 字节)` : '失败');
      resolve(ok);
    });
  });
}
