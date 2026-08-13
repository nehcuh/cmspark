# Dual review: coding-handoff P1–P3 batch

## Scope
feat/coding-handoff implements remaining P1–P3:
- Launch presets (claude -p)
- Follow-up multi-turn (new session + prior context)
- adopt_discovered → config
- Handback summary format
- CU+ACP secondary stop
- propose_diff + workspace-contained apply (L2 never cruise-skip)

## Verify
1. acp_apply_diff / acp.apply_diff always HITL
2. path escape rejected
3. followup requires confirm
4. no free shell
5. catalog lockstep includes acp_apply_diff

## Capability
Surface: L0/L1 + workspace write only via gated apply
Compose: acp
Trust: forceConfirm never waive for acp_* spawn/apply
Autonomy: single session

VERDICT required.
