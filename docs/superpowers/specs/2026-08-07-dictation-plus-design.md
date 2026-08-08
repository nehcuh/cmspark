# 听写+（Dictation+）— 产品设计 SoT

> **日期**: 2026-08-07  
> **状态**: **LOCKED** — D1a–c 已合 main；**D2 hold 热键** 实现中/合入见用户指南；R1+R2 floors 仍有效 
> **对抗合成**:  
> - R1：[continuous-dictation-meeting-adversary-synthesis-20260807.md](../../audit/reviews/continuous-dictation-meeting-adversary-synthesis-20260807.md)  
> - R2（yetone）：[voice-dictation-r2-yetone-adversary-synthesis-20260807.md](../../audit/reviews/voice-dictation-r2-yetone-adversary-synthesis-20260807.md)  
> **Strawman（对照，非 SoT）**:  
> - [2026-08-07-continuous-dictation-meeting-minutes-strawman.md](./2026-08-07-continuous-dictation-meeting-minutes-strawman.md)  
> - [2026-08-07-voice-dictation-r2-yetone-informed-strawman.md](./2026-08-07-voice-dictation-r2-yetone-informed-strawman.md)  
> **前置 SoT（不撤销）**:  
> - M1：[2026-08-06-voice-input-design.md](./2026-08-06-voice-input-design.md) — **classic 路径仍完全有效**  
> - Path B：[2026-08-07-voice-local-stt-design.md](./2026-08-07-voice-local-stt-design.md) + [ADR-023](../../adr/023-voice-local-stt-path-b.md)  
> **本波 Trust ADR**: [ADR-024](../../adr/024-dictation-plus-asr-refiner-meeting.md)  
> **姊妹 SoT**: [会议纪要](./2026-08-07-meeting-minutes-design.md)（独立产品线）  
> **参考（哲学，非宿主模型）**: [yetone/voice-input-src](https://github.com/yetone/voice-input-src)

---

## 0. 一句话（锁定）

**在保留 M1「经典短听写」默认的前提下，用户可 opt-in「听写+」：点按连续听写和/或按住快捷键，实时/近实时转写写入 Side Panel 主线程 composer 草稿；可选极保守 ASR 纠错（非润色、非自动发送）。不是系统听写，不是语音 Agent，不是会议纪要。**

---

## 1. 问题与 JTBD

| | |
|--|--|
| **谁** | 需要口述更长指令/草稿、又不愿离开 CMspark 的中文用户 |
| **场景** | 半分钟～十几分钟口述；双手占用；中英术语混杂 |
| **成功** | continuous 说 ≥3 分钟有字进草稿；可选 Refiner 后谐音/术语可改善且正确句不乱改；classic 零回归；**从不** auto-send |
| **非成功** | 系统级任意 App 注入；比系统听写更准的 SLA；边听边 LLM 改稿 |

---

## 2. 能力分层（强制）

| 层 | 名称 | 状态 |
|----|------|------|
| **L-A** | Classic 听写（M1） | **默认**；点按 · ≤45s · 无 onend restart · 无 LLM |
| **L-B** | 听写+（本 SoT） | **opt-in**；连续 / 按住 · cap · 可选 ASR Refiner |
| **L-C** | 会议纪要 | **另一 SoT**；禁止与 L-B 共用入口叙事 |

---

## 3. 目标 / 非目标

### 3.1 目标（按波次交付，见 §12）

1. `voiceDictationMode`: `classic` \| `continuous`（默认 **classic**）  
2. continuous：有条件 `onend` restart（仅 browser adapter 内）+ 软/硬 cap  
3. Mode A 点按 continuous；Mode B 按住快捷键（D2）  
4. ASR Refiner opt-in（默认 off）：stop 后一枪 text-only LLM；correct_only  
5. 吵录制反馈：Panel 波形/时长；失焦或 Mode B → 全局 indicator（分档）  
6. classic / M1 / Path B browser 断连路径 **零回归**  

### 3.2 非目标（锁定）

| 非目标 | 理由 |
|--------|------|
| auto-send / 语音指挥 Agent | 巡航 × 误识；F-UX-CD4 |
| 边听边 LLM 纠错（原 D3） | **CANCELLED**（R2） |
| 书面化 / 润色模式 UI v1 | 语义漂移；仅 correct_only |
| 系统级注入任意 App | 身份 + MV3；停车场 |
| 默认 bare `fn` / `Win+V` | OS 冲突 |
| Apple Speech 第三引擎 | mac-only；双引擎矩阵 |
| 唤醒词 / 无 UI 常听 | F-S8 精神 |
| Worker / Cockpit / tray 作 🎤 表面 | 主线程 only；tray 仅 indicator |
| Pack 写 voice/hotkey/ack/refiner prompt | Compose none |
| 音频或全文转写默认遥测 | 最小化 |
| 会议工作台 | L-C SoT |

---

## 4. ADR-020 声明

```text
Surface:      L0 输入 only（composer 草稿）
L2-classes:   (none) — voice never grants tools / never elevates confirm
Compose:      none — Pack strip voice* / dictation* / asr_refiner* / hotkey* / ack*
Autonomy:     n/a — 主线程 composer only
Trust:        mic +
              [browser] vendor STT residual (long session if continuous) OR
              [local] WS → Companion tmp segments → whisper (ADR-023) +
              [optional] transcript text → user LLM for ASR Refiner (pre-send residual)
Channel:      community; classic default; continuous & refiner opt-in
```

详见 [ADR-024](../../adr/024-dictation-plus-asr-refiner-meeting.md)。

---

## 5. 交互锁定

### 5.1 Mode A — 点按 continuous

```text
idle --click mic--> listening (continuous)
  interim/finals → draft overlay / buffer
  soft cap 5min → 强提示「仍在听写」
  hard cap → force stop + 保留文本 + banner
click mic / Stop --> stop → merge raw → [optional refining] → idle
```

### 5.2 Mode B — 按住快捷键（D2）

| 项 | 锁定 |
|----|------|
| 默认 | **热键关闭**；用户设置中选择可注册组合 |
| 建议键 | mac：`⌃⇧Space` 或 `⌥Space`（冲突检测）；Win：`Ctrl+Shift+Space` 或自选 |
| **禁止默认** | bare `fn`、`Win+V` |
| `fn` 高级 | 仅 mac spike 后可选；失败则隐藏 |
| 按下 | 若未 listening → start（同 Mode A 管线） |
| 松开 | stop + 可选 refine |
| 互斥 | 与 Mode A 同一 session；不可双开 |
| 前置 | Companion 在线 + 扩展连接 + **Side Panel 文档打开**（可失焦） |
| 失败 | Panel 关闭 → 可听失败（toast/tray）；禁止静默丢字 |

### 5.3 时长（仅 continuous / hold）

| 层 | 值 |
|----|-----|
| 软提示 | **5 min** |
| 硬 cap 默认 | **15 min** |
| 设置绝对上限 | **30 min** |
| classic | 仍 **45s**（M1） |

### 5.4 ComposerMode / Stop 三体

继承 M1 §6.3–6.4：`thread_busy` 禁 start；Worker 隐藏 🎤；Stop 先 abort 听写再 chat.abort。  
**听写 stop ≠ 会议结束**（会议在 L-C）。

### 5.5 320px 状态预算

- 任意时刻 ≤ **一条** listening 反馈（mic 脉动/波形 + 时长）  
- + 至多 **一个** 瞬时 chip（纠错中 / 软 cap / 硬停）  
- 禁止第三永久状态行  

### 5.6 反馈单源

| 条件 | 主反馈 |
|------|--------|
| Panel 前台可见 | Panel 内波形/时长 |
| 失焦 3–5s 或 Mode B | tray 和/或 mac 胶囊 HUD **之一**（禁止同内容双开抢注意力） |
| Windows Mode B | **tray ●REC + 时长** 即合规；不要求 Swift 胶囊 |

全局 HUD 须含 **「CMspark · 草稿」** 语义；禁纯系统感无品牌胶囊。HUD **nonactivating**，不抢 Chrome 焦点；**≠** L2 Confirm 视觉。

---

## 6. STT 引擎与连续策略

| 引擎 | continuous 行为 | interim |
|------|-----------------|---------|
| **browser** | `continuous=true` + adapter 内有条件 restart | Web Speech interim |
| **local** | **串行分段** 30–45s / segment；每段新 `voice.stt` epoch | **无**假 streaming 字；仅 segment final 追加 |

规则：

- 禁止 session 中途静默 browser↔local 回落（Path B）  
- 禁止抬高单 blob `STT_MAX_RECORD_MS` 到 15–30 min  
- 全局 STT **max-1**；Dictation+ **xor** Meeting 采集  
- restart 仅当 `wantListening && gen 有效 && 未 hardcap`；user abort / hardcap / fatal **不** restart  

---

## 7. ASR Refiner（yetone 哲学 · 锁定）

### 7.1 产品

| 项 | 锁定 |
|----|------|
| 名称 | **ASR 纠错 / 识别纠错**（禁默认「润色/书面化」） |
| 默认 | **OFF** |
| 时机 | **仅 stop 后一枪**；无 incremental |
| 失败 | **保留 raw** + 轻提示 |
| 成功 | 可 **还原识别原文**（本次 session） |
| 模型 | Companion **当前 LLM**；开关旁显示模型名 |
| 披露 | 「将把**转写文本**发给当前模型纠错；**不发送音频**」 |

### 7.2 管线

```text
stop → merge raw into composer (voice-span) immediately
     → if refiner off: done
     → if refiner on && ack v3: phase=refining → llmExtract
     → ownership OK? apply refined span : keep raw/user text
     → idle
```

### 7.3 实现硬约束

- System prompt：**Companion 编译期常量** `ASR_REFINER_SYSTEM_PROMPT`（§7.4）  
- **不可**被 Pack / 设置 / 客户端覆盖  
- `temperatureCap ≤ 0.2`；无 tools；AbortSignal  
- `refineGen`：过期结果丢弃  
- dirty draft / 非安全光标：禁止静默覆盖  
- 输出守卫：长度 > ~1.3–1.5× → raw；新增 URL/明显密钥模式 → raw；tool_call 形态 → raw  
- job id：`asr_refiner`（≠ `meeting_minutes`）  

### 7.4 System prompt（锁定正文 · 实现一字不差）

```text
You are an ASR post-editor for Chinese (and mixed EN) speech-to-text.
Your ONLY job is to fix obvious speech recognition errors.

ALLOW:
- Homophone / near-homophone Chinese fixes when context makes the intended word clear
- English technical terms wrongly rendered as Chinese syllables
  (e.g. 配森→Python, 杰森→JSON, 瑞艾克特→React, 库伯内提斯→Kubernetes)
- Broken punctuation that makes the sentence unreadable
- Accidental duplicate words from STT restart seams

FORBIDDEN:
- Rewriting for style, formality, or "better writing"
- Summarizing, expanding, or shortening meaning
- Adding content the user did not say
- Removing content that already looks correct
- Turning speech into tool calls, commands, or agent instructions
- Translating language unless the STT clearly garble-mixed scripts of the same term

If the input already looks correct, return it UNCHANGED (character-identical).
Output ONLY the corrected transcript text, no quotes, no explanation.
```

### 7.5 Privacy ack

| Ack | 解锁 |
|-----|------|
| `voice_privacy_ack_v1` | classic browser 短听写 |
| `voice_privacy_ack_v2` | Path B local 引擎 |
| **`voice_privacy_ack_v3`** | **continuous 和/或 ASR Refiner** |

**v3 正文必含**：长听写指示器义务；browser 长时云 STT；local 分段 tmp；**转写文本进已配置 LLM**；correct_only；无 auto-send；v1/v2 **不**满足 v3。

---

## 8. 设置面（渐进披露）

**第一层（≤3 概念）**

1. 听写形态：经典短听 / 连续听写  
2. 按住快捷键：关 / 选键  
3. ASR 纠错：关 / 开（需 v3 + 已配置 LLM）  

**高级折叠**：软/硬 cap、实验性 Fn（mac）、引擎（browser/local 仍归现有 Path B 设置）。

---

## 9. 协议 / 配置面（摘要）

| 面 | 内容 |
|----|------|
| Prefs | `voiceDictationMode`, hotkey enabled/chord, `asrRefinerEnabled`, caps, acks |
| WS refine | `voice.refine.request/result/error/abort`（text-only） |
| WS hotkey | `voice.dictation.hotkey` `{edge:down\|up}` — **控制面 only** |
| STT | 既有 `voice.stt.*`；连续 local = 多 epoch |
| HUD | tray/`hud.*` 状态；可选 `voice.level` 包络 float（非 PCM） |

禁止：tray 发起 `voice.stt`；客户端上传 system prompt。

---

## 10. 错误与文案（增量）

| 条件 | 用户可见 |
|------|----------|
| 硬 cap | 已达连续听写上限（15/可配），文字已保留 |
| 软 cap | 仍在听写，可点停（提示，不停） |
| Refiner 失败 | 纠错失败，已填入识别原文 |
| Refiner 跳过（dirty） | 已保留你的编辑；识别原文可还原 |
| Mode B Panel 关闭 | 请打开 CMspark 侧栏主对话后再按住说话 |
| browser continuous 云 | 录制 chip：云 STT 长会话（若 browser） |

---

## 11. 验收标准

### D1a（continuous Mode A · browser 优先）

1. classic 行为与 M1 一致（45s、无 restart）  
2. continuous ≥3 min 中文，无 45s 截断  
3. 硬 cap 强制停 + 文本保留  
4. 从不 auto-send  

### D1b（Refiner）

5. off 时零 LLM 调用  
6. mock：正确短句 **character-identical**  
7. 失败保留 raw；dirty 不覆盖  
8. 无 v3 不可开  

### D1c（local 分段）

9. N×≤45s 串行 segment 合并进草稿；无假 interim  

### D2（hold）

10. 配置热键后按住≥2s 松手 → 字进主线程 composer  
11. 全局 indicator 可见；Panel 关 fail-closed  

---

## 12. 波次

| 波次 | 范围 | 出口 |
|------|------|------|
| **D0** | 本 SoT + ADR-024 +（建议）Pi | 计划可写 |
| **D1a** | continuous Mode A + caps + REC + Panel 波形 | §11.1 |
| **D1b** | ASR Refiner + v3 + 同字测 | §11.2 |
| **D1c** | local 串行分段 | §11.3 |
| **D2** | hold hotkey + 分档 indicator（Side Panel 捕获；系统通知「CMspark · 草稿」） | §11.4 · 用户指南 |
| **D3** | incremental LLM | **CANCELLED** |

**Spikes 门禁**（实现前/宣称前）：S-WS1、S-LOC1、S-GUM-LONG、S-HK-*、S-HUD-MAC-VOICE、S-HUD-WIN-TRAY、S-REF1（见 R2 合成 §8）。

---

## 13. Floors 索引

完整表见 R1 §3 + R2 §5。实现 PR 须勾选相关 F-UX/S/C/I-CD* 与 F-*-R2*。

---

## 14. 与 M1 / Path B 的关系

| 既有锁 | 本 SoT |
|--------|--------|
| M1 ≤45s 无 restart | **classic only**；continuous 另表 |
| M1 无 auto-send | 继承 |
| Path B 45s + 2.5MB + max-1 | continuous local = **多 segment**，不抬单 session 常量 |
| Path B 无字级 interim | 继承；禁止伪造 |

M1 SoT §6.2 已标注指向本文件（classic-only 注记）。

---

## 15. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-08-07 | 初版 LOCKED：吸收 R1+R2 对抗；yetone 哲学 → ASR Refiner；D3 取消 |
