'use strict';
// 实时调试：打印 VAD 内部状态，看麦克风数据有没有进来、能量多少
const { spawn } = require('child_process');
const { EnergyVad } = require('./vad');

let lastLog = 0;
let frames = 0, maxRms = 0;
const origWrite = EnergyVad.prototype._processFrame;

const vad = new EnergyVad({
  onSpeechStart: () => console.log('>>> 语音开始'),
  onSpeechEnd: (a) => console.log(`>>> 语音结束 ${(a.length/32000).toFixed(2)}s`),
});

// hook 帧处理打日志
vad._processFrame = function(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 2) { const v = frame.readInt16LE(i)/32768; sum += v*v; }
  const rms = Math.sqrt(sum/(frame.length/2))*32768;
  frames++;
  if (rms > maxRms) maxRms = rms;
  if (Date.now() - lastLog > 1000) {
    lastLog = Date.now();
    console.log(`帧:${frames} RMS峰值:${maxRms.toFixed(0)} 噪声底:${vad.noiseFloor?.toFixed(0)} 状态:${this.state||'?'}`);
    maxRms = 0;
  }
  return origWrite.call(this, frame);
};

const mic = spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
  '-hide_banner','-loglevel','error','-f','dshow',
  '-i', process.env.MIC_DEVICE || 'audio=麦克风阵列 (Realtek(R) Audio)',
  '-ar','16000','-ac','1','-f','s16le','-',
], { stdio: ['ignore','pipe','inherit'] });
mic.stdout.on('data', (c) => vad.write(c));
console.log('调试中，请说话。30 秒后退出');
setTimeout(() => { console.log('总帧数:', frames); process.exit(0); }, 30000);
