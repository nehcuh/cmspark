# Delta IMPLEMENTATION review — P0+P1 must-fix only

You are an independent senior **product + extension systems** reviewer. This is a **delta review** of fixes applied after dual `APPROVE_WITH_FIXES`. Do not implement code. Do not re-litigate the whole redesign unless a fix re-breaks it.

## Context

- Branch: `feat/ui-mode-p0`
- Prior reviews (both `APPROVE_WITH_FIXES`):
  - `docs/audit/reviews/ui-mode-p0p1-impl-claude-20260726-153051.md`
  - `docs/audit/reviews/ui-mode-p0p1-impl-pi-20260726-153051.md`
  - Synthesis: `docs/decisions/v1.3/ui-mode-p0p1-impl-review-synthesis-2026-07-26.md`
- Fix commit (primary): `c502eea` — `fix(ui): address P0+P1 dual-review must-fixes`
- Spec: `docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md` §6 P0/P1 + D9′–D16

## Must-fix checklist (verify each)

| # | Claimed fix | Primary files |
|---|-------------|---------------|
| 1 | Cockpit hydrates computerTask + pending confirms from SW mirror | `background/computer-task-mirror.ts`, `cockpit/CockpitApp.tsx` CockpitBoot, `agentStore` HYDRATE_*, `background/index.ts` cockpit.hydrate |
| 2 | Panel hard-gates chat.send while L2 task running/paused | `App.tsx` InputArea canSend / handleSend |
| 3 | Cockpit nonce anti-paste parity (keydown/context/drop) | `cockpit/CockpitApp.tsx` ConfirmElevated |
| 4 | openOrFocusCockpit in-flight mutex | `background/cockpit-window.ts` |
| 5 | Confirm focus background-driven (no Cockpit self-focus) | `CockpitApp.tsx` (removed self-focus), `background/index.ts` openOrFocus on confirm |
| 6 | ConfirmElevated session/thread trust checkboxes | `CockpitApp.tsx` |
| 7 | Panel full SecurityConfirmationDialog 60s auto-deny | `App.tsx` SecurityConfirmationDialog |
| + | MinimalConfirm disables Allow when nonce required | `MinimalConfirm.tsx` |
| + | SW-death window id documented | `cockpit-window.ts` header, `docs/DESIGN.md` |

## How to review

1. `git show c502eea --stat` and read the full patch for that commit (and any later related commits on the branch if present).
2. Read the listed files for correctness (not just “code exists”).
3. Attack: residual races, hydrate incomplete, gate bypass, nonce still pasteable, double-window, trust not sent, timeout not wired to decide(false).

## Output format

```markdown
# Delta Review: P0+P1 Must-Fixes

## Verdict
One of: APPROVE_IMPL | APPROVE_WITH_FIXES | REJECT_REWORK

## Summary
(3–8 sentences)

## Checklist
| # | Status Met/Partial/Miss | Notes |

## Residual blockers (if any)
(numbered)

## Residual nits / P2
(bullets)

## Answers
- Are prior must-fixes closed enough for product owner confirmation?
- Any new regressions introduced by the fix commit?

VERDICT: <same>
```

End with exactly one line: `VERDICT: APPROVE_IMPL` or `VERDICT: APPROVE_WITH_FIXES` or `VERDICT: REJECT_REWORK`.
