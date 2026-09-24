# COOLBUY 本地启动器（Native Messaging）

让插件的 Start 键控制本地 Agent 进程，不需要手动打开终端。

## 一次性安装

Windows：

```bat
node native\register.js
```

macOS / Linux：

```bash
node native/register.js
```

然后完全重启 Chrome、Edge、Chromium 或 Brave。

## 支持的系统

- Windows：写入 HKCU 注册表，使用 `launch.bat`。
- macOS：写入 `~/Library/Application Support/<browser>/NativeMessagingHosts`，使用 `launch.sh`。
- Linux：写入 `~/.config/<browser>/NativeMessagingHosts`，使用 `launch.sh`。

已覆盖 Chrome、Chromium、Edge 和 Brave。

## 工作原理

```text
按 Start → background.js connectNative('com.coolbuy.launcher')
  → 浏览器启动 native/launch.bat 或 launch.sh
  → coolbuy-launcher.js 启动 agent-b.js --bridge
  → 7901 端口就绪后，按钮变红
再按 Start → 启动器结束 Agent 及其 ffmpeg/ffplay 子进程
```

`com.coolbuy.launcher.json` 和 `launch.bat` / `launch.sh` 由 `register.js` 按本机路径生成，不入库。
