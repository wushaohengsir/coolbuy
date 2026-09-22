/**
 * 发言通道（Speaker）—— 小冷"往外说话"的一切，一个深模块。
 *
 * interface（调用方要知的全部）：
 *   speakStream() → { onDelta, flush }   新起一段发言（绑定当前代际）
 *   hush()                               立即静音：杀播放器、作废队列（代际 +1）
 *   drain() → Promise                    等排队的发言全部播完
 *   gen                                  当前代际（引擎据此判断"我这轮还有没有效"）
 *
 * 收进 implementation 后面的：代际令牌、ffplay 进程生命周期、TTS 逐句排队、
 * 播放器早退检测（设备打不开时大声报错，而不是被 -loglevel quiet 吞掉）。
 *
 * onEvent(ev) 上报：{ type:'error', message } 播放器/TTS 异常；{ type:'sys', text } 细节。
 */

'use strict';
const { spawn } = require('child_process');

function createSpeaker({ synthesize, onEvent } = {}) {
  if (!synthesize) throw new Error('createSpeaker: 缺少 synthesize（TTS provider）');
  const emit = onEvent || (() => {});

  let gen = 0;                       // 代际令牌
  let currentPlayer = null;          // 当前 ffplay 进程
  let ttsQueue = Promise.resolve();  // 逐句排队

  /** 静音：作废在途的合成与播放。打断/会话结束时调用。 */
  function hush() {
    gen++;
    if (currentPlayer) { try { currentPlayer.kill(); } catch {} }
  }

  // ---------- 播放器：每次播放起独立 ffplay，播完退出（避免 -autoexit 后 stdin 变 EPIPE 卡死） ----------
  async function playPcmStream(pcmIterator, myGen) {
    return new Promise(async (resolve, reject) => {
      if (myGen !== gen) return resolve(); // 已被打断
      const startedAt = Date.now();
      let written = 0;
      const p = spawn(process.env.FFPLAY_PATH || 'ffplay', [
        '-nodisp', '-autoexit', '-loglevel', 'quiet',
        '-f', 's16le', '-ar', '24000', '-ch_layout', 'mono', '-',
      ], { stdio: ['pipe', 'inherit', 'inherit'] });
      currentPlayer = p;
      p.stdin.on('error', () => { /* EPIPE 时播放器已退出，忽略 */ });
      p.on('exit', (code) => {
        if (currentPlayer === p) currentPlayer = null;
        // 写了不少音频但进程秒退：输出设备大概率打不开（-loglevel quiet 吞掉了真实原因）
        if (myGen === gen && written > 48000 && Date.now() - startedAt < 500) {
          emit({ type: 'error', message: `播放器 ${Date.now() - startedAt}ms 内退出(code ${code})，${(written / 48000).toFixed(1)}s 音频没播出来：请检查系统默认音频输出设备` });
        }
        resolve();
      });
      p.on('error', reject);
      try {
        for await (const chunk of pcmIterator) {
          if (myGen !== gen || !p.stdin.writable) break; // 打断：退出循环 → generator finally 关 TTS 会话
          written += chunk.length;
          p.stdin.write(chunk);
        }
      } catch (e) { /* 忽略写入错误 */ }
      try { p.stdin.end(); } catch {}
      // 兜底超时：30 秒后强杀
      setTimeout(() => { try { p.kill(); } catch {} }, 30000).unref?.();
    });
  }

  // ---------- 按句流式：LLM 文本增量 → 切句 → 逐句合成播放 ----------
  function speakStream() {
    const myGen = gen; // 绑定创建时的代际
    let pending = '';
    const speak = (sentence) => {
      ttsQueue = ttsQueue.then(async () => {
        if (myGen !== gen) return; // 轮到时已被打断，丢弃
        await playPcmStream(synthesize(sentence), myGen);
      }).catch((e) => emit({ type: 'error', message: `TTS 失败: ${e.message}` }));
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

  return {
    get gen() { return gen; },
    hush,
    speakStream,
    drain: () => ttsQueue,
  };
}

module.exports = { createSpeaker };
