/**
 * 打包便携版：node(便携) + ffmpeg/ffplay + 代码 + node_modules + 模型
 * → dist/coolbuy-portable/，整目录拷到任何 Win x64 电脑即用（无需装 Node/ffmpeg）。
 *
 * 用法：node make-portable.js   （可重复运行，已下载/已复制的部分会跳过）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist', 'coolbuy-portable');
const NODE_VERSION = '24.12.0';
const PROXY = process.env.PORTABLE_PROXY || 'http://127.0.0.1:17897';

function log(s) { console.log(`  [打包] ${s}`); }
function sh(cmd, opts = {}) { return spawnSync(cmd, [], { shell: true, stdio: 'inherit', ...opts }); }
/** 用 Windows 原生 Expand-Archive 解压 zip（GNU tar 会把 F:\ 路径当远程主机，不可靠） */
function extractZip(zip, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const r = spawnSync('powershell', [
    '-NoProfile', '-Command',
    `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${destDir}' -Force`,
  ], { stdio: 'inherit' });
  return r.status === 0;
}
function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000000) { log(`已存在，跳过下载 ${path.basename(dest)}`); return true; }
  log(`下载 ${url}`);
  const r = sh(`curl -sL -x "${PROXY}" -o "${dest}" "${url}"`);
  if (r.status !== 0 || !fs.existsSync(dest) || fs.statSync(dest).size < 1000000) {
    // 代理失败再试直连
    log('代理下载失败，试直连');
    sh(`curl -sL -o "${dest}" "${url}"`);
  }
  return fs.existsSync(dest) && fs.statSync(dest).size > 1000000;
}

function copyDir(src, dest, exclude = []) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (exclude.includes(name)) continue;
    const s = path.join(src, name);
    const d = path.join(dest, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDir(s, d, []);
    else { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); }
  }
}

// ---------- 1. 目录骨架 ----------
fs.mkdirSync(path.join(DIST, 'app'), { recursive: true });
fs.mkdirSync(path.join(DIST, 'node'), { recursive: true });
fs.mkdirSync(path.join(DIST, 'ffmpeg'), { recursive: true });

// ---------- 2. Node 便携版 ----------
if (!fs.existsSync(path.join(DIST, 'node', 'node.exe'))) {
  const zip = path.join(DIST, 'node.zip');
  const url = `https://npmmirror.com/mirrors/node/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`;
  if (download(url, zip)) {
    log('解压 node');
    extractZip(zip, DIST);
    const extracted = path.join(DIST, `node-v${NODE_VERSION}-win-x64`);
    if (fs.existsSync(extracted)) {
      copyDir(extracted, path.join(DIST, 'node'));
      fs.rmSync(extracted, { recursive: true, force: true });
    }
    fs.rmSync(zip, { force: true });
  }
}

// ---------- 3. ffmpeg / ffplay ----------
if (!fs.existsSync(path.join(DIST, 'ffmpeg', 'ffmpeg.exe'))) {
  const zip = path.join(DIST, 'ffmpeg.zip');
  const url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
  if (download(url, zip)) {
    log('解压 ffmpeg');
    const tmp = path.join(DIST, 'ffmpeg-tmp');
    fs.mkdirSync(tmp, { recursive: true });
    extractZip(zip, tmp);
    // 找 bin/ffmpeg.exe 和 bin/ffplay.exe
    const found = [];
    (function walk(d) {
      if (!fs.existsSync(d)) return;
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n);
        const st = fs.statSync(p);
        if (st.isDirectory()) walk(p);
        else if (n === 'ffmpeg.exe' || n === 'ffplay.exe') found.push(p);
      }
    })(tmp);
    for (const f of found) fs.copyFileSync(f, path.join(DIST, 'ffmpeg', path.basename(f)));
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(zip, { force: true });
  }
}

// ---------- 4. 代码（排除 node_modules / models / dist / .git） ----------
log('复制代码');
copyDir(ROOT, path.join(DIST, 'app'), ['node_modules', 'models', 'dist', '.git', 'data', 'extension.pem', 'make-portable.js']);
// data 目录（会话落盘）需要存在但清空
fs.mkdirSync(path.join(DIST, 'app', 'data'), { recursive: true });

// ---------- 5. node_modules（本机已是 win-x64，直接拷） ----------
if (!fs.existsSync(path.join(DIST, 'app', 'node_modules'))) {
  log('复制 node_modules（约 300MB）');
  copyDir(path.join(ROOT, 'node_modules'), path.join(DIST, 'app', 'node_modules'));
}

// ---------- 6. 模型（本地已下载，直接拷） ----------
if (!fs.existsSync(path.join(DIST, 'app', 'models'))) {
  log('复制模型（约 380MB）');
  fs.mkdirSync(path.join(DIST, 'app', 'models'), { recursive: true });
  for (const m of ['sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09', 'kokoro-multi-lang-v1_0']) {
    const s = path.join(ROOT, 'models', m);
    if (fs.existsSync(s)) copyDir(s, path.join(DIST, 'app', 'models', m));
  }
  for (const f of ['silero_vad.onnx', 'smart-turn-v3.2-cpu.onnx']) {
    const s = path.join(ROOT, f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(DIST, 'app', f));
  }
}

// ---------- 7. launch.bat：用包内相对 node 路径 ----------
fs.writeFileSync(path.join(DIST, 'app', 'native', 'launch.bat'), [
  '@echo off',
  'rem portable launch - use bundled node relative to this bat',
  '"%~dp0..\\..\\node\\node.exe" "%~dp0coolbuy-launcher.js"',
  '',
].join('\r\n'), 'ascii');

// ---------- 8. install.bat ----------
fs.writeFileSync(path.join(DIST, 'install.bat'), [
  '@echo off',
  'chcp 65001 >nul',
  'echo ================================================',
  'echo   coolbuy 一键安装（便携版）',
  'echo ================================================',
  'cd /d "%~dp0"',
  'echo.',
  'echo [1/1] 注册本地启动器（固定扩展 ID，无需手动复制）...',
  '"%~dp0node\\node.exe" "%~dp0app\\native\\register.js"',
  'echo.',
  'echo ================================================',
  'echo   完成！剩余两步（Chrome 安全限制，无法自动化）：',
  'echo   1. Chrome 地址栏 chrome://extensions → 开开发者模式',
  'echo      → 加载已解压的扩展程序 → 选 app\\extension 文件夹',
  'echo   2. 完全关闭并重启 Chrome',
  'echo   之后打开任意电商商品页 → 点工具栏小冷图标 → 按 Start',
  'echo ================================================',
  'echo 详见 README-for-agent.md',
  'pause',
  '',
].join('\r\n'), 'ascii');

// ---------- 9. Agent 指导文档 ----------
fs.copyFileSync(path.join(ROOT, 'portable-guide.md'), path.join(DIST, 'README-for-agent.md'));

log(`完成！便携包在 ${DIST}`);
log(`总大小约 ${(size(DIST) / 1048576).toFixed(0)} MB`);

function size(d) {
  let total = 0;
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    const st = fs.statSync(p);
    total += st.isDirectory() ? size(p) : st.size;
  }
  return total;
}
