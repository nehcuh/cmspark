# Adversary Synthesis — 语音输入（Voice Input）

**Date**: 2026-08-06  
**Strawman**: `docs/superpowers/specs/2026-08-06-voice-input-design-strawman.md`  
**SoT (post-adversary)**: `docs/superpowers/specs/2026-08-06-voice-input-design.md`  
**Agents**: Product/UX · Security/Privacy/Trust · Platform/Compat/ADR · Impl architect  

---

## 1. Scoreboard

| Agent | Verdict | Core stance |
|-------|---------|-------------|
| Product/UX | **MAJOR_REVISE** | Busy 合同与代码不符；Stop/mic 三体；320px chrome；中文听写非魔法；禁 auto-send；禁「语音 Agent」叙事 |
| Security/Trust | **MAJOR_REVISE** | 隐私不能只写「不经 Companion」（Chrome 云 STT）；auto-send×巡航=免确认注入；Path B v1 禁；审计 modality |
| Platform/Compat | **PASS_WITH_CHANGES** | Scheme A 可做；Side Panel 权限 bootstrap 是硬坑；≤45s cap；无 `audioCapture`；hide/disable 矩阵 |
| Impl | **PASS_WITH_CHANGES** | pure SM + adapter；prefs 只 `chrome.storage.local`；abort 世代 token；零 Companion M1 |

**产品目标本身**（mic → 文字进 composer）四路均未 `REJECT_PRODUCT_GOAL`。  
**Strawman 不可直接实现** — 必须吸收 floors 后锁 SoT。

---

## 2. Conflict resolution（写入 SoT）

| 冲突 | 决议 |
|------|------|
| Product: worker 显示 🎤 vs Security F-S9 仅主线程 | **v1 仅主线程 composer**（`parent_thread_id` 空）；worker 隐藏 🎤 |
| Product 点按 vs Security 按住（减环境噪声） | **点按 toggle + 硬超时 ≤45s**（Platform/Impl 一致；按住 M2+） |
| Product 隐藏不可用 vs Security 灰显说明 | **矩阵**：结构不可用 **Hide**；权限拒绝/离线 **Disable+原因** |
| 全员 vs strawman auto-send M2 | **v1 不存在 auto-send 设置**；M2+ 另开对抗且巡航时强制关 |
| 听写 during `thread_busy` | **M1 禁止 start**（与 textarea disabled 对齐）；不改 busy 合同 |
| `run_busy` | **允许**听写填草稿；发送走现有 `canSend`（可发） |
| 默认 `voiceInputEnabled` | **true** 但 **首次点 🎤 才 privacy ack + 权限**；未 ack 不 `start()` |
| Path B Companion STT | **v1–M2 禁**；M3 停车场 + 独立 ADR |
| 隐私一句话 | **三通道模型**（STT 厂商 / Companion 文本 / 本地存储）— 禁止仅「不经 Companion」 |

---

## 3. Mandatory floors（进入 SoT）

### Product/UX

| ID | Floor |
|----|--------|
| F-UX1 | ComposerMode 矩阵：`ready` / `run_busy` / `thread_busy` / `l2_task` 各自 mic 可见/可听写/可发 |
| F-UX2 | Listening 时右侧主按钮语义明确：听写结束 vs 停止对话；Stop 同时停听写+abort 时 tooltip 写清 |
| F-UX3 | 320px 布局锁：attach · textarea · mic · send；超宽则 mic 与 attach 互斥 morph |
| F-UX4 | 文案仅「语音输入/听写」— 禁止「语音 Agent/语音指挥」 |
| F-UX5 | M1 含空结果/拒权/不支持/超时错误路径（不可推到 M2） |
| F-UX6 | 成功标准：授权后可编辑并发送 ≥15 字中文指令；非「点两下开始说」 |

### Security

| ID | Floor |
|----|--------|
| F-S1 | 三通道隐私披露（浏览器 STT 可能云端；Companion 不见音频） |
| F-S2 | v1 无 auto-send；若未来有则巡航/三旗/值守时强制关 |
| F-S3 | 发送 = 与键盘同一 `handleSend`；不新确认方言 |
| F-S4 | 可选审计 `input_modality: voice`（至少本地/未来 companion 可区分） |
| F-S5 | 无 `audioCapture` manifest |
| F-S6 | 无转写内容遥测 |
| F-S7 | Path B 禁 v1 |
| F-S8 | 单次 ≤45s；无唤醒；失焦/abort/切线程停听 |
| F-S9 | 仅主线程 composer |
| F-S10 | 首次 privacy ack 版本化 |
| F-S11 | Pack 不得写 voice 风险开关 |
| F-S12 | ADR-020 checklist 正确写 Trust（mic+STT residual） |

### Platform

| ID | Floor |
|----|--------|
| F-C1 | 隐私文案含 Chrome/Google STT 可能出站 |
| F-C2 | Side Panel 权限 **bootstrap**（扩展 tab 授权页）— 不只 sidepanel 内 `start()` |
| F-C3 | 会话硬 cap + error map |
| F-C4 | Tier-1 = Google Chrome desktop Win/macOS |
| F-C5 | Capability hide/disable 矩阵 D0–D10 |
| F-C6 | 无 audioCapture；SpeechRecognition 仅 document（Side Panel） |

### Impl

| ID | Floor |
|----|--------|
| F-I1 | 听写态不进 `agentStore`（仅 prefs） |
| F-I2 | prefs → `chrome.storage.local` 非 companion config |
| F-I3 | 唯一发送路径 `handleSend` |
| F-I4 | chat.abort / Stop → 先 abort recognition（session token） |
| F-I5 | 切线程丢弃 session |
| F-I6 | pure `session-reducer` + adapter + hook |
| F-I7 | 双提交防护 `committed` |
| F-I8 | 听写开始时 snapshot baseText；final append |

---

## 4. Locked defaults（§7 裁决）

| Q | 锁定 |
|---|------|
| Q1 按住 vs 点按 | **点按 toggle** |
| Q2 auto_send | **v1 无此设置** |
| Q3 子任务 🎤 | **否** |
| Q4 不可用 UI | **矩阵**（Hide 结构失败 / Disable 可恢复阻塞） |
| Q5 audioCapture | **不添加** |
| Q6 长听 | **≤45s 硬停；无静默 restart** |

---

## 5. Ship order

```text
SoT lock (this synthesis → design.md)
  → optional dual-review (Pi+Claude) if shipping soon
  → Platform spike: Side Panel zh-CN onresult + bootstrap permission on macOS/Win
  → M1: pure SM + mic + draft + privacy ack + settings enable + errors
  → M1.1: modality metadata if cheap
  → M2 parking: auto-send (re-adversary), lang UI, hold-to-talk
  → M3 parking: Companion STT (new ADR)
```

---

## 6. Dual-review / Pi readiness

| Gate | Status |
|------|--------|
| Floors in SoT | Yes |
| Defaults locked | Yes |
| No Surface/Trust elevation | Hold |
| Residual risks named | Yes (R1–R8 Security) |
| Spike before feature default-on in prod | Required (M0.5) |
| **Pi re-review** | **APPROVE_WITH_NITS** `voice-input-design-verdict-pi-20260806-194531` — nits absorbed into SoT |

**Internal adversary gate:** MAJOR_REVISE **resolved by SoT patch**, not overridden.  
**Pi gate:** green for M0.5 / M1 planning.

---

## 7. Artifacts

- Strawman: `docs/superpowers/specs/2026-08-06-voice-input-design-strawman.md`
- SoT: `docs/superpowers/specs/2026-08-06-voice-input-design.md`
- This synthesis: `docs/audit/reviews/voice-input-adversary-synthesis-20260806.md`
