# Agent Guide

This repository contains the COOLBUY browser extension and local voice Agent.

Before installing the packaged product, read `portable-guide.md`. The packaging script copies that file to `README-for-agent.md` in the release archive.

Repositories:

- GitHub: https://github.com/wushaohengsir/coolbuy
- Gitee: https://gitee.com/wushaohengsir/coolbuy

Rules:

- Never commit `.env`, API keys, local recordings, `models/`, `dist/` or `extension.pem`.
- Keep Windows, macOS and Linux support working when changing audio, native messaging or packaging code.
- The user only supplies an OpenAI-compatible LLM API key. Local ASR/TTS must remain the default.
