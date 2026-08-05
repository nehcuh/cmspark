# Dual review: MCP full-autonomy cruise waive + ChatView stick-to-bottom

## Scope (review ONLY these product changes)

### A) MCP critical confirm waived under three-flag full autonomy cruise
- `companion/src/server.ts` — `executeMcpTool` / `executeMcpMetaTool`
- `companion/src/config.ts` — warning text
- `companion/tests/integration/mcp-capability-gate.test.ts`
- `docs/mcp.md`

**Product intent:** User with `auto_approve_dangerous` + `auto_approve_enterprise_tools` + `allow_all_schemes` (三旗 / full-autonomy cruise) should not get MCP `write_file` / critical capability confirms. God-mode alone or enterprise flag alone must STILL confirm. Align with shell_exec forceConfirm waive algebra.

**Capability declaration (ADR-020):**
```
Surface:      n/a (no new L0/L1/L2 class; gate algebra only)
L2-classes:   (none new)
Compose:      mcp-server (confirm policy for existing MCP tools)
Autonomy:     single (cruise = max residual-risk opt-in)
Trust:        three-flag full_autonomy_cruise waives MCP L2; partial flags do not; originWs unchanged on remaining confirms
Channel:      community + enterprise (MCP path; enterprise flag is one of three)
```

### B) Side Panel ChatView long-thread scroll stick-to-bottom
- `chrome-extension/src/sidepanel/components/ChatView.tsx`

**Product intent:** Long conversations must follow latest response; do not jump to thread start. Respect user scroll-up to read history.

### Out of scope / drive-by (flag if mixed into merge advice)
- `companion/src/packs/builtin/netsec-port-survey/pack.yaml` skill_refs — user may have local pack edit; not part of A/B design unless you see security coupling.

### Already on main (context only, not this review batch)
- `skill_install` user-home source tier (commit a054121)

## Reviewer must verify by reading code

1. **MCP gate algebra**
   - Three flags required for waive
   - Two-flag god-mode path still confirms critical write
   - enterprise alone still confirms
   - Audit log `mcp.confirm.waived` / reason `full_autonomy_cruise`
   - originWs not regressed on remaining confirm path
   - Meta tools also waived under cruise consistently
   - Tests cover: cruise NO confirm; enterprise alone STILL confirms; god-mode STILL confirms

2. **ChatView scroll**
   - pin vs user-scrolled-up behavior
   - ResizeObserver / stickKey / ignoreScrollRef correctness
   - No infinite re-render / scroll thrash risk
   - Thread switch re-pins
   - overflow-anchor changes

3. **Security / product**
   - Trust monotonicity: cruise is explicit max risk — OK if tested; partial flags must not silently weaken MCP
   - No new confirmation dialect
   - Missing tests or incomplete coverage → nit or REJECT as severity warrants

## Output format
Findings with severity + file:line where possible.
End with exactly one of:
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
