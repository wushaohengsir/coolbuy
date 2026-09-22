// 后台 service worker：图标点击开关面板 + Start 键生命周期（Native Messaging 启动/杀死本地 Agent）
const HOST = 'com.coolbuy.launcher';

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try { await chrome.tabs.sendMessage(tab.id, { type: 'coolbuy:toggle' }); } catch {}
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'coolbuy:launch') {
    // 带上用户保存的 API key，启动器 spawn 本地 Agent 时作为环境变量注入
    chrome.storage.local.get('coolbuyConfig', (r) => {
      nativeCall({ type: 'start', config: r.coolbuyConfig || {} })
        .then((resp) => sendResponse({ ok: resp.type === 'started', ...resp }))
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
    });
    return true; // 异步 sendResponse
  }
  if (msg?.type === 'coolbuy:shutdown') {
    nativeCall({ type: 'kill' })
      .catch(() => {}) // 杀不掉也当停了（进程可能已死）
      .finally(() => {
        try { nativePort?.disconnect(); } catch {}
        nativePort = null;
        sendResponse({ ok: true });
      });
    return true;
  }
  if (msg?.type === 'coolbuy:fetch-models') {
    // 拉取 OpenAI 兼容的 /models 列表（host_permissions 让后台可跨域）
    (async () => {
      try {
        const base = (msg.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const res = await fetch(`${base}/models`, {
          headers: { Authorization: `Bearer ${msg.apiKey}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        const models = (j.data || []).map((m) => m.id).filter(Boolean).sort();
        sendResponse({ ok: true, models });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
  }
});

let nativePort = null;

/** 向启动器发一条指令并等回执。端口复用（启动器随端口存活）。 */
function nativeCall(payload) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => done(reject, '启动器无响应（未注册？运行 node native/register.js <扩展ID>）'), 70000);
    try {
      if (!nativePort) {
        nativePort = chrome.runtime.connectNative(HOST);
        nativePort.onDisconnect.addListener(() => {
          const err = chrome.runtime.lastError?.message;
          nativePort = null;
          done(reject, err || '启动器连接断开（未注册？运行 node native/register.js <扩展ID>）');
        });
      }
      nativePort.onMessage.addListener(function onMsg(m) {
        if (m.type === 'error') done(reject, m.message);
        else done(resolve, m);
      });
      nativePort.postMessage(payload);
    } catch (e) {
      done(reject, String(e?.message || e));
    }
  });
}
