/**
 * coolbuy 本地 Agent 启动器（Chrome Native Messaging Host）
 *
 * 职责：让插件的 Start 键控制本地 Agent 进程的生死——
 *   按 Start（灰） → Chrome 拉起本脚本 → spawn `node agent-b.js --bridge`
 *   再按 Start（红）→ 插件断开 native 端口（或发 kill）→ 杀进程树，会话结束
 *
 * 协议：Chrome native messaging stdio（4 字节小端长度 + JSON）
 *   收：{ type:'start' } / { type:'kill' } / { type:'ping' }
 *   发：{ type:'started', pid?, reused? } / { type:'killed' } / { type:'pong' } / { type:'error', message }
 *
 * Chrome 断开 stdin（端口关闭/浏览器退出）时，杀 Agent 自杀——进程不会变孤儿。
 */

'use strict';
const { spawn, spawnSync } = require('child_process');
const net = require('net');
const path = require('path');
const { getFfmpegPath, getFfplayPath, listAudioDevices } = require('../audio');

const AGENT_ENTRY = path.join(__dirname, '..', 'agent-b.js');
const AGENT_CWD = path.join(__dirname, '..');
const BRIDGE_PORT = Number(process.env.BRIDGE_PORT) || 7901;

let agent = null;

// ---- stdio 帧解析 ----
let buf = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;
    const body = buf.slice(4, 4 + len);
    buf = buf.slice(4 + len);
    try { handle(JSON.parse(body.toString('utf8'))); } catch {}
  }
});
process.stdin.on('end', shutdown); // Chrome 断开 = 红色 Start / 浏览器关闭

function send(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([head, body]));
}

async function handle(msg) {
  switch (msg.type) {
    case 'ping':
      send({ type: 'pong', agentRunning: !!agent });
      break;
    case 'start': {
      if (await portOpen()) { send({ type: 'started', reused: true }); break; } // 已在跑（手动起的/上次没杀）
      const bundled = {
        FFMPEG_PATH: getFfmpegPath(),
        FFPLAY_PATH: getFfplayPath(),
      };
      agent = spawn(process.execPath, [AGENT_ENTRY, '--bridge'], {
        stdio: 'ignore',
        windowsHide: process.platform === 'win32',
        detached: process.platform !== 'win32',
        cwd: AGENT_CWD,
        env: { ...process.env, ...envFromConfig(msg.config), ...bundled }, // 用户 API key + 便携 ffmpeg 注入
      });
      agent.on('exit', () => { agent = null; });
      try {
        await waitPort(60000); // 首次启动要加载本地模型（SenseVoice / Smart Turn）
        send({ type: 'started', pid: agent.pid });
      } catch (e) {
        killAgent();
        send({ type: 'error', message: `Agent 启动失败: ${e.message}` });
      }
      break;
    }
    case 'kill':
      killAgent();
      send({ type: 'killed' });
      break;
    case 'list_devices':
      listDevices()
        .then((devices) => send({ type: 'devices', devices }))
        .catch((e) => send({ type: 'error', message: String(e?.message || e) }));
      break;
  }
}

/** 列出本机音频输入设备，返回 {label, value} 列表 */
function listDevices() {
  return listAudioDevices();
}

function portOpen() {
  return new Promise((resolve) => {
    const s = net.connect(BRIDGE_PORT, '127.0.0.1');
    s.once('connect', () => { s.end(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

/** 把插件传来的配置对象转成环境变量（只保留非空值） */
function envFromConfig(config) {
  const env = {};
  for (const [k, v] of Object.entries(config || {})) {
    if (typeof v === 'string' && v.trim()) env[k] = v.trim();
  }
  return env;
}

async function waitPort(timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await portOpen()) return;
    if (agent && agent.exitCode !== null) throw new Error(`进程提前退出(code ${agent.exitCode})`);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('等待桥端口超时');
}

function killAgent() {
  // 优先按监听 7901 的 PID 杀，涵盖手动启动或复用的 Agent。
  const pid = findBridgePid() || (agent ? agent.pid : null);
  if (pid && process.platform === 'win32') {
    try { spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {}
  } else if (pid) {
    try { process.kill(-pid, 'SIGTERM'); } catch {
      try { process.kill(pid, 'SIGTERM'); } catch {}
    }
  }
  agent = null;
}

/** 找 7901 端口监听进程 PID。 */
function findBridgePid() {
  if (process.platform === 'win32') return findBridgePidWindows();
  const lsof = spawnSync('lsof', [
    '-nP', `-iTCP:${BRIDGE_PORT}`, '-sTCP:LISTEN', '-t',
  ], { encoding: 'utf8', windowsHide: false });
  if (lsof.status === 0) {
    const pid = parseInt((lsof.stdout || '').trim().split(/\s+/)[0], 10);
    if (pid) return pid;
  }
  const ss = spawnSync('ss', ['-ltnp'], { encoding: 'utf8', windowsHide: false });
  if (ss.status === 0) {
    for (const line of (ss.stdout || '').split(/\r?\n/)) {
      if (!new RegExp(`:${BRIDGE_PORT}\\s`).test(line)) continue;
      const match = line.match(/pid=(\d+)/);
      if (match) return parseInt(match[1], 10);
    }
  }
  return null;
}

function findBridgePidWindows() {
  try {
    const out = spawnSync('netstat', ['-ano', '-p', 'tcp'], {
      encoding: 'utf8',
      windowsHide: true,
    }).stdout || '';
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/LISTENING\s+(\d+)/);
      if (m && new RegExp(`:${BRIDGE_PORT}\\s`).test(line)) return parseInt(m[1], 10);
    }
  } catch {}
  return null;
}

function shutdown() {
  killAgent();
  process.exit(0);
}
