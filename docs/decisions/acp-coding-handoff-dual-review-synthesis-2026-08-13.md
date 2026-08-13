# Dual-review synthesis: 编程接力 / ACP coding-handoff design

**Date:** 2026-08-13  
**Batch:** `acp-coding-handoff-design`  
**Verdict JSON:** [`docs/audit/reviews/acp-coding-handoff-design-verdict-20260813-084345.json`](../audit/reviews/acp-coding-handoff-design-verdict-20260813-084345.json)

| Reviewer | Verdict | Artifact |
|----------|---------|----------|
| Claude | **APPROVE_WITH_NITS** | [`…-claude-20260813-084345.md`](../audit/reviews/acp-coding-handoff-design-claude-20260813-084345.md) |
| Pi | **APPROVE_WITH_NITS** | [`…-pi-20260813-084345.md`](../audit/reviews/acp-coding-handoff-design-pi-20260813-084345.md) |
| Combined | **both_ok=true** (exit 0) | — |

**Primary SoT reviewed:** [`acp-coding-handoff-product-design-2026-08-13.md`](acp-coding-handoff-product-design-2026-08-13.md)  
**Prompt:** [`_prompts/acp-coding-handoff-design-20260813.md`](../audit/reviews/_prompts/acp-coding-handoff-design-20260813.md)

---

## Consensus

1. **No blocking issues.** Design is sound as product SoT for **Phase A** (编程任务包 / no ACP protocol).
2. **ADR-020 fit strong:** Composition only; bans 中层 Agent / second runtime / new bottom tab; Autonomy stays single-thread handoff.
3. **ADR-022 dual-facade correctly separated:** Outbound = agent→browser; 接力 = browser→agent; loop guards required.
4. **Trust stance conservative:** HITL start, default off, no auto-spawn / shell-in-agent / worker-ACP / auto_approve skip; untrusted handback + Q5-style taint.
5. **Hero JTBD real and CMspark-unique** (logged-in page truth → local code action).
6. **Phase B+ requires future Accepted ADR + §9 Q1/Q3/Q6/Q8 answered + demand gate** — do not start ACP protocol code on this review alone.

---

## Nits to fold (union Claude + Pi)

| ID | Source | Topic | Action |
|----|--------|-------|--------|
| **N1** | Both | 「只读」徽章会被读成 OS 沙箱保证；外部进程仍可写盘 | 改文案为 **会话模式: 审查/起草** + 诚实脚注；非权限担保 |
| **N2** | Both | `acp_propose_session` L2 须绑定 `originWs` + 复用既有 Confirm 家族 | 写入设计 MUST / 未来 ADR 门槛 |
| **N3** | Pi | 云外泄 disclosure 须 **Companion 会话状态强制**（对齐 ADR-022 L3+），不可仅 Agent 自报 | Q6 升为硬要求 |
| **N4** | Claude | §3 补 `L2-classes: (none)` | 模板对齐 |
| **N5** | Claude | Phase A 与 `dynamic-workflow` Prompt Chain 合并 vs 双轨 — **优先扩展 dynamic-workflow** | 实现前锁定 Q9 |
| **N6** | Claude | Phase B「有真实复用」须 **可审计数字门**（非建造者自评） | 写入 §8 |
| **N7** | Claude | 明确：**无 Accepted ACP ADR 不得合入协议代码** | 写入 §9/§11 |
| **N8** | Pi | Phase A「可选唤起 CLI」须声明 = 纯 copy 或复用 host_app 白名单语义，非新 spawn 面 | 写入 §4 L0 |
| **N9** | Claude | v1 审计表 `apply_*` 要么推迟到 Phase D，要么 v1 仅 `policy_violation` | 澄清 §6.4 |
| **N10** | Pi | 审计 retention / 0o600 与谁可读 | 未来 ADR 补 |

**Blocking for Phase A impl:** N1 wording, N5 (merge path), N8 (CLI open scope).  
**Blocking for Phase B code:** N2, N3, N6, N7 (+ original Q1/Q3/Q6/Q8).

---

## Ship gating (agreed)

| Stage | After dual-review? |
|-------|--------------------|
| Phase A design SoT + fold nits into decision doc | **Yes** |
| Phase A impl (Pack/skill/export/copy; optional CLI open as scoped) | **Yes** after N1/N5/N8 folded |
| Phase B ACP protocol code | **No** until Accepted ADR + Q-gate + numeric demand + N2/N3 |
| Phase C/D propose/apply | **No** — separate dual-review required |

---

## Bottom line

> **both_ok**: 产品方向与分期通过。先做无协议的「编程任务包」；全量 ACP Client 仍是条件解锁。最高优先级诚实点是：**会话模式 ≠ 外部进程写盘担保**。

---

## Follow-up (post dual-review)

**2026-08-13**：产品 SoT 增补 **[§5.7 UX Consistency Contract](acp-coding-handoff-product-design-2026-08-13.md#57-ux-consistency-contract实现--pr-硬附件)** — 八条宪法、组件对标、Phase A/B 线框清单、PR checklist、ship slices。实现与后续 dual-review 以该节为 UI 硬门禁。
