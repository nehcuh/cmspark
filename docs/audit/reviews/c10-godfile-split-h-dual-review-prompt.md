# Dual external review — C10 Phase H (confirm-response + WS lifecycle)

## Scope
Commits `4034495` + `0da75cd` on `fix/c10-godfile-split-a`.

### H1
`handleSecurityConfirmationResponse` → `security/confirm-response.ts` with ConfirmResponseDeps injection. Server thin wrapper preserves public API.

### H2  
WS lifecycle → `ws/lifecycle.ts`:
- isAllowedWsOrigin, healthz, pickAuthenticatedClientWs, ensureOutboundToolRunnerWired
- applyConnectionCloseGracePeriod, broadcastToClients, setupBroadcastAuthForTests
- startServer + wss/clients/wsAuth state
- bindWsLifecycle from server (no lifecycle→server import)

### LOC
server.ts: 2434 → **1022** (−1412)

## Verify
1. Zero intentional algebra change (whitelist injection still validated; originWs on confirm response)
2. chrome-extension:// origin gate preserved
3. pre-auth only auth.handshake; AUTH_TIMEOUT / terminate
4. grace period only kills matching originWs pending tools
5. outbound tool runner rewire on connect/close
6. No circular import lifecycle↔server
7. Tests: security-gates, healthz, ws-origin, security-confirmation-origin, pending-tool-origin, ws-tool-forward

Final line:
VERDICT: APPROVE
or VERDICT: APPROVE_WITH_NITS
or VERDICT: REJECT
