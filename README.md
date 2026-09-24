# coolbuy

付款前，一个语音 AI「小冷」跟你聊两句，帮你把冲动消费的决定权拿回自己手里。

COOLBUY 由两部分组成：

- Chrome / Edge / Chromium / Brave 浏览器插件：读取用户正在浏览的商品页信息。
- 本地语音 Agent：负责 ASR、对话、LLM 工具调用和 TTS。

ASR 默认使用本地 SenseVoice，TTS 默认使用本地 Kokoro。用户只需要提供一个 OpenAI 兼容的 LLM API，不需要再配置语音服务。

## 能做什么

- 识别当前商品、价格、促销信息和页面停留时间。
- 通过本机 WebSocket 把页面上下文交给本地 Agent。
- 支持本地 ASR、本地 TTS，也支持切换到豆包云端语音。
- 支持语音打断、语义判停和 Interview 主动提问。
- API Key 和语音配置保存在浏览器 `chrome.storage.local`，不上传项目服务器。

## 系统支持

| 系统 | 音频采集 | Native Messaging | 便携打包 |
|---|---|---|---|
| Windows 10/11 x64 | DirectShow | 注册表 | 支持，脚本自动下载 ffmpeg |
| macOS Intel / Apple Silicon | AVFoundation | `~/Library/Application Support` | 支持，脚本自动获取静态 ffmpeg |
| Linux x64 / arm64 | PulseAudio，可切 ALSA | `~/.config` | 支持，脚本自动下载 ffmpeg |

## 浏览器支持

COOLBUY 面向 Chromium 内核浏览器，支持：

- Google Chrome
- Microsoft Edge
- Chromium
- Brave

没有 Chrome 也可以直接使用 Edge 或其他 Chromium 浏览器。安装脚本会同时注册这些浏览器的 Native Messaging Host。扩展仍需要在该浏览器对应的用户配置中手动“加载已解压的扩展程序”。

源码运行要求：

- Node.js 22 或更高版本。
- `ffmpeg` 和 `ffplay` 在 `PATH` 中，或通过 `FFMPEG_PATH`、`FFPLAY_PATH` 指定。
- 完整的 Chromium 浏览器。

## 快速安装

发布包会按系统分别提供。下载对应系统版本后：

仓库内的 `build-portable.yml` 会在 GitHub Actions 上分别构建 Windows、Linux、macOS Intel 和 macOS Apple Silicon 四个版本。

Windows：

```bat
install.bat
```

macOS / Linux：

```bash
chmod +x install.sh
./install.sh
```

然后：

1. 打开 `chrome://extensions`，开启开发者模式。
2. 选择“加载已解压的扩展程序”。
3. 选择包内的 `app/extension`。
4. 完全退出并重新启动浏览器。
5. 打开电商商品页，点击工具栏中的 COOLBUY 图标。
6. 在设置中填写 LLM API Key、Base URL 和模型名，选择麦克风。

macOS 首次使用时，需要在“系统设置 → 隐私与安全性”中允许浏览器和终端访问麦克风。

## 本地 TTS 和豆包 TTS

默认使用本地 Kokoro，不需要额外 Key，适合直接安装即用。

如果希望获得更好的音色和更自然的韵律，可以在插件设置中选择“云端豆包”。使用豆包 TTS 需要从火山引擎获取：

- 火山引擎 App ID，不是 Google 或 Apple ID。
- 火山引擎 Access Key。

这两项只保存在用户本机的浏览器存储中。没有豆包凭据时继续使用本地 Kokoro 即可，不影响核心对话功能。

## 从源码运行

```bash
npm install
npm run register
npm run list-devices
node agent-b.js --bridge
```

开发调试也可以直接运行：

```bash
node agent-b.js --text "我现在很想买这个耳机"
node agent-b.js --tts-test
node mic-test.js
npm run portable
```

## 目录结构

```text
extension/                 浏览器插件
native/                    Native Messaging 启动与注册
audio.js                   跨平台音频设备适配
agent-b.js                 本地语音 Agent 主链路
brain.js                   LLM 对话与工具循环
llm.js                     OpenAI 兼容 LLM 客户端
asr-local.js / tts-local.js 本地 ASR / TTS
models/                    本地模型，不提交 Git
make-portable.js           当前系统便携包构建脚本
portable-guide.md          交给安装 Agent 的指导说明书
dist/                      构建产物，不提交 Git
```

## 隐私与安全

- LLM API Key 只保存在本机浏览器配置中。
- 商品页信息仅在用户按下 Start 后发送给本地 Agent，再由本地 Agent 交给用户配置的 LLM。
- 本地桥当前只监听 `127.0.0.1:7901`。不要在公网或不受信任的局域网中暴露该端口。
- 公开发布二进制前，应继续完善本地桥的一次性 token 握手。
- `.env`、`extension.pem`、`dist/`、`models/` 不进入 Git 仓库。

## Chrome 扩展看起来消失

Chrome 的每个用户配置都有独立的扩展列表。若 Chrome 有多个用户，扩展只安装在其中某一个用户里，切换到另一个用户后就会看不到。

排查方式：

1. 打开 `chrome://version`，确认 `配置文件路径` 和安装扩展时一致。
2. 打开 `chrome://extensions`，确认开发者模式仍开启，并能看到 COOLBUY。
3. 不要使用访客模式或无痕模式判断扩展是否被删除。
4. 如果任务栏图标只是不显示，在扩展菜单中重新固定 COOLBUY。

Edge 通常只有默认用户配置，因此更容易表现为重启后持续存在。

## 下载

- GitHub：https://github.com/wushaohengsir/coolbuy
- Gitee：https://gitee.com/wushaohengsir/coolbuy

## 许可证

项目代码使用 MIT License。便携包内包含的 ffmpeg、Node.js、模型和其他依赖遵循各自许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
