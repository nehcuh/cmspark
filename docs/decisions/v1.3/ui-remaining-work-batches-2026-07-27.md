# UI Remaining Work — Batch Plan (post P0–P2)

| Field | Value |
|-------|--------|
| Date | 2026-07-27 |
| Gate | Each batch: internal adversarial → Claude + Pi dual review |
| Workflow | `.grok/workflows/ui-remaining-loop.rhai` |

## Scope (implementable now)

| Batch | Goal | Out of scope |
|-------|------|--------------|
| **R1** | Cockpit `windowId` session persistence + reclaim | Companion native HUD |
| **R2** | Mode pin UI + multi-confirm queue chrome | Full queue reordering product |
| **R3** | Secondary-panel token migration + dead ComputerTaskBar | MCP-as-mode product fork |
| **R4** | Empty suggestion chips + L2 FOUC soften + packs discoverability note | Multi-window cockpit |

## Product defaults (open knobs closed for this pass)

1. **Board / packs**: remain in BottomBar「更多」only (not permanent §4 tabs).
2. **Mode pin**: pin blocks auto-down only (existing ModeController rule); UI = badge toggle.
3. **L1 expand**: same Cockpit window shell (no separate L1 theme window).
4. **Follow-up queue flush**: unchanged — Panel queue messages when task not hard-gated.

## Acceptance

- extension tests green
- no new Material hex on primary paths
- dual-review both APPROVE / APPROVE_WITH_NITS per batch
