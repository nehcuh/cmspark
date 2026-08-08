# Changelog

格式大致遵循 [Keep a Changelog](https://keepachangelog.com/)。版本号与 `companion/package.json` / `chrome-extension/package.json` 对齐。

## [0.5.0] — 2026-08-08

### 稳定切点

听写 / 会议 / 本机 STT 产品线合入并文档化；Computer Use 实验定位仅保留 **Qwen3-VL**；macOS DMG 可打包安装。

### Added

- **听写+ D2**：按住热键；设置中 **按键盘录制** 组合键；文字/语音改设置命令条  
- **实时出字**：浏览器 Web Speech interim；本机 Whisper **M2 渐进假设流**（PCM 流式 + `voice.stt.partial_request`，约 8s 窗定稿）  
- **会议**：装配 › 场景 › 会议 工作台入口；Mtg0–3（粘贴/本机录/上传/实验发言人N）  
- ADR-023 / ADR-024 与用户指南 [meeting-and-dictation-user-guide](docs/meeting-and-dictation-user-guide.md)

### Removed

- **TinyClick / Florence-2 ONNX** 全栈与 `onnxruntime-node`、CI vendor 校验（PR #151）  
- 实验桌面定位统一为 **Qwen3-VL**

### Changed

- 产品版本 **0.4.0 → 0.5.0**  
- 文档导航、GOAL G22、architecture §9 与 README 能力表同步  

### Security / Trust

- 本机 STT 仍走 chrome-extension origin fence；partial 失败 soft-skip 不杀 live 会话  
- Pack 仍不得写 voice / hotkey / ack  

## [0.4.0] — 2026-08

### Added / shipped under 0.4.x

- Multi-agent · Mission Board · Pack / 企业模块  
- Computer Use / Host / Apps · Confirm Center · Outbound MCP 骨架  
- Qwen3-VL 实验定位层  
- 听写 M1 + Path B 本机 STT 初版 · Dictation+ D1 · 会议 Mtg 初版（后续并入 0.5.0 文档）  

## [0.3.0] — 2026-07

- MCP · Mission Pack · Computer Use / Host 主路径 · Multi-agent P0  

---

链接：

- [docs/README.md](docs/README.md)  
- [GOAL.md](docs/GOAL.md)  
