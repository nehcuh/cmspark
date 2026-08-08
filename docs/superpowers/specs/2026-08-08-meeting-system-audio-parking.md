# 会议系统音频 / 混音 — 停车场调研（Mtg2）

> **日期**: 2026-08-08  
> **状态**: **PARKING** — 不实现；Mtg2 仅调研落盘  
> **SoT**: [会议纪要](./2026-08-07-meeting-minutes-design.md) §3.2 / §7；[ADR-024](../../adr/024-dictation-plus-asr-refiner-meeting.md)

---

## 1. 用户诉求

在飞书/Zoom/腾讯会议等窗口播放对方声音时，希望 CMspark **同时**采到：

1. 本机麦克风（自己）  
2. 系统/应用播放音频（对方）

从而得到完整会谈转写，而不只是「自言自语备忘」。

---

## 2. 平台现实（2026-08）

| 平台 | 能力 | 备注 |
|------|------|------|
| **macOS** | 无公开「系统混音」API；需虚拟设备（BlackHole / Loopback）或 ScreenCaptureKit 音频 | Chrome `getDisplayMedia` 可勾 audio，但扩展 Side Panel 权限与 UX 复杂；用户须装虚拟声卡 |
| **Windows** | WASAPI loopback 可采输出设备 | 需 native companion 模块；非纯 Extension |
| **Linux** | Pulse/PipeWire monitor source | 发行版差异大 |
| **Chrome Extension only** | `getUserMedia` mic；`getDisplayMedia` 可选 system audio（Chrome 限定） | MV3 + Side Panel 触发 display media 体验差；与「Pack 永不 auto mic」冲突风险 |

结论：**系统混音不是 Mtg1/Mtg2 的 Extension-only 交付物**；若做，应是 **Companion 原生 + 显式用户安装/授权** 的独立波次，并另开 Trust 对抗。

---

## 3. 与当前架构的冲突点

1. **Trust residual**：多一路「桌面/系统音频」通道，隐私文案与 ack 必须新版本（不能塞进 `meeting_privacy_ack_v1` 静默升级）。  
2. **Pack 纪律**：禁止 Pack 写 `autoStart` / 静默开采。  
3. **max-1 STT**：混音流若双轨，分段与预算需重新设计。  
4. **法律**：多方会议录音合规仍由用户负责（SoT 已诚实声明）。

---

## 4. 推荐路径（若未来做）

| 阶段 | 内容 |
|------|------|
| Spike | macOS ScreenCaptureKit 或用户自备 BlackHole 聚合 → Companion 录文件 → 现有 `voice.stt` / 上传路径 |
| MVP | 仅 Windows WASAPI loopback opt-in + 独立 ack |
| 非目标 | 伪装成「飞书一键自动录多方」营销 |

**Mtg2 已交付的替代**：上传会后录音文件（客户端解码 → 本机分段 STT）+ 手动 speaker 标签。

---

## 5. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-08-08 | Mtg2 调研初版 LOCKED as parking |
