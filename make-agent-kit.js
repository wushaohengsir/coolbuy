/**
 * Build the small attachment kit for social posts.
 *
 * The archive always contains README-for-agent.md so another AI agent can read
 * the installation contract without downloading the full multi-hundred-MB app.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const DIST_ROOT = path.join(ROOT, 'dist');
const STAGE = path.join(DIST_ROOT, 'coolbuy-agent-kit');
const VERSION = require('./package.json').version;
const IS_WINDOWS = process.platform === 'win32';
const ARCHIVE = path.join(
  DIST_ROOT,
  `coolbuy-agent-kit-v${VERSION}${IS_WINDOWS ? '.zip' : '.tar.gz'}`,
);

function assertSafe(pathname) {
  const root = path.resolve(DIST_ROOT);
  const target = path.resolve(pathname);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`拒绝操作 dist 之外的路径: ${target}`);
  }
}

const AGENT_PROMPT = `请先阅读同目录下的 README-for-agent.md，然后负责完成 COOLBUY 的安装。

要求：
1. Windows 运行 install.bat；macOS / Linux 运行 install.sh。
2. Chrome、Edge、Chromium、Brave 任选已安装的 Chromium 浏览器。
3. 在浏览器扩展管理页开启开发者模式，加载 app/extension 或 README 指定目录。
4. 完全重启浏览器。
5. 用户最后只需要提供 OpenAI 兼容的 LLM API Key。
6. 默认使用本地 ASR 和本地 Kokoro TTS。豆包 TTS 是可选增强，需要用户自己提供火山引擎 App ID 和 Access Key。
7. 完成后验证本地 Agent 能启动、麦克风能识别、Start / Stop / Interview 能正常工作。
`;

function writeStage() {
  assertSafe(STAGE);
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'portable-guide.md'),
    path.join(STAGE, 'README-for-agent.md'),
  );
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(STAGE, 'LICENSE'));
  fs.writeFileSync(path.join(STAGE, 'AGENT-PROMPT.txt'), AGENT_PROMPT, 'utf8');
  fs.writeFileSync(path.join(STAGE, 'DOWNLOAD-LINKS.txt'), [
    'GitHub: https://github.com/wushaohengsir/coolbuy',
    'Gitee: https://gitee.com/wushaohengsir/coolbuy',
    'Gitee Releases: https://gitee.com/wushaohengsir/coolbuy/releases',
    '',
  ].join('\n'), 'utf8');
}

function makeArchive() {
  assertSafe(ARCHIVE);
  fs.rmSync(ARCHIVE, { force: true });
  if (IS_WINDOWS) {
    const result = spawnSync('powershell', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -LiteralPath '${STAGE}' -DestinationPath '${ARCHIVE}' -CompressionLevel Optimal`,
    ], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('Agent 附件压缩失败');
  } else {
    const result = spawnSync('tar', [
      '-czf', ARCHIVE, '-C', DIST_ROOT, path.basename(STAGE),
    ], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('Agent 附件压缩失败');
  }
  return ARCHIVE;
}

writeStage();
const archive = makeArchive();
console.log(`Agent 附件：${archive}`);
console.log(`大小：${(fs.statSync(archive).size / 1024).toFixed(1)} KiB`);
