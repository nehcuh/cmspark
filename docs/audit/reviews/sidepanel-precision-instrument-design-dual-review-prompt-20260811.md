# Dual external review: Side Panel 「精密仪器台」redesign **design**

**Batch:** `sidepanel-precision-instrument-design`  
**Stage:** Design gate before Phase 1 code  
**Date:** 2026-08-11  

## Capability declaration

```text
Surface:      L0 Panel chrome redesign
L2-classes:   (none new)
Compose:      none
Autonomy:     none
Trust:        no elevation; confirm/急停 weight must not drop
Channel:      unchanged
```

## Required reading

1. **SoT** — `docs/superpowers/specs/2026-08-11-sidepanel-precision-instrument-redesign.md`  
2. **PRODUCT.md** — repo root  
3. **Current tokens** — `chrome-extension/src/sidepanel/ui/tokens.ts`  
4. **Shell styles** — `App.tsx` container/inputArea/composerCapsule; `StatusRail.tsx`; ChatView empty/bubbles  
5. Density — `docs/audit/reviews/sidepanel-density-budget-20260811.md`  
6. ADR-020 checklist  

## Premise

User finds UI ugly and messy; authorized “you choose direction” → **精密仪器台**; delivery rhythm = design dual-review then phased PRs. Full Settings rewrite is Phase 2.

## Must answer

1. Is Operate / Restrained direction appropriate for a browser agent panel?  
2. Do Phase 1 token/shell changes address “messy” without harming FocusBand/confirm?  
3. Is phasing sound (shell first, secondary later)?  
4. Any ADR-020 or density budget conflict?  
5. Implementable without inventing features?

### Rejection gates

| # | Gate |
|---|------|
| R1 | Weakens 急停/confirm visibility |
| R2 | Makes graph/timeline default wrong or invents L2 tools |
| R3 | Persuade/marketing aesthetic that hurts Operate scanability |
| R4 | Phase 1 scope includes entire Settings rewrite as blocking |

### Output

Summary · spot-check · blocking · nits · scope · exact VERDICT line.
