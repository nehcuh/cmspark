# 听写+ 与 会议记录 — 用户指南

> 产品 **0.4.x** · Trust SoT：[ADR-024](adr/024-dictation-plus-asr-refiner-meeting.md)  
> 听写+ 设计：[dictation-plus SoT](superpowers/specs/2026-08-07-dictation-plus-design.md)  
> 会议设计：[meeting-minutes SoT](superpowers/specs/2026-08-07-meeting-minutes-design.md) · [Mtg3 diarize](superpowers/specs/2026-08-08-meeting-mtg3-diarize-design.md)

---

## 1. 两条产品线（不要混）

| | **听写+（L-B）** | **会议记录（L-C）** |
|--|------------------|---------------------|
| 入口 | 主对话 composer 🎤 | 侧栏「会议」/ 任务包「会议记录」 |
| 产物 | 草稿文本（不自动发送） | 本地会话转写 + 结构化纪要 |
| 长录 STT | continuous：browser 或本机分段 | **仅本机**（或上传音频） |
| 说话人 | 无 | 手动 / 实验性「发言人N」 |
| Pack | **不得**改 voice / 热键 / ack | 仅 skills + 纪要 prompt |

全局 **max-1**：会议录音中禁用听写；听写中无法开始会议录音。

---

## 2. 听写+

### 2.1 形态

1. **经典短听**（默认）：点按 🎤，约 ≤45 秒，无静默续听  
2. **连续听写**（设置 opt-in）：更长口述；浏览器自动续听；本机约 45 秒一段串行  
3. **按住热键（D2）**：设置中开启并选择组合键；**按住说话、松手结束**；默认关  

时长：软提示约 5 分钟；硬上限默认 15 分钟（设置可调，绝对上限 30 分钟）。

### 2.2 ASR 纠错

- 默认 **关**；停录后可选一枪「识别纠错」（不是润色）  
- 只发**转写文本**给当前 Companion LLM，不发音频  
- 需隐私说明 **v3**；失败则保留识别原文  

### 2.3 按住热键（D2）

| 项 | 说明 |
|----|------|
| 默认 | **关闭** |
| 建议键 | mac：`⌃⇧Space` / `⌥Space`；Win：`Ctrl+Shift+Space` |
| **禁止默认** | bare `fn`、`Win+V` |
| 前置 | Companion 已连接 + **Side Panel 打开且获得键盘焦点** |
| 行为 | 按下 → 开始**连续**听写管线；松开 → 结束并可选纠错 |
| 互斥 | 与点按 🎤 同一会话；会议录音进行中会拒绝 |
| 反馈 | 侧栏内时长/状态；开始时系统通知「CMspark · 草稿」 |
| Panel 关闭/失焦 | 失焦会结束 hold；关闭侧栏后无法捕获组合键 |

当前实现：组合键由 **Side Panel 窗口** `keydown`/`keyup` 捕获（面板需焦点）。OS 级全局热键（失焦仍按住）属后续增强，不在 D2.0 宣称范围。

### 2.4 隐私 ack

| 版本 | 何时 |
|------|------|
| v1 | 浏览器听写 |
| v2 | 本机 STT |
| v3 | 连续听写 / ASR 纠错 / 按住热键长听 |

---

## 3. 会议记录

### 3.1 入口

- 底栏 / 上下文 **会议**  
- 或 **任务包 → 会议记录**（应用 **不会**自动开麦）

### 3.2 能力波次（已交付）

| 波次 | 能力 |
|------|------|
| **Mtg0** | 粘贴转写 → 生成 TL;DR / 决议 / 待办 / 风险；复制 / 发到草稿 |
| **Mtg1** | 显式「开始录制」本机分段 STT；结束生成纪要；`meeting_privacy_ack_v1`；默认删音频 |
| **Mtg2** | 静音切分段；默认/批量说话人；上传 `.txt/.md`；上传音频 → 本机转写 |
| **Mtg3** | 实验：**自动标「发言人N」**（段特征 k-means，**非身份识别**）；弱标交替 |

### 3.3 诚实边界

- **不是**飞书/Otter 级多方 diarize SLA  
- **系统/会议软件混音**：未做产品能力，见 [parking 调研](superpowers/specs/2026-08-08-meeting-system-audio-parking.md)  
- 纪要 LLM **不得臆造**未出现的出席人/决议；已有标签可沿用  

### 3.4 数据位置

`~/.cmspark-agent/meetings/<id>/`（meta / transcript / minutes；权限收紧）

---

## 4. 真机验收清单（供用户自测）

> 实现侧不代跑；合入后由你本地验收。

### 听写+

- [ ] classic 45s 行为与 M1 一致、不 auto-send  
- [ ] continuous ≥3 min 中文有字进草稿  
- [ ] ASR 纠错 off 无 LLM；on 失败保留 raw  
- [ ] 本机 continuous 多段合并  
- [ ] 开启按住热键后按住 ≥2s 松手 → 字进主线程草稿；侧栏关闭时有失败提示  

### 会议

- [ ] Pack 应用不开麦  
- [ ] 粘贴转写 → 纪要结构可读  
- [ ] 本机录 ≥1–5 min → 可编辑转写 → 纪要；默认无残留 audio  
- [ ] 上传音频 → 转写；可选自动「发言人N」；可手改  
- [ ] 听写与会议互斥提示  

---

## 5. 相关 ADR / 设置

- [ADR-023 本机 STT](adr/023-voice-local-stt-path-b.md)  
- [ADR-024 听写+ · Refiner · 会议落盘](adr/024-dictation-plus-asr-refiner-meeting.md)  
- Side Panel → **设置 → 语音 / 听写**  
