# P1-2 Security Batch Report — originWs bind

**Date:** 2026-07-30  
**Branch:** `fix/diagnosis-P1-2`  
**Workflow:** `p1-security-batch-fix` (args.batch=P1-2)  
**External dual-review:** Claude `APPROVE_WITH_NITS` + Pi `APPROVE`  
**Verdict:** `docs/audit/reviews/P1-2-verdict-20260730-100117.json`

## Shipped

| Change | Files |
|--------|--------|
| navigate URL L2 → `{ originWs: ws }` | `companion/src/server.ts` |
| MCP tool confirm → `{ originWs: ws }` | same |
| MCP meta confirm → `{ originWs: ws }` | same |
| Unit multi-peer | `security-confirmation-origin.test.ts` |
| Integration navigate + MCP tool | `security-gates.test.ts`, `mcp-capability-gate.test.ts` |
| Inventory P1-2 FIXED | `docs/audit/p1-security-open-items-2026-07-29.md` |

**Preserved:** tray privileged `respond()`; evaluate/shell conditional bind; host/biometric already-bound sites.

## Capability declaration (ADR-020)

```text
Surface:      L1 navigate + Composition mcp-server (confirm bind only)
L2-classes:   (none new)
Compose:      mcp-server
Autonomy:     single
Trust:        originWs multi-peer on MCP tool/meta + navigate URL L2
Channel:      community
```

## Tests

```bash
cd companion && npx tsc -p tsconfig.test.json && node --test \
  .test-dist/tests/security-confirmation-origin.test.js \
  .test-dist/tests/integration/security-gates.test.js \
  .test-dist/tests/integration/mcp-capability-gate.test.js
# 101 pass / 0 fail (2026-07-30)
```

## Residual nits (non-blocking)

- No dedicated MCP-meta multi-peer integration (manager unit covers meta surface bind).
- Happy-path wire replies in some harnesses still use privileged `respond()`; new cases deliberately use `respondFrom` rogue/origin.

## Out of scope (next)

- P1-3 evaluate post-approval integrity  
- P1-4 shell structure  
- `analyze_image_fetch` origin bind (deferred)
