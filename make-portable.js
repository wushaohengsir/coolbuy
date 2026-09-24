/**
 * Build a portable package for the current operating system.
 *
 * Windows, Linux and macOS bundle static ffmpeg/ffplay downloads. macOS can
 * override the download with PORTABLE_FFMPEG_DIR:
 *
 *   PORTABLE_FFMPEG_DIR=/path/to/ffmpeg-bin node make-portable.js
 *
 * The package contains the local Node runtime, ffmpeg, app code, dependencies
 * and models. It intentionally excludes .env and all local test recordings.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const PLATFORM = process.platform;
const ARCH = process.arch;
const IS_WINDOWS = PLATFORM === 'win32';
const DIST_NAME = `coolbuy-portable-${PLATFORM}-${ARCH}`;
const DIST = path.join(ROOT, 'dist', DIST_NAME);
const NODE_BIN = IS_WINDOWS ? 'node.exe' : 'node';
const FFMPEG_BIN = IS_WINDOWS ? 'ffmpeg.exe' : 'ffmpeg';
const FFPLAY_BIN = IS_WINDOWS ? 'ffplay.exe' : 'ffplay';

function log(message) {
  console.log(`  [打包] ${message}`);
}

function assertSafeDist() {
  const distRoot = path.resolve(ROOT, 'dist');
  const target = path.resolve(DIST);
  if (!target.startsWith(`${distRoot}${path.sep}`)) {
    throw new Error(`拒绝清理 dist 之外的目录: ${target}`);
  }
}

function copyDir(src, dest, shouldSkip = () => false) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const stat = fs.statSync(from);
    if (shouldSkip(name, from, stat)) continue;
    if (stat.isDirectory()) copyDir(from, to, shouldSkip);
    else {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
}

function copyFile(source, target, mode) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  if (mode) fs.chmodSync(target, mode);
}

function findExistingTool(name) {
  const oldPackage = path.join(ROOT, 'dist', 'coolbuy-portable', 'ffmpeg', name);
  const projectDir = path.join(ROOT, 'ffmpeg', name);
  return [oldPackage, projectDir].find((candidate) => fs.existsSync(candidate)) || null;
}

async function download(url, dest) {
  log(`下载 ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`下载失败 HTTP ${response.status}: ${url}`);
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(dest));
}

function extractZip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (IS_WINDOWS) {
    const result = spawnSync('powershell', [
      '-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`,
    ], { stdio: 'inherit' });
    return result.status === 0;
  }
  return spawnSync('tar', ['-xf', zip, '-C', dest], { stdio: 'inherit' }).status === 0;
}

function extractTar(archive, dest) {
  fs.mkdirSync(dest, { recursive: true });
  return spawnSync('tar', ['-xf', archive, '-C', dest], { stdio: 'inherit' }).status === 0;
}

function walkFiles(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walkFiles(full, result);
    else result.push(full);
  }
  return result;
}

async function prepareNode() {
  const target = path.join(DIST, 'node', NODE_BIN);
  copyFile(process.execPath, target, IS_WINDOWS ? undefined : 0o755);
  log(`使用当前 Node 运行时 ${process.version}`);
}

async function prepareFfmpeg() {
  const targetDir = path.join(DIST, 'ffmpeg');
  fs.mkdirSync(targetDir, { recursive: true });
  const existingFfmpeg = findExistingTool(FFMPEG_BIN);
  const existingFfplay = findExistingTool(FFPLAY_BIN);
  if (existingFfmpeg && existingFfplay) {
    copyFile(existingFfmpeg, path.join(targetDir, FFMPEG_BIN), IS_WINDOWS ? undefined : 0o755);
    copyFile(existingFfplay, path.join(targetDir, FFPLAY_BIN), IS_WINDOWS ? undefined : 0o755);
    log('复用已下载的 ffmpeg/ffplay');
    return;
  }

  if (PLATFORM === 'darwin') {
    const sourceDir = process.env.PORTABLE_FFMPEG_DIR;
    if (sourceDir) {
      const sourceFfmpeg = path.join(sourceDir, 'ffmpeg');
      const sourceFfplay = path.join(sourceDir, 'ffplay');
      if (!fs.existsSync(sourceFfmpeg) || !fs.existsSync(sourceFfplay)) {
        throw new Error(`PORTABLE_FFMPEG_DIR 缺少 ffmpeg 或 ffplay: ${sourceDir}`);
      }
      copyFile(sourceFfmpeg, path.join(targetDir, 'ffmpeg'), 0o755);
      copyFile(sourceFfplay, path.join(targetDir, 'ffplay'), 0o755);
      return;
    }
    for (const tool of ['ffmpeg', 'ffplay']) {
      const archive = path.join(DIST, `${tool}.zip`);
      const temp = path.join(DIST, `${tool}-tmp`);
      await download(`https://evermeet.cx/ffmpeg/getrelease/${tool === 'ffmpeg' ? 'zip' : 'ffplay/zip'}`, archive);
      if (!extractZip(archive, temp)) throw new Error(`${tool} 解压失败`);
      const binary = walkFiles(temp).find((file) => path.basename(file) === tool);
      if (!binary) throw new Error(`${tool} 下载包中没有可执行文件`);
      copyFile(binary, path.join(targetDir, tool), 0o755);
      fs.rmSync(temp, { recursive: true, force: true });
      fs.rmSync(archive, { force: true });
    }
    log('已准备 macOS 静态 ffmpeg/ffplay');
    return;
  }

  const archiveExt = IS_WINDOWS ? 'zip' : 'tar.xz';
  const archive = path.join(DIST, `ffmpeg.${archiveExt}`);
  let url;
  if (IS_WINDOWS) {
    url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
  } else if (ARCH === 'arm64') {
    url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linuxarm64-gpl.tar.xz';
  } else {
    url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz';
  }
  await download(url, archive);
  const temp = path.join(DIST, 'ffmpeg-tmp');
  const ok = archiveExt === 'zip' ? extractZip(archive, temp) : extractTar(archive, temp);
  if (!ok) throw new Error('ffmpeg 解压失败');
  for (const file of walkFiles(temp)) {
    const name = path.basename(file);
    if (name === FFMPEG_BIN || name === FFPLAY_BIN) {
      copyFile(file, path.join(targetDir, name), IS_WINDOWS ? undefined : 0o755);
    }
  }
  fs.rmSync(temp, { recursive: true, force: true });
  fs.rmSync(archive, { force: true });
  if (!fs.existsSync(path.join(targetDir, FFMPEG_BIN))) {
    throw new Error('下载包中没有找到 ffmpeg');
  }
  log('已准备便携 ffmpeg/ffplay');
}

function shouldSkipSource(name, fullPath, stat) {
  const excludedNames = new Set([
    '.git', '.env', '.env.local', 'node_modules', 'models', 'dist', 'data',
    'extension.pem', 'make-portable.js', 'npm-debug.log',
    'com.coolbuy.launcher.json', 'coolbuy-launcher.reg', 'launch.bat', 'launch.sh',
  ]);
  if (excludedNames.has(name)) return true;
  if (stat.isFile()) {
    if (name.endsWith('.local')) return true;
    if (/\.(pcm|wav|mp3|log)$/i.test(name)) return true;
  }
  return false;
}

function prepareApp() {
  const appDir = path.join(DIST, 'app');
  copyDir(ROOT, appDir, shouldSkipSource);
  fs.mkdirSync(path.join(appDir, 'data'), { recursive: true });

  log('复制 node_modules');
  copyDir(path.join(ROOT, 'node_modules'), path.join(appDir, 'node_modules'));

  log('复制本地 ASR/TTS/VAD 模型');
  fs.mkdirSync(path.join(appDir, 'models'), { recursive: true });
  for (const model of [
    'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09',
    'kokoro-multi-lang-v1_0',
  ]) {
    const source = path.join(ROOT, 'models', model);
    if (fs.existsSync(source)) {
      copyDir(source, path.join(appDir, 'models', model), (name) => name === 'test_wavs');
    }
  }
  for (const model of ['silero_vad.onnx', 'smart-turn-v3.2-cpu.onnx']) {
    const source = path.join(ROOT, model);
    if (fs.existsSync(source)) copyFile(source, path.join(appDir, model));
  }
}

function writeLaunchers() {
  const nativeDir = path.join(DIST, 'app', 'native');
  fs.mkdirSync(nativeDir, { recursive: true });
  if (IS_WINDOWS) {
    fs.writeFileSync(path.join(nativeDir, 'launch.bat'), [
      '@echo off',
      'rem portable launch - use bundled node relative to this bat',
      '"%~dp0..\\..\\node\\node.exe" "%~dp0coolbuy-launcher.js"',
      '',
    ].join('\r\n'), 'ascii');
    fs.writeFileSync(path.join(DIST, 'install.bat'), [
      '@echo off',
      'chcp 65001 >nul',
      'echo ================================================',
      'echo   coolbuy 一键安装（Windows 便携版）',
      'echo ================================================',
      'cd /d "%~dp0"',
      'echo.',
      'echo [1/1] 注册 Chrome / Edge / Chromium / Brave 本地启动器...',
      '"%~dp0node\\node.exe" "%~dp0app\\native\\register.js"',
      'echo.',
      'echo ================================================',
      'echo   完成！剩余两步（浏览器安全限制，无法自动化）：',
      'echo   1. 打开 chrome://extensions → 开启开发者模式',
      'echo      → 加载已解压的扩展程序 → 选择 app\\extension',
      'echo   2. 完全关闭并重启浏览器',
      'echo ================================================',
      'echo 详见 README-for-agent.md',
      'pause',
      '',
    ].join('\r\n'), 'utf8');
  } else {
    const launchPath = path.join(nativeDir, 'launch.sh');
    fs.writeFileSync(launchPath, [
      '#!/bin/sh',
      'DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
      'exec "$DIR/../../node/node" "$DIR/coolbuy-launcher.js" "$@"',
      '',
    ].join('\n'), 'utf8');
    fs.chmodSync(launchPath, 0o755);
    const installPath = path.join(DIST, 'install.sh');
    fs.writeFileSync(installPath, [
      '#!/bin/sh',
      'set -eu',
      'ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
      'echo "================================================"',
      'echo "  coolbuy 一键安装（' + PLATFORM + ' 便携版）"',
      'echo "================================================"',
      '"$ROOT/node/node" "$ROOT/app/native/register.js"',
      'echo',
      'echo "完成！接下来在浏览器中加载 app/extension，然后完全重启浏览器。"',
      'echo "详见 README-for-agent.md"',
      '',
    ].join('\n'), 'utf8');
    fs.chmodSync(installPath, 0o755);
  }
}

function packageArchive() {
  const parent = path.dirname(DIST);
  const folder = path.basename(DIST);
  const archive = path.join(parent, `${folder}${IS_WINDOWS ? '.zip' : '.tar.gz'}`);
  fs.rmSync(archive, { force: true });
  const args = IS_WINDOWS
    ? ['-a', '-c', '-f', archive, '-C', parent, folder]
    : ['-czf', archive, '-C', parent, folder];
  const result = spawnSync('tar', args, { stdio: 'inherit' });
  if (result.status !== 0 || !fs.existsSync(archive)) throw new Error('压缩失败');
  return archive;
}

function directorySize(dir) {
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    total += stat.isDirectory() ? directorySize(full) : stat.size;
  }
  return total;
}

async function main() {
  assertSafeDist();
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  await prepareNode();
  await prepareFfmpeg();
  log('复制应用代码');
  prepareApp();
  writeLaunchers();
  copyFile(
    path.join(ROOT, 'portable-guide.md'),
    path.join(DIST, 'README-for-agent.md'),
  );
  copyFile(path.join(ROOT, 'LICENSE'), path.join(DIST, 'LICENSE'));
  copyFile(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), path.join(DIST, 'THIRD_PARTY_NOTICES.md'));
  const archive = packageArchive();
  log(`目录完成：${DIST}`);
  log(`目录大小：${(directorySize(DIST) / 1048576).toFixed(1)} MiB`);
  log(`压缩包：${archive}（${(fs.statSync(archive).size / 1048576).toFixed(1)} MiB）`);
}

main().catch((error) => {
  console.error(`  [打包失败] ${error.message}`);
  process.exit(1);
});
