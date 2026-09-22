// 后台 service worker：图标点击开关面板 + Start 键生命周期（Native Messaging 启动/杀死本地 Agent）
const HOST = 'com.coolbuy.launcher';

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try { await chrome.tabs.sendMessage(tab.id, { type: 'coolbuy:toggle' }); } catch {}
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'coolbuy:launch') {
    nativeCall({ type: 'start' })
      .then((r) => sendResponse({ ok: r.type === 'started', ...r }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
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
