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

### Windows

1. 解压便携包。
2. 双击 `install.bat`。
3. 打开 `chrome://extensions`，开启开发者模式。
4. 点击“加载已解压的扩展程序”，选择 `app\extension`。
5. 完全退出并重新启动浏览器。

### macOS / Linux

1. 解压便携包。
2. 在终端进入目录并执行：

   ```bash
   chmod +x install.sh
   ./install.sh
   ```

3. 打开 `chrome://extensions`，开启开发者模式。
4. 点击“加载已解压的扩展程序”，选择 `app/extension`。
5. 完全退出并重新启动浏览器。

macOS 第一次录音时，需要允许浏览器或终端访问麦克风。

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
| 本地识别较慢 | 靠近麦克风，使用完整短句；CPU 推理会受机器性能影响 |
| 端口 7901 被占用 | 关闭占用进程，或在两端同时设置 `BRIDGE_PORT` |

## Agent 执行要求

- 用户只需要提供 LLM API Key；不要要求用户另外配置 ASR 或 TTS。
- 安装过程中可以自动执行脚本和文件操作。
- 在浏览器中开启开发者模式和加载扩展必须由用户确认。
- 不要把 `.env`、API Key、本地录音或模型文件提交到 Git。
