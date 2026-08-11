# Dual external review — C10 Phase F (multi-agent pre-gate)

## Scope
Commit `dc6eb63` on `fix/c10-godfile-split-a`.

### Extract
ADR-015 multi-agent pre-gate try/catch → `orchestrator/tool-pregate.ts` (`runMultiAgentToolPregate`)

Includes:
- sweepExpired tab leases
- sidePanelWinsReleaseOutboundLease
- worker paused / isToolAllowed (pack whitelist + HARD_DENY)
- TAB_ID_REQUIRED / __require_tab_id
- early HARD tab lease
- host_computer + Chrome while leases held
- ORCHESTRATOR_GATE_ERROR fail-closed

**Stays before pregate in createToolExecutor:** actingThreadId, shell/netsec normalize, tool.start, isOutboundMcpCall

### Order
tool.start → **pregate** → cookie → browser_download → L2 → URL → image → companion/MCP/ext

### server.ts
2765 → 2635 (−130)

## Verify
1. Zero intentional algebra change
2. Outbound MCP skips pack whitelist (isOutboundMcpCall)
3. Worker HARD_DENY still enforced via isToolAllowed
4. Single-agent does not take tab leases unless multi
5. Tests: orchestrator-tool-pregate 9, worker-hard-deny 3, security-gates 63

Final line:
VERDICT: APPROVE
or VERDICT: APPROVE_WITH_NITS
or VERDICT: REJECT
