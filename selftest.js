'use strict';
/**
 * 自测：TTS 生成"我想买这个耳机" → 降采样 16k → 过 VAD → recognizeOnce
 * 模拟完整用户语音输入路径（无需真人说话）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const { synthesize } = require('./tts');
const { SileroVad } = require('./vad');
const { recognizeOnce } = require('./asr');

(async () => {
  console.log('1) TTS 生成测试语音…');
  const parts = [];
  for await (const pcm of synthesize('我想买这个耳机，都看了很久了。')) {
    parts.push(pcm);
  }
  const pcm24k = Buffer.concat(parts);
  console.log(`   24k PCM ${pcm24k.length} 字节 ≈ ${(pcm24k.length / 96000).toFixed(1)}s`);

  // 用 ffmpeg 标准重采样 24k→16k（自写抽点会破坏音质，Silero 认不出）
  fs.writeFileSync('tts_selftest_24k.pcm', pcm24k);
  const { execSync } = require('child_process');
  execSync(`"${process.env.FFMPEG_PATH || 'ffmpeg'}" -hide_banner -loglevel error -f s16le -ar 24000 -ac 1 -i tts_selftest_24k.pcm -f s16le -ar 16000 -y selftest_16k.pcm`);
  const pcm16 = fs.readFileSync('selftest_16k.pcm');
  console.log(`   16k PCM ${pcm16.length} 字节（ffmpeg 重采样）`);

  // 前后各拼 1 秒静音，模拟真实麦克风流
  const silence = Buffer.alloc(32000);
  const stream = Buffer.concat([silence, pcm16, silence]);

  // 2) VAD 切段
  console.log('2) VAD 切段（Silero ONNX）…');
  const segments = [];
  const vad = new SileroVad({
    onSpeechStart: () => console.log('   [VAD] 语音开始'),
    onSpeechEnd: (audio) => {
      console.log(`   [VAD] 语音结束，段长 ${(audio.length / 32000).toFixed(2)}s`);
      segments.push(audio);
    },
  });
  // 等模型加载
  await new Promise((r) => setInterval(() => vad.ready && r(), 50));
  // 模拟实时流：每次喂 100ms
  for (let off = 0; off < stream.length; off += 3200) {
    vad.write(stream.slice(off, off + 3200));
    await new Promise((r) => setTimeout(r, 20));
  }
  await new Promise((r) => setTimeout(r, 1000)); // 等判停
  if (!segments.length) { console.log('   ✘ VAD 未检测到语音！'); process.exit(1); }

  // 3) recognizeOnce
  console.log('3) ASR 一次性识别…');
  const text = await recognizeOnce(segments[0]);
  console.log(`   识别结果: "${text}"`);
  const ok = text.includes('耳机') || text.includes('想买');
  console.log(ok ? '\n✔ 自测通过：VAD 切段 + ASR 识别全链路正常' : '\n✘ 识别文本不符');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
