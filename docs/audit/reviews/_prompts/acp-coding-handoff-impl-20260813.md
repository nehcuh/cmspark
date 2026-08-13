# Dual review: 编程接力 / ACP coding-handoff implementation

## Scope

Branch `feat/coding-handoff` implements product design + ADR-025:

### Phase A (default usable)
- Task package builder + copy UX (`/code`, `/编程`, message action, modal)
- Settings section 编程助手
- Pack `coding-handoff` + dynamic-workflow merge notes
- UX copy module per §5.7

### Phase B (default off)
- `companion/src/acp/*` client manager (stdio spawn, review_readonly)
- Tools: acp_list_agents, acp_propose_session, acp_start_session, acp_collect_result, acp_cancel_session, acp_get_status
- L2 gate on propose/start; worker HARD_DENY; handback untrusted frame + taint
- `config.acp.enabled` default false

### Explicitly NOT implemented (correct per design)
- Phase D apply / shell-in-agent / auto-spawn
- Side Panel multi-file IDE / new bottom tab
- Full ACP JSON-RPC dialect (best-effort stdio + prompt file)

## Capability declaration

```text
Surface:      L0/L1 evidence; coding writes external
L2-classes:   (none default); acp session start L2
Compose:      pack + acp client + task package
Autonomy:     single; workers deny acp_*
Trust:        HITL; taint; default acp off
Channel:      community
```

## Verify

1. No free-exec arbitrary CLI from Phase A terminal button (copy-first)
2. Catalog lockstep includes new COMPANION_TOOLS
3. sanitizeAcpConfig forces review_readonly / allow_exec false
4. ADR-020: no 中层 Agent language in UI copy
5. Security: workers cannot ACP; propose/start need security_token

## Output

Findings + VERDICT line.
