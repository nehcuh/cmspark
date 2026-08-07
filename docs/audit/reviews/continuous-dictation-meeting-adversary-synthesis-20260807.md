# Adversary Synthesis — 连续听写 + 会议纪要

**Date**: 2026-08-07  
**Strawman**: `docs/superpowers/specs/2026-08-07-continuous-dictation-meeting-minutes-strawman.md`  
**Agents**: Product/UX · Security/Privacy/Trust · Platform/Compat/ADR · Impl architect  
**Status**: **MAJOR_REVISE resolved into locked floors** — strawman **不可直接实现**；须吸收本合成后写 **两份** SoT（Dictation+ / Meeting）再进计划  

---

## 1. Scoreboard

| Agent | Verdict | Core stance |
|-------|---------|-------------|
| Product/UX | **MAJOR_REVISE** | 两产品线拆对；模式爆炸 / P2 默认 on / 会议名实 / 320px 过承诺必须砍；classic 零回归 |
| Security/Trust | **MAJOR_REVISE** | 产品目标可接受；新 Trust 面（长听 + 预发送 LLM 文本 + 会议落盘）缺 floors；硬 cap 更严；ack 拆 v3 + meeting |
| Platform/Compat | **MAJOR_REVISE** | 目标可行；**fn / Win+V 默认非法**；Path B 须分段协议；热键=原生 Companion；panel 关闭无麦 |
| Impl | **PASS_WITH_CHANGES** | 目标可做；SM/generation/segment 未写清；D1 先 browser continuous；local 分段独立 PR |

**产品目标本身**（可选长听写 + 独立会议场景 + 快捷键形态）四路均未 `REJECT_PRODUCT_GOAL`。  
**Strawman 不可直接实现** — 必须吸收 floors 后锁 SoT。

---

## 2. Conflict resolution（写入 SoT）

| 冲突 | 决议 |
|------|------|
| 用户「不要卡死时长」vs M1 F-S8 ≤45s | **classic 保持 45s + 无 restart**；**continuous 为 opt-in**，软/硬 cap 替代死 45s；文档标 F-S8 = classic-only |
| 硬 cap 30（Product/Platform/Impl）vs 15 default（Security） | **默认硬 cap 15 min**；设置可调，**绝对上限 30 min**；软提示 **5 min** |
| P2 Incremental 默认 on（strawman）vs 全员 off | **默认 OFF**；**v1 可不交付 P2**（D3 可选） |
| Final polish 默认 on（strawman/Impl）vs Product/Security off | **默认 OFF**；用户 opt-in + `voice_privacy_ack_v3`；失败不阻塞 raw |
| 默认 `fn` / `Win+V`（用户意向）vs Platform 阻断 | **禁止作为默认**；热键默认 **关闭**；用户自选可注册组合（建议 ⌃⇧Space / Ctrl+Shift+Space） |
| 连续优先 local vs Path B 无 interim | **长会话引导 local**；要 interim 可用 browser + **长时云 STT 披露**；禁止伪造 streaming 字 |
| 会议 = 加长听写？ | **否** — 独立产品线 + 独立 SoT + 独立 ack |
| 会议 browser STT？ | **Mtg1 禁止** — 仅 local（或上传文件） |
| 热键是否要 Side Panel？ | **v1：Panel 须打开**（可失焦）；关闭 = 失败可理解 + indicator；禁止静默丢字 |
| 两份 SoT 还是一份？ | **两份**：`continuous-dictation-design` + `meeting-minutes-design` |
| Ship 是否同波次？ | **强制分开**：D1 → Mtg0 可并行 → Mtg1（依赖 local 分段）→ D2 热键 → D3 incremental |

---

## 3. Mandatory floors（进入 SoT）

### 3.1 Product/UX（F-UX-CD*）

| ID | Floor |
|----|--------|
| F-UX-CD1 | **两产品线硬拆**：Dictation = composer 输入；Meeting = 独立工作台/产物。禁止共用「语音」入口叙事混为一谈 |
| F-UX-CD2 | 文案仅「听写 / 语音输入 / 会议转写·纪要」；禁「语音 Agent / 语音指挥」 |
| F-UX-CD3 | 默认 **`classic`**（M1 行为）；continuous / hold / polish **全部 opt-in** |
| F-UX-CD4 | **无 auto-send**；v1 不出现该设置；「发送到对话」只填草稿/附件，仍须用户 Send |
| F-UX-CD5 | ComposerMode / 主线程 only / Worker 无 🎤 — 继承 M1；连续模式同样适用 |
| F-UX-CD6 | 320px：无第三永久状态行；listening = mic 脉动 + 时长；polish 用一次性 processing |
| F-UX-CD7 | **Draft 所有权**：用户 dirty/焦点非尾时禁止 LLM 静默覆盖；polish 须可还原 raw |
| F-UX-CD8 | P2 Incremental **默认 OFF**；v1 可整波不做 |
| F-UX-CD9 | P3 Final polish **默认 OFF**；opt-in「仅纠错」优先于「书面化」 |
| F-UX-CD10 | 长听写录制态必须「吵」：●REC + 累计时长 + 软 cap 提示；热键开麦 **必须** 全局 indicator |
| F-UX-CD11 | Mode A/B 互斥；设置热键默认关；禁默认 fn / Win+V |
| F-UX-CD12 | 热键无主线程/Panel 时 **可听失败**，禁止静默写错线程 |
| F-UX-CD13 | 会议 Mtg1 命名诚实：**「暂不分说话人」**；禁营销自动多方 diarize |
| F-UX-CD14 | 应用 Pack **绝不**自动开麦；Mtg0 = Pack+粘贴优先 |
| F-UX-CD15 | 会议 UI 克制：状态条 + 可滚动转写 + 纪要卡片；非完整时间轴 IDE |
| F-UX-CD16 | Stop / mic / 会议结束 **三体语义分离** |

### 3.2 Security/Trust（F-S-CD*）

| ID | Floor |
|----|--------|
| F-S-CD1 | **四通道 residual 矩阵**：mic · STT(browser\|local) · **LLM 见转写文本** · **会议持久转写±音频** |
| F-S-CD2 | 无 auto-send（含会议「发送到对话」） |
| F-S-CD3 | Voice/Meeting **永不**授工具 / 抬 Surface / 写 auto_approve / 跳 L2 |
| F-S-CD4 | Pack **strip/reject** voice*、sttEngine、ack、caps、hotkey、audio_retain、autoStart |
| F-S-CD5 | 默认 classic；continuous 不静默开启 |
| F-S-CD6 | 硬 cap **默认 15 min**，**绝对上限 30 min**；软提示 **5 min**；到点强制停 + 保留字 + 响亮 banner |
| F-S-CD7 | Browser continuous：长时云 STT **显式披露** + 录制中 chip；禁静默 browser↔local 回落 |
| F-S-CD8 | Local continuous：**分段**（30–45s）；禁多分钟单 blob；tmp 0o600 + unlink + boot GC；全局 max-1（Dictation xor Meeting） |
| F-S-CD9 | P2/P3：须 **ack v3**；默认 off；payload 仅 transcript buffer（无 DOM/工具结果） |
| F-S-CD10 | Polish 默认 `correct_only`；不发明指令/URL/凭证 |
| F-S-CD11 | Mode B：Companion 在线 + 扩展连接 + **强制** panel 外 indicator；stuck-key watchdog |
| F-S-CD12 | 全局热键：无唤醒词；macOS Accessibility **预提示**；禁静默授权 |
| F-S-CD13 | Dictation+ 主线程 composer only；tray 仅 indicator |
| F-S-CD14 | Abort/切线程/chat.abort：停 capture + 取消 LLM；不 auto-send |
| F-S-CD15 | **`voice_privacy_ack_v3`**（连续和/或 LLM polish）；**`meeting_privacy_ack_v1`**（会议）— 不可互相替代 |
| F-S-CD16 | 会议音频默认 **转写成功后删除**；保留 opt-in ≤7 天；`meetings/` 0o700/0o600 + 路径 containment |
| F-S-CD17 | 会议 STT **仅 local**（Mtg1） |
| F-S-CD18 | 会议 Start **仅显式手势**；热键不得误开会议 |
| F-S-CD19 | 纪要 LLM： grounded in transcript；禁臆造出席人/决议；minutes job **text-only 无工具** |
| F-S-CD20 | 磁盘分桶：models/whisper · tmp/voice-stt · meetings/ |
| F-S-CD21 | 日志无 PCM/全文转写/纪要正文 |
| F-S-CD22 | 无 `audioCapture` manifest |
| F-S-CD23 | 新/修订 ADR（连续分段、热键 Trust、会议落盘、ack） |
| F-S-CD24 | M1 F-S8 标 **classic-only**；不静默删除历史 SoT |

### 3.3 Platform（F-C-CD*）

| ID | Floor |
|----|--------|
| F-C-CD1 | Tier-1：Chrome desktop macOS + Windows |
| F-C-CD2 | 无 audioCapture manifest |
| F-C-CD3 | Mode B **不是** chrome.commands 能独立完成；须 Companion 原生 hold down/up |
| F-C-CD4 | **禁止默认 bare fn**（macOS） |
| F-C-CD5 | **禁止默认 Win+V**（剪贴板历史） |
| F-C-CD6 | Hold 须 key-down + key-up 监测（可能 Accessibility） |
| F-C-CD7 | Mode B v1：Companion 在线 + 扩展连接 + **Side Panel 文档存活**（可失焦）；关闭 panel 不开麦 |
| F-C-CD8 | Browser continuous：有条件 restart + generation；禁 abort/hardcap 后 restart |
| F-C-CD9 | 多分钟 browser STT **不承诺可靠** — 须 spike S-WS1；长会话优先 local 分段 |
| F-C-CD10 | Path B 连续 = **segment protocol**，不是抬 45s 常量 |
| F-C-CD11 | 长 gUM v1 = 打开的 Side Panel 文档 |
| F-C-CD12 | 会议系统音频 / 混音 = **停车场** |
| F-C-CD13 | 会议音频分段落盘 + 默认删 |
| F-C-CD14 | 会议长录 **local-only** |
| F-C-CD15 | 热键冲突 soft-fail + 用户自选 |
| F-C-CD16 | Mode B 强制 tray/HUD indicator |
| F-C-CD17 | Linux 热键默认关 |
| F-C-CD18 | continuous feature-flag；默认 classic |
| F-C-CD19 | 硬 cap 上限 30 min（默认 15） |
| F-C-CD20 | ADR 显式 reopen M1/Path B 边界 |

### 3.4 Impl（F-I-CD*）

| ID | Floor |
|----|--------|
| F-I-CD1 | classic / continuous = **显式 mode 判别的 SM**，禁止布尔乱洒 |
| F-I-CD2 | **listenGen** 世代令牌；所有 async 带 gen |
| F-I-CD3 | onend restart **仅 adapter 内**；reducer 不收伪 ENGINE_END |
| F-I-CD4 | classic 保持 45s + 无 restart；continuous 用软/硬 cap |
| F-I-CD5 | Path B continuous = 多 segment `voice.stt` epoch，禁止单 blob 30min |
| F-I-CD6 | D1 local 默认 **串行分段**（录完再转下一段）；并发 queue 另 ADR |
| F-I-CD7 | TranscriptBuffer 纯模块；segment finals 追加 |
| F-I-CD8 | LLM polish/correct = 带外 text-only job + AbortSignal；不进 agent tool loop |
| F-I-CD9 | 不经 agentStore 写 live SM / PCM / 全文 |
| F-I-CD10 | phase 区分 listening / polishing（及可选 correcting） |
| F-I-CD11 | 热键 = **控制面** WS only；音频/STT 仍 extension origin |
| F-I-CD12 | 热键无 panel peer → fail closed |
| F-I-CD13 | MeetingSession = Companion `meetings/` 产物，不是 thread 消息堆 |
| F-I-CD14 | agentStore 仅 prefs + 薄镜像 |
| F-I-CD15 | 磁盘分桶 + GC + quota |
| F-I-CD16 | Pack 不写 mic/hotkey/engine/caps/ack |
| F-I-CD17 | mode×engine 组合矩阵测试 |
| F-I-CD18 | 默认 classic |

---

## 4. Locked defaults（§10 全票/多数）

| Q | 锁定 |
|---|------|
| **Q-DEF1** | **classic**（零回归） |
| **Q-CAP1** | 软 **5 min** 提示；硬 **默认 15 min**；设置上限 **30 min**；local segment **30–45s** |
| **Q-LLM1** | Incremental **OFF**（D3 可选）；Final polish **OFF**（opt-in + ack v3） |
| **Q-LLM2** | polish 失败 **不阻塞** raw merge |
| **Q-HK1** | Companion 在线 + 扩展连接 + **Panel 打开**（可失焦）+ 全局 REC indicator |
| **Q-HK2** | **不默认 fn**；热键默认 **关**；建议可配置 ⌃⇧Space / ⌥Space（冲突检测） |
| **Q-HK3** | **不用 Win+V**；建议 Ctrl+Shift+Space 或用户自选 |
| **Q-MTG1** | 转写成功后 **默认删音频** |
| **Q-MTG2** | 会议 **仅 local STT** |
| **Q-MTG3** | Mtg0 **仅 Pack**；Mtg1 再谈一等入口 |
| **Q-SCOPE1** | **强制分波/分 PR** |

---

## 5. 用户意向吸收表（诚实对照）

| 用户想要 | 合成结论 |
|----------|----------|
| 不要卡死语音时间 | **部分吸收**：取消 continuous 的 45s 死闸；代之以 15/30 min 安全硬 cap + 软提示。**不是无限录** |
| 点按 → 实时转写 → LLM 纠错 → 停后润色 | **分阶段吸收**：实时转写 = D1；停后润色 = D1b opt-in；**实时 LLM 纠错 = D3 且默认关**（防改稿/费用/预发送泄密） |
| 快捷键按住（fn / Win+V） | **形态吸收，默认键否决**：按住说话 = D2；**fn / Win+V 不能做默认**；默认关 + 用户选键 |
| 插件会议记录场景 | **完整吸收为独立线**：Mtg0 Pack 纪要 → Mtg1 工作台+长录；**不**劫持 composer 🎤 |
| 不同人说话 | **目标承认，Mtg1 不交付自动 diarize**；诚实命名；Mtg2 手动 / Mtg3 自动另对抗 |

---

## 6. Ship order（锁定）

```text
D0   本合成 → 两份 SoT + ADR 草案（连续 / 会议）
     → 建议 Pi 复审后再写 implementation plan

Mtg0 Pack「会议记录」+ 粘贴转写 → 纪要（零麦克风）     ║ 可与 D1 并行
                                                        ║
D1a  continuous Mode A（点按）+ browser 有条件 restart  ║
     + 软/硬 cap + 吵 REC + classic 回归                 ║
D1b  Final polish opt-in + voice_privacy_ack_v3         ║
D1c  Local 串行分段 continuous（会议依赖）               ║
                                                        ▼
Mtg1 会议工作台 + 分段 local STT + 结束生成纪要
     + meeting_privacy_ack_v1 + 默认删音频

D2   Hold-to-talk 全局热键（原生 Companion + indicator）
     默认关；禁 fn/Win+V 默认

D3   Incremental correct（默认 off；可整波砍）

Mtg2 手动 speaker / 上传文件 / 系统音频调研
Mtg3 自动 diarize — 另开对抗
```

**Required spikes before claims**

| Spike | 门禁 |
|-------|------|
| S-WS1 | browser continuous ≥3 min zh-CN + restart SM |
| S-LOC1 | 5×45s local segments 合并 + abort |
| S-HK-MAC / S-HK-WIN | hold down/up + 权限 + 冲突（D2 前） |
| S-GUM-LONG | panel 打开时长录音稳定性（30 min 上限前） |

---

## 7. SoT / ADR 预期产出

| 产出 | 内容 |
|------|------|
| `docs/superpowers/specs/YYYY-MM-DD-continuous-dictation-design.md` | Dictation+ SoT（吸收 F-*-CD* 听写部分） |
| `docs/superpowers/specs/YYYY-MM-DD-meeting-minutes-design.md` | Meeting SoT |
| ADR-02x（新）或修订 023 | 分段 STT、连续 Trust、热键控制面、会议落盘与 ack |
| 修订 M1 SoT | F-S8 / Q6 标注 classic-only；continuous 指向新 SoT |

---

## 8. Residual risks（合成后仍在）

| ID | Risk | 残留级别 |
|----|------|----------|
| R1 | 遗忘开麦（咖啡馆） | Medium（15 min 仍非零） |
| R2 | Browser 长会话云 STT | Medium（用户选 browser 时） |
| R3 | 预发送 LLM 文本外发 | Medium（用户开 polish 时） |
| R4 | Web Speech restart 丢字 | Medium |
| R5 | Local 串行分段静音缝 | High for 会议 → 后需 ring buffer ADR |
| R6 | 热键 Accessibility / 误触 | Medium |
| R7 | 会议名实（无 diarize）差评 | Medium（靠诚实命名） |
| R8 | classic/continuous 双模式回归 | High if 缺矩阵测 |
| R9 | 笔记本备份同步 meetings/ | Outside product |
| R10 | 多方录音法律合规 | User residual（ack 一句） |

---

## 9. Dual-review / Pi readiness

| Gate | Status |
|------|--------|
| Floors 合成 | Yes（本文件） |
| Defaults locked | Yes §4 |
| Product goal | Alive, split |
| Strawman implementable as-is | **No** |
| Spikes named | Yes §6 |
| SoT written | **Pending**（用户确认合成后） |
| Pi re-review | **Recommended** before implementation plan |

**Internal adversary gate:** 三路 MAJOR_REVISE + 一路 PASS_WITH_CHANGES → **以本合成 floors 为准修订**，不得用「用户要求取消 45s」跳过 classic 默认 / 硬 cap / ack。

---

## 10. Artifacts

| 文件 | 角色 |
|------|------|
| `docs/superpowers/specs/2026-08-07-continuous-dictation-meeting-minutes-strawman.md` | Strawman（待废为对照） |
| `docs/audit/reviews/continuous-dictation-meeting-adversary-synthesis-20260807.md` | **本合成** |
| 四路 raw | session subagents（Product/Security/Platform/Impl）2026-08-07 |

---

## 11. One-line product narrative（对外可用）

> **听写**：可选「连续听写」把短听写升级为可长达 15 分钟的点按听写（默认仍是 45 秒经典模式）；可配置按住快捷键；可选 LLM 润色草稿。  
> **会议**：独立「会议记录」场景——本机转写 + 生成纪要；暂不分说话人；与输入框麦克风不是同一按钮。
