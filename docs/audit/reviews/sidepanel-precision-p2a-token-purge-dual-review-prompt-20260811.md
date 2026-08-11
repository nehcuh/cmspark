# Dual external review: Precision Instrument **Phase 2a** token purge

**Batch:** `sidepanel-precision-p2a-token-purge`  
**Stage:** Implementation (mechanical presentation)  
**Date:** 2026-08-11  
**Parent:** Phase 1 MERGED #168; design SoT `2026-08-11-sidepanel-precision-instrument-redesign.md` §3 Phase 2  

## Capability declaration

```text
Surface:      L0 Panel secondary chrome (colors only)
L2-classes:   (none new)
Compose:      none
Autonomy:     none
Trust:        no elevation; no confirm/急停 logic change
Channel:      unchanged
```

## Scope

Token-only hex purge on SettingsSlideout, UserEnv, SettingsSection/IntentBar, McpPanel/McpServerForm/OutboundMcp, AppsPanel, PacksPanel, NetSecSettings, AtThreadPopover, ThreadGraphApp residual edges.

**Not in PR:** SectionHeader component, ThreadList density (2b), motion Phase 3, icons, host-integrity.

## Must answer

1. Are replacements semantic-correct (danger→danger, muted text→textMuted, borders→border*) without inventing new palette?  
2. Any accidental logic/behavior change beyond colors?  
3. Confirm/急停 / FocusBand / Security paths untouched?  
4. ThreadGraph canvas alpha approach acceptable?  
5. Ready to merge on tests green?

### Rejection gates

| # | Gate |
|---|------|
| B1 | Trust/confirm/急停 behavior changed |
| B2 | New L2 tools or feature invention |
| B3 | Mass wrong mapping (e.g. danger painted as accent) that harms safety chrome |

## Output

Summary · spot-checks · blocking · nits · VERDICT line.
