# ADR-024: 听写+（连续/按住）· ASR Refiner · 会议落盘

**日期**: 2026-08-07 | **状态**: **Accepted（设计门禁）** — 产品 SoT 已锁；实现按波次 D1/Mtg*  
**相关**:  
- [ADR-020](020-capability-model-three-axes.md)  
- [ADR-023](023-voice-local-stt-path-b.md) Path B local STT（**不撤销**；本 ADR **扩展**连续分段与文本 LLM residual）  
- [ADR-014](014-mission-pack-enterprise-modules.md) Pack  
- 产品 SoT：  
  - [听写+](../superpowers/specs/2026-08-07-dictation-plus-design.md)  
  - [会议纪要](../superpowers/specs/2026-08-07-meeting-minutes-design.md)  
  - M1 classic：[2026-08-06-voice-input-design.md](../superpowers/specs/2026-08-06-voice-input-design.md)  

**过程**:  
- R1 对抗合成：`docs/audit/reviews/continuous-dictation-meeting-adversary-synthesis-20260807.md`  
- R2 yetone 对照：`docs/audit/reviews/voice-dictation-r2-yetone-adversary-synthesis-20260807.md`  

> **规范优先级**：本 ADR 为 **Trust / 协议 / Pack 门禁 / 非目标** SoT。交互细节与波次验收以产品 SoT 为准。冲突时：**Trust/安全/协议以本 ADR 为准**。

---

## 1. 背景

M1 锁定 classic：≤45s、禁止 onend 静默 restart、无 pre-send LLM。  
Path B（ADR-023）锁定本机短段 STT、tmp unlink、max-1、无 Pack 写 voice。  

用户需要：(1) 更长听写 + 可选停后 ASR 纠错；(2) 独立会议纪要。  
开源 [yetone/voice-input](https://github.com/yetone/voice-input-src) 验证了「按住 + 可见录音 + **极保守 refine**」体验，但其 **系统级注入 / 默认 Fn / Apple Speech** 宿主模型 **不**适用 CMspark 双层拓扑。

---

## 2. 决策摘要

1. **classic 默认保留**；`voiceDictationMode=continuous` 为 **opt-in**。  
2. continuous 允许 **有条件** Web Speech restart 与 **local 多 segment**；**禁止**单 blob 抬高到 15–30 min。  
3. 硬 cap **默认 15 min**、**绝对上限 30 min**；软提示 **5 min**。  
4. **ASR Refiner**：可选、默认 off、仅 stop 后、correct_only、Companion **固定 system prompt**、text→用户 LLM residual、须 `voice_privacy_ack_v3`。  
5. **禁止** incremental 边听边 LLM；**禁止** v1 书面化 UI；**禁止** auto-send。  
6. 热键 hold = Companion **控制面**；音频/STT 仍 extension；默认键 **非** fn/Win+V。  
7. **系统级注入任意 App** = 非目标（另产品另对抗）。  
8. **会议** = 独立产物线：`meetings/` 落盘、`meeting_privacy_ack_v1`、长录 **local only**、默认删音频、Pack 不 auto-start。  
9. job 家族硬拆：`asr_refiner` ≠ `meeting_minutes`。  

---

## 3. 对 ADR-023 / M1 的显式 reopen

| 既有锁 | 本 ADR |
|--------|--------|
| M1 F-S8 ≤45s 无 restart | **classic only**；continuous 见产品 SoT |
| ADR-023 单 session 45s / 2.5MB | continuous/meeting = **多 epoch 分段**；**不**静默把全局常量改为 30 min |
| ADR-023 无 durable audio | **会议**引入可选 durable；默认转写后删；分桶 |
| ADR-023 ack v2 | continuous/Refiner 需 **v3**；会议需 **meeting v1** |
| ADR-023 Compose none voice* | **扩展 strip**：hotkey、caps、asr_refiner*、audio_retain、autoStart |

---

## 4. Trust residual 矩阵（四通道）

实现与设置 UI 必须可展示：

| # | 通道 | 何时 |
|---|------|------|
| 1 | mic OS/Chrome | 任何听写/会议采集 |
| 2a | browser 厂商 STT（可长时） | engine=browser continuous |
| 2b | local WS → Companion tmp → whisper | engine=local / 会议 |
| 3 | **转写文本 → 用户配置 LLM** | ASR Refiner on 或 纪要生成 |
| 4 | **会议持久转写 ± 音频** | MeetingSession |

禁止文案：「完全本地 / 零风险」当 2a 或 3 或 4 启用时。

---

## 5. 协议门禁

### 5.1 新增/扩展消息族（授权依据 = 本 ADR）

| 族 | 约束 |
|----|------|
| `voice.refine.*` | text-only；origin chrome-extension；无 client system prompt |
| `voice.dictation.hotkey` | edge only；**禁止**音频 |
| `voice.level`（可选） | 包络 float；非 PCM |
| `meeting.*` | 会话/转写/纪要；音频策略见产品 SoT |

### 5.2 继承 ADR-023

- `voice.stt.*` / `voice.model.*` 仍有效  
- STT origin fence、max-1、tmp 0o600、boot GC  

### 5.3 Pack

apply/install/save **strip/reject**：  
`voice*`、`sttEngine`、`localModelId`、`*privacy_ack*`、`*hotkey*`、`*cap*`、`asr_refiner*`、`refiner_prompt*`、`audio_retained`、`autoStart*`、`auto_send*`。

---

## 6. ASR Refiner 实现门禁

| 门 | 要求 |
|----|------|
| Prompt | 编译期常量；与 Dictation+ SoT §7.4 一致 |
| Runtime | `llmExtract` 类、无 tools、temp≤0.2、AbortSignal |
| 默认 | off |
| 失败 | raw |
| 输出守卫 | 长度界；可疑新 URL/密钥；拒 tool 形态 |
| 日志 | 无全文 in/out |

---

## 7. 会议落盘门禁

| 门 | 要求 |
|----|------|
| 路径 | `DATA_DIR/meetings/<id>/` only + realpath containment |
| 权限 | dir 0o700 / files 0o600 |
| 默认 | 转写成功后 **删除** audio/ |
| 保留 | opt-in ≤7 天 + GC |
| 预算 | 与 whisper 权重分桶；fail-closed |
| STT | 长录 local only |

---

## 8. 非目标（本 ADR）

- 系统级 VoiceInput 平替  
- 默认 Fn / Win+V  
- Apple Speech 引擎  
- 边听边 LLM  
- auto-send  
- 自动 diarize  
- 系统音频混音  
- 语音授工具 / 绕过 L2  

---

## 9. 后果

**正**

- 长听写与会议有明确 Trust 边界与分波实现路径  
- yetone 级纠错哲学可测（同字回归）  
- classic / Path B 用户零回归  

**负 / 残余**

- 预发送文本→LLM（用户开 Refiner 时）  
- 遗忘开麦（15 min 硬 cap 非零）  
- local 串行分段静音缝（后续 ring-buffer 另案）  
- Win/mac 全局 indicator 体验差  

**迁移**

- 已安装用户保持 classic；新开关 opt-in  
- 若已存在空 `voice_privacy_ack_v3` 而无正文语义，Refiner 上线前须 bump 版本  

---

## 10. 检查清单（PR 门）

实现 PR 须自证：

- [ ] classic 回归（45s / 无 restart）  
- [ ] continuous 仅 opt-in；硬 cap 默认 15  
- [ ] local 连续为多 segment，非单 blob 抬常量  
- [ ] Refiner 默认 off；固定 prompt；失败 raw  
- [ ] Pack strip 含新键  
- [ ] 无 auto-send；无系统注入  
- [ ] 会议与听写 max-1 互斥  
- [ ] 日志无 PCM/全文转写  
- [ ] ADR-020 三轴表贴在 PR  

---

## 11. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-08-07 | Accepted 设计门禁；对齐 R1+R2 SoT |
