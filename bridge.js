/**
 * 插件桥 —— 本地 WebSocket 服务：浏览器插件 ↔ 本地 Agent
 *
 * 协议（JSON 单消息）：
 *   插件 → Agent：
 *     { type:'start', page:{ item, price, platform, promo, url, dwellSeconds } }
 *     { type:'stop' }        用户按 Stop：结束会话，结论落盘
 *     { type:'interview' }   用户按 Interview：小冷主动反问
 *   Agent → 插件：
 *     { type:'ready', asr, tts }            连接建立，报告当前 provider
 *     { type:'state', state }               idle | listening | thinking | speaking
 *     { type:'user'|'agent', text }         一轮对话的双方文本
 *     { type:'sys', text }                  运行细节（判停/延迟等，面板可不显示）
 *     { type:'outcome', outcome, insistCount }  会话结束：released(放行) | aborted(仅停止语音，无结论)
 *                                               ※ cooled 预留：将来大脑明确达成冷静共识时由工具层标记
 *     { type:'error', message }
 *
 * 安全说明（TODO）：目前接受任何 localhost 页面的连接，本地任意网页都能驱动
 * 本 Agent。上线前应加一次性 token 握手（安装插件时生成，写入双方配置）。
 */

'use strict';
const { WebSocketServer } = require('ws');

const DEFAULT_PORT = 7901;

class Bridge {
  constructor({ onStart, onStop, onInterview, port } = {}) {
    this.onStart = onStart;
    this.onStop = onStop;
    this.onInterview = onInterview;
    this.port = port || Number(process.env.BRIDGE_PORT) || DEFAULT_PORT;
    this.clients = new Set();
  }

  start(providers = {}) {
    this.wss = new WebSocketServer({ host: '127.0.0.1', port: this.port });
    this.wss.on('listening', () => {
      console.log(`  [桥] ws://127.0.0.1:${this.port} 等待插件连接`);
    });
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      ws.send(JSON.stringify({ type: 'ready', ...providers }));
      ws.on('message', (raw) => this._handle(raw));
      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
    });
    this.wss.on('error', (e) => {
      console.error(`  [桥] 端口 ${this.port} 启动失败: ${e.message}`);
      process.exit(1);
    });
  }

  _handle(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    switch (msg.type) {
      case 'start': this.onStart?.(msg.page || {}); break;
      case 'stop': this.onStop?.(); break;
      case 'interview': this.onInterview?.(); break;
    }
  }

  /** 广播给所有已连接插件 */
  send(obj) {
    const s = JSON.stringify(obj);
    for (const ws of this.clients) {
      if (ws.readyState === 1) { try { ws.send(s); } catch {} }
    }
  }
}

module.exports = { Bridge, DEFAULT_PORT };
