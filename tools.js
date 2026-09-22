/**
 * B 路线工具层 —— 本地大脑可调用的工具 + 会话生命周期
 * 对应三键交互：Start（页面上下文进入）/ Stop（结束语音，仅中断）/ Interview（主动提问）
 * 浏览器插件上线前，页面上下文由 mock 提供；插件上线后同一接口换成 WS 推送（见 bridge.js）。
 *
 * 产品边界（2026-09-23 定）：核心是"购物时和 AI 聊两句"——看见商品/价格、
 * 多轮上下文、低延迟。不做愿望单/收藏夹这类资产管理架构。
 */

'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

// ---- 本地持久状态（用户画像 + 历史会话） ----
let state = {
  profile: {
    nickname: '老板',
    monthlyBudget: 800,
    impulseThreshold: 200,
    savingsGoal: { name: '日本旅行基金', progress: 62 },
  },
  purchases: [
    { item: '蓝牙音箱', price: 299, date: '上个月' },
    { item: '机械键盘键帽', price: 159, date: '三周前' },
  ],
  sessions: [],      // 已结束的协商会话
};

fs.mkdirSync(DATA_DIR, { recursive: true });
try {
  const disk = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  state = { ...state, ...disk };
  delete state.wishlist; // 愿望单架构已下线，清掉旧数据
} catch {}
function save() { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }

// ---- 运行时会话状态（不落盘，Stop 时结论落盘） ----
const session = {
  active: false,
  page: null,          // 当前页面上下文（插件推来）
  insistCount: 0,      // 用户坚持购买次数（2 次必须放行）
  startedAt: null,
};

// ---- 工具定义（OpenAI function calling schema） ----
const toolSchemas = [
  {
    type: 'function',
    function: {
      name: 'get_page_context',
      description: '获取用户当前浏览器的页面信息（商品/价格/促销话术）。对话开始时或需要确认眼前这单时调用。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_user_profile',
      description: '获取用户消费画像：月预算、单件冲动警戒线、近期消费记录、储蓄目标。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mark_insist',
      description: '用户明确表达坚持要购买时调用（说了"就要买/别拦我/下单"等）。累计 2 次后必须痛快放行，绝不再劝。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

// ---- 工具执行 ----
function executeTool(name, args) {
  switch (name) {
    case 'get_page_context':
      return session.page || { error: 'no_page_context' };
    case 'get_user_profile':
      return {
        ...state.profile,
        recentPurchases: state.purchases,
      };
    case 'mark_insist':
      session.insistCount += 1;
      return { insistCount: session.insistCount, mustRelease: session.insistCount >= 2 };
    default:
      return { error: `unknown_tool_${name}` };
  }
}

// ---- 三键交互 API（面板/CLI 调用） ----
function startSession(pageContext) {
  session.active = true;
  session.page = pageContext || null;
  session.insistCount = 0;
  session.startedAt = Date.now();
  return { ok: true };
}

function stopSession(outcome) {
  if (!session.active) return { ok: false, error: 'not_active' };
  session.active = false;
  const record = {
    page: session.page,
    outcome, // 'released' 放行 | 'aborted' 仅停止语音（预留 'cooled'：明确达成冷静共识时）
    insistCount: session.insistCount,
    startedAt: new Date(session.startedAt).toISOString(),
    endedAt: new Date().toISOString(),
  };
  state.sessions.push(record);
  save();
  return { ok: true, record };
}

/** 结束会话并判定结论——「坚持 2 次 = 放行」这条业务规则的唯一归属处。
 *  调用方（引擎/CLI）不读 session 内部字段，只拿结论。 */
function concludeSession() {
  const insistCount = session.insistCount;
  const outcome = insistCount >= 2 ? 'released' : 'aborted';
  const rec = stopSession(outcome);
  return { outcome, insistCount, record: rec.record || null };
}

module.exports = { toolSchemas, executeTool, startSession, stopSession, concludeSession, session, state };
