/**
 * B 路线工具层 —— 本地大脑可调用的工具
 * 对应三键交互：Start（页面上下文进入）/ Stop（会话结论落盘）/ Interview（主动提问）
 * 浏览器插件上线前，页面上下文由 mock 提供；插件上线后同一接口换成 WS 推送。
 */

'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

// ---- 本地持久状态（用户画像 + 愿望单 + 历史） ----
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
  wishlist: [],      // 48h 冷静期条目
  sessions: [],      // 已结束的协商会话
};

fs.mkdirSync(DATA_DIR, { recursive: true });
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch {}
function save() { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }

// ---- 运行时会话状态（不落盘，Stop 时结论落盘） ----
const session = {
  active: false,
  page: null,          // 当前页面上下文（插件/mock 推来）
  insistCount: 0,      // 用户坚持购买次数（2 次必须放行）
  stage: 'idle',       // idle | confirm | motive | factcheck | delay | released
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
  {
    type: 'function',
    function: {
      name: 'add_wishlist',
      description: '用户接受 48 小时冷静期提案时调用：把当前商品加入愿望单。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_wishlist',
      description: '检查愿望单里是否有相似商品（用户想买新东西时先查，避免重复购买）。',
      parameters: {
        type: 'object',
        properties: { keyword: { type: 'string', description: '商品关键词' } },
        required: [],
      },
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
        wishlistCount: state.wishlist.length,
      };
    case 'mark_insist':
      session.insistCount += 1;
      return { insistCount: session.insistCount, mustRelease: session.insistCount >= 2 };
    case 'add_wishlist': {
      if (!session.page) return { error: 'no_page_context' };
      const entry = {
        item: session.page.item,
        price: session.page.price,
        addedAt: new Date().toISOString(),
        revisitAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      };
      state.wishlist.push(entry);
      save();
      return { added: entry, totalWishlist: state.wishlist.length };
    }
    case 'check_wishlist': {
      const kw = (args.keyword || '').toLowerCase();
      const hits = kw
        ? state.wishlist.filter((w) => (w.item || '').toLowerCase().includes(kw))
        : state.wishlist;
      return { matches: hits };
    }
    default:
      return { error: `unknown_tool_${name}` };
  }
}

// ---- 三键交互 API（面板/CLI 调用） ----
function startSession(pageContext) {
  session.active = true;
  session.page = pageContext || null;
  session.insistCount = 0;
  session.stage = 'confirm';
  session.startedAt = Date.now();
  return { ok: true, stage: session.stage };
}

function stopSession(outcome) {
  if (!session.active) return { ok: false, error: 'not_active' };
  session.active = false;
  const record = {
    page: session.page,
    outcome, // 'cooled' 冷静 | 'released' 放行 | 'wishlist' 进冷静期 | 'aborted' 中断
    insistCount: session.insistCount,
    startedAt: new Date(session.startedAt).toISOString(),
    endedAt: new Date().toISOString(),
  };
  state.sessions.push(record);
  save();
  return { ok: true, record };
}

module.exports = { toolSchemas, executeTool, startSession, stopSession, session, state };
