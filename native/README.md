# coolbuy 本地启动器（Native Messaging）

让插件的 **Start 键控制本地 Agent 进程生死**：灰 Start 拉起、红 Start 杀死，不用再开终端。

## 一次性安装

1. 加载扩展后，在 `chrome://extensions`（开发者模式）复制 coolbuy 卡片上的 **ID**（32 位 a-p 字母）
2. 在项目根目录运行：

   ```bat
   node native\register.js <扩展ID>
   ```

3. **重启 Chrome**

要求：`node` 在系统 PATH 里（`node -v` 能输出版本号即可）。

## 工作原理

```
按 Start（灰）→ background.js connectNative('com.coolbuy.launcher')
  → Chrome 拉起 native/launch.bat → coolbuy-launcher.js
  → spawn node agent-b.js --bridge → 等 7901 端口就绪 → 面板开始会话，按钮变红
再按 Start（红）→ 插件发 kill + 断开 native 端口
  → 启动器 taskkill /T /F 杀整棵进程树（含 ffmpeg/ffplay）→ 按钮变灰
```

`com.coolbuy.launcher.json` 由 register.js 按本机路径和扩展 ID 生成，不入库。
