# Side Panel UX：设置分类 · 时间线可折叠 · 运行时上下文预算

> **日期**: 2026-08-06  
> **状态**: **IMPL IN PROGRESS** — 四路对抗 + Pi **APPROVE_WITH_NITS**（`settings-thread-compact-pi-20260806-221435`）· W0/W1/W2 已落地  
> **对抗**: [settings-thread-compact-adversary-synthesis-20260806.md](../../audit/reviews/settings-thread-compact-adversary-synthesis-20260806.md)  
> **触发**: (1) 设置过多无分类；(2) 今天/昨天不可折叠；(3) 长对话需压缩  
> **轴 (ADR-020)**: Surface **L0（chat UX + request-path context budget）** · Compose none · Autonomy n/a · Trust 不抬升  
> **Timeline SoT**: [thread-history-ia](2026-08-06-thread-history-ia-product-design.md) §B.1（本 doc 只实现链接）

---

## 0. 问题陈述

| ID | 问题 | 现状 |
|----|------|------|
| **S1** | 设置全量平铺 | `SettingsSlideout.tsx` ~2500 行；仅高级闸门可折叠；Secrets 靠前但 LLM 埋底 |
| **S2** | 今天/昨天不可折叠 | `ThreadList.tsx` chevron 写死、无 onClick；月/日已可折叠 |
| **S3** | 长对话 token | `adapter.ts` 静默 head-drop（`JSON.length > cw*3`）；无 UI；默认 `cw=1e6` 几乎不触发 |

**不是问题**: 删设置项；今天默认展开；Digest/Export 与 runtime budget 合并。

---

## 1. 能力声明

```text
Surface:      L0 chat UX + request-path context budget
L2-classes:   (none)
Compose:      none — runtime budget ≠ Skill/Knowledge/Pack/Digest
Autonomy:     n/a — worker 独立预算；不合并 parent 全文
Trust:        不抬升；armed chrome 不可藏；压缩非安全控制
Channel:      community | enterprise 不变
```

---

## 2. 三系统 glossary（F-C3）

| 系统 | 字段/入口 | 用途 | 存哪 | 进 LLM？ |
|------|-----------|------|------|----------|
| **ThreadDigest** | `digest` on index | 搜索 / `@` card | thread index | 仅 `@` 显式 |
| **Export summary** | Obsidian / NotebookLM | 出站笔记 | 下载 / ADR-008 | 导出管道 |
| **Runtime context budget** | `runtime_context_budget` meta | 请求路径截断/omit | thread meta 可选；**消息数组默认不持久化 omit** | **每轮 request 组装** |

禁止：共享 prompt、把 M2 写进 digest、export 默认夹 omit。

---

## 3. 产品决策（对抗后锁定）

### 3.1 设置分类（S1）

| ID | 决策 |
|----|------|
| **D-S1** | 一级 accordion；无三级嵌套 |
| **D-S2** | **未配对**: 默认展开「连接与配对」+「模型与推理」。**已配对**: 默认仅「模型与推理」（F-UX3） |
| **D-S3** | Elevated trust → header **仍显示 armed badge**（F-S2）；**不**强制展开（2026-08-08：允许折叠，避免高权限时版面过长） |
| **D-S4** | LS: `cmspark.settings.expandSections: string[]`；force 规则覆盖 |
| **D-S5** | 分类树见 §4.1（含 **密钥与环境** 独立行 — F-UX1） |
| **D-S6** | 本批无设置搜索；deep-link 合同 F-UX7 |
| **D-S7** | **W1 无 config schema 变更**；arm/secrets/配对路径语义不变 |
| **D-S8** | 折叠时 **不 unmount** arm 短语面板（hide CSS 或保持 section mounted） |

**Armed set（F-S3 检测 + F-S2 badge；不再 force-open）**:  
`auto_approve_dangerous` · `auto_approve_enterprise_tools` · `allow_all_schemes` · `unattended.armed`（session）

### 3.2 时间线折叠（S2）— **SoT = History IA**

| ID | 决策 |
|----|------|
| **D-T1** | 今天/昨天组头可折叠；交互对齐月/日（checkbox `stopPropagation`） |
| **D-T2** | **今天默认展开；昨天默认折叠**（F-UX2） |
| **D-T3** | LS 统一：`cmspark.threadList.expand` = `{ months: string[], today?: boolean, yesterday?: boolean }`；迁移旧 `expandMonths`（F-C2） |
| **D-T4** | 多选行为不变 |
| **D-T5** | 搜索非空：匹配结果所在组强制展开（**含月**，与 D-T5 一致实现） |

### 3.3 运行时上下文预算（S3）

| ID | 决策 |
|----|------|
| **D-C1** | Companion 发 LLM 前组装；**默认不删磁盘消息** |
| **D-C2** | **M1**: 共享 token 估算 + turn-safe head-drop + **request-only** omit user 边界消息（metadata-only 文案，F-S4/F-C5） |
| **D-C3** | **M2**（后置）: `runtime_context_budget.rolling_summary`；默认 **off**；需 F-S5 redact |
| **D-C4** | 算法闭合见 §5（F-I1/I2） |
| **D-C5** | **Durable** 系统条：`模型上下文已压缩；下方消息列表仍为完整原文`（F-UX4/F-S6）；与行为 **同切片**（F-UX5） |
| **D-C6** | `llm.context_compaction`: `auto` \| `prompt` \| `off`；**companion 持久化**（F-I5）；UI 在「模型与推理」 |
| **D-C7** | 启用 `auto` 一次 informed ack（非 GODMODE 短语）（Q5 修订） |
| **D-C8** | Worker 独立；禁止 parent budget 注入 worker（F-S8） |
| **D-C9** | Export/digest 不污染 |
| **D-C10** | Q4 诚实：默认 1e6 **可不触发**；Settings 旁文案（F-UX6/F-C6）；**不宣称默认用户已自动压缩** |
| **D-C11** | Pre-loop only（F-I6）；mid-loop recompact = follow-up |
| **D-C12** | Audit `thread.context_compacted` 字段见 §6（F-S7） |

---

## 4. 信息架构

### 4.1 设置分类树（锁定）

```
设置
├── 连接与配对           未配对强制展开；已配对默认折叠
├── 模型与推理           默认展开（配对后唯一大默认）
│     LLM / 视觉 / 文件上传
│     长对话上下文预算（D-C6）+ context_window 诚实提示（F-UX6）
├── 密钥与环境           默认折叠；独立一级（F-UX1）— UserEnv Secrets
├── 安全与信任           默认折叠；armed 时 header badge，可折叠（F-S2/S3）
│     信任域 / 自动批准域
│     自主度 / Autopilot / 无人值守
│     高级闸门（二级）
├── 本机与集成           默认折叠（原「能力扩展」去 Secrets）
│     场景导流 · Outbound MCP · NetSec
├── 导出与集成           默认折叠 — Obsidian
└── 实验功能             默认折叠 — Qwen/VL
```

视觉：文本标题优先，避免 emoji Parade（UIUX quiet shell）。

### 4.2 时间线（实现；规则在 History IA）

```
今天 · N   [▼/▶]  默认展开
昨天 · M   [▶]    默认折叠
2026-07    [▶]    默认折叠
```

---

## 5. M1 算法契约（F-I1/I2/I4）

```text
// shared: companion/src/llm/token-estimate.ts (or re-export from summary-export)
estimateTokens(text: string): number  // SoT = summary-export CJK heuristic; one module only

estimateMessagesTokens(msgs: CanonicalChatMessage[]): number
  sum estimateTokens(serializeMessage(m))
  serializeMessage:
    system|user: content ?? ""
    assistant: content + each tool_call name + arguments
    tool: content

// Order in chatCreate:
// 1. build system prompt + rebuild history
// 2. build tools list (whitelist/MCP)
// 3. reserve = max(
//      floor(context_window * 0.15),
//      estimateTokens(system) + estimateTokens(JSON.stringify(tools)) + replyReserve
//    )
//    replyReserve = min(8192, floor(context_window / 8))
// 4. budget = context_window - reserve
// 5. while estimateMessagesTokens(messages) > budget && canDrop:
//      turn-safe drop oldest non-system (mirror adapter tool-pair splice)
//      never drop last user turn; never break tool pairs
// 6. if dropped: ensure exactly one omit notice as role=user immediately after leading system(s):
//      "[context_omitted] Earlier N messages omitted (turn-safe). Full history on disk."
//      metadata-only — no content samples (F-S4)
//      sticky: re-insert if loop would drop it; do not stack duplicates
// 7. streamChat — pre-loop only (D-C11)

// mode:
//   off    → skip compact (keep legacy? or skip entirely — prefer skip new path; legacy loop removed)
//   prompt → emit UI ask once / session; on decline skip; on accept = auto once
//   auto   → always when over budget; requires dual-truth chip path
```

**Omit 永不写入** `threadManager` 持久化消息（F-C5）。

**Provider**: OpenAI + Anthropic convert 单测 omit 为 user 边界（F-I4）。

---

## 6. Audit schema（F-S7）

```json
{
  "event": "thread.context_compacted",
  "thread_id": "...",
  "agent_role": "user|worker|orchestrator|...",
  "mode": "m1",
  "setting": "auto|prompt|off",
  "dropped_count": 0,
  "compacted_up_to_message_id": "...|null",
  "tokens_before": 0,
  "tokens_after": 0,
  "user_notified": true,
  "tool_pairs_preserved": true,
  "summary_bytes": 0,
  "summary_sha256": null,
  "model": null,
  "at": "ISO-8601"
}
```

禁止 audit 写全文 summary。

---

## 7. 波次与验收

| 波次 | 内容 | 验收 |
|------|------|------|
| **W0** | ThreadList 今天/昨天折叠 + 统一 LS + 昨天默认折叠 | 点击折叠；刷新保留；checkbox 不误触；搜索展开 |
| **W1** | Settings accordion + Secrets 独立 + force-expand + 配对默认 | 已配对默认 1 展开；armed 见安全；arm phrase 仍可用；UserEnv 独立 save |
| **W2** | `compactMessagesTurnSafe` + shared tokens + omit wire + durable chip + `context_compaction` + F-UX6 文案 | 小 window fixture 触发；1e6 短历史 no-op；UI 条可见；export 无 omit 污染 |
| **W3** | M2 + mid-loop + prompt UX 打磨 | 后置 |

---

## 8. 非目标

- 设置多页路由；删设置项；静默删磁盘；跨 thread 全文注入；M3 UI 消息中间折叠；compaction 做 Skill/Pack；本批改 `context_window` 默认 1e6 数值

---

## 9. 修订日志

| 日期 | 变更 |
|------|------|
| 2026-08-06 | 初稿 |
| 2026-08-06 | 四路对抗：吸收 F-UX1–7, F-S1–8, F-I1–6, F-C1–7；Q1–Q5 锁定；MAJOR_REVISE 关闭 |
| 2026-08-06 | Pi APPROVE_WITH_NITS；W0 ThreadList fold；W1 Settings accordion；W2 context-budget + dual-truth chip |
| 2026-08-06 | W3-lite：context_compaction 配置 + prompt 模式；Anthropic 连续 user 合并；F-UX7 deep-link；Settings UI |
| 2026-08-06 | M2：redactForCompaction + optional LLM rolling summary（默认关）；mid-loop recompact after tool rounds |
| 2026-08-06 | M2 默认开 + 策略门（≥3 msgs / ≥500 tok / pre_loop）；runtime_context_budget meta；查看摘要弹层；context_window 默认 128k |

---

*Pi re-review m2-meta: APPROVE_WITH_NITS (`settings-thread-compact-m2-meta-pi-20260806-230545`)*
