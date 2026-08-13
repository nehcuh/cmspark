I have enough grounding to render an independent verdict. The patch file contains only untracked docs (no code change); `companion/src/acp/` does not exist yet; the design's grounding references (cli-q5.ts taint, l2-admission.ts originWs binding, mcp/manager.ts lifecycle, outbound-mcp/* module) all check out.

---

# Dual Review — 编程接力 / ACP coding-agent handoff product design

## 1. Summary

- **Nature confirmed**: this is a design/product synthesis review, not a code batch. The diff (`acp-coding-handoff-design-diff-20260813-084345.patch`) contains **only** untracked docs/prompt files; `companion/src/acp/` does **not** exist. No production trust surface is added by this batch.
- **ADR-020 fit is strong**: 编程接力 is placed on the **Composition** axis (Pack + optional ACP client + task-package export), **not** Surface or Autonomy. The doc explicitly bans "中层 Agent / 第二 runtime / ACP 面板 / 内置 Claude Code" language (§0) — the exact anti-pattern ADR-020 §2/§3 warns against.
- **ADR-022 symmetry is correctly identified**: Outbound = coding agent → CMspark browser; 接力 = CMspark browser → coding agent. The doc mandates loop isolation (§6.2: no token cross-injection, `handoff_depth ≤ 1`, `acp.loop_blocked` audit).
- **Trust gates are conservative and pattern-reuse over invention**: HITL session start, `acp.enabled=false` default, `acp_propose_session` is L2, handback framed `<<<UNTRUSTED_ACP_HANDBACK>>>`, Q5-style thread taint on handback (mirrors verified `companion/src/apps/cli-q5.ts`). apply / shell-in-agent / auto-spawn / worker-ACP = **NO-GO v1** (§6.1, §10). Trust monotonicity preserved.
- **Hero JTBD is real and CMspark-unique**: logged-in staging/SSO/PR-page evidence → local code action. Playwright/clean-profile cannot replicate. Phase A scope (Pack + skill + slash + Markdown export, ~1–2w, zero protocol tax) is well-bounded.
- **Phasing is honest**: Phase A thin task-package → Phase B RO ACP (gated by real Phase A reuse) → Phase C propose-diff → Phase D apply NO-GO v1. §9 lists 12 must-answer questions with Q1/Q3/Q6/Q8 explicitly blocking before any ACP protocol code.
- **Architecture placement is consistent**: `companion/src/acp/` parallel to existing `mcp/`, `outbound-mcp/`, `apps/` (verified). Tools shaped `propose / collect / cancel` — no free-fire `run`. Workspace realpath containment + hash-pin adapter mirror MCP stdio precedent.
- **No blocking issues found.** Seven non-blocking nits below.

## 2. Blocking issues

None. The design is sound as a product SoT for Phase A; no production code or trust surface is added by this batch.

## 3. Nits (non-blocking, prioritized)

1. **(checklist completeness)** §3 capability declaration block is missing the `L2-classes:` line that the dual-review checklist template requires. The prompt's quoted declaration includes `L2-classes: (none default Phase A/B); future apply would be L2-class side effects` but the doc's actual block (lines 79–83) omits it. Add `L2-classes: (none)` for template fidelity.
2. **(originWs — P1-2 watchlist)** §6/§7 should explicitly state that `acp_propose_session`'s L2 confirm binds `{ originWs: ws }`. The doc implies this by saying "对齐 host_cli Q5" but never names originWs. Verified `companion/src/tool/l2-admission.ts:1166–1169` binds `originWs` on non-outbound calls; Phase B ACP must follow the same rule, not regress to outbound-style unbound fan-out. One sentence in §7 suffices.
3. **(dynamic-workflow overlap — resolve before Phase A ships)** §4 L0 says "扩展现有 `dynamic-workflow` Prompt Chain，零新协议税", but §8 Phase A deliverables list a new "Pack / skill：编程接力 + 任务包 Markdown 模板", and §9 Q9 leaves "merge or dual-track" open. If Phase A ships a parallel Pack, users get **two** prompt-chain generators (verified `companion/builtin-skills/dynamic-workflow.md` already ships a Prompt Chain mode that emits structured Claude Code prompts). Recommend resolving Q9 in favor of **extending dynamic-workflow** before Phase A impl begins; otherwise the ADR-020 §7 "一级 UI 入口数 / 新 runtime" hygiene metric rots.
4. **(Trust badge wording — residual-write UX)** §5.4 proposes a "只读 / 可写" badge in the trust bar. Since the external agent is a separate OS process the user launched, CMspark cannot actually enforce read-only-ness of that process — "只读" will be read as a permission guarantee and mislead. §1 仲裁2 already acknowledges the external agent may self-write. Recommend relabeling to **会话模式: 审查 / 起草** (mode label) and adding a tooltip "会话模式 ≠ 外部进程权限担保".
5. **(Phase B gate is qualitative)** §8 Phase B condition is "仅当 Phase A 有真实复用" with no numeric threshold. §2.3 lists Week-1 signals (≥3 uses, <15 min, ≥2 working days) but no multi-user / durability bar. Recommend pinning a numeric gate (e.g., ≥X threads with ≥Y handoffs over 14 days, post-cooldown) so the "is there real demand?" decision is not made by the team that built it.
6. **(Lock Phase B ADR requirement)** §11 says "协议细节以未来 ADR 为准" but does not explicitly say "no ACP protocol code lands before that ADR is Accepted". §9's Q1/Q3/Q6/Q8 blocking gate is good but should also name the ADR prereq as a MUST, so a future eager implementer cannot skip it.
7. **(Audit field naming)** §6.4 audit minimum set includes `apply_*` — but §6.1/§10 make apply NO-GO v1. Either drop `apply_*` from the v1 audit set (and add it when Phase D lands) or clarify it's a forward-compat field that always logs `policy_violation` in v1. Minor; prevents confused audit readers.

## 4. ADR-020 capability checklist — pass/fail notes

| Check | Result | Note |
|-------|--------|------|
| Axes fit (Composition vs Surface vs Autonomy) | ✅ pass | Correctly placed on Composition (doc §3). No "中层 Agent" language anywhere; §0 explicitly bans it. |
| Pack-first | ✅ pass | Phase A primary deliverable is Pack + skill + slash. §5.1 forbids new bottom tab; "场景级" entry limited to the 编程接力 Pack. |
| Confirm dialects | ✅ pass | Reuses L2 admission + Q5 taint; no new confirmation family invented. |
| Trust monotonicity | ✅ pass | §6.1: auto_approve / 无人值守跳过 = Never; god-mode may not skip ACP L2; Worker禁ACP (prevents autonomy-pollution). |
| originWs on new confirms | ⚠️ nit | Implied via "对齐 Q5" but not stated. See nit #2. |
| No new runtime | ✅ pass | ACP is a Composition client tool, not an agent framework. Single tool-loop preserved. |
| Experimental layers on write paths | N/A | v1 has no write path; RO + propose only. |
| Capability declaration present | ⚠️ nit | Present in §3 but missing `L2-classes:` line. See nit #1. |

P1 watchlist (from checklist): P1-1 god-mode step-up — N/A (no `config.set` / `auto_approve_*` change); P1-2 originWs — nit #2; P1-3 evaluate integrity — N/A; P1-4 shell structure — N/A (shell-in-agent banned v1).

## 5. Ship recommendation

**Phase A (编程任务包)**: ship as SoT. Low-risk Pack + skill + slash + Markdown export. Zero protocol tax, zero spawn, zero apply. Recommend resolving nit #3 (dynamic-workflow merge) during Phase A impl, not after.

**Phase B (RO ACP)**: **do not** start until (a) a future ADR is Accepted, (b) §9 Q1/Q3/Q6/Q8 are answered in writing, (c) Phase A hits the numeric reuse gate (nit #5). The design's gates are correct; this review only tightens the gate's audibility.

**Phase C/D (propose-diff / apply)**: design's NO-GO v1 stance is correct. Do not lift without a separate dual-review.

VERDICT: APPROVE_WITH_NITS
