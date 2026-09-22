/**
 * 注册 Native Messaging Host：生成 host manifest + 写注册表（HKCU，无需管理员）
 * 用法：node native/register.js <32位扩展ID>
 *   扩展ID：chrome://extensions → 打开开发者模式 → coolbuy 卡片上的 ID（a-p 字母）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const id = process.argv[2];
if (!id || !/^[a-p]{32}$/.test(id)) {
  console.error('用法: node native/register.js <32位扩展ID（a-p）>');
  console.error('扩展ID 在 chrome://extensions 开发者模式的 coolbuy 卡片上');
  process.exit(1);
}

const manifestPath = path.join(__dirname, 'com.coolbuy.launcher.json');
const manifest = {
  name: 'com.coolbuy.launcher',
  description: 'coolbuy 本地 Agent 启动器（Start 键控制进程生死）',
  path: path.join(__dirname, 'launch.bat'),
  type: 'stdio',
  allowed_origins: [`chrome-extension://${id}/`],
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

execSync(
  `reg add "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.coolbuy.launcher" /ve /d "${manifestPath}" /f`,
  { stdio: 'inherit' }
);
console.log('\n注册完成。重启 Chrome 后，按面板的 Start 即可拉起本地 Agent。');
