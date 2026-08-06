# Adversary Synthesis — Settings IA · Timeline fold · Runtime context budget

**Date**: 2026-08-06  
**SoT**: `docs/superpowers/specs/2026-08-06-settings-thread-compact-ux.md`  
**Agents**: Product/UX · Security/Trust · Impl · Compat/ADR  

---

## 1. Scoreboard

| Agent | Verdict | Core stance |
|-------|---------|-------------|
| Product/UX | **MAJOR_REVISE** | Secrets 不可埋折叠 junk drawer；昨天默认折叠；禁止再发静默 head-drop；1e6 诚实性 |
| Security/Trust | **PASS_WITH_CHANGES** | Armed Trust 必须压过 LS 折叠；omit/M2 强 redact；dual-truth 常驻指示；审计 schema |
| Impl | **MAJOR_REVISE** | M1 算法未闭合；tools 构建顺序；omit wire 角色；schema vs D-S7；1e6 无产品价值 |
| Compat/ADR | **PASS_WITH_CHANGES** | Timeline SoT 归 History IA；三摘要 glossary；禁止 compaction_summary 撞名；request-only |

**Merge rule:** Product + Impl MAJOR_REVISE → **全部 blocking floors 写入 SoT** 后才可 dual/Pi 与开发；不 override 为 soft nits。

---

## 2. Conflict resolution

| Conflict | Resolution |
|----------|------------|
| Product: 昨天默认折叠 vs Compat 倾向展开 | **采纳 Product F-UX2：昨天默认折叠**；History IA 同步修订 |
| Secrets 位置 | **独立一级「密钥与环境」**（F-UX1）；不在能力扩展 |
| 配对后默认展开 | **仅「模型与推理」**（F-UX3）；未配对 + 连接 |
| W2 静默 vs dual-truth | **F-UX5 + F-S6：行为变更与 durable 系统条同切片**；否则不改 drop 行为 |
| `auto` 默认 | **M1 行为落地后才允许默认 `auto`**；在 dual-truth chip 前默认 `prompt` 或与 chip 同发则 `auto` |
| D-S7 schema 不变 vs D-C6 | **W1 无 schema 变更**；`llm.context_compaction` 属 W2/W3 companion 字段 |
| omit 进 messages | **仅 request payload**；`user` 边界消息模板；**永不写磁盘** |
| Timeline dual SoT | **History IA 修订为唯一 Timeline SoT**；本 doc 链接实现 |
| Fold LS keys | **统一 `cmspark.threadList.expand`** JSON：`{ months: string[], today?: boolean, yesterday?: boolean }`（迁移旧 `expandMonths`） |
| Q1 | 昨天默认折叠 |
| Q2 | wire-only user omit notice |
| Q3 | M2 默认 off |
| Q4 | 本批 **不改 1e6 默认值**；Settings 明示 + 验收用小 window；S3 不宣称「默认用户已自动压缩」 |
| Q5 | 无 GODMODE phrase；启用 `auto` 时 **informed ack 一次**（非 Trust 短语） |

---

## 3. Mandatory floors (into SoT)

### Product / UX

| ID | Floor |
|----|--------|
| F-UX1 | Secrets 独立一级分类「密钥与环境」；能力扩展仅 MCP/NetSec/场景 |
| F-UX2 | 昨天默认折叠；今天默认展开 |
| F-UX3 | 配对后默认只展开模型；未配对强制连接+模型 |
| F-UX4 | omit/drop 仅 LLM request；磁盘与 UI 全文；文案区分界面 vs 模型 |
| F-UX5 | 禁止无 UI 静默 head-drop 作为 S3 完成；chip 与行为同切片 |
| F-UX6 | Context Window 旁诚实文案（过大 ≈ 不触发压缩） |
| F-UX7 | StatusRail/错误 deep-link → 打开设置并展开目标分类 |

### Security

| ID | Floor |
|----|--------|
| F-S1 | Elevated trust force-open 安全区 > LS collapse |
| F-S2 | 折叠时仍可见 elevated badge / 状态行 |
| F-S3 | Armed set: auto_approve_dangerous, auto_approve_enterprise_tools, allow_all_schemes, unattended.armed |
| F-S4 | M1 omit = metadata only（count/role/range）；禁内容采样 |
| F-S5 | M2 前 `redactForCompaction`（history 敏感工具级，非 tag regex） |
| F-S6 | Durable dual-truth 指示（本会话有效） |
| F-S7 | Audit schema 完整字段；摘要只 hash+length |
| F-S8 | runtime budget meta 不注入跨 thread / digest / export |

### Impl

| ID | Floor |
|----|--------|
| F-I1 | 共享 `estimateTokens` + `estimateMessagesTokens` 契约 |
| F-I2 | 闭合 reserve；**先 build tools 再 compact** |
| F-I3 | W2 验收诚实：1e6 默认可 no-op；fixture 小 window |
| F-I4 | omit = sticky `user` 边界模板；双 provider 测 |
| F-I5 | `llm.context_compaction` companion 字段；非仅 LS |
| F-I6 | 文档：pre-loop only；mid-loop recompact = follow-up |

### Compat

| ID | Floor |
|----|--------|
| F-C1 | Timeline 规则写入 History IA |
| F-C2 | 单一 fold LS schema |
| F-C3 | 三系统 glossary（Digest / Export / Runtime budget） |
| F-C4 | 字段名 `runtime_context_budget`，禁裸 `compaction_summary` |
| F-C5 | request-path only persist 规则 |
| F-C6 | Q4 诚实 / 不虚假营销 |
| F-C7 | 单一 estimateTokens 模块 |

---

## 4. Ship order (post-adversary)

```text
SoT patch + History IA amend
  → Pi re-review
  → W0: ThreadList today/yesterday toggle + unified LS + yesterday default collapsed
  → W1: Settings accordion (Secrets row, force-expand, paired defaults, no schema)
  → W2: pure compactMessagesTurnSafe + shared tokens + request omit + durable UI chip
       + llm.context_compaction + Settings honesty (F-UX6)
  → W3 later: M2 LLM rolling + prompt mode UX polish + mid-loop recompact
```

**W0 可与 SoT/Pi 并行后立即编码**（floors 已锁）。  
**W1/W2 在 SoT 含 floors 后开发。**

---

## 5. Artifacts

- Design SoT (revised): `docs/superpowers/specs/2026-08-06-settings-thread-compact-ux.md`
- History IA amend: `docs/superpowers/specs/2026-08-06-thread-history-ia-product-design.md`
- This synthesis: `docs/audit/reviews/settings-thread-compact-adversary-synthesis-20260806.md`
- Dual/Pi prompt: `docs/audit/reviews/settings-thread-compact-dual-review-prompt-20260806.md`
