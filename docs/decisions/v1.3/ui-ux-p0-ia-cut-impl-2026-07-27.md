# P0 IA Cut Implementation — Side Panel chrome declutter

| Field | Value |
|-------|--------|
| Date | 2026-07-27 |
| Status | Implemented |
| Basis | `ui-ux-depth-adversarial-final-2026-07-27.md` (Claude APPROVE_WITH_NITS + Pi APPROVE) |
| Spec | `docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md` §4 / D5 |

## Changes

1. **`mode-controller.ts`**
   - `contextBarTabsForLevel`: L0 `[skills, knowledge, history]` · L1 `[tabs, skills]` · L2 `[]`
   - New `contextBarOverflowTabsForLevel` for demoted panels (packs/board/mcp/apps/…)

2. **`BottomBar.tsx`**
   - Primary tabs = §4 only
   - 「更多」overflow menu for packs/board/mcp/apps/etc. (no silent discovery loss)
   - L2: thin「更多」only (no permanent 4-tab bar)

3. **`App.tsx` Header**
   - Permanent Craft / Obsidian / NotebookLM / logs strip → single ⋯ menu
   - Settings moved into ⋯ (removed from composer row)
   - L1 tint uses `tokens.modeBrowserBg` (not ad-hoc `#f5f9ff`)

4. **`FleetStrip.tsx`**
   - Idle single-agent: return `null` (no permanent「舰队」link)

5. **Explicit non-changes (per dual-review)**
   - L0/L1 full `SecurityConfirmationDialog` retained
   - No wholesale Material→token color sweep (P2)
   - ComputerTaskBar stays for non-L2

## Verify

```bash
npm --prefix chrome-extension test
```

## Follow-ups (not this PR)

- P1 Cockpit confirm content-split for L0/L1
- P2 token unify + empty/composer polish
- Board permanent vs `/` product knob
- a11y keyboard path for ContextBar shrink
