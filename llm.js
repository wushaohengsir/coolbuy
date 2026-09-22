/**
 * 方舟（豆包）LLM 客户端 — OpenAI 兼容流式接口 + 工具调用
 * env: ARK_API_KEY / ARK_MODEL / ARK_BASE_URL
 * LLM_MOCK=1 时用本地剧本模拟（无 key 调试用）
 */

'use strict';
require('./agent-env')();

const ARK_BASE_URL = process.env.LLM_BASE_URL || process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
const ARK_MODEL = process.env.LLM_MODEL || process.env.ARK_MODEL || 'doubao-seed-2-0-lite-260215';

/**
 * 流式对话。yield 事件：
 *   { type: 'delta', text }            文本增量
 *   { type: 'tool_calls', toolCalls }  完整工具调用数组（finish_reason==='tool_calls' 时）
 *   { type: 'done', finishReason }
 * signal：外部 AbortSignal（打断机制用）。abort 后静默收尾，不抛错。
 */
async function* chatStream({ messages, tools = undefined, model = ARK_MODEL, signal }) {
  if (process.env.LLM_MOCK === '1') {
    yield* mockStream(messages, tools);
    return;
  }
  if (!process.env.LLM_API_KEY && !process.env.ARK_API_KEY) throw new Error('缺少 LLM_API_KEY / ARK_API_KEY（或设 LLM_MOCK=1 用模拟）');
  if (signal?.aborted) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('LLM 超时(60s)')), 60000);
  const onExternalAbort = () => controller.abort(signal.reason || new Error('已打断'));
  signal?.addEventListener('abort', onExternalAbort, { once: true });

  let res;
  try {
    res = await fetch(`${ARK_BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.LLM_API_KEY || process.env.ARK_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        ...(tools && tools.length ? { tools, tool_choice: 'auto' } : {}),
        stream: true,
      }),
    });
  } catch (e) {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onExternalAbort);
    if (signal?.aborted) return; // 被打断：静默收尾
    throw e;
  }
  clearTimeout(timeout);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  // SSE 解析
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let acc = {}; // tool_calls 累积器 index -> {id, function:{name, arguments}}
  let finishReason = null;

  try {
    while (true) {
      if (signal?.aborted) return; // 打断：丢弃剩余流
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let j;
        try { j = JSON.parse(data); } catch { continue; }
        const choice = j.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const d = choice.delta || {};
        if (d.content) yield { type: 'delta', text: d.content };
        for (const tc of d.tool_calls || []) {
          const a = (acc[tc.index] ||= { id: '', function: { name: '', arguments: '' } });
          if (tc.id) a.id = tc.id;
          if (tc.function?.name) a.function.name += tc.function.name;
          if (tc.function?.arguments) a.function.arguments += tc.function.arguments;
        }
      }
    }
  } catch (e) {
    if (signal?.aborted) return; // abort 导致的 reader 抛错属正常收尾
    throw e;
  } finally {
    signal?.removeEventListener('abort', onExternalAbort);
    try { reader.releaseLock(); } catch {}
  }
  const toolCalls = Object.values(acc);
  if (finishReason === 'tool_calls' && toolCalls.length) {
    yield { type: 'tool_calls', toolCalls };
  }
  yield { type: 'done', finishReason };
}

// ---- mock：走一遍"调工具→回复"两轮，验证 brain 循环 ----
async function* mockStream(messages, tools) {
  const last = messages[messages.length - 1];
  const wantsTool = messages.every((m) => m.role !== 'tool'); // 还没调过工具
  if (wantsTool && tools?.length) {
    yield {
      type: 'tool_calls',
      toolCalls: [{ id: 'mock-1', type: 'function', function: { name: 'get_page_context', arguments: '{}' } }],
    };
    yield { type: 'done', finishReason: 'tool_calls' };
    return;
  }
  const page = messages.find((m) => m.role === 'tool')?.content || '';
  const text = '（mock 回复）我看到你眼前的页面了：' + page.slice(0, 80) + '…老板，这单要不要先聊聊？';
  for (const seg of text.match(/.{1,8}/g) || []) {
    await new Promise((r) => setTimeout(r, 20));
    yield { type: 'delta', text: seg };
  }
  yield { type: 'done', finishReason: 'stop' };
}

module.exports = { chatStream, ARK_MODEL };
