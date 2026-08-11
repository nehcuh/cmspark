# Dual external review: Side Panel design debt remaining (W4 + residual hex)

**Batch:** `sidepanel-design-debt-remaining`  
**Stage:** Pre-implementation plan gate  
**Date:** 2026-08-11  
**Parent batch:** W1–W3 APPROVE_WITH_NITS and implemented (`sidepanel-design-debt-conditional-go`)

## Capability declaration

```text
Surface:      L0 Panel chrome only
L2-classes:   (none)
Compose:      none
Autonomy:     none
Trust:        no elevation
Channel:      unchanged
```

## Required reading

1. **Primary SoT** — `docs/superpowers/specs/2026-08-11-sidepanel-design-debt-remaining-w4-hex.md`
2. **Parent SoT (context)** — `docs/superpowers/specs/2026-08-11-sidepanel-design-debt-conditional-go.md` (W4 optional + lag note)
3. **Parent dual-review** — `docs/audit/reviews/sidepanel-design-debt-conditional-go-verdict-20260811-164753.json` + Pi/Claude nits on W4
4. **Code spot-check**  
   - Residual hex: `rg '#2563eb|#dbeafe' chrome-extension/src/sidepanel`  
   - Stack: `App.tsx` FocusBand / SceneStatusBar / RunBusyChip / WorkerScopeBar  
   - Caps: `focus-band-priority.ts`, Scene/RunBusy/Worker styles  
5. **Density targets** — `docs/superpowers/specs/2026-07-31-sidepanel-uiux-redesign.md` (≥55% / ≥40% @ 640px)
6. ADR-020 checklist — `docs/audit/reviews/_templates/dual-review-capability-checklist.md`

## Product premise

```text
1. W1–W3 already landed; this batch is remaining follow-up only.
2. W4 = measure first; structural code only if budget fails; no FocusBand redesign.
3. W5 = named residual accent/blue hex → tokens only (BoardPanel, AppsPanel, computer-utils).
4. Still NO-GO: Settings rewrite, ontology rename, polish pass, mass hex of all grays.
5. Static budget calculation is acceptable when live Side Panel is unavailable.
```

## Must answer

1. Is residual `#2563eb` / `#dbeafe` still present as claimed?  
2. Is static density method + surgical-only-if-fail sound vs UIUX v2?  
3. Does W5 stay monotonic (not a full AppsPanel restyle)?  
4. Any scope smuggling (FocusBand/Settings/Board Host entry)?  
5. Acceptance B1–B6 implementable?

### Rejection gates

| # | Gate |
|---|------|
| R1 | SoT false code claims |
| R2 | Requires FocusBand rewrite / Settings restructure / BottomBar re-enable as mandatory |
| R3 | Mass hex migration beyond named accent residues |
| R4 | Trust / L2 tool elevation |

### Output

1. Summary ≤10 lines  
2. Factual spot-check  
3. Blocking  
4. Nits  
5. Scope W4/W5 keep-cut  
6. Exact final line: `VERDICT: APPROVE` | `VERDICT: APPROVE_WITH_NITS` | `VERDICT: REJECT`
