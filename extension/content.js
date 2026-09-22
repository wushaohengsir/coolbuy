/**
 * coolbuy 小冷 · 浏览器插件 content script
 * 职责：三键面板（Start/Stop/Interview）+ 页面上下文抓取 + 连本地 Agent（ws://127.0.0.1:7901）
 * 语音、判停、大脑全部在本地 Agent（node agent-b.js --bridge），本脚本只做 UI 和搬运。
 */
(() => {
  if (window.__coolbuyInjected) return; // 防重复注入
  window.__coolbuyInjected = true;

  const BRIDGE_URL = 'ws://127.0.0.1:7901';
  const navStart = Date.now();

  // ---------- 页面上下文抓取 ----------
  // 站点适配器预留：ADAPTERS['taobao.com'] = (doc) => ({item, price, promo})
  const ADAPTERS = {};

  function scrapePage() {
    const host = location.hostname.replace(/^www\./, '');
    const adapterKey = Object.keys(ADAPTERS).find((k) => host.endsWith(k));
    if (adapterKey) {
      try { return { ...ADAPTERS[adapterKey](document), url: location.href, platform: host, dwellSeconds: dwell() }; } catch {}
    }
    return { ...scrapeGeneric(), url: location.href, platform: host, dwellSeconds: dwell() };
  }

  function dwell() {
    return Math.round((Date.now() - navStart) / 1000);
  }

  function scrapeGeneric() {
    // 1. JSON-LD Product（电商站普遍带结构化数据）
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const j = JSON.parse(el.textContent);
        const items = Array.isArray(j) ? j : [j];
        for (const it of items) {
          const p = findProduct(it);
          if (p) return p;
        }
      } catch {}
    }
    // 2. OpenGraph / meta
    const meta = (n) => document.querySelector(`meta[property="${n}"],meta[name="${n}"]`)?.content;
    const ogTitle = meta('og:title');
    const ogPrice = meta('product:price:amount') || meta('og:price:amount');
    if (ogTitle || ogPrice) {
      return { item: clean(ogTitle), price: num(ogPrice), promo: findPromo() };
    }
    // 3. 兜底：标题 + 页面里第一个 ¥ 价格
    const bodyText = (document.body?.innerText || '').slice(0, 5000);
    const mPrice = bodyText.match(/[¥￥]\s*(\d+(?:\.\d+)?)/);
    return {
      item: clean(document.title),
      price: mPrice ? Number(mPrice[1]) : null,
      promo: findPromo(bodyText),
    };
  }

  function findProduct(node) {
    if (!node || typeof node !== 'object') return null;
    const types = [].concat(node['@type'] || []);
    if (types.includes('Product')) {
      const offers = [].concat(node.offers || [])[0] || {};
      return {
        item: clean(node.name),
        price: num(offers.price ?? offers.lowPrice),
        promo: findPromo(),
      };
    }
    for (const v of Object.values(node)) {
      if (v && typeof v === 'object') { const r = findProduct(v); if (r) return r; }
    }
    return null;
  }

  function findPromo(text) {
    const t = (text || document.body?.innerText || '').slice(0, 5000);
    const m = t.match(/(限时[^。\n]{0,16}|秒杀|仅剩[^。\n]{0,12}|还剩[^。\n]{0,12}|满\d+减\d+|直降\d+|前\d+名[^。\n]{0,10})/);
    return m ? m[0] : null;
  }

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 60) || null;
  const num = (v) => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };

  // ---------- WS 客户端 ----------
  let ws = null;
  let wsReady = false;

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    ws = new WebSocket(BRIDGE_URL);
    ws.onopen = () => { wsReady = true; setStatus('已连接本地 Agent', '按 Start 开始聊，或直接按 Interview 让小冷先问'); };
    ws.onmessage = (e) => { try { handleEvent(JSON.parse(e.data)); } catch {} };
    ws.onclose = () => {
      wsReady = false;
      setStatus('本地 Agent 未连接', '先在终端运行：node agent-b.js --bridge');
      setTimeout(connect, 3000); // 断线重连
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  const sendCmd = (obj) => { if (wsReady) ws.send(JSON.stringify(obj)); };

  function handleEvent(ev) {
    switch (ev.type) {
      case 'ready':
        setSub(`ASR=${ev.asr} · TTS=${ev.tts}`);
        break;
      case 'state':
        if (ev.state === 'listening') setStatus('在听…', '开口说话，说完停一下');
        else if (ev.state === 'thinking') setStatus('思考中…', '');
        else if (ev.state === 'speaking') setStatus('小冷说话中', '可以直接抢话打断');
        else if (ev.state === 'idle') setStatus('已结束', '按 Start 再来一轮');
        break;
      case 'user':
        addLine('你', ev.text, 'user');
        break;
      case 'agent':
        addLine('小冷', ev.text, 'agent');
        break;
      case 'outcome': {
        // Stop 只是停止语音，结论只来自对话事实（released）；
        // aborted = 无结论的中断；cooled 预留给将来大脑明确达成冷静共识时标记
        const map = { cooled: '冷静成功 ✓', released: '已放行，去买吧', aborted: '语音已停止' };
        setStatus(map[ev.outcome] || ev.outcome, ev.outcome === 'aborted' ? '' : `坚持购买 ${ev.insistCount} 次`);
        break;
      }
      case 'error':
        setStatus('出错了', ev.message);
        break;
    }
  }

  // ---------- 面板 UI（Shadow DOM 隔离页面样式） ----------
  const host = document.createElement('div');
  host.id = 'coolbuy-panel-host';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .panel {
        position: fixed; top: 16px; right: 16px; z-index: 2147483647;
        width: 320px; border-radius: 14px; background: #fff; color: #1a1a1a;
        box-shadow: 0 8px 40px rgba(0,0,0,.18); font: 13px/1.5 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
        overflow: hidden; display: none;
      }
      .panel.show { display: block; }
      .bar { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #eee; }
      .bar .brand { font-size: 11px; letter-spacing: .12em; color: #888; }
      .bar .name { font-weight: 700; font-size: 14px; }
      .bar .x { cursor: pointer; border: 1px solid #e5e5e5; border-radius: 8px; width: 26px; height: 26px; text-align: center; line-height: 24px; color: #999; }
      .card { margin: 10px 12px; padding: 12px 14px; border-radius: 12px; background: #f3f5f4; }
      .status { font-weight: 700; font-size: 15px; }
      .sub { color: #777; margin-top: 2px; min-height: 18px; }
      .page .label { font-size: 11px; letter-spacing: .1em; color: #999; margin-bottom: 4px; }
      .page .item { font-weight: 600; }
      .page .meta { color: #777; }
      .btns { display: flex; gap: 10px; padding: 4px 12px 12px; }
      button {
        flex: 1; padding: 10px 0; border-radius: 10px; border: 1px solid #ddd;
        font-size: 14px; font-weight: 600; cursor: pointer; background: #fff;
      }
      button.start { background: #2f3a38; color: #fff; border-color: #2f3a38; }
      button.interview { background: #0d7a6f; color: #fff; border-color: #0d7a6f; }
      button:active { transform: translateY(1px); }
      .log { max-height: 140px; overflow-y: auto; padding: 0 14px 10px; }
      .log .l { margin: 3px 0; color: #555; }
      .log .l b { color: #1a1a1a; }
      .log .l.agent b { color: #0d7a6f; }
    </style>
    <div class="panel">
      <div class="bar">
        <div><div class="brand">COOLBUY</div><div class="name">小冷 · 付款前聊两句</div></div>
        <div class="x">✕</div>
      </div>
      <div class="card">
        <div class="status">连接中…</div>
        <div class="sub"></div>
      </div>
      <div class="card page">
        <div class="label">PAGE</div>
        <div class="item">—</div>
        <div class="meta">—</div>
      </div>
      <div class="log"></div>
      <div class="btns">
        <button class="start">Start</button>
        <button class="stop">Stop</button>
        <button class="interview">Interview</button>
      </div>
    </div>`;
  document.documentElement.appendChild(host);

  const $ = (sel) => shadow.querySelector(sel);
  const panel = $('.panel');

  function setStatus(main, sub) { $('.status').textContent = main; setSub(sub); }
  function setSub(sub) { $('.sub').textContent = sub || ''; }
  function addLine(who, text, cls) {
    const log = $('.log');
    const div = document.createElement('div');
    div.className = `l ${cls}`;
    const b = document.createElement('b');
    b.textContent = `${who}: `;
    div.appendChild(b);
    div.appendChild(document.createTextNode(text));
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    while (log.children.length > 30) log.removeChild(log.firstChild);
  }

  function refreshPageCard() {
    const p = scrapePage();
    $('.page .item').textContent = p.item ? `${p.item}${p.price ? `  ¥${p.price}` : ''}` : '未识别到商品';
    $('.page .meta').textContent = [p.promo, p.platform, `停留 ${p.dwellSeconds}s`].filter(Boolean).join(' · ');
    return p;
  }

  // ---------- 交互 ----------
  $('.x').onclick = () => panel.classList.remove('show');
  $('.start').onclick = () => { $('.log').innerHTML = ''; sendCmd({ type: 'start', page: refreshPageCard() }); };
  $('.stop').onclick = () => sendCmd({ type: 'stop' });
  $('.interview').onclick = () => sendCmd({ type: 'interview' });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'coolbuy:toggle') {
      panel.classList.toggle('show');
      if (panel.classList.contains('show')) { connect(); refreshPageCard(); }
    }
  });
})();
