# COOLBUY 便携包 · Agent 安装与使用指南

这份说明供接手本机的 AI Agent 和用户共同使用。

仓库地址：

- GitHub：https://github.com/wushaohengsir/coolbuy
- Gitee：https://gitee.com/wushaohengsir/coolbuy
- Gitee 发布页：https://gitee.com/wushaohengsir/coolbuy/releases

## 这是什么

**COOLBUY / 小冷** 是一个付款前陪你聊两句的语音 AI，帮助用户减少冲动消费。

产品由浏览器插件和本地语音 Agent 组成。便携包内含 Node 运行时、ffmpeg、应用代码、本地 ASR 和本地 TTS 模型。安装完成后，用户只需要提供一个 OpenAI 兼容的 LLM API。

## 安装

浏览器要求：Chrome、Edge、Chromium、Brave 均可，任意一个 Chromium 内核浏览器即可，不是必须安装 Chrome。

### Windows

1. 解压便携包。
2. 双击 `install.bat`。
3. 打开浏览器的扩展管理页并开启开发者模式：
   - Chrome / Chromium：`chrome://extensions`
   - Edge：`edge://extensions`
   - Brave：`brave://extensions`
4. 点击“加载已解压的扩展程序”，选择 `app\extension`。
5. 完全退出并重新启动浏览器。

### macOS / Linux

1. 解压便携包。
2. 在终端进入目录并执行：

   ```bash
   chmod +x install.sh
   ./install.sh
   ```

3. 打开浏览器的扩展管理页并开启开发者模式：
   - Chrome / Chromium：`chrome://extensions`
   - Edge：`edge://extensions`
   - Brave：`brave://extensions`
4. 点击“加载已解压的扩展程序”，选择 `app/extension`。
5. 完全退出并重新启动浏览器。

macOS 第一次录音时，需要允许浏览器或终端访问麦克风。

## 浏览器选择

安装脚本会同时注册 Chrome、Edge、Chromium 和 Brave 的本地启动器。用户可以选择自己已经安装的浏览器：

1. 打开该浏览器的扩展管理页。Chrome / Chromium 使用 `chrome://extensions`，Edge 使用 `edge://extensions`，Brave 使用 `brave://extensions`。
2. 开启开发者模式。
3. 选择“加载已解压的扩展程序”。
4. 选择包内的 `app/extension`。
5. 完全退出并重新打开该浏览器。

Chrome、Edge、Chromium、Brave 都有独立的用户配置。扩展安装在哪个用户配置，就必须从同一个用户配置打开。不要用访客模式或无痕模式判断安装是否成功。

Windows 上如果 Chrome 有多个用户，可以建立专用快捷方式，在“目标”后追加 `--profile-directory="Profile 1"`，避免每次打开到另一个用户配置。

## 首次配置

1. 打开任意电商商品详情页。
2. 点击浏览器工具栏中的 COOLBUY“小冷”图标。
3. 点击面板右上角的设置按钮。
4. 填写：
   - 大模型 API Key。
   - 大模型 Base URL，可选，默认兼容 OpenAI 格式。
   - 大模型名称，可点击“拉取模型列表”。
5. 刷新并选择本机麦克风。
6. ASR 和 TTS 默认使用本地模型，不需要额外 Key。
7. 保存配置，然后按 Start。

### 更好的 TTS 音色

默认 TTS 是本地 Kokoro，不额外收费，也不需要外部 Key。

如果用户希望获得更好的音色和更自然的语音体验，可以选择“云端豆包”。此时需要用户在火山引擎申请：

- App ID，注意不是 Apple ID。
- Access Key。

在插件设置中选择“云端豆包”，填写以上两项并保存。没有火山引擎凭据时保持“本地 Kokoro”即可。

## 三键说明

- **Start（灰）**：启动本地 Agent，开始一次新会话。
- **Start（红）**：结束会话并关闭本地 Agent。
- **Stop**：暂停或恢复监听和语音，不退出程序。
- **Interview**：让 AI 基于当前页面主动提出一个问题。

## 目录结构

```text
install.bat / install.sh    一键注册浏览器本地启动器
node/                       便携 Node 运行时
ffmpeg/                     ffmpeg 与 ffplay
app/
  agent-b.js                本地语音 Agent 主程序
  native/                   Native Messaging 启动器与注册脚本
  extension/                浏览器插件
  models/                   本地 ASR、TTS、VAD、语义判停模型
README-for-agent.md         本说明
LICENSE                     项目许可证
THIRD_PARTY_NOTICES.md      第三方软件说明
```

## 常见问题

| 现象 | 处理 |
|---|---|
| 面板显示“本地 Agent 未连接” | 确认已运行安装脚本，并完全重启浏览器 |
| 按 Start 后启动失败 | Windows 查看 `app` 目录；macOS/Linux 在终端运行 `./node/node app/agent-b.js --bridge` |
| 识别不到麦克风 | 检查系统麦克风权限；重新加载设备列表；确认 ffmpeg 支持当前音频后端 |
| 没有声音 | 检查系统输出设备和 `ffplay` 是否可执行 |
| Chrome 关闭后看不到扩展 | 检查是否切换了 Chrome 用户配置；打开 `chrome://version` 确认配置路径 |
| Chrome 中同时出现两个 COOLBUY | 移除全部旧卡片，再重新加载一次扩展目录。旧的 `kfbmp...` 是固定 key 之前产生的重复 ID |
| 不想安装 Chrome | 改用 Edge、Chromium 或 Brave，安装脚本均已覆盖 |
| 想使用更好的 TTS | 选择云端豆包，填写火山引擎 App ID 和 Access Key |
| 本地识别较慢 | 靠近麦克风，使用完整短句；CPU 推理会受机器性能影响 |
| 端口 7901 被占用 | 关闭占用进程，或在两端同时设置 `BRIDGE_PORT` |

## Agent 执行要求

- 用户只需要提供 LLM API Key；不要要求用户另外配置 ASR 或 TTS。
- 默认使用本地 ASR 和本地 Kokoro TTS。豆包 TTS 是可选增强，需要用户自行提供火山引擎 App ID 和 Access Key。
- Chrome、Edge、Chromium、Brave 都可以使用。
- 安装过程中可以自动执行脚本和文件操作。
- 在浏览器中开启开发者模式和加载扩展必须由用户确认。
- 不要把 `.env`、API Key、本地录音或模型文件提交到 Git。
