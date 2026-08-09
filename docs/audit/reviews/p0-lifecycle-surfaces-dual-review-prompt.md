# Dual-review — P0-D/E lifecycle + CU PID + voice/outbound defaults

## Capability declaration (ADR-020)

```text
Surface:      L2 host_computer (cuPid fix only); L0 voice binary resolve; Composition outbound MCP
L2-classes:   host_computer (macOS PID resolution correctness)
Compose:      mcp (outbound grant default)
Autonomy:     single (+ multi-agent gate CAS)
Trust:        generation CAS; originWs-scoped pending tools; require_grant default true; no PATH whisper
Channel:      community
```

## Blast tier

**T3** for lifecycle races and outbound grant; **T2/T3** for whisper supply chain.

## DoD

### SEC-D chat supersede
1. `llmLoopGeneration` CAS: predecessor `finally` does not `abortControllers.delete` successor or `releaseMultiAgentLlmLoop` if generation advanced.
2. Supersede drains pending tools + worker L2 via `drainThreadOnSupersede`.
3. Stale AbortError does not emit chat.aborted for successor generation.
4. Same CAS on `chat.regenerate`.

### SEC-E pending originWs
1. `pendingToolCalls` stores `originWs`.
2. `handleToolResult(msg, fromWs)` ignores origin mismatch.
3. `applyConnectionCloseGracePeriod(closedWs)` only grace-kills matching origin (not other peers).
4. Tests: `pending-tool-origin-ws.test.ts`.

### SEC-F cuPidForWindow
1. `host.swift` + `host-skylight.swift` resolve PID via window-number match (`cuWindowInfoDict`), not `windows.first`.

### VOICE-01
1. PATH whisper-cli only when `CMSPARK_WHISPER_PATH_FALLBACK=1` (stt-session-service + whisper-state).

### MCPO-01
1. `defaultConfig.outbound_mcp.require_grant === true`.
2. `authorizeOutboundRequest` honors explicit `requireGrant: false` override for legacy/tests.
3. outbound-mcp-grants tests green.

## Machine

```
node --test mcp-stdio + pending-tool-origin + outbound-mcp-grants + path + redact → pass
```

Inspect real files/diff. End with VERDICT.
