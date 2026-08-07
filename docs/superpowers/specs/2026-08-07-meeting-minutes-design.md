# 会议纪要（Meeting Minutes）— 产品设计 SoT

> **日期**: 2026-08-07  
> **状态**: **LOCKED for Mtg0/Mtg1 planning** — R1 四路对抗 floors 已吸收；R2 确认与听写+ 硬拆  
> **对抗合成**:  
> - R1：[continuous-dictation-meeting-adversary-synthesis-20260807.md](../../audit/reviews/continuous-dictation-meeting-adversary-synthesis-20260807.md)  
> - R2（听写交叉）：[voice-dictation-r2-yetone-adversary-synthesis-20260807.md](../../audit/reviews/voice-dictation-r2-yetone-adversary-synthesis-20260807.md)  
> **姊妹 SoT**: [听写+](./2026-08-07-dictation-plus-design.md)（**禁止**用会议级常听冒充 composer 默认）  
> **Trust ADR**: [ADR-024](../../adr/024-dictation-plus-asr-refiner-meeting.md)  
> **Pack 前置**: [ADR-014](../../adr/014-mission-pack-enterprise-modules.md)  

---

## 0. 一句话（锁定）

**独立「会议记录」场景：用户显式开始一场会议采集（本机 STT）或粘贴/导入转写，生成可编辑转写与结构化纪要（TL;DR / 决议 / 待办）；默认可导出。暂不承诺自动说话人分离。应用任务包永不自动开麦。**

---

## 1. JTBD

| | |
|--|--|
| **谁** | 需要会后纪要的用户（1:1、小会、自录备忘） |
| **成功 Mtg0** | 粘贴转写 → 结构化纪要可复制 / 可选 Obsidian |
| **成功 Mtg1** | 录 ≥5 分钟单人 → 可编辑转写 → 生成纪要 → 默认删音频 |
| **非成功** | 飞书/Otter 级多方 diarize；系统混音默认；静默后台录会 |

---

## 2. 与听写+ 的硬边界

| | 听写+ (L-B) | 会议 (L-C) |
|--|-------------|------------|
| 入口 | composer 🎤 / 热键 | 任务包 / 会议工作台 |
| 产物 | textarea 草稿 | MeetingSession 转写 + 纪要 |
| 注入 chat | 用户 Send | 「发送到对话」= 填草稿/附件，仍须 Send |
| STT | browser 或 local | **长录仅 local**（或文件） |
| LLM | ASR Refiner（可选） | **纪要 job**（另一 prompt） |
| auto-start | 否 | **否**（含 Pack apply） |

---

## 3. 目标 / 非目标

### 3.1 目标

**Mtg0**

1. Mission Pack `meeting-minutes`：skills + `system_prompt_append`（纪要结构）  
2. 用户粘贴转写 → 生成 TL;DR / 决议 / 待办 / 风险  
3. 复制；可选对齐现有 Obsidian 导出模式  
4. **零麦克风**  

**Mtg1**

5. 会议工作台 UI（状态条 · 可滚动转写 · 结束后纪要卡片）  
6. 显式「开始会议」→ 本机分段 STT → 「结束并生成纪要」  
7. `meeting_privacy_ack_v1`  
8. 音频默认转写成功后删除；目录 `~/.cmspark-agent/meetings/`  

### 3.2 非目标 v1

| 非目标 | 理由 |
|--------|------|
| 自动说话人分离 SLA | Mtg3 另对抗 |
| 系统/会议软件混音 | 平台停车场 |
| browser 云 STT 长会 | 隐私 |
| Pack / 热键自动开录 | F-S-CD18 |
| 音频进 history.db | 最小化 |
| 纪要 LLM 带工具 | text-only job |
| 营销「多方会议自动纪要」 | 名实不符 |

**诚实命名**：Mtg1 对外可用副标题 **「暂不分说话人」** / 「单人备忘转写」。

---

## 4. ADR-020

```text
Surface:      L0 工作台（文档产物）；工具仍走既有 Surface
L2-classes:   (none) from meeting capture itself
Compose:      Pack = skills + system_prompt_append + tool_whitelist only
              Pack 不得写 voice* / sttEngine / ack / hotkey / audio_retain / autoStart
Autonomy:     n/a（非 multi-worker 默认）
Trust:        mic + local STT residual + durable transcript ± optional audio
              + minutes text → user LLM
Channel:      community; meeting capture opt-in after meeting_privacy_ack_v1
```

---

## 5. 对象模型

```text
MeetingSession
  id, thread_id?, title, started_at, ended_at, status
  privacy: { stt_engine: "local", audio_retained, retain_until? }
  transcript: [{ t0?, t1?, speaker?, text, source: stt|user_edit|asr_refiner? }]
  minutes: { tldr, decisions[], actions[], risks[], raw_md, generated_at }
```

**磁盘**（Mtg1）：

```text
~/.cmspark-agent/meetings/<id>/
  meta.json
  transcript.jsonl
  minutes.md
  audio/          # optional; default delete after successful STT
```

- dir **0o700**，files **0o600**  
- realpath containment under DATA_DIR  
- boot GC：过期保留 / 孤儿  
- 与 `models/whisper`、`tmp/voice-stt` **分桶预算**  

**禁止**把全文转写默认堆进 thread messages 当主存储。

---

## 6. UX

### 6.1 入口

| 波次 | 入口 |
|------|------|
| Mtg0 | 底栏 **任务包** →「会议记录」→ 应用到线程；聊天内粘贴转写 + 请生成纪要 |
| Mtg1 | 可加一等「会议」入口；**应用 Pack 不自动录音** |

### 6.2 工作台（Mtg1 · 克制）

```text
[标题]  [● 录制中 mm:ss]  [暂停?] [结束并生成纪要]
────────────────────────────────
可滚动转写（可编辑）
────────────────────────────────
纪要卡片（结束后）
  TL;DR · 决议 · 待办 · 风险
  [复制] [导出] [发送到对话]
```

- v1 **不做**完整时间轴 IDE / 多轨 seek  
- 「结束并生成纪要」须确认语义（停录 + 生成；录音段策略按隐私）  
- 「发送到对话」**永不** auto-send  

### 6.3 说话人

| 波次 | 能力 |
|------|------|
| Mtg1 | 单轨；可选标签「我」；**无**自动 diarize |
| Mtg2 | 静音切 + 手动标 speaker；上传文件 |
| Mtg3 | 自动 diarize — **另开对抗** |

---

## 7. 采集与 STT（Mtg1）

| 项 | 锁定 |
|----|------|
| 源 | 本机 mic（getUserMedia）；**系统混音停车场** |
| 引擎 | **local only**（Path B whisper 分段） |
| 分段 | 30–45s 串行（同听写+ D1c 能力） |
| 与听写+ | 全局 max-1：会议进行中禁 Dictation STT 并提示 |
| 上传文件 | Mtg1.1 可选；同 unlink 策略 |

可选：转写后 **ASR Refiner** 再纪要 — **两 job 明示勾选**，默认 off（R2 Q-MEET-X）。

---

## 8. 纪要 LLM

| 项 | 锁定 |
|----|------|
| Job | `meeting_minutes`（≠ `asr_refiner`） |
| 输入 | 用户/STT 转写文本 only |
| 输出 | 结构化 Markdown（TL;DR、决议、待办、风险） |
| 约束 | **禁止臆造**出席人/未出现的决议；无工具  
| 失败 | 保留转写；banner；可重试 |
| 再生成 | 允许；以**当前可编辑转写**为准 |

---

## 9. Privacy

### `meeting_privacy_ack_v1` 必含

1. 会创建本地会话产物（转写 ± 可选音频）  
2. **默认：转写成功后删除音频**；保留须 opt-in ≤7 天  
3. 纪要将转写文本发给已配置 LLM  
4. 长会 STT **本机**；非 browser 云  
5. Pack **不会**自动开始录音  
6. 多方录音法律合规由用户负责（一句诚实非目标）  

`voice_privacy_ack_v3` **不能**替代 meeting ack。

---

## 10. Pack `meeting-minutes`

```yaml
# 概念示例 — 不得包含 voice/stt/ack/hotkey/autoStart
id: meeting-minutes
# skills: [...]
# system_prompt_append: 仅基于用户提供的转写生成纪要；禁止臆造…
```

应用后空状态 CTA：**粘贴转写** 或 **开始录制**（Mtg1）；绝无自动 mic。

---

## 11. 协议面（Mtg1 摘要）

| 消息族 | 用途 |
|--------|------|
| `meeting.start` / `pause` / `end` | 会话生命周期 |
| `meeting.append_transcript` / `get` / `list` | 转写 CRUD |
| `meeting.generate_minutes` | 纪要 job |
| 复用 | 分段 `voice.stt.*` 绑定 meetingId |

Origin / 鉴权与现有 WS 一致；tray 不发起会议音频。

---

## 12. 验收

**Mtg0**

1. 应用 Pack 不触发 mic  
2. 粘贴 ≥200 字中文转写 → 纪要含 TL;DR 与至少一类待办/决议结构（允许模型变异，结构门禁）  
3. 可复制  

**Mtg1**

4. 录 5 min 单人 → 转写可编辑 → 纪要生成  
5. 成功后音频按默认策略删除（可测文件消失）  
6. 无 meeting ack 不能 Start  
7. 与听写+ 互斥提示  

---

## 13. 波次

| 波次 | 范围 | 依赖 |
|------|------|------|
| **Mtg0** | Pack + 粘贴纪要 | 无 mic |
| **Mtg1** | 工作台 + 分段 local + 删音频 + ack | Dictation+ **D1c** 分段能力 |
| **Mtg2** | 手动 speaker / 上传 / 系统音频调研 | 另评 |
| **Mtg3** | 自动 diarize | 另对抗 |

可与 Dictation+ **D1 并行做 Mtg0**（推荐先验证纪要价值）。

---

## 14. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-08-07 | 初版 LOCKED：R1 会议线 + R2 硬拆确认 |
