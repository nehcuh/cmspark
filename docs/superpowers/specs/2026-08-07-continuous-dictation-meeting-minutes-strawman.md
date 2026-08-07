# 连续听写 + 会议纪要 — 产品设计 Strawman（待对抗）

> **日期**: 2026-08-07  
> **状态**: STRAWMAN（**已废为对照**）— 对抗完成；锁定 SoT 见 [听写+](./2026-08-07-dictation-plus-design.md) · [会议](./2026-08-07-meeting-minutes-design.md) · [ADR-024](../../adr/024-dictation-plus-asr-refiner-meeting.md)  
> **触发**: 用户要求 (1) 取消语音硬时间上限、两种听写形态（点按连续 / 快捷键按住）、LLM 纠错与终稿改写；(2) 插件内「会议记录」场景  
> **前置 SoT（不得静默推翻）**:  
> - [2026-08-06-voice-input-design.md](./2026-08-06-voice-input-design.md)（M1 Web Speech floors）  
> - [2026-08-07-voice-local-stt-design.md](./2026-08-07-voice-local-stt-design.md) + [ADR-023](../../adr/023-voice-local-stt-path-b.md)  
> - [ADR-020](../../adr/020-capability-model-three-axes.md) · [ADR-014](../../adr/014-mission-pack-enterprise-modules.md)  
> **关系**: 本 strawman **重开** M1 锁定的「≤45s / 禁止 onend restart / 仅点按」；须对抗后才能进 SoT。**不**默认撤销 Path B 隐私契约。

---

## 0. 一句话（草案）

**语音输入升级为「可长听写」两种手势（点按连续 / 系统级按住快捷键），管线为实时转写 + LLM 增量纠错 + 停止后终稿润色；并新增独立「会议记录」场景（任务包 + 会议工作台），产出可编辑转写与结构化纪要，而非仅往 composer 塞几句字。**

---

## 1. 问题 / JTBD

| | 连续听写（Dictation+） | 会议记录（Meeting） |
|--|----------------------|---------------------|
| **谁** | 边浏览边说长指令/长草稿的用户 | 开会需要转写 + 纪要的用户 |
| **场景** | 懒打字、口述邮件/需求、长 system 说明 | 1:1 / 小会 / 自录备忘；后处理纪要 |
| **失败态今天** | 45s 硬停；Chrome `onend` 不 restart；无 LLM 纠错 | 无会议实体；无说话人；无纪要流水线 |
| **成功** | 说几分钟不停；字实时进框；停后文案可发 | 一场会 → 转写可改 → 纪要可导出 |

---

## 2. 用户预决策（对话收敛，**可被对抗推翻**）

| ID | 用户意向 | 草案落点 |
|----|----------|----------|
| U1 | 不要卡死语音时长 | 取消「单次 45s 硬停」作为唯一产品闸；改为 **可配置软 cap + 安全硬 cap**（见 §5） |
| U2 | 形态 1：点按 → 说 → 后台记录 → 实时转写 → LLM 按前文纠错 → 点停 → LLM 整段润色 | **Dictation Mode A = Toggle Continuous** |
| U3 | 形态 2：快捷键按住说话（Mac 默认 fn 或 fn+V；Win fn 或 Win+V） | **Dictation Mode B = Hold-to-Talk Hotkey** |
| U4 | 插件场景专配「会议记录」 | **Meeting Scene** = Mission Pack + 专用 UI 切片（非仅 system prompt） |
| U5 | 会议要方便做纪要 | 转写 artifact + LLM 纪要模板 + 可选导出（Obsidian 对齐） |

---

## 3. 产品拆分（强制：两产品线，共享底层）

```text
┌─────────────────────────────────────────────────────────────┐
│  Shared: STT engine (browser | local) · capture · session   │
│          optional LLM polish pipeline · privacy ack tier    │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
     ┌──────────▼──────────┐       ┌──────────▼──────────────┐
     │  Dictation+         │       │  Meeting Scene          │
     │  Composer 🎤 / 热键  │       │  独立入口 + Meeting UI  │
     │  → draft textarea   │       │  → 转写文档 + 纪要      │
     │  Surface L0 输入    │       │  Surface L0 工作台      │
     └─────────────────────┘       └─────────────────────────┘
```

**草案锁**：

- **不得**用会议级常听冒充 composer 默认行为（默认仍可是短听写；长听写/会议 **显式模式**）。  
- **不得**让 Mission Pack 静默打开 mic / 写 voice 风险开关（继承 F-S11）。  
- 会议 **不是** 把 45s 改成 1 小时那么简单；有独立对象模型。

---

## 4. Dictation+（连续听写）— 交互草案

### 4.1 Mode A — Toggle Continuous（点按）

```text
idle --click mic--> recording+live STT
  |                    |
  |  interim → draft overlay / append finals
  |  every N finals or Δt → LLM incremental correct (optional, on)
  |
  +--click mic / Stop--> finalize
         → stop capture
         → optional LLM full-pass polish
         → merge into textarea (user editable)
         → NEVER auto-send (v1)
```

### 4.2 Mode B — Hold-to-Talk（全局快捷键）

| 平台 | 默认草案 | 可配置 |
|------|----------|--------|
| macOS | **按住 `fn`** 说话；松手结束 | 备选 `fn+V`、自定义（设置） |
| Windows | **按住 `Win+V`** 说话；松手结束 | 备选其他组合（设置）；**不用裸 Win** |
| Linux | 自定义（无统一 fn） | 默认关闭热键直至用户选 |

行为：

- **按下** → 若未 listening 则 start（与 Mode A 同管线）  
- **松开** → stop + 终稿润色（同 Mode A finalize）  
- Side Panel **不必前台焦点** 即可触发？→ **开放问题 Q-HK1**（见 §10；Platform 必答）  
- 与 Mode A **互斥**：hold 进行中点 mic = 同 session stop；不可双开会话  

### 4.3 管线阶段（两形态共用）

| 阶段 | 名称 | 行为 | 默认 |
|------|------|------|------|
| P0 | Capture | mic / MediaRecorder 或 Web Speech continuous + **允许 restart** | on |
| P1 | Live STT | 实时/近实时文字进 draft | on |
| P2 | Incremental LLM correct | 以「前文 + 新 final 块」为上下文，纠同音/标点/专名 | **on（可关）** |
| P3 | Final polish | 停止后对整段润色改写（保意、可设「仅纠错 / 书面化」） | **on（可关）** |
| P4 | Auto-send | 说完直接发 chat | **off 且 v1 不提供**（巡航风险） |

**LLM 调用约束（草案）**：

- 走现有 Companion LLM adapter；**只收文字**，不收音频（local STT 音频仍仅 Path B 管线）  
- Incremental：debounce ≥1.5s 或每 K 个 final；**取消 in-flight** 用 session generation  
- Final polish：**显式** processing 态；失败则保留 raw 转写 + banner  
- 费用/延迟：设置暴露「纠错/润色」开关；默认 on 但须隐私 ack 覆盖「转写进 LLM」  

### 4.4 时长策略（替代死 45s）— 草案

| 层 | Dictation+ | 理由 |
|----|------------|------|
| **无产品「几句话就停」** | 允许 continuous + `onend` **有条件 restart** | 用户明确要求 |
| **软 cap 提示** | 默认 10 min 提示「仍在听写，点停」 | 防遗忘 |
| **安全硬 cap** | 默认 **30 min** 强制 stop + 保留文本 | 磁盘/内存/误开麦 |
| **可配置** | 软/硬 cap 在设置；硬 cap 上限草案 60 min | 对抗可砍 |
| **Local STT** | 分段上传/转写（chunk window），非单 blob 30min | 预算与 whisper 现实 |

**明确推翻 M1 F-S8 / Q6**：仅当本对抗合成锁定后生效；M1 已发布行为可 feature-flag：`voiceDictationMode: classic|continuous`。

### 4.5 与现网 M1 兼容

| 项 | 草案 |
|----|------|
| 默认 | **`classic`（45s 点按，当前行为）** 或 **`continuous`？** → 开放 **Q-DEF1** |
| 设置 | 「听写形态：经典短听 / 连续听写」；「按住快捷键」独立开关 |
| browser vs local | 连续听写 **优先 local**（长会话隐私 + 可控 restart）；browser 允许但披露云 STT 长会话 |
| Path B 45s 服务端 cap | 连续模式改为 **分段 session** 或 **raise server cap with budget** — Impl 必答 |

---

## 5. Meeting Scene（会议记录）— 草案

### 5.1 入口

| 入口 | 行为 |
|------|------|
| 底栏 **任务包** → Pack「会议记录」→ 应用到线程 | 装 skills + system_prompt_append + 工具策略 |
| Side Panel **会议** 快捷入口（可选 M2） | 一键新建「会议线程」+ 应用 Pack + 打开会议工作台 |
| 非目标 v1 | 系统托盘常听、后台无 UI 录会 |

### 5.2 会议对象模型（草案）

```text
MeetingSession
  id, thread_id, title, started_at, ended_at, status
  capture: { device, sample_rate, path_or_ephemeral }
  transcript: [{ t0, t1, speaker?, text, source: stt|user_edit|llm }]
  minutes: { tldr, decisions[], actions[], risks[], raw_md }
  privacy: { stt_engine, audio_retained: bool, retain_until? }
```

- **产物落点**：Companion 数据目录 `~/.cmspark-agent/meetings/`（草案）或 thread 附件；**不**默认进 history.db 音频  
- 转写可编辑；纪要由 LLM 生成后可再生成 / 导出 Obsidian  

### 5.3 会议 UX 草图

```text
[会议标题]  [● 录制中 12:34]  [暂停] [结束并生成纪要]
────────────────────────────────────
时间轴转写（可编辑）
  00:01  发言… 
  00:45  …
────────────────────────────────────
纪要预览（结束后）
  TL;DR · 决议 · 待办 · 风险
  [复制] [导出 Obsidian] [发送到对话]
```

### 5.4 说话人分离（Speaker diarization）

| 波次 | 能力 |
|------|------|
| **Meeting M1** | **单说话人 / 不分 speaker**（标签可选「我」）；先打通长转写 + 纪要 |
| **Meeting M2** | 启发式分段（静音切）+ 用户手动标 speaker |
| **Meeting M3** | 自动 diarize（本机模型或明确同意的云 API）— **另开对抗** |

用户要「不同人说话」→ strawman **承认目标**，但 **不在 M1 承诺自动分离**（对抗可要求提前或砍叙事）。

### 5.5 会议音频来源（草案）

| 源 | M1 | 说明 |
|----|----|------|
| 本机麦克风（用户侧） | **是** | getUserMedia |
| 系统音频 / 会议软件混音 | **停车场** | OS 权限复杂（BlackHole / WASAPI loopback）；M2+ |
| 上传已有录音文件 | **可选 M1.1** | 无实时压力；易做纪要 |

### 5.6 Mission Pack 内容（草案）

- `pack.yaml`: id `meeting-minutes`，skills：纪要结构、待办抽取  
- `system_prompt_append`: 只基于用户提供的转写生成纪要；禁止臆造出席人  
- **不** require shell/netsec；**不**写 `sttEngine`  
- 应用 Pack **不**自动开始录音；须用户点「开始会议」

---

## 6. Trust / 隐私（草案 · 对抗必砍）

```text
Dictation+ continuous:
  Surface: L0 输入
  Trust:   mic + [browser STT cloud residual | local WS audio residual]
           + LLM sees transcript text (new residual vs M1 pure STT→draft)
  Compose: none for engine switches
  禁止: auto-send; Pack 写 hotkey/engine; 无唤醒常听

Meeting:
  Surface: L0 工作台（文档产物）；工具仍走既有 Surface
  Trust:   长音频落盘策略 + 转写持久化 + LLM 纪要
  新 ack:  voice_privacy_ack_v3 或 meeting_privacy_ack_v1
```

**必须披露**：

1. 连续 browser 听写 = 长时可能持续出站到厂商 STT  
2. LLM 纠错/润色/纪要 = **文字**进用户配置的 LLM 提供商  
3. 会议录音默认：结束转写成功后 **删除音频** vs **保留 N 天**（设置；默认删）  

---

## 7. 架构草图（Impl 攻击面）

### 7.1 Dictation+ 

```text
[Hotkey OS hook | Mic button]
        → DictationSessionController (generation token)
            → CaptureAdapter (WebSpeech continuous+restart | Local chunked)
            → TranscriptBuffer (finals + interim)
            → LlmCorrector (debounced incremental)
            → on Stop → LlmPolisher → mergeFinalTranscript → textarea
```

### 7.2 Meeting

```text
[Start Meeting]
  → MeetingSession (companion state + disk)
  → long Capture (segmented files)
  → STT segments → transcript store
  → End → LLM minutes job → UI + optional Obsidian export
```

### 7.3 热键实现约束（草案）

| 层 | 选项 | 草案倾向 |
|----|------|----------|
| Extension only `commands` | Chrome 快捷键，**需用户在 chrome://extensions/shortcuts 绑定**；**拿不到裸 fn** | 不足 |
| Companion + 原生全局热键 | macOS/Win 注册全局 shortcut；经 WS 通知 extension start/stop | **Mode B 需要** |
| fn 键 | macOS 特殊；Windows 无统一 fn 语义 | **Platform 必答 Q-HK2** |

---

## 8. 波次（草案）

| 波次 | 范围 | 出口 |
|------|------|------|
| **D0** | 本 strawman + 四路对抗 + 合成 +（建议）Pi 复审 | 锁定 SoT 或 MAJOR_REVISE |
| **D1 Dictation+** | continuous toggle；软/硬 cap；LLM polish（final）；设置；feature flag | 长听写可用；无热键也可 |
| **D2 Hold hotkey** | Companion 全局热键 + 设置；松手 finalize | 系统级按住说话 |
| **D3 Incremental correct** | 实时 LLM 纠错防抖 | 质量体感 |
| **Mtg0** | Pack「会议记录」+ 纪要 prompt（**无**长录音）用户粘贴转写也可生成 | 纪要链路先通 |
| **Mtg1** | 会议工作台 + 长录音分段 STT + 结束生成纪要（单 speaker） | 端到端会议 |
| **Mtg2** | 手动 speaker / 上传文件 / 系统音频调研 | |
| **Mtg3** | 自动 diarize | 另对抗 |

---

## 9. 非目标（v1 草案）

| 非目标 | 理由 |
|--------|------|
| 默认 auto-send / 语音指挥 Agent | 巡航 × 误识 |
| 唤醒词 / 无 UI 常听 | 隐私与误触发 |
| 会议 M1 自动说话人分离 SLA | 模型与标注成本 |
| 承诺「比飞书/Otter 更好」 | 无评测 |
| Pack 静默开麦 | F-S11 |
| 用听写绕过 L2 | Trust 单调 |
| 转写全文默认遥测 | 最小化 |

---

## 10. 开放问题（请四路对抗裁决）

| ID | 问题 | 建议默认（可推翻） |
|----|------|-------------------|
| **Q-DEF1** | 装新版本后默认 classic 还是 continuous？ | **classic**（零回归）；设置一键升 continuous |
| **Q-CAP1** | 硬 cap 30 vs 60 min？Local 磁盘预算公式？ | 30 min hard；local 分段 30–60s windows |
| **Q-LLM1** | Incremental correct 默认 on 还是 off？ | **off** 省费用；Final polish **on** |
| **Q-LLM2** | polish 失败是否阻塞 merge？ | **不阻塞**；保留 raw |
| **Q-HK1** | 热键是否要求 Side Panel 打开 / Companion 在线？ | Companion 在线 + 扩展连接；Panel 可后台 |
| **Q-HK2** | macOS 默认 `fn` 是否可行？不行则默认什么？ | 调研后：不可行则 **`⌥Space` 或 `fn+V` 可配置** |
| **Q-HK3** | Windows 默认 `Win+V` 与系统剪贴板历史冲突？ | 若冲突改 `Ctrl+Shift+V` 或用户自选 |
| **Q-MTG1** | 会议音频默认删除还是保留？ | **成功转写后删除音频** |
| **Q-MTG2** | 会议是否允许 browser STT？ | **仅 local**（长会隐私） |
| **Q-MTG3** | 会议入口：仅 Pack vs 底栏一等入口？ | Mtg0 Pack；Mtg1 可加一等入口 |
| **Q-SCOPE1** | Dictation+ 与 Meeting 是否同一 PR 波次？ | **分开**：D1 先，Mtg0 可并行文档/Pack |

---

## 11. 攻击面自报（供 Security 深化）

1. **长听写遗忘** → 会议室/咖啡馆误录 → 硬 cap + 明显录制态 + 可选失焦策略重开  
2. **全局热键劫持 / 误触** → 无焦点突然听写 → 需要可见 indicator（tray 或 HUD）  
3. **LLM 纠错改写语义** → 危险指令被「润色」得更可执行 → polish 仅语言不增行为；禁 auto-send  
4. **Incremental LLM 成本与注入** → 转写含恶意页噪声 → 仅 Side Panel 会话文本；不读 DOM  
5. **会议长音频落盘** → 密钥级讨论残留 → 默认删音频 + 目录权限 0o600  
6. **fn / 辅助功能权限** → macOS 全局热键可能要 Accessibility → 明确引导  
7. **与 Path B redirect/下载** 无关但抢磁盘预算 → meetings/ 与 models/whisper 分桶  

---

## 12. 成功标准（草案 · 可测）

**Dictation+ D1**

1. continuous 模式说 **≥3 分钟** 中文，draft 有字，无无故 45s 截断  
2. 点停后 final polish 完成或 raw 保留；**从不** auto-send  
3. classic 模式行为与 M1 一致（回归）  

**Dictation+ D2**

4. 配置热键后，按住≥2s 说话松手，字进当前主线程 composer  

**Meeting Mtg1**

5. 录 5 分钟单人 → 转写可编辑 → 生成含 TL;DR/待办的纪要 → 可复制  
6. 结束成功后音频按策略删除（若默认删）  

---

## 13. ADR / 文档预期（若对抗通过）

| 产出 | 时机 |
|------|------|
| SoT `…-continuous-dictation-design.md` | D0 合成后 |
| SoT `…-meeting-minutes-design.md` | 可与上合并或分册（对抗裁） |
| ADR-02x 修订或新 ADR（长听写 Trust + 热键 + 会议落盘） | 合成锁定后 |
| 修订 M1 SoT：F-S8/Q6 标为「classic only」 | 合成后 |

---

## 14. 请对抗输出格式

每位 agent 必须给出：

1. **Verdict**: `PASS` | `PASS_WITH_CHANGES` | `MAJOR_REVISE` | `REJECT_PRODUCT_GOAL`  
2. **Floors** 表（F-UX-* / F-S-* / F-C-* / F-I-*）  
3. **对 §10 开放问题的明确选票**  
4. **与现网 M1/Path B 冲突清单**  
5. **残余风险 R1…**  

合成后写入：`docs/audit/reviews/continuous-dictation-meeting-adversary-synthesis-20260807.md`
