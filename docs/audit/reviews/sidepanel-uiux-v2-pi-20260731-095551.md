Now I have all evidence needed. Let me compile the final review.

---

## Summary

The revised spec (`2026-07-31-sidepanel-uiux-redesign.md`) addresses **all blocking issues** from both adversarial critics (A and B). The author made concrete structural changes: Board removed from 装配, FocusBand converted to a hard state machine with single-slot priority, ContextPanelHost replace-before-remove migration (M1–M4), P0 装配 entry, slash parity matrix (§4.8), Esc/overlay stack (§4.9), metrics scoped honestly (§14), and PR plan resequenced with host extraction before strip deletion. The ontology is ADR-020-compliant. The design is **implementable** for engineers. Remaining issues are nits.

---

## ADR-020 / three-mode fit

| Axis | Fit | Evidence |
|------|-----|----------|
| Surface (A) | ✅ | L0/L1/L2 kept; no new surface; panel-only presentation change |
| Composition (B) | ✅ | 装配 drawer scoped to Skill·Knowledge·Packs·MCP·user-env; label "挂到当前线程 / Surface" prevents "deeper agent" misreading |
| Autonomy (C) | ✅ | Board explicitly excluded from 装配 (§4.5 "Not in 装配"), placed under FocusBand fleet / `/board` / Cockpit |
| Trust | ✅ | Content-split D10′ preserved; no new confirm dialects; abort never adjacent to Send |
| Three-mode D1–D16 | ✅ | D5′/K2′ recorded as intentional IA delta (§2.2); all other D-decisions frozen |
| Pack-first | ✅ | No new primary Panel chrome without Pack path; 装配 is universal Composition entry |
| No "中层 Agent" | ✅ | Copy ban explicit in §2.1, §13, K3 |

**Capability declaration** (from prompt): Complete and accurate. No missing axes.

---

## Adversarial closure check

| Issue | Critic | Closed? | Evidence in revised spec |
|-------|--------|---------|--------------------------|
| A-B1: Board in 装配 | A | ✅ YES | §4.5: "Not in 装配 (Autonomy — Axis C): Board / Fleet / multi-worker" |
| A-B2: FocusBand stacking / height metric gamed | A | ✅ YES | §4.3: hard single-slot priority, ≤80px cap; §14: L0 ≥55%, worst-case ≥40% |
| A-B3: BottomBar no migration map | A | ✅ YES | §4.7: M1–M4 replace-before-remove; §12: PR2 = "ContextPanelHost extract (no strip delete)" |
| A-M1: D5′ not recorded | A | ✅ YES | §2.2: explicit D5′/K2′ as intentional IA delta |
| A-M2: L2 Abort next to Send | A | ✅ YES | §4.4 L2 chips: "(no Abort here)"; K8: "Abort never adjacent to Send" |
| A-M3: alert() overclaim | A | ✅ YES | §14: "No `alert()` on reconnect path (P0); other alerts tracked separately" |
| A-M4: modal/overlay hierarchy undefined | A | ✅ YES | §4.9: Esc/overlay priority stack table |
| A-M5: 装配 over-stuffed for 320px | A | ✅ YES | §4.5: 5 sections only (no Board), one-surface rule, drawer-open waives metric |
| A-M8: PR plan realism | A | ✅ YES | §12 resequenced: PR1 StatusRail → PR2 Host extract → PR3 FocusBand → PR4 chips/slash → PR5 strip removal → PR6 drawer → PR7 Cockpit |
| B-B1: Panel host gap | B | ✅ YES | §4.7: ContextPanelHost named, M1–M4 migration, PR2 extracts host before strip dies |
| B-B2: P0 discoverability cliff | B | ✅ YES | §4.1: "「装配」entry (P0 minimum)"; §8 P0: "装配 P0 entry (section list)" |
| B-B3: FocusBand not state machine | B | ✅ YES | §4.3: hard priority table (P0–P4), hard rules 1–4, 急停 always visible |
| B-M1: Abort near Send | B | ✅ YES | §4.4: no Abort in L2 chips (covered by A-M2) |
| B-M2: slash parity incomplete | B | ✅ YES | §4.8: full parity matrix (9 targets) |
| B-M3: PR sequencing regression window | B | ✅ YES | §12: host before strip removal, ship gate PR1–PR4 before strip deletion |
| B-M4: metrics honesty | B | ✅ YES | §14 scoped: L0/L1+confirm heights separately, alert() P0 only |
| B-M7: drawer landfill re-entry | B | ✅ YES | §4.5: one-surface rule, Board gated, no 6-tab clone |

All 16 adversarial blocking + major issues are **closed** in the revised spec.

---

## Residual risks

1. **FleetStrip `pending > 0` visibility**: B-M5 correctly identifies that any pending confirm forces Fleet chrome. The FocusBand state machine says "Fleet never claims primary over Confirm" (§4.3 rule 2) and "suppress when pending==0 && workers==0" (priority P4) — but the actual code guardrail "remove `pending > 0` from FleetStrip show condition" is **implied** not explicit. Risk: implementer misses this and Fleet still renders a second bar on single-agent confirms. (NIT)

2. **DESIGN.md radius SoT**: v2 says 6/8/12; DESIGN.md says 4/6/8. Spec §8 says PR7 "DESIGN.md semantic roles fully listed" but the radius table isn't named. The migration plan (§12 PR1) says "tokens.ts, DESIGN.md" but acceptance says "connection section rewrite" only. Implementers may ship with two competing radius tables for multiple PRs. (NIT)

3. **DESIGN.md connection Material hexes**: Still live (`#4CAF50/#FF9800/#F44336`). Connection token migration is in PR1 acceptance but the DESIGN.md section is deferred to PR7. For ~4 PRs the doc will contradict the code. (NIT)

4. **Pin mode discoverability regression**: §4.2 moves pin from ModeBadge to ⋯ menu. Critic B flagged this (B-m5). Not addressed — pin is discoverability regression for power users who pin L1 during long sessions. (NIT)

5. **L1 工作区 chip undefined**: §4.4 L1 chip "工作区" has no open target. Critic B flagged (B-m6). Implication is Host → PacksPanel workspace subsection, but not stated. (NIT)

6. **States matrix still nominal**: §5.3 names components but no filled Brad Frost matrix. However, critical state behaviors are covered: FocusBand hard state machine (§4.3), primary flows (§6.1), Esc stack (§4.9). Engineers have enough to implement but a filled matrix would reduce back-and-forth. (NIT)

---

## Blocking

**None.** All blocking issues from adversarial A and B are fully resolved in the revised design.

---

## Nits

| # | Section | Nit | Fix |
|---|---------|-----|-----|
| N1 | §4.3 / code | FleetStrip `pending > 0` visibility rule removal not explicit | Add to §4.3 rule 2: "Remove `pending > 0` from FleetStrip `visible` condition; pending confirm chrome is owned by MinimalConfirm in FocusBand" |
| N2 | §5.2 / DESIGN.md | Radius 6/8/12 vs DESIGN.md 4/6/8 — SoT conflict; PR7 too late for doc sync | Move DESIGN.md radius+connection rewrite into PR1 acceptance explicitly |
| N3 | §4.2 | Pin mode moved to ⋯ = discoverability regression for power users | Either keep pin on ModeBadge (current) or add note: "Pin lives in ⋯; long-press badge → pin considered for v2-P2" |
| N4 | §4.4 L1 chips | "工作区" chip has no defined open target | Add: "工作区 → ContextPanelHost opens PacksPanel at workspace subsection" |
| N5 | §1 | Research section (§1.1–1.2) still leads the design doc | Move to Appendix A; open with §3 pain audit + §2 constraints (A-M9 not addressed) |
| N6 | §5.3 | States matrix named as list only; no filled default·hover·active·disabled·loading·empty·error per component | Add at minimum for 3 components: StatusRail, FocusBand, MinimalConfirm |
| N7 | §12 PR1 | DESIGN.md connection Material hex deletion not in PR1 acceptance | Add to PR1 accept: "DESIGN.md Connection Status section uses status tokens, not `#4CAF50/#FF9800/#F44336`" |
| N8 | §14 / docs | No doc delta checklist for user-facing guides | Add note: "mission-pack-usage.md, confirm-center-user-guide.md, AGENTS.md — update 底栏 references in PR5" |
| N9 | §4.4 L0 chips | "总结本页" in empty state ambiguous (L0 vs L1 semantics) | Clarify: "总结本页 = paste/summarize selection as text (L0 — no CDP tool call)" per ADR-020 |

---

VERDICT: APPROVE_WITH_NITS
