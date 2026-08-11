All checks complete. Full review follows.

---

# Dual external review — Side Panel 「精密仪器台」Phase 1 implementation

**Batch:** `sidepanel-precision-instrument-p1-impl` · **Commit:** `2a6797b` vs `f6ed181` (origin/main) · **Date:** 2026-08-11

## Patch freshness — verified

`git status` / `git log` confirm working tree is clean of graph WIP. `git diff f6ed181 2a6797b --stat` matches the patch header exactly (14 files, +1185/−98). **Patch is current, not stale.** Thread-graph files (`background/thread-graph.ts`, `tabs/thread-graph.tsx`) do **not** exist in the tree; `companion/src/host-use/darwin/host-integrity.ts` still carries the old SHA (`1d9ac27e…`, line 54) — the host-integrity bump appears only as text inside the committed design-gate *review artifact*, never as code.

## Must-answer questions

**1. Phase 1 only, matching design §4 token table?** Yes, verified in real files:
- `tokens.ts:17` `bg #f4f5f8`; `radiusComposer/radiusBubble 14` (~74), `radiusSheet 16` (~76), `radiusMenu 10` (~77); single soft shadow ladder (~70–72) ✓
- `App.tsx:1693` container `background: tokens.bg` (solid, gradient gone — R1) ✓
- `App.tsx:1700` inputArea solid `bgElevated`, **no** `backdropFilter` (R1/B4) ✓
- `App.tsx:1712` composerCapsule `boxShadow: tokens.shadowSm` — inset white ring removed (design nit N2 addressed) ✓
- `App.tsx:1719` textarea `fontSize: 13` (was 14, now on scale) ✓
- `App.tsx:1751` sendBtn `background: tokens.accent` solid, no gradient/shadow (R3; nit N3 addressed) ✓
- `ChatView.tsx:1619` emptyTitle `fontSize: 15` (not 18; nit N4 addressed); empty 13 / kicker 11 / hint 13 / chips 11 ✓
- `StatusRail.tsx:449` solid `bgElevated`, no glass; `minHeight: 44` **kept** (density constant untouched — R6) ✓

**2. N5/N6/N7 reflected?** N5 — `docs/DESIGN.md:149` "Chip row height ceiling: ≤40px (density budget Scenario B)" ✓ (chip row `ComposerChips.tsx` fontSize 11, untouched). N6 — `tokens.ts` "Motion (Phase 1 freeze…)" + `docs/DESIGN.md:157` explicit 150/220ms freeze ✓. N7 — Scenario B named, constants verified untouched (`minHeight`/`maxHeight` zero code-diff hits); budget doc *path* not named in DESIGN.md (minor, see nits).

**3. FocusBand padding/shadow only, 急停 intact?** Confirmed. `FocusBand.tsx:226–243` — `cardShell` radius→`radiusLg`/`shadowSm`, `outer` padding `"2px 12px 0"`. No height change (`FOCUS_BAND_MAX_PX` untouched). Confirm/abort machinery intact: `cardConfirm` still `background: tokens.dangerSurface` (line 247), secondary 急停 row present (lines 180–215), `dangerSurface` still in `tokens.ts:36` and asserted in `tokens-helpers.test.ts:114` (B1 clear).

**4. Over-claim / DESIGN.md sync?** DESIGN.md synced (composer no-glass, 14/16 radii, type scale, status-first hierarchy). One over-claim: prompt says "implementer claims **622 pass**" — actual run is **615 pass / 0 fail** (R5 green, count wrong by 7).

## Rejection gates

| Gate | Result |
|---|---|
| B1 急停/confirm weakened | **Not triggered** — dangerSurface + abort row + FOCUS_BAND_MAX_PX all intact |
| B2 Thread Graph / host-integrity / unrelated shipped | **Not triggered** — zero unrelated code; only docs text inside review artifacts |
| B3 New L2 tools / trust elevation | **Not triggered** — L0 chrome only; ModeBadge untouched (0 diff lines) |
| B4 Residual glass / canvas gradient | **Not triggered** — zero `backdrop-filter` in App/ChatView/StatusRail; only remaining gradients are dark L2 confirm surfaces (SafetyStrip:269/277, MinimalConfirm:243) kept by design's confirm content-split |
| B5 Token contract without test sync | **Not triggered** — `tokens-helpers.test.ts` updated in lockstep (bg, radii 14/16/10); 615 tests green |

## ADR-020 checklist

Declaration **present** in prompt (Surface L0 Panel chrome / L2-classes none / Compose none / Autonomy none / Trust no-elevation / Channel unchanged) and accurate: (1) axes fit — Surface L0 presentation only ✓; (2) Pack-first — no new scenario/entry chrome ✓; (3) confirm dialects — no new family, MinimalConfirm/SafetyStrip untouched ✓; (4) trust monotonicity — no elevation, FocusBand weight preserved ✓; (5) originWs — n/a, no `securityConfirmations.request` ✓; (6) no new runtime ✓; (7) experimental layers n/a ✓. No P1-watchlist surface touched.

## Blocking issues

None.

## Nits (non-blocking)

1. **Test-count over-claim** — prompt states "622 pass"; fresh run reports **615 pass / 0 fail** (implementer's number is stale by 7). Green either way.
2. **R2 strict-read: sub-scale glyph sizes remain** — `StatusRail.tsx` brandMark `fontSize: 9` and cruiseX `fontSize: 10` are below the 11/12/13/15 chrome scale. Design gate (Pi review nit #2) asked for the micro-label exemption to be *pinned*; the impl didn't pin it, though it did move connLabel 10→11 and cruisePill 10→11 up. Decorative glyphs only — non-blocking.
3. **Design-gate patch artifact embeds other batches' WIP text** — the committed `…design-diff-20260811-203708.patch` contains diff text for thread-graph code and a host-integrity SHA bump (docs only; tree verified clean). Same hygiene nit as design-gate Pi nit #5; may confuse automated greps.
4. **Budget doc path not named** — `docs/DESIGN.md:149` cites "density budget Scenario B" without the SoT path `docs/audit/reviews/sidepanel-density-budget-20260811.md` (nit N7 partially reflected).

## Summary

Phase 1 shell implementation is faithful to the design SoT §3/§4, all four rejection gates and all six acceptance checks pass (tests green, R2/R3/R4/R6 verified from code), and the ADR-020 declaration is present and truthful. FocusBand confirm/急停 safety path is untouched. The only issues are a stale test-count claim and two cosmetic/scope-hygiene nits — nothing blocking.

VERDICT: APPROVE_WITH_NITS
