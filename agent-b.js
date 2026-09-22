/**
 * agent-b —— B 路线主链路：麦克风 → 流式ASR → 大脑(LLM+工具) → 流式TTS → 扬声器
 *
 * 用法：
 *   node agent-b.js --text "我就想买这个耳机"     # 纯文本调试（不走语音，LLM_MOCK=1 可无 key）
 *   node agent-b.js --text --interview            # 面试模式（AI 先开口）
 *   node agent-b.js                               # 全语音 CLI（需火山 key + 方舟 key），支持抢话打断
 *   node agent-b.js --bridge                      # 插件桥模式：起 WS 服务，等插件 Start/Stop/Interview
 *   node agent-b.js --asr-test                    # 用 mic_test.pcm 验证 ASR 链路
 *
 * 打断（barge-in）：AI 说话期间 VAD 以 barge 模式持续监听，用户起话即
 * 静音 + abort LLM（发言通道 speaker.js 管代际与播放，引擎管大脑在途请求）。
 *
 * Provider：ASR 默认本地 SenseVoice（免 key），TTS 默认豆包云端；
 * 通过 data/providers.json 或 ASR_PROVIDER / TTS_PROVIDER 切换，见 providers.js。
 */

'use strict';
const { spawn } = require('child_process');
const crypto = require('crypto');
const T = require('./tools');
const { think, interview } = require('./brain');
const { AsrSession } = require('./asr'); // --asr-test 专用（豆包云端链路测试）
require('./agent-env')();

// Provider 装配（ASR/TTS 可插拔，选择逻辑见 providers.js）
const { getAsr, getTts } = require('./providers');
let asrProvider = null;
let ttsProvider = null;
try {
  ttsProvider = getTts();
} catch (e) { console.error(e.message); process.exit(1); }
const synthesize = (text, opts) => ttsProvider.synthesize(text, opts);

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

// ---------- 发言通道与打断 ----------
// speaker.js 是深模块：合成/播放/代际/静音全部收在其 interface 后面。
// 本文件只保留"大脑在途请求"的打断语义，speaker 实例由各模式启动时创建。
const { createSpeaker } = require('./speaker');

/** CLI 事件渲染（speaker 的 sys/error 事件也走这里） */
const cliEvent = (ev) => {
  switch (ev.type) {
    case 'user': log.user(ev.text); break;
    case 'agent': log.agent(ev.text); break;
    case 'sys': log.sys(ev.text); break;
    case 'error': console.log(c.red(`  ${ev.message}`)); break;
    case 'outcome': console.log(c.green(`\n  [会话结束] outcome=${ev.outcome}，insist=${ev.insistCount}`)); break;
  }
};

// ---------- TTS 链路测试：合成一句话并播放，自动判定问题在云端还是播放设备 ----------
if (has('--tts-test')) {
  (async () => {
    const text = args.find((a, i) => args[i - 1] === '--tts-test' && !a.startsWith('--'))
      || '老板，听得到这条，说明合成和播放都正常。';
    log.sys(`合成中：「${text}」`);
    const sp = createSpeaker({ synthesize, onEvent: cliEvent });
    const voice = sp.speakStream();
    voice.onDelta(text);
    voice.flush();
    const t0 = Date.now();
    await sp.drain();
    log.sys(`播放队列耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    log.sys('判定：无 error 事件 = 云端 + 播放设备正常（听不到请查系统音量/默认输出设备）');
    process.exit(0);
  })().catch((e) => { console.error(c.red(`TTS 测试失败（云端合成环节）: ${e.message}`)); process.exit(1); });
  return;
}

// ---------- 文本调试模式 ----------
if (has('--text')) {
  (async () => {
    T.startSession(MOCK_PAGE);
    const history = [];
    const sp = createSpeaker({ synthesize, onEvent: cliEvent });
    const voice = sp.speakStream();
    const userInput = args.find((a, i) => args[i - 1] === '--text' && !a.startsWith('--'))
      || args.find((a) => !a.startsWith('--'));

    if (has('--interview')) {
      log.sys('面试模式：小冷先开口');
      const reply = await interview(history, (d) => { process.stdout.write(c.cyan(d)); voice.onDelta(d); });
      console.log();
      history.push({ role: 'assistant', content: reply });
    }
    if (userInput && userInput !== '--text') {
      log.user(userInput);
      const reply = await think(userInput, history, (d) => { process.stdout.write(c.cyan(d)); voice.onDelta(d); });
      console.log();
      history.push({ role: 'user', content: userInput }, { role: 'assistant', content: reply });
    }
    voice.flush?.();
    await sp.drain();
    // 打印会话结论
    const { outcome, insistCount } = T.concludeSession();
    console.log(c.green(`\n  [会话结束] outcome=${outcome}，insist=${insistCount}`));
    process.exit(0);
  })().catch((e) => { console.error(c.red(e.stack || e.message)); process.exit(1); });
  return;
}

// ---------- VAD 调试：实时打印人声概率，定位"听不到"在音频采集还是 VAD 阈值 ----------
if (has('--vad-debug')) {
  const { SileroVad } = require('./vad');
  let n = 0;
  let asr = null;
  try { asr = getAsr(); } catch (e) { console.error(c.red('ASR 初始化失败: ' + e.message)); process.exit(1); }
  const vad = new SileroVad({
    onSpeechStart: () => console.log(c.green('  [起话]')),
    onSpeechEnd: async (audio) => {
      const t = Date.now();
      const r = await asr.recognize(audio);
      console.log(c.cyan(`  [识别] ${JSON.stringify(r.text)}`), c.dim(`${(audio.length / 32000).toFixed(2)}s ${Date.now() - t}ms`));
    },
  });
  const orig = vad._onProb.bind(vad);
  let frameIdx = 0;
  vad._onProb = (p, f) => {
    if (frameIdx++ % 5 === 0) console.log(c.dim(`    p=${p.toFixed(2)} ${p >= 0.30 ? 'V' : '·'} state=${vad.state} hit=${vad.hitCount}`));
    return orig(p, f);
  };
  const mic = spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'dshow', '-i', process.env.MIC_DEVICE || 'audio=麦克风阵列 (Realtek(R) Audio)',
    '-ar', '16000', '-ac', '1', '-f', 's16le', '-',
  ], { stdio: ['ignore', 'pipe', 'inherit'] });
  mic.stdout.on('data', (chunk) => vad.write(chunk));
  console.log(c.dim('\n  ── VAD 调试：开口说话，观察 p 值。p<0.30 是静音，人声应 >0.30 并触发[起话]。Ctrl+C 退出 ──\n'));
  process.on('SIGINT', () => { try { mic.kill(); } catch {} process.exit(0); });
  return;
}

// ---------- 全语音引擎（CLI 直接启动，或 --bridge 由插件远程启动） ----------
// 打断设计：
//   - VAD 全程常开，AI 说话时不再 pause，用户随时可以抢话
//   - AI 说话期间 VAD 切 barge 模式（门槛抬高抗扬声器回声）
//   - 检测到用户起话 → interrupt()：静音（speaker.hush）+ abort LLM
//   - 用户 utterance 走正常链路（判停 → ASR → 大脑），与被打断的旧轮次无竞态
// 判停设计（smart-turn）：
//   - VAD 报 ~0.2s 静音 → 语义模型判"说完没有"（用户思考停顿不会被切断）
//   - 判"未完"继续听，3s 连续静音兜底；SMART_TURN=0 退回纯 VAD 静音判停
const { SileroVad } = require('./vad');
const { SmartTurn } = require('./turn');

try {
  asrProvider = getAsr();
} catch (e) {
  console.error(e.message);
  console.error('提示：设 ASR_PROVIDER=doubao 可退回云端 ASR（需火山 key）');
  process.exit(1);
}
log.sys(`Provider：ASR=${asrProvider.name}，TTS=${ttsProvider.name}`);

/** 语音引擎：一次会话的生命周期 = start() → 对话 → stop()。
 *  onEvent(ev) 接收运行事件（state/user/agent/sys/outcome/error），
 *  CLI 模式打印到终端，bridge 模式转发给插件。 */
function createVoiceEngine({ onEvent } = {}) {
  const emit = onEvent || (() => {});
  const speaker = createSpeaker({ synthesize, onEvent: emit });
  const history = [];
  let mode = 'listening';             // idle | listening | thinking | speaking
  let utterChain = Promise.resolve(); // 用户话语串行处理，防打断与旧轮次竞态
  let lastReplyText = '';             // 本轮小冷已生成文本（回声自滤用）
  let currentAbort = null;            // 在途 LLM 请求的 AbortController
  let mic = null;
  let active = false;
  let paused = false;                 // Stop 软停状态（暂停语音但会话保留）

  const norm = (s) => (s || '').replace(/[\s，。！？,.!?~…、；：]/g, '');
  const setMode = (m) => { mode = m; emit({ type: 'state', state: m }); };

  /** 打断：静音 + 作废在途 LLM 生成。 */
  const interrupt = () => {
    speaker.hush();
    if (currentAbort) { try { currentAbort.abort(); } catch {} currentAbort = null; }
  };

  const smartTurn = process.env.SMART_TURN === '0' ? null : new SmartTurn();
  if (smartTurn) smartTurn._initPromise.then(() => emit({ type: 'sys', text: 'Smart Turn 语义判停已就绪' }));

  /** 跑一轮回复（用户话语 or Interview 反问），内部处理打断/历史/播放 */
  const runReply = async ({ userText, isInterview } = {}) => {
    const t0 = Date.now();
    setMode('thinking');
    const abort = new AbortController();
    currentAbort = abort;
    const g = speaker.gen;
    lastReplyText = '';
    const voice = speaker.speakStream();
    let reply = '';
    let gotFirstToken = false;
    const onDelta = (d) => {
      if (!gotFirstToken) {
        gotFirstToken = true;
        setMode('speaking');
        vad.setBargeMode(true); // 开始往外说话 → 抗回声打断门槛
        emit({ type: 'sys', text: `大脑首字 ${(Date.now() - t0) / 1000}s` });
      }
      lastReplyText += d;
      voice.onDelta(d);
    };
    try {
      reply = isInterview
        ? await interview(history, onDelta, { signal: abort.signal })
        : await think(userText, history, onDelta, { signal: abort.signal });
      const finalReply = reply ? (abort.signal.aborted ? `${reply}（被打断）` : reply) : '（被打断，未回复）';
      if (isInterview) history.push({ role: 'assistant', content: finalReply });
      else history.push({ role: 'user', content: userText }, { role: 'assistant', content: finalReply });
      emit({ type: 'agent', text: finalReply });
      if (g === speaker.gen) {
        voice.flush?.();
        await speaker.drain(); // 等播完
        emit({ type: 'sys', text: `播完 ${(Date.now() - t0) / 1000}s` });
      }
    } catch (e) {
      if (!abort.signal.aborted) emit({ type: 'error', message: `回复失败: ${e.message}` });
    } finally {
      if (currentAbort === abort) currentAbort = null;
      // 只有"没被更新的打断作废"的轮次才归还状态；被打断的轮次由新轮次接管
      if (g === speaker.gen && active) { vad.setBargeMode(false); setMode('listening'); }
    }
  };

  const vad = new SileroVad({
    onMaybeEnd: smartTurn && (async (audio) => {
      const t0 = Date.now();
      const r = await smartTurn.predict(audio);
      emit({ type: 'sys', text: `判停:${r.complete ? '说完' : '未完'} p=${r.probability.toFixed(2)} ${Date.now() - t0}ms` });
      return r.complete;
    }),
    onSpeechStart: () => {
      emit({ type: 'sys', text: '[听]' });
      if (mode === 'thinking' || mode === 'speaking') {
        emit({ type: 'sys', text: '用户打断，掐断当前回复' });
        interrupt();
        setMode('listening'); // 发言权交给用户
      }
    },
    onSpeechEnd: (audio) => {
      utterChain = utterChain.then(async () => {
        const dur = (audio.length / 32000).toFixed(1);
        const tAsr = Date.now();
        let text = '';
        try {
          if (asrProvider.recognize) {
            // 本地 ASR：顺带拿情绪标签（将来可喂大脑）
            const r = await asrProvider.recognize(audio);
            text = r.text;
            if (r.emotion) emit({ type: 'sys', text: `情绪:${r.emotion.toLowerCase()}` });
          } else {
            text = await asrProvider.recognizeOnce(audio);
          }
        } catch (e) { emit({ type: 'sys', text: `ASR: ${e.message}` }); }
        emit({ type: 'sys', text: `ASR ${Date.now() - tAsr}ms` });
        if (!text || !text.trim()) { emit({ type: 'sys', text: `（${dur}s 语音段未识别出内容）` }); return; }
        // 回声自滤：识别结果是小冷自己刚说的话 → 扬声器串音触发的误打断，忽略
        if (norm(text).length >= 4 && norm(lastReplyText).includes(norm(text))) {
          emit({ type: 'sys', text: '（识别到扬声器回声，忽略）' });
          return;
        }
        emit({ type: 'user', text });
        await runReply({ userText: text });
      });
    },
  });

  return {
    get active() { return active; },

    /** Start：开始会话（pageCtx 来自插件抓取；CLI 模式传 MOCK_PAGE）。
     *  每次 Start 都是全新对话：清空上下文记忆，上一轮的话不带进这一轮。 */
    start(pageCtx) {
      if (active) { emit({ type: 'sys', text: '会话已在进行中' }); return; }
      const page = pageCtx || MOCK_PAGE;
      T.startSession(page);
      history.length = 0;      // 跨会话不保留记忆（会话内多轮记忆由 history 承担）
      lastReplyText = '';
      active = true;
      emit({ type: 'sys', text: `会话开始：${page.item || '未知商品'} ¥${page.price ?? '?'}（${page.promo || '无促销话术'}）` });
      setMode('listening');
      mic = spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'dshow', '-i', process.env.MIC_DEVICE || 'audio=麦克风阵列 (Realtek(R) Audio)',
        '-ar', '16000', '-ac', '1', '-f', 's16le', '-',
      ], { stdio: ['ignore', 'pipe', 'inherit'] });
      mic.stdout.on('data', (chunk) => vad.write(chunk));
      mic.on('error', (e) => emit({ type: 'error', message: `麦克风启动失败: ${e.message}` }));
    },

    /** Interview：小冷主动反问（会话进行中才有效） */
    interview() {
      if (!active) { emit({ type: 'sys', text: 'Interview 需要在会话进行中' }); return; }
      utterChain = utterChain.then(() => runReply({ isInterview: true }));
    },

    /** Stop 键 = 暂停/恢复语音（软停）：强制小冷闭嘴并停止监听，会话保留；再按恢复 */
    togglePause() {
      if (!active) { emit({ type: 'sys', text: '当前没有进行中的会话' }); return; }
      paused = !paused;
      if (paused) {
        interrupt();          // 静音 + abort 在途 LLM
        vad.pause();          // 停止监听（丢弃音频，状态保留）
        setMode('paused');
        emit({ type: 'sys', text: '已暂停：小冷闭嘴、停止监听。再按 Stop 恢复' });
      } else {
        vad.resume();
        setMode('listening');
        emit({ type: 'sys', text: '已恢复，可以继续说话' });
      }
    },

    /** 会话中页面变化（切换 SKU/款式）时刷新 Agent 快照 */
    updatePage(page) {
      if (!page) return;
      const merged = T.updatePage(page);
      if (merged) emit({ type: 'sys', text: `页面已更新：${merged.item || ''} ¥${merged.price ?? '?'}（${merged.promo || ''}）` });
    },

    /** 结束会话（红色 Start 杀进程前先落盘结论；进程留下） */
    stop() {
      if (!active) { emit({ type: 'sys', text: '当前没有进行中的会话' }); return; }
      active = false;
      paused = false;
      interrupt();
      try { mic?.kill(); } catch {}
      mic = null;
      vad.setBargeMode(false);
      vad.resume(); // 清空缓冲与状态机（不重置 LSTM）
      const { outcome, insistCount } = T.concludeSession();
      setMode('idle');
      emit({ type: 'outcome', outcome, insistCount });
    },
  };
}

// ---------- 插件桥模式：起 WS 服务，等插件三键指令 ----------
if (has('--bridge')) {
  const { Bridge } = require('./bridge');
  let bridge = null;
  const engine = createVoiceEngine({
    onEvent: (ev) => { cliEvent(ev); bridge?.send(ev); },
  });
  bridge = new Bridge({
    onStart: (page) => engine.start(page),
    onStop: () => engine.togglePause(),          // Stop 键：暂停/恢复
    onEnd: () => engine.stop(),                  // 红色 Start 杀进程前落盘结论
    onInterview: () => engine.interview(),
    onPageUpdate: (page) => engine.updatePage(page),
    status: () => ({ active: engine.active }),   // 新面板连上时继承状态用
  });
  // 大脑的"眼睛"：get_page_context 工具深挖时向插件要实时 DOM 详情
  T.setPageDetailFetcher(() => bridge.fetchPage());
  bridge.start({ asr: asrProvider.name, tts: ttsProvider.name });
  log.sys('插件桥模式：等插件按 Start 后开始对话。Ctrl+C 退出');
  process.on('SIGINT', () => { engine.stop(); setTimeout(() => process.exit(0), 300); });
  return;
}

// ---------- CLI 全语音模式：直接开会话 ----------
const engine = createVoiceEngine({ onEvent: cliEvent });
engine.start(MOCK_PAGE);
console.log(c.dim('\n  ── 全语音模式。开口说话（说完整句停一秒），小冷接话。小冷说话时可直接抢话打断。Ctrl+C 结束 ──\n'));
process.on('SIGINT', () => {
  console.log();
  engine.stop();
  setTimeout(() => process.exit(0), 500);
});
