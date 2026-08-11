I've verified the spec against the actual code. Now I'll write the review.

---

# Dual external review — Side Panel 「精密仪器台」 redesign **design**

**Batch:** `sidepanel-precision-instrument-design` · **Stage:** Design gate · **Date:** 2026-08-11

## Capability declaration check

The spec includes a full ADR-020 declaration:

```text
Surface:      L0 Panel chrome (+ visual L1/L2 badges; no new L2 tools)
L2-classes:   (none new)
Compose:      none (装配 entry chrome only)
Autonomy:     none (Fleet/Board presentation only)
Trust:        no elevation; 急停/确认视觉权重不得降低
Channel:      unchanged
```

Surface correctly anchored (L0 chrome only); no new tools, no new L2 classes, no new gates, no new Pack. Declaration matches the artifact (design doc, no code). **No declaration issue.** `[inspected]`

## Patch freshness

`git status --short` matches the diff header exactly (same `M`/`??` set, same base `f6ed181`). Patch is current. Note: the diff body is the **repo's other in-flight work** (icons, thread-graph tab, host-integrity hash bump) — not the design's own implementation. This is a **design-gate** review; the artifact under review is `docs/superpowers/specs/2026-08-11-sidepanel-precision-instrument-redesign.md`, not a code diff. `[executed]`

## Diagnosis — spot-checked against real code

| Claim in spec §0 | Verified in repo |
|---|---|
| Canvas gradient on shell | `App.tsx:1692` — `linear-gradient(180deg, ${tokens.bg} 0%, #eef0f6 100%)` ✓ `[inspected]` |
| Glass blur on composer | `App.tsx:1700–1701` — `backdropFilter: "blur(14px)"` + `WebkitBackdropFilter` ✓ |
| Dual-shadow on composer capsule | `App.tsx:1714` — `${tokens.shadowMd}, 0 0 0 1px rgba(255,255,255,0.8) inset` ✓ |
| `radiusComposer` / `radiusBubble` 18 | `tokens.ts:76–77` ✓ |
| `radiusSheet` 20 | `tokens.ts:79` ✓ |
| Empty-title 18px | `ChatView.tsx:1616` — `emptyTitle: { fontSize: 18 }` ✓ |
| Purple→blue gradient on send | `App.tsx:1751` — `linear-gradient(145deg, ${tokens.accent} 0%, ${tokens.accentHover} 100%)` ✓ (the spec bans this in §5 but the §4 token-delta table omits it — see nit N3) |

Diagnosis is **factually grounded**, not hand-wavy. `[inspected]`

## Phase 1 vs density budget — no conflict

Density budget (`sidepanel-density-budget-20260811.md`) is a static budget keyed off constants: StatusRail 44 / FocusBand 80 / Scene/RunBusy/Worker 28 / InputArea 44–120 / chips ≤40. Phase 1 token refresh changes **colors, radii, shadows, and bg** — **no height constant is touched**. P1-5 ("shared horizontal padding 12; hairline separators") is purely cosmetic and doesn't change `minHeight`/`maxHeight`. Both L0 idle (72.2% ≥ 55%) and worst-case (45.8% ≥ 40%) remain PASS. `[inspected]`

## Rejection gates

| # | Gate | Status |
|---|---|---|
| R1 | Weakens 急停/confirm visibility | **Not triggered.** Capability decl explicit "急停/确认视觉权重不得降低"; §6 acceptance R4; Cockpit (L2) is a separate surface not in Phase 1. |
| R2 | Graph/timeline default wrong or invents L2 tools | **Not triggered.** Graph stays full-page tab (already shipped). Spec §2 keeps timeline + thread list grammar. No new L2 tools. |
| R3 | Persuade/marketing aesthetic | **Not triggered.** §5 explicitly bans purple→blue gradients, `backdrop-filter` on shell, emoji in chrome, 18px titles. Matches PRODUCT.md anti-references. |
| R4 | Phase 1 includes Settings rewrite as blocking | **Not triggered.** §3 Phase 1 "Out of Phase 1: SettingsSlideout full rewrite, MCP/Apps hex purge (Phase 2)." |

**No blocking issues.**

## ADR-020 checklist

| # | Check | Result |
|---|---|---|
| 1 | Axes fit (Surface vs Compose vs Autonomy) | ✓ — correctly anchored on Surface (L0 chrome) |
| 2 | Pack-first for scenarios | ✓ — no scenario/Pack added; visual only |
| 3 | Confirm dialects | ✓ — no new confirm family; existing L2/Cockpit untouched |
| 4 | Trust monotonicity | ✓ — Trust decl: "no elevation"; 急停 weight preserved by R4 |
| 5 | originWs | n/a — no `securityConfirmations.request` change |
| 6 | No new runtime | ✓ — tokens + shell styles only |
| 7 | Experimental layers | n/a — no TinyClick / locator change |

## Nits (non-blocking — list for implementer)

- **N1 — `bg` delta is cosmetic theater.** §4 proposes `#f5f6fa` → `#f4f5f8` (a single-step blue shift, indistinguishable at 320px). Either commit to a real tonal shift or drop the change — churn cost > visual value.
- **N2 — `shadowMd` proposal is structurally identical to current.** §4 calls the current shadow "dual heavy" but proposes another two-layer shadow (`0 1px 3px … , 0 4px 12px …`). The actual "card cage" feel comes from the **inset ring** on `composerCapsule` (`0 0 0 1px rgba(255,255,255,0.8) inset` at `App.tsx:1714`), not the outer shadow. Spec should distinguish: "outer elevation kept + simplified; **inset highlight ring removed**." Otherwise the implementer may keep the inset ring and miss the actual fix.
- **N3 — `sendBtn` gradient + decorative shadow omitted from §4 table.** §5 bans "purple→blue gradients on send," but the §4 token-delta table doesn't list `sendBtn.background` flatten (→ single `tokens.accent`) or `sendBtn.boxShadow` (`0 2px 8px rgba(79,70,229,0.35)` at `App.tsx:1759`) cleanup. Implementer could miss these as out-of-scope.
- **N4 — `emptyTitle` 18→15 not in token-delta table.** §1 declares scale "11/12/13/15 only," but the §4 table has no `ChatView:emptyTitle.fontSize` row. Easy to miss in implementation.
- **N5 — Chip-row height ceiling not pinned.** Density budget caps chips at ≤40px; P1-2/P1-5 talk about padding/radius but don't carry the ≤40 ceiling forward. Implementer could grow chip padding and bust Scenario B (45.8% → ≤45%).
- **N6 — `transition` tightening deferred to Phase 3 but no Phase-1 freeze statement.** Spec implies Phase 1 leaves 150/220ms alone; should be explicit so a P1 implementer doesn't sneak motion changes into the shell PR.
- **N7 — R6 acceptance check could name the budget doc path.** `docs/audit/reviews/sidepanel-density-budget-20260811.md` — implementer should re-run the static budget against Phase 1 token changes (and call out any constant edit) before merge.

## Scope

Design-only. Phase 1 is tokens + `App.tsx` shell (`container`/`inputArea`/`composerCapsule`/`sendBtn`) + `StatusRail` density + `ChatView` empty/bubble + `FocusBand` padding. No new tools, no new L2 classes, no Pack, no Autonomy change, no Cockpit rewrite. **Honors PRODUCT.md §"Constraints (non-negotiable)"** in full. `[inspected]`

## Summary

Design is sound, grounded, and gates correctly. Operate / Restrained direction is the right call for a daily-driver power-user panel; phasing (shell → secondary → polish) lets the user feel "this looks serious" without blocking on a Settings rewrite. ADR-020 declaration present and accurate; no rejection gate triggered; density budget unaffected. Nits are implementer-clarity issues — addressing them up front will prevent Phase 1 from drifting into Phase 2 territory or missing the actual fixes (inset ring on composer, send-btn gradient).

VERDICT: APPROVE_WITH_NITS
