'use strict';
// 模拟两轮对话：第一段语音→handleUtterance（含TTS播放）→ 第二段语音，看 VAD 是否恢复监听
const fs = require('fs');
const { SileroVad } = require('./vad');
const { execSync, spawn } = require('child_process');

(async () => {
  // 1) 用 TTS 生成两段"用户语音"（提前生成好）
  if (!fs.existsSync('turn1_16k.pcm') || !fs.existsSync('turn2_16k.pcm')) {
    const { synthesize } = require('./tts');
    for (const [f, text] of [['turn1_24k.pcm', '我想买个耳机。'], ['turn2_24k.pcm', '我上个月刚买过一个音箱。']]) {
      const parts = [];
      for await (const c of synthesize(text)) parts.push(c);
      fs.writeFileSync(f, Buffer.concat(parts));
    }
    execSync('ffmpeg -hide_banner -loglevel error -f s16le -ar 24000 -ac 1 -i turn1_24k.pcm -f s16le -ar 16000 -y turn1_16k.pcm');
    execSync('ffmpeg -hide_banner -loglevel error -f s16le -ar 24000 -ac 1 -i turn2_24k.pcm -f s16le -ar 16000 -y turn2_16k.pcm');
    console.log('测试语音已生成');
  }

  const vad = new SileroVad({
    onSpeechStart: () => console.log('  [VAD] 语音开始'),
    onSpeechEnd: (a) => console.log(`  [VAD] 语音结束 ${(a.length / 32000).toFixed(2)}s`),
  });
  await new Promise((r) => setInterval(() => vad.ready && r(), 50));
  console.log('模型就绪。模拟两轮（中间模拟5秒"播放时间"并 pause/resume）…\n');

  const silence = (ms) => Buffer.alloc(32 * ms); // 32字节/ms

  // 轮1
  const turn1 = fs.readFileSync('turn1_16k.pcm');
  const stream1 = Buffer.concat([silence(1000), turn1, silence(1000)]);
  for (let off = 0; off < stream1.length; off += 3200) {
    vad.write(stream1.slice(off, off + 3200));
    await new Promise((r) => setTimeout(r, 25));
  }
  await new Promise((r) => setTimeout(r, 1500));
  console.log('--- 轮1 结束，pause（模拟TTS播放）5秒 ---');
  vad.pause();
  await new Promise((r) => setTimeout(r, 5000));
  vad.resume();
  console.log('--- resume，开始轮2 ---');

  // 轮2
  const turn2 = fs.readFileSync('turn2_16k.pcm');
  const stream2 = Buffer.concat([silence(1000), turn2, silence(1000)]);
  for (let off = 0; off < stream2.length; off += 3200) {
    vad.write(stream2.slice(off, off + 3200));
    await new Promise((r) => setTimeout(r, 25));
  }
  await new Promise((r) => setTimeout(r, 1500));
  console.log('--- 轮2 结束 ---');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
