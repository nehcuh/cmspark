# Dual-review prompt — P0-C SEC-B mcp.add stdio L2 + MCP list redact

## Capability declaration (ADR-020)

```text
Surface:      n/a (local process spawn via MCP stdio — trust root)
L2-classes:   (none host_*); new confirm family: mcp.add_stdio / mcp.update_stdio
Compose:      mcp-server
Autonomy:     single
Trust:        L2 force high + criticalApis; fail closed without requestConfirmation
Channel:      community
```

## Blast tier

**T3** — authenticated peer could previously spawn arbitrary commands via mcp.add without shell enterprise module.

## DoD

1. `mcp.add` with transport=stdio without session.requestConfirmation → error, no config write.
2. User deny → error, no config write.
3. User approve → server registered; confirm details include command preview + riskLevel high.
4. `mcp.update` that changes command/args/cwd/env re-confirms; trust_level-only update does not need spawn confirm (optional verify).
5. `mcp.toggle_server` enable of disabled stdio re-confirms.
6. http transport does not require stdio L2.
7. mcp.list / servers.updated / status_changed broadcasts mask env/headers to `***`.

## Files

- `companion/src/message-router.ts` — requireMcpStdioSpawnConfirm, redactMcpServersForBroadcast, mcp.add/update/toggle/list
- `companion/src/server.ts` — broadcast redaction
- `companion/tests/mcp-stdio-l2-gate.test.ts`

## Machine

```
node --test .test-dist/tests/mcp-stdio-l2-gate.test.js → pass
```

Note: working tree also contains approved P0-persistence (SEC-A/C). Focus this review on MCP spawn + redaction; do not re-REJECT persistence unless regression.

End with VERDICT line.
