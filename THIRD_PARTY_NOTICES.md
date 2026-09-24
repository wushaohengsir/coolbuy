# Third-Party Notices

COOLBUY 项目代码使用 MIT License。便携包和运行时还会包含以下第三方软件或模型，它们分别遵循自己的许可证。

| Component | Purpose | License / Upstream |
|---|---|---|
| FFmpeg | 音频采集、重采样和播放 | GPL build from https://github.com/BtbN/FFmpeg-Builds |
| Node.js | 本地运行时 | Multiple licenses, https://github.com/nodejs/node |
| sherpa-onnx | 本地 ASR / TTS 推理 | Apache-2.0, https://github.com/k2-fsa/sherpa-onnx |
| SenseVoice model | 本地语音识别 | Upstream: https://huggingface.co/ASLP-lab/WSYue-ASR |
| Kokoro model | 本地语音合成 | Apache-2.0, https://github.com/hexgrad/kokoro |
| npm dependencies | Agent 运行依赖 | 各包许可证见 `node_modules` 内的 LICENSE 文件 |

## FFmpeg

Windows 和 Linux 便携包使用 BtbN 的 GPL ffmpeg 构建。再分发这些二进制时，应同时提供对应源代码获取方式，并保留 FFmpeg 的许可证和版权声明。

FFmpeg 官方源码：https://ffmpeg.org/download.html

## Models

模型文件体积较大，不进入 Git 仓库。发布完整便携包前，请确认目标模型的许可证允许再分发，并保留模型目录中的 LICENSE、README 和来源说明。

此文件用于项目内合规提示，不构成法律意见。
