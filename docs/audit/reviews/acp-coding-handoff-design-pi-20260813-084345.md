## 1. Summary

This batch contains **no production code** — `git diff`/`git diff --cached` are empty; the deliverable is a single untracked design synthesis, `docs/decisions/acp-coding-handoff-product-design-2026-08-13.md`, plus review scaffolding. The design is honest, well-phased, and correctly anchored to ADR-020: it places ACP as **Composition** (pack + optional client + task-package export), bans 中层 Agent / second runtime / new bottom tab, keeps Autonomy single-thread (never `spawn_worker`/Board/worker-ACP), and stages write as Phase D NO-GO-by-default. The dual-facade tension with Outbound MCP (ADR-022) is explicitly separated in §8 and gated by §9 Q1/Q3/Q6/Q8. Phase A (task-package export, zero ACP) is the safe, falsifiable recommended slice with concrete Week-1 signals. I find no blocking issue; several honesty/forward-gate nits remain.

## 2. Blocking issues

None.

## 3. Nits (prioritized, non-blocking)

1. **§5.4 "只读" badge is ambiguous about process-level writes (highest product-trust gap).** The badge + trust bar say "只读 / 可写 徽章", but a spawned external agent is a *separate process with its own filesystem access* — ACP protocol capability "readonly" is advisory, not a sandbox. The doc partially acknowledges this in §4 L3 ("外部 Agent 自写盘 · CMspark 只展示结果") and the §7 kill-line "无法强制只读", but the user-facing microcopy should carry the honesty framing verbatim: "只读 = 协议能力只读；外部进程自身仍可写盘，CMspark 不承诺沙箱". Otherwise UI says 只读 while disk writes happen — exactly the "不知道谁写了磁盘" failure the Week-1 criteria (§2.3) claim to prevent. Fix in doc, not code.

2. **§7 future ADR must commit to `originWs` + confirm-family reuse.** `acp_propose_session`(L2) is a *new confirmation surface*; ADR-020 anti-pattern #2 and the P1-2 watchlist both require reusing the existing `SecurityConfirmationManager` family and binding `{ originWs: ws }` on any new `request()`. The doc says only "L2 确认启动" without naming the family or the originWs discipline. Add a one-line MUST to §9 (or §7) so the future ACP ADR cannot introduce a third confirm dialect.

3. **§4 L2 disclosure parity with ADR-022 L3+ is flagged but not mechanized.** §9 Q6 asks the right question, and §5.6 microcopy is honest ("可能再上云"), but the doc does not commit to *server-side session-state enforcement* of `disclosure_accepted`. ADR-022 L3+ explicitly requires "须由 Companion 会话状态强制，不得仅信任 [caller] 参数自报" — the ACP client path (where the *external agent* could self-report disclosure) must inherit the same rule, or Phase B undercuts ADR-022's parity. Fold this into §9 Q6 as a hard requirement, not just a question.

4. **§8 Phase A "可选唤起 CLI" is an un-scoped local-action path.** "可选 `open` 本机 CLI（feature-detect，失败仅复制）" launches a local process. It's low-risk, but the repo already has `host_app`/`host_cli` with strict whitelist/typing. The doc should note this reuses `host_app` whitelist semantics or stays a pure copy-fallback — not a new spawn surface — to avoid a later reviewer flagging it as an un-gated exec.

5. **§6.4 audit set lacks a retention/authorization note** (who can read `acp.*` events, 0o600-style, mirroring ADR-022's audit spec). Minor; add when the future ADR lands.

## 4. Capability checklist (ADR-020)

| Check | Result |
|-------|--------|
| Declaration present (§3 + review task) | ✅ Present and correct |
| Axes fit — Composition, not 中层 Agent/runtime | ✅ Pass (§3, §7 module `companion/src/acp/` mirrors inbound MCP client lifecycle) |
| Pack-first — Phase A = Pack/skill, no new bottom tab | ✅ Pass (§4 L0, §5.1 禁止) |
| No new confirm dialect | ⚠️ Not yet specified (nit 2) — future ADR must name the family |
| Trust monotonicity — no auto_approve/无人值守 skip ACP | ✅ Pass (§6.1 "Never", §7 lifecycle HITL) |
| originWs on new confirms | ⚠️ Deferred to future ADR (nit 2) — no code today, so not blocking |
| No new runtime / no Autonomy pollution | ✅ Pass (single-thread handoff; worker-ACP Never §6.1) |
| Experimental layers not on write path | ✅ Pass (write = Phase D NO-GO; Phase A/B are export/readonly) |

Pure docs batch → missing-originWs is non-blocking; declaration present so no checklist blocker.

## 5. Ship recommendation

- **Phase A (task-package export, no ACP): APPROVE as SoT** — safe, falsifiable, correctly gated by Q1/Q3/Q6/Q8 *before* any ACP protocol code (§9). Nothing here blocks starting Phase A.
- **Phase B (readonly ACP): conditional** — only after Phase A demand signals + Q1/Q3/Q6/Q8 answered + nits 1–3 folded into the future ACP ADR.

VERDICT: APPROVE_WITH_NITS
