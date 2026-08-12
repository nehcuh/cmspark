# 听写+ 与 会议记录 — 用户指南

> 产品 **0.5.0** · Trust SoT：[ADR-024](adr/024-dictation-plus-asr-refiner-meeting.md)  
> 听写+ 设计：[dictation-plus SoT](superpowers/specs/2026-08-07-dictation-plus-design.md)  
> 本机 STT：[ADR-023](adr/023-voice-local-stt-path-b.md) · [local STT SoT](superpowers/specs/2026-08-07-voice-local-stt-design.md)  
> 会议设计：[meeting-minutes SoT](superpowers/specs/2026-08-07-meeting-minutes-design.md) · [Mtg3 diarize](superpowers/specs/2026-08-08-meeting-mtg3-diarize-design.md)

---

## 1. 两条产品线（不要混）

| | **听写+（L-B）** | **会议记录（L-C）** |
|--|------------------|---------------------|
| 入口 | 主对话 composer 🎤 | **装配 › 场景 › 会议** / 侧栏「会议」/ `/meeting` |
| 产物 | 草稿文本（不自动发送） | 本地会话转写 + 结构化纪要 |
| 长录 STT | continuous：browser 或本机（含 M2 渐进假设） | **仅本机**（或上传音频） |
| 说话人 | 无 | 手动 / 实验性「发言人N」 |
| Pack | **不得**改 voice / 热键 / ack | 仅 skills + 纪要 prompt |

全局 **max-1**：会议录音中禁用听写；听写中无法开始会议录音。

---

## 2. 听写+

### 2.1 形态

1. **经典短听**（默认）：点按 🎤，约 ≤45 秒，无静默续听  
2. **连续听写**（设置 opt-in）：更长口述；浏览器自动续听；本机可分段 / 渐进假设  
3. **按住热键（D2）**：设置中开启；**按键盘录制**组合键或选预设；**按住说话、松手结束**；默认关  
4. **实时出字**（设置）：浏览器 = Web Speech interim；本机 = M2 渐进假设（见 §2.5）

时长：软提示约 5 分钟；硬上限默认 15 分钟（设置可调，绝对上限 30 分钟）。

### 2.2 ASR 纠错

- 默认 **关**；停录后可选一枪「识别纠错」（不是润色）  
- 只发**转写文本**给当前 Companion LLM，不发音频  
- 需隐私说明 **v3**；失败则保留识别原文  

### 2.3 按住热键（D2）

| 项 | 说明 |
|----|------|
| 默认 | **关闭** |
| 设置方式 | 勾选启用 → **「按键盘录制」** 或点预设 chip |
| 建议键 | mac：`⌃⇧Space` / `⌥Space`；Win：`Ctrl+Shift+Space` |
| **禁止** | bare `fn`、单独 `Meta+V` / `Win+V` |
| 前置 | Companion 已连接 + **Side Panel 打开且获得键盘焦点** |
| 行为 | 按下 → 开始**连续**听写管线；松开 → 结束并可选纠错 |
| 互斥 | 与点按 🎤 同一会话；会议录音进行中会拒绝 |
| 反馈 | 侧栏内时长/状态；开始时系统通知「CMspark · 草稿」 |

OS 级全局热键（失焦仍按住）属后续增强。

### 2.4 隐私 ack

| 版本 | 何时 |
|------|------|
| v1 | 浏览器听写 |
| v2 | 本机 STT |
| v3 | 连续听写 / ASR 纠错 / 按住热键长听 / 实时出字长听 |

### 2.5 本机组件（cmspark-whisper）与模型

本机听写分两层，都可在 **设置 → 听写** 完成：

| 层 | 内容 | 如何就绪 |
|----|------|----------|
| **本机组件** | `cmspark-whisper` + DLL（Windows） | 安装包可内置；若提示「未找到」→ 点 **「下载本机听写组件」**（HTTPS + sha256 pin；约数 MB） |
| **模型权重** | ggml-small / medium / large-v3-turbo | 设置页下载到 `~/.cmspark-agent/models/whisper/` |

打包：`build-package.bat` 在缺少 `companion/dist/bin/cmspark-whisper-win-x64.exe` 时会按 `assets/whisper-binary.manifest.json` **自动拉取**（`CMSPARK_WHISPER_AUTO_FETCH=0` 可关）。  
Windows pin 与 [whisper.cpp v1.7.6](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.7.6) `whisper-bin-x64.zip` 对齐。

### 2.6 本机 Whisper 渐进假设（M2）

开启 **本机听写** + **连续听写** + **实时出字** 时：

| 项 | 行为 |
|----|------|
| 采集 | 16 kHz PCM 流式上传（AudioWorklet 优先） |
| 临时字 | 会话内 snapshot → Whisper **重解码** → 草稿 interim |
| 定稿 | 约 **8s** 窗口结束一次 final（非整段等停） |
| poll | 按上次推断耗时自适应（约 1.4–6s） |
| **诚实边界** | **不是** decoder-token 真流式；medium 临时字会偏慢 |
| **large-v3-turbo** | **无**渐进临时字（仅终稿）；CPU 上短音频也可能数十秒～数分钟；设置默认推荐 **medium** |

浏览器听写路径：Web Speech 字级 interim（厂商云 STT 残留，见 v1 ack）。

### 2.7 文字 / 语音改设置

设置页顶部支持短命令，例如：`开启连续听写` · `开启实时出字` · `浏览器听写` · `打开会议` · `打开场景`。可键盘输入或点「语音」口述（不进聊天、不 auto-send）。

---

## 3. 会议记录

### 3.1 入口（推荐层级）

1. 底栏 **装配** → **场景**  
2. 顶部 **会议** 专区 → **打开会议工作台**  
3. 可选 **应用「会议记录」场景**（写入纪要 prompt；**不会**自动开麦）  
4. 快捷：`/meeting`；列表项「打开会议工作台」

### 3.2 能力波次（已交付）

| 波次 | 能力 |
|------|------|
| **Mtg0** | 粘贴转写 → 生成 TL;DR / 决议 / 待办 / 风险；复制 / 发到草稿 |
| **Mtg1** | 显式「开始录制」本机分段 STT；结束生成纪要；`meeting_privacy_ack_v1`；默认删音频 |
| **Mtg2** | 静音切分段；默认/批量说话人；上传 `.txt/.md`；上传音频 → 本机转写 |
| **Mtg3** | 实验：**自动标「发言人N」**（段特征 k-means，**非身份识别**）；弱标交替 |
| **P1 近实时** | 会议录制默认渐进假设出字 + 约 8s 窗定稿（同听写 M2；非 token 真流式；large 仅终稿） |
| **P2 长会** | 直播录硬上限 **3 小时**（2 小时软提示）；上传音频同上限；纪要输入抬到 20 万字 |

### 3.3 诚实边界

- **不是**飞书/Otter 级多方 diarize SLA  
- **系统/会议软件混音**：未做产品能力，见 [parking 调研](superpowers/specs/2026-08-08-meeting-system-audio-parking.md)  
- 纪要 LLM **不得臆造**未出现的出席人/决议；已有标签可沿用  
- **近实时**是 Whisper 重解码假设，不是厂商级字级流式；CPU 上 medium 临时字会偏慢  
- **3 小时**为产品硬上限；边听边 LLM 语义纠错仍不提供（隐私 / ADR-024）  


### 3.4 数据位置

`~/.cmspark-agent/meetings/<id>/`（meta / transcript / minutes；权限收紧）

### 3.5 转写错误 resource_conflict / 本机识别

- **含义**：上一段本机识别未结束（会话争用），或识别进程失败（现会区分为「识别失败 / 内存不足」中文提示）。
- **处理**：等数秒后重试；确认设置里 STT 引擎为「本机」且模型 ready；关闭听写后再开会议。
- **当前版本**：开始会议会清理陈旧 STT 会话；段失败会自动重试一次；会议错误走中文映射。

### 3.6 纪要模板

- 会议工作台可展开 **「纪要模板（可选）」** 粘贴自定义 Markdown 模板（本地记住上次内容）。
- 留空则使用默认：TL;DR / 决议 / 待办 / 风险。
- 模板只约束**输出结构**，不能让模型编造转写中没有的事实。
- 生成纪要将把转写文本发给已配置的 LLM。

---

## 4. 真机验收清单（供用户自测）

### 听写+

- [ ] classic 45s 行为与 M1 一致、不 auto-send  
- [ ] continuous ≥3 min 中文有字进草稿  
- [ ] ASR 纠错 off 无 LLM；on 失败保留 raw  
- [ ] 本机 + 实时出字：说话中见临时字，约 8s 窗定稿  
- [ ] 设置「按键盘录制」后按住 ≥2s 松手 → 字进草稿  

### 会议

- [ ] **装配 › 场景 › 会议** 可打开工作台（不靠 `/meeting`）  
- [ ] Pack 应用不开麦  
- [ ] 粘贴转写 → 纪要结构可读  
- [ ] 本机录 ≥1–5 min → 可编辑转写 → 纪要；默认无残留 audio  
- [ ] 听写与会议互斥提示  
- [ ] 开始录制不立即出现 `resource_conflict` 裸码  
- [ ] 近实时：说话中见「识别中…」临时字，约 8s 后定稿进转写  
- [ ] 软提示约 2h；硬上限约 3h（勿与听写 15/30 min 混淆）  
- [ ] 可选模板生成纪要结构贴合模板  

- [ ] 开始录制不立即出现 `resource_conflict` 裸码  
- [ ] 可选模板生成纪要结构贴合模板  

---

## 5. 相关 ADR / 设置

- [ADR-023 本机 STT](adr/023-voice-local-stt-path-b.md)  
- [ADR-024 听写+ · Refiner · 会议落盘](adr/024-dictation-plus-asr-refiner-meeting.md)  
- Side Panel → **设置 → 语音 / 听写**  
