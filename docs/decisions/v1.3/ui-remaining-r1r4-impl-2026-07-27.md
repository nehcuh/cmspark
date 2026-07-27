# UI Remaining R1–R4 Implementation

| Field | Value |
|-------|--------|
| Date | 2026-07-27 |
| Status | **Shipped** — dual review r2: Claude APPROVE_WITH_NITS, Pi APPROVE_WITH_NITS (parser UNKNOWN on Chinese verdict line; body confirms) |
| Tests | `npm --prefix chrome-extension test` — 258 pass |
| Reviews | `docs/audit/reviews/ui-remaining-R1-R4-r2-*.md` |

## R1 Cockpit session persist

- `cockpit-window.ts`: `chrome.storage.session` key `cmspark.cockpitWindowId`
- Reclaim via `windows.getAll` + `isCockpitTabUrl`
- Hydrate on open/focus/close
- Tests: path, size, session key, URL match

## R2 Mode pin + confirm queue

- `ModeBadge`: click toggles `SET_MODE_PIN` (pin blocks auto-down)
- Toast on pin/unpin
- `MinimalConfirm`: queue badge `1/N`, tail tool names, Esc=deny, focus deny button

## R3 Secondary tokens + dead code

- Settings/Apps/MCP/Knowledge/NB/SkillCraft/ThreadList/McpServerForm → `tokens.*` for Material hexes
- Removed unmounted `ComputerTaskBar.tsx`

## R4 Empty chips + FOUC + discoverability

- L0/L1 suggestion chips → `cmspark:fill-composer` → InputArea
- L2 header soft green tint (`#ecfdf5`) before dark SafetyStrip
- Empty copy mentions 底栏「更多」for packs/board

## Product defaults locked

- Board/packs stay in overflow only
- L1 expand = same Cockpit shell
