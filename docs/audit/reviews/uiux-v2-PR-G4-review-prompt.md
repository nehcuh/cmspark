# Pi external review: PR-G4 — 装配 / menus polish

**Batch:** `uiux-v2-PR-G4`  
**Stage:** Implementation review (visual only)  
**Date:** 2026-07-31  
**Branch:** `feat/uiux-v2-shell`

## Capability declaration

```text
Surface:      n/a (presentation of 装配 drawer + popup menus)
L2-classes:   (none)
Compose:      unchanged — still Composition-only sections (no Board)
Autonomy:     n/a
Trust:        n/a
Channel:      n/a
```

## Spec

`docs/superpowers/specs/2026-07-31-gemini-inspired-visual-comparison.md` §5 装配 drawer, §8 PR-G4

### PR-G4 must deliver

1. **Drawer scrim** — soft `rgba(15,23,42,0.28)` via token SoT  
2. **Sheet radius** — larger top corners (radiusSheet ~20), elevated shadow  
3. **Section list MD3** — settings-list groups (one card + hairline dividers), not button grid cages  
4. **Menu radius/shadow match** — StatusRail ⋯ + panel ⋮ menus use shared radiusMenu + shadowLg + tokens (no raw `#e5e7eb` / radius 4 Material leftovers in scope)

### Must NOT change

- `COMPOSE_SECTIONS` / Board exclusion  
- ADR-020 copy / attach line semantics  
- Modal focus trap behavior  
- FocusBand / Host panel open wiring  

## Rejection gates

| Gate | Fail if |
|------|---------|
| Board under 装配 | board section or panel open from drawer |
| Scrim hard black | pure black high-alpha overlay |
| Section buttons still each fully caged | every row has independent full border card with gaps like button grid |
| Menus still raw gray hex cages | Apps/Mcp/Knowledge menus still `#e5e7eb` / radius 4 |

## Files in scope

- `chrome-extension/src/sidepanel/ui/tokens.ts`
- `chrome-extension/src/sidepanel/components/ComposeDrawer.tsx`
- `chrome-extension/src/sidepanel/components/StatusRail.tsx` (menu shell)
- `chrome-extension/src/sidepanel/components/ContextPanelHost.tsx` (menu)
- `chrome-extension/src/sidepanel/components/KnowledgeSubPanel.tsx` (menu)
- `chrome-extension/src/sidepanel/components/AppsPanel.tsx` (menu)
- `chrome-extension/src/sidepanel/components/McpPanel.tsx` (menu)
- `chrome-extension/tests/tokens-helpers.test.ts`

## Output format

```markdown
## Summary
## Spec trace (G4)
## 装配 IA safety
## Menus
## Blocking
## Nits
VERDICT: APPROVE|APPROVE_WITH_NITS|REJECT
```
