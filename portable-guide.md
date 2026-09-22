# coolbuy 便携包 · 安装与使用指南

（给接手这台电脑的 AI Agent / 使用者 的说明）

## 这是什么

**coolbuy**：付款前，一个语音 AI「小冷」跟你聊两句，帮你把冲动消费的决定权拿回自己手里。

形态 = Chrome 浏览器插件 + 本地语音 Agent。**本目录就是完整程序**，自带 Node 运行时和 ffmpeg，目标电脑无需预装 Node / ffmpeg，只需已装 Chrome。

## 目录结构

```
install.bat      一键注册（双击跑一次即可，扩展 ID 已固定，无需手动复制）
node/            便携 Node 运行时
ffmpeg/          ffmpeg.exe + ffplay.exe（采音/放音）
app/
  agent-b.js     本地语音 Agent 主程序
  native/        本地启动器 + 注册脚本
  extension/     浏览器插件（Chrome 加载这个目录）
  models/        本地模型：ASR(SenseVoice) + TTS(Kokoro) + VAD + 语义判停
README-for-agent.md  本说明
```

## 安装步骤（3 步）

1. 双击运行 `install.bat`（注册本地启动器，写注册表 HKCU，免管理员）
2. Chrome 地址栏输入 `chrome://extensions` → 右上角打开「开发者模式」→ 点「加载已解压的扩展程序」→ 选择 `app\extension` 文件夹
3. **完全关闭并重启 Chrome**（注册表只在启动时读一次）

> 第 2 步是 Chrome 的安全限制，必须由人在 Chrome 界面上点，无法自动化。

## 使用

1. 打开任意电商商品页（京东 / 淘宝 / 拼多多 商品详情页）
2. 点浏览器工具栏的 coolbuy 小冷图标 → 弹出面板
3. 首次先点面板右上 **⚙ 设置**：
   - 大模型 API Key（LLM 用，OpenAI 兼容；Base URL + 模型名可选，可点「拉取模型列表」）
   - 麦克风设备：点「刷新设备列表」选本机麦克风
   - ASR / TTS 默认本地，免 key，无需填
4. 按 **Start** → 本地 Agent 启动（首次约 5~10 秒加载模型）→ 按钮变红 → 直接开口说话

三键语义：
- **Start（灰）**：启动本地 Agent 并开始对话 → 变红
- **Start（红）**：结束对话并**关闭本地程序** → 变灰
- **Stop**：暂停 / 恢复语音（程序不退出）
- **Interview**：让 AI 主动先开口反问

## 注意事项

- 端口 `7901` 被本地程序使用，勿被占用
- 完全自包含：不依赖系统 Node / ffmpeg，但 Chrome 必须已装
- 配置（API key、麦克风、音色）存在浏览器 `chrome.storage.local`，仅本机

## 故障排查

| 现象 | 处理 |
|---|---|
| 面板显示「本地 Agent 未连接」 | 确认 install.bat 跑过 + Chrome 完全重启；再按 Start |
| 按 Start 报「启动失败」 | 看面板状态文字；或手动在 `app` 目录运行 `node agent-b.js --bridge` 看终端日志 |
| 没声音 / 识别不到说话 | 设置里「刷新设备列表」选对麦克风；检查系统音量与默认输出设备 |
| 说话识别慢或错 | 靠近麦克风、说完整句；默认本地模型，中文短句效果最佳 |
