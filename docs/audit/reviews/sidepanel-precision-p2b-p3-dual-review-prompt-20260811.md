# Dual external review: Precision Instrument **Phase 2b + Phase 3**

**Batch:** `sidepanel-precision-p2b-p3`  
**Stage:** Implementation  
**Date:** 2026-08-11  
**Parent:** Phase 1 #168 · Phase 2a #170 MERGED · design SoT redesign §3 Phase 2/3  

## Capability declaration

```text
Surface:      L0 Panel chrome (shared components + motion tokens)
L2-classes:   (none new)
Compose:      none
Autonomy:     none
Trust:        no elevation; confirm/急停 untouched
Channel:      unchanged
```

## Scope

| Area | Files |
|------|--------|
| SectionHeader | `ui/SectionHeader.tsx` + Knowledge / OutboundMCP / SettingsSection scale |
| popup menus | `ui/popupMenuStyles.ts` + StatusRail, ThreadList, McpPanel, AppsPanel |
| Motion | `tokens.transitionFast` 120ms / `transition` 180ms |
| Banners | `ui/PanelBanner.tsx` + App DisconnectedBanner wired; toast/log hex cleanup |
| ThreadList | residual hex → tokens |

**Not in PR:** icons regen, host-integrity, new features.

## Must answer

1. SectionHeader + popup density match StatusRail instrument grammar?  
2. Motion tighten only tokens (no layout height / density budget break)?  
3. PanelBanner preserves disconnect recovery UX?  
4. Confirm/急停 / security paths untouched?  
5. Tests green?

### Rejection gates

| # | Gate |
|---|------|
| B1 | Weakens confirm/急停 or disconnect recovery |
| B2 | New L2 tools / trust elevation |
| B3 | Breaks density budget via growing chrome |

## Output

Summary · spot-checks · blocking · nits · VERDICT line.
