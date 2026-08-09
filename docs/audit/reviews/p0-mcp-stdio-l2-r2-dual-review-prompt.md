# Dual-review R2 — P0-C SEC-B mcp stdio L2 (Pi REJECT fixes)

## Prior verdict

Pi **REJECT** on r1 (`p0-mcp-stdio-l2-*-20260809-153609`):

1. `mcp.update {enabled:true}` on disabled stdio bypassed L2 (only toggle_server gated).
2. Redacted `***` env/headers on edit-save corrupted persisted secrets.

## Fixes this round

1. `mcpStdioSpawnSurfaceChanged`: `enabled false→true` is spawn surface.
2. `mergeMcpServerPreservingSecrets` / `restoreMaskedRecord`: `***` restores prior disk secrets; never writes mask literal.
3. Tests: enabled-only L2 fail-closed; *** env preserve.

## DoD (re-check)

Same as r1 DoD 1–7 **plus**:
- enabled-only update on disabled stdio without confirm → error
- trust_level + env:*** update keeps real API_KEY on disk

## Machine

```
node --test .test-dist/tests/mcp-stdio-l2-gate.test.js → 7 pass
```

Capability declaration unchanged from r1. Focus on whether Pi blockers are fully closed; other batches in working tree (SEC-D/E/VOICE) are out of scope unless they regress MCP.

End with VERDICT line.
