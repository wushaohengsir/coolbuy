/**
 * agent-b —— B 路线主链路：麦克风 → 流式ASR → 大脑(LLM+工具) → 流式TTS → 扬声器
 *
 * 用法：
 *   node agent-b.js --text "我就想买这个耳机"     # 纯文本调试（不走语音，LLM_MOCK=1 可无 key）
 *   node agent-b.js --text --interview            # 面试模式（AI 先开口）
 *   node agent-b.js                               # 全语音（需火山 key + 方舟 key）
 *   node agent-b.js --asr-test                    # 用 mic_test.pcm 验证 ASR 链路
 */

'use strict';
const { spawn } = require('child_process');
const crypto = require('crypto');
const T = require('./tools');
const { think, interview } = require('./brain');
const { AsrSession } = require('./asr');
const { synthesize } = require('./tts');
require('./agent-env')();

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};
const log = {
  sys: (s) => console.log(c.dim(`  [系统] ${s}`)),
  user: (s) => console.log(c.yellow(`  你: ${s}`)),
  agent: (s) => console.log(c.cyan(`  小冷: ${s}`)),
  tool: (s) => console.log(c.dim(`  [工具] ${s}`)),
};

// ---- mock 页面上下文（插件上线后由本地 WS 推送替代） ----
const MOCK_PAGE = {
  item: '旗舰降噪耳机',
  price: 399,
  platform: '某电商',
  promo: '限时秒杀，还剩 2 件',
  dwellSeconds: 240,
};

const args = process.argv.slice(2);
const has = (f) => args.includes(f);

// ---------- ASR 链路测试 ----------
if (has('--asr-test')) {
  const fs = require('fs');
  if (!fs.existsSync('mic_test.pcm')) { console.log('先跑 node mic-test.js 生成 mic_test.pcm'); process.exit(1); }
  log.sys('ASR 链路测试：喂 mic_test.pcm（1 秒录音）…');
  const asr = new AsrSession({
    onResult: (r) => log.sys(`识别${r.definite ? '(定稿)' : '(中间)'}: ${r.text}`),
    onEnd: () => { log.sys('ASR 结束'); process.exit(0); },
    onError: (e) => { console.log(c.red(`ASR 错误: ${e.message}`)); process.exit(1); },
  });
  const pcm = fs.readFileSync('mic_test.pcm');
  // 按块喂
  let off = 0;
  const feed = () => {
    if (off >= pcm.length) { asr.finish(); return; }
    asr.write(pcm.slice(off, off + 3200)); // 100ms
    off += 3200;
    setTimeout(feed, 50);
  };
  setTimeout(feed, 300);
  setTimeout(() => { log.sys('超时退出'); process.exit(1); }, 20000);
  return;
}

// ---------- Start 会话（三键交互的 start） ----------
T.startSession(MOCK_PAGE);
log.sys(`会话开始（模拟插件推送页面：${MOCK_PAGE.item} ¥${MOCK_PAGE.price}）`);

// ---------- 播放器：每次播放起独立 ffplay，播完退出（避免 -autoexit 后 stdin 变 EPIPE 卡死） ----------
async function playPcmStream(pcmIterator) {
  return new Promise(async (resolve, reject) => {
    const p = spawn(process.env.FFPLAY_PATH || 'ffplay', [
      '-nodisp', '-autoexit', '-loglevel', 'quiet',
      '-f', 's16le', '-ar', '24000', '-ch_layout', 'mono', '-',
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    p.stdin.on('error', () => { /* EPIPE 时播放器已退出，忽略 */ });
    p.on('exit', () => resolve());
    p.on('error', reject);
    try {
      for await (const chunk of pcmIterator) {
        if (!p.stdin.writable) break;
        p.stdin.write(chunk);
      }
    } catch (e) { /* 忽略写入错误 */ }
    p.stdin.end();
    // 兜底超时：30 秒后强杀
    setTimeout(() => { try { p.kill(); } catch {} }, 30000).unref?.();
  });
}

// ---------- TTS：按句流式合成（Seed-TTS 2.0，返回 PCM s16le 24k mono） ----------
let ttsQueue = Promise.resolve();
function speakStream() {
  let pending = '';
  const speak = (sentence) => {
    ttsQueue = ttsQueue.then(async () => {
      // 每句独立播放：合成迭代器直接交给 playPcmStream，边合成边写、写完 end、播完 resolve
      await playPcmStream(synthesize(sentence));
    }).catch((e) => log.sys(`TTS 失败: ${e.message}`));
  };
  const onDelta = (delta) => {
    pending += delta;
    const m = pending.match(/^(.*?[。！？!?~\n])(.*)$/s);
    if (m && m[1].trim().length >= 4) {
      pending = m[2];
      speak(m[1].trim());
    }
  };
  const flush = () => { if (pending.trim()) { speak(pending.trim()); pending = ''; } };
  return { onDelta, flush };
}

// ---------- 文本调试模式 ----------
if (has('--text')) {
  (async () => {
    const history = [];
    const speaker = speakStream([]);
    const userInput = args.find((a, i) => args[i - 1] === '--text' && !a.startsWith('--'))
      || args.find((a) => !a.startsWith('--'));

    if (has('--interview')) {
      log.sys('面试模式：小冷先开口');
      const reply = await interview(history, (d) => { process.stdout.write(c.cyan(d)); speaker.onDelta(d); });
      console.log();
      history.push({ role: 'assistant', content: reply });
    }
    if (userInput && userInput !== '--text') {
      log.user(userInput);
      const reply = await think(userInput, history, (d) => { process.stdout.write(c.cyan(d)); speaker.onDelta(d); });
      console.log();
      history.push({ role: 'user', content: userInput }, { role: 'assistant', content: reply });
    }
    await speaker.flush?.();
    await ttsQueue;
    // 打印会话结论
    const outcome = T.session.insistCount >= 2 ? 'released' : 'aborted';
    console.log(c.green(`\n  [会话结束] outcome=${outcome}，insist=${T.session.insistCount}`));
    T.stopSession(outcome);
    process.exit(0);
  })().catch((e) => { console.error(c.red(e.stack || e.message)); process.exit(1); });
  return;
}

// ---------- 全语音模式（Silero 神经网络 VAD 切段 → 每段一次 ASR） ----------
const { SileroVad } = require('./vad');
const { recognizeOnce } = require('./asr');

(async () => {
  const history = [];

  const handleUtterance = async (text) => {
    const t0 = Date.now();
    log.user(text);
    // vad 已在 onSpeechEnd 里 pause
    let gotFirstToken = false;
    const speaker = speakStream();
    try {
      const reply = await think(text, history, (d) => {
        if (!gotFirstToken) { log.sys(`大脑首字 ${(Date.now() - t0) / 1000}s`); gotFirstToken = true; }
        speaker.onDelta(d);
      });
      console.log();
      history.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
      await speaker.flush?.();
      await ttsQueue; // 等播完
      log.sys(`播完 ${(Date.now() - t0) / 1000}s`);
    } catch (e) {
      console.log(c.red(`回复失败: ${e.message}`));
    }
    setTimeout(() => vad.resume(), 300); // 稍等扬声器余音散去
  };

  const vad = new SileroVad({
    onSpeechStart: () => process.stdout.write(c.dim('  [听] ')),
    onSpeechEnd: (audio) => {
      // 判停瞬间立即暂停 VAD（不等 async 链），防处理期间继续吞音频
      vad.pause();
      if (busy) { vad.resume(); return; }
      busy = true;
      (async () => {
        try {
          const dur = (audio.length / 32000).toFixed(1);
          let text = '';
          try { text = await recognizeOnce(audio); } catch (e) { log.sys(`ASR: ${e.message}`); }
          process.stdout.write('\r' + ' '.repeat(8) + '\r');
          if (text && text.trim()) await handleUtterance(text);
          else { log.sys(`（${dur}s 语音段未识别出内容）`); vad.resume(); }
        } finally { busy = false; }
      })();
    },
  });
  let busy = false;

  const mic = spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'dshow', '-i', process.env.MIC_DEVICE || 'audio=麦克风阵列 (Realtek(R) Audio)',
    '-ar', '16000', '-ac', '1', '-f', 's16le', '-',
  ], { stdio: ['ignore', 'pipe', 'inherit'] });
  mic.stdout.on('data', (chunk) => vad.write(chunk));

  console.log(c.dim('\n  ── 全语音模式。开口说话（说完整句停一秒），小冷接话。Ctrl+C 结束 ──\n'));

  process.on('SIGINT', async () => {
    console.log();
    const outcome = T.session.insistCount >= 2 ? 'released' : 'cooled';
    log.sys(`会话结束（${outcome}）`);
    T.stopSession(outcome);
    try { mic.kill(); } catch {}
    setTimeout(() => process.exit(0), 500);
  });
})();
