Patch freshness confirmed — `2a6797b` is HEAD, file stat matches, no thread-graph/host-integrity/icons leakage. Tests green (`615 pass / 0 fail`). Writing review now.

---

# Dual external review — Side Panel 「精密仪器台」**Phase 1 implementation**

**Batch:** `sidepanel-precision-instrument-p1-impl` · **Stage:** Impl gate · **Date:** 2026-08-11  
**Commit:** `2a6797b feat(ui): Side Panel Precision Instrument Desk Phase 1 shell`  
**Design gate:** both APPROVE_WITH_NITS (`sidepanel-precision-instrument-design-verdict-20260811-203708.json`)

## Capability declaration check

Prompt carries the required ADR-020 declaration (Surface L0; no L2/Compose/Autonomy/Trust/Channel change). `[inspected]` Diff scope matches: pure visual — tokens + shell styles + DESIGN.md + design-gate artifacts. No new tools, no new gates, no `securityConfirmations.request` change, no `originWs` regression surface. **Declaration present and accurate.**

## Patch freshness

- `git status` matches the diff header exactly (clean tree, three new review artifacts). `[executed]`
- `git show --stat 2a6797b` confirms the impl commit touches **only** the listed Phase 1 files: `tokens.ts`, `App.tsx`, `ChatView.tsx`, `FocusBand.tsx`, `StatusRail.tsx`, `tokens-helpers.test.ts`, `PRODUCT.md`, `docs/DESIGN.md`, plus design-gate paperwork. **No thread-graph, host-integrity SHA, or icon-regen leakage** → B2 clear.

## Acceptance spot-checks (re-checked from current code)

| # | Check | Result |
|---|--------|--------|
| R1 | No glass composer / no canvas gradient | ✓ `App.tsx:1693` container `background: tokens.bg` (solid); `App.tsx:1700` inputArea `background: tokens.bgElevated` (no `backdrop-filter`); grep for `backdrop-filter\|backdropFilter\|WebkitBackdropFilter` in `sidepanel/` → 0 hits. `[executed]` |
| R2 | Type scale 11/12/13/15 in StatusRail + empty + composer | ✓ mostly — empty title 15 (`ChatView.tsx:1616`), composer textarea 13 (`App.tsx:1721`), StatusRail body 11/12/13. **Two stragglers:** `brandMark fontSize: 9` (`StatusRail.tsx:463`) and `cruiseX fontSize: 10` (`StatusRail.tsx:505`) — see nit N2. |
| R3 | Send = solid accent; mode remains chip | ✓ `App.tsx:1750` `sendBtn.background: tokens.accent` (no gradient), `color: tokens.userBubbleText`. ModeBadge still chip; no full-rail fill introduced. |
| R4 | FocusBand confirm/急停 intact | ✓ `FocusBand.tsx:247` `cardConfirm.background: tokens.dangerSurface` preserved; `border: 1px solid rgba(220, 38, 38, 0.28)` preserved; `abortLine` / `abortBtn` (`FocusBand.tsx:265–304`) intact. B1 clear. |
| R5 | `npm --prefix chrome-extension test` green | ✓ `[executed]` **615 pass / 0 fail** in 9.35s — but the implementer prompt claims 622. See nit N1. |
| R6 | Density budget heights unchanged; chip ≤40 noted | ✓ No `minHeight`/`maxHeight` constant edits in this PR (StatusRail 44 / textarea 44–120 / FocusBand 80 / chip row ≤40 unchanged). `docs/DESIGN.md` "Chip row height ceiling: ≤40px (density budget Scenario B)" line added. |

## Design-dual nit absorption (N5–N7)

- **N5 (chip ≤40 ceiling)** — reflected: `docs/DESIGN.md` line added under Input/Composer section. ✓
- **N6 (motion freeze)** — reflected: `tokens.ts:1-4` header "Motion left at 150/220ms in Phase 1 (tighten in Phase 3)"; `tokens.ts:69` comment "Phase 1 freeze — Phase 3 may tighten"; `DESIGN.md` Motion section restated. ✓
- **N7 (budget cross-ref)** — partially: `DESIGN.md` now points to the redesign SoT and notes Phase 1, but doesn't carry an explicit "no height constant delta → budget re-run not required" line. See nit N3.

## Rejection gates

| # | Gate | Status |
|---|------|--------|
| B1 | Weakens 急停/confirm | **Not triggered** — `dangerSurface` fill, confirm border, abort line/button all preserved (see R4). |
| B2 | Ships Thread Graph / host-integrity / unrelated | **Not triggered** — impl commit is clean (see Patch freshness). |
| B3 | New L2 tools / trust elevation | **Not triggered** — pure visual. |
| B4 | Residual glass / `backdrop-filter` / canvas gradient | **Not triggered** — grep clean, container solid. |
| B5 | Token contract broken without test update | **Not triggered** — `tokens-helpers.test.ts` updated to assert `bg #f4f5f8`, `radiusComposer 14`, `radiusBubble 14`, `radiusSheet 16`, `radiusMenu 10`; all assertions pass. |

## ADR-020 checklist

| # | Check | Result |
|---|--------|--------|
| 1 | Axes fit | ✓ Surface L0 only; no Compose/Autonomy conflation. |
| 2 | Pack-first | n/a — no scenario added. |
| 3 | Confirm dialects | ✓ — no new confirm family; existing L2/Cockpit untouched. |
| 4 | Trust monotonicity | ✓ — no trust change; 急停 weight preserved. |
| 5 | originWs | n/a — no `securityConfirmations.request` change. |
| 6 | No new runtime | ✓ — tokens + style objects only. |
| 7 | Experimental layers | n/a. |

## Must answer

1. **Phase 1 only + token table match?** Yes. `tokens.ts` deltas exactly match SoT §4 (`bg #f4f5f8`, `radiusComposer/Bubble 14`, `radiusSheet 16`, single-soft `shadowMd`); `App.tsx` container/inputArea/composerCapsule/sendBtn match §5 anti-pattern bans; no Phase 2/3 territory entered.
2. **N5/N6/N7 reflected enough for merge?** N5 ✓, N6 ✓, N7 partial (N3 below).
3. **FocusBand change padding/shadow only — 急停 path intact?** Confirmed. `outer` padding horizontal 10→12 only; `cardShell` swapped `radius 16 → tokens.radiusLg` (12) and `shadowMd → shadowSm`. `cardConfirm`/`abortLine`/`abortBtn` semantics untouched. B1 not triggered.
4. **Over-claim or missing DESIGN.md sync?** One over-claim (test count, N1) and one missing cross-ref line (N3). DESIGN.md sync is otherwise accurate.

## Nits (non-blocking)

- **N1 — Test count over-claim.** Implementer prompt says "implementer claims 622 pass"; actual run is `tests 615 / pass 615 / fail 0 / duration 9.35s`. `[executed]` Green, but the count is off by 7 — likely a stale copy-paste from a prior run. Update prompt or PR description to match.
- **N2 — R2 type-scale has two stragglers in StatusRail.** `StatusRail.tsx:463` `brandMark fontSize: 9` and `:505` `cruiseX fontSize: 10`. Both are icon-sized glyphs (single letter inside an 18px badge; "×" close symbol on the cruise pill), not body chrome. Pi's design review flagged the ambiguity but did not call it blocking. Suggest: either normalize to ≥11, or add a one-line exemption to `docs/DESIGN.md` §Type Scale ("icon-sized glyph inside ≤20px badge exempt").
- **N3 — R6 / N7 budget cross-ref line missing.** `docs/DESIGN.md` mentions Phase 1 freeze and chip ≤40 ceiling, but doesn't carry an explicit "Phase 1 = token/style only; no `minHeight`/`maxHeight` constant delta; density budget re-run not required" line. A one-liner would close the loop for any future reviewer checking R6 without re-reading the spec.

## Summary

Phase 1 implementation is sound, grounded, and bounded. Token deltas match the design SoT exactly; glass/gradient are fully purged from primary shell; FocusBand confirm/急停 weight preserved; tests updated and green. Capability declaration present and accurate; no ADR-020 rejection gate triggered; no scope creep into Phase 2/3 territory or unrelated batches. Nits are over-claim hygiene (N1) and minor type-scale/budget-doc polish (N2, N3) — none block merge.

VERDICT: APPROVE_WITH_NITS
