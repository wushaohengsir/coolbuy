/**
 * B 路线大脑 —— Agent 循环：感知（ASR文本/面板事件）→ 决策（LLM+工具）→ 行动（流式TTS）
 * 关键设计：
 *   - 工具调用循环：LLM 要求调工具 → 执行 → 结果回填 → LLM 继续生成（最多 3 轮）
 *   - 文本按句切分流式出（首句 1 秒内可开始播）
 *   - Interview 模式：注入指令让 AI 主动反问，不等用户先说话
 */

'use strict';
const { chatStream } = require('./llm');
const T = require('./tools');

const SYSTEM_PROMPT = `你是「小冷」，coolbuy 的冲动消费冷静协商助手。用户在电商网站犹豫要不要下单，点了 Start 主动找你聊。

## 人设
嘴损但真心为用户好的朋友。称呼用户「老板」。口语化、短句（单轮 2-4 句），像微信语音，不说教，不说"你应该"。绝不使用"剁手""吃土"等羞辱性词。

## 对话策略（跟着对话自然推进，不机械走步骤）
1. 确认：结合页面信息确认他在看什么、多少钱、促销话术是什么
2. 问动机：区分"真需要"和"情绪性想要"（"是耳机真不行了，还是今天有点烦？"）
3. 摆事实：调 get_user_profile 拿近期消费对照（"上个月那台音箱用过几次？"）
4. 提延迟：调 add_wishlist 提 48 小时冷静期，框定为"还想要我提醒你买，一分不亏"
5. 放行：调 mark_insist 后若 mustRelease=true，立刻痛快放行甚至帮比价，之后绝不再劝

## 硬规则
- mark_insist 返回 mustRelease=true 后，本轮及之后所有轮次禁止再劝，直接放行
- 冷静成功给正反馈并绑定储蓄目标（"省下 X，日本基金到 Y% 了"）
- 回复永远口语短句，禁止列表、禁止长篇
- 不知道页面信息就调 get_page_context，别猜`;

/** Agent 循环。onText(增量文本) 回调用于喂 TTS。
 *  返回完整回复文本。 */
async function think(userText, history, onText) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: userText },
  ];

  let fullText = '';
  for (let hop = 0; hop < 3; hop++) {
    let finishReason = null;
    let toolCalls = null;
    for await (const ev of chatStream({
      messages,
      tools: T.toolSchemas,
    })) {
      if (ev.type === 'delta') { fullText += ev.text; onText?.(ev.text); }
      if (ev.type === 'tool_calls') toolCalls = ev.toolCalls;
      if (ev.type === 'done') finishReason = ev.finishReason;
    }
    if (finishReason !== 'tool_calls' || !toolCalls) break;

    // 执行工具并回填，继续下一跳（DeepSeek 要求 tool_calls 项含 type:"function"）
    messages.push({ role: 'assistant', content: null, tool_calls: toolCalls.map((tc) => ({ type: 'function', ...tc })) });
    for (const tc of toolCalls) {
      const args = safeParse(tc.function.arguments);
      const result = T.executeTool(tc.function.name, args);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }
  return fullText;
}

/** Interview 模式：AI 主动反问，用户还没说话 */
async function interview(history, onText) {
  const instruction =
    '（面试模式）用户还没说话。基于页面信息，主动向他提一个直击购买动机的问题。只问一个，口语短句。';
  return think(instruction, history, onText);
}

function safeParse(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }

module.exports = { think, interview, SYSTEM_PROMPT };
