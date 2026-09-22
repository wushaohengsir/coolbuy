'use strict';
const { spawn } = require('child_process');
const ff = spawn('ffmpeg', ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
ff.stderr.on('data', (d) => { out += d.toString(); });
ff.on('exit', () => {
  const lines = out.split('\n').filter((l) => l.includes('(audio)'));
  console.log('音频输入设备:');
  for (const l of lines) console.log(' ', l.split('"')[1]);
});
