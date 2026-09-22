// 后台 service worker：点击插件图标 → 开关当前标签页的小冷面板
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try { await chrome.tabs.sendMessage(tab.id, { type: 'coolbuy:toggle' }); } catch {}
});
