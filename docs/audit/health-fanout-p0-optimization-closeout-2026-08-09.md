# Health Fanout P0 Optimization Closeout (2026-08-09)

**Source audit:** `docs/audit/health-fanout-2026-08-09.md` (9 High)  
**Gate:** MACHINE → `scripts/dual-external-review.sh` (Claude + Pi) per batch  
**Status:** P0 security batch **COMPLETE** under dual-approve*

---

## Dual-review ledger

| Batch | Scope | Claude | Pi | Verdict JSON |
|-------|--------|--------|-----|--------------|
| **p0-persistence-sec-ac** | SEC-A path + SEC-C tool tape | APPROVE | APPROVE_WITH_NITS | `p0-persistence-sec-ac-verdict-20260809-153105.json` |
| **p0-mcp-stdio-l2** | SEC-B mcp.add L2 | APPROVE | **REJECT** | r1 — enable-bypass + *** secret clobber |
| **p0-mcp-stdio-l2-r2** | Pi blockers fixed | APPROVE | APPROVE_WITH_NITS | `p0-mcp-stdio-l2-r2-verdict-20260809-154209.json` |
| **p0-lifecycle-surfaces** | SEC-D/E + F + VOICE + MCPO | APPROVE_WITH_NITS | **REJECT** | r1 — abort gate leak + file.upload CAS |
| **p0-lifecycle-surfaces-r2** | Pi blockers fixed | APPROVE | APPROVE_WITH_NITS | `p0-lifecycle-surfaces-r2-verdict-20260809-155354.json` |

---

## High residual map (post-fix)

| ID | Title | Status |
|----|-------|--------|
| SEC-A | threadFilePath path escape | **FIXED** + dual-approved |
| SEC-B | mcp.add stdio no L2 | **FIXED** + dual-approved (r2) |
| SEC-C | thread JSON unredacted tool tape | **FIXED** + dual-approved |
| SEC-D | chat.create supersede CAS | **FIXED** + dual-approved (r2) |
| SEC-E | pending tools global on peer close | **FIXED** + dual-approved (r2) |
| SEC-F | cuPidForWindow first window | **FIXED** (Swift) + dual-approved (r2) |
| VOICE-01 | PATH whisper silent fallback | **FIXED** (opt-in env only) + dual-approved (r2) |
| VOICE-02 | incomplete Tier-1 pins | **PARTIAL** — not full pin matrix; PATH closed; pin debt remains P1 |
| MCPO-01 | require_grant default false | **FIXED** (default true) + dual-approved (r2) |

---

## Code touch summary

- `companion/src/threads/thread-manager.ts` — safe thread ids
- `companion/src/security/tool-persistence-redact.ts` — new
- `companion/src/llm/adapter.ts` — createToolResultMessage redacts
- `companion/src/message-router.ts` — MCP L2, generation CAS, abort gate release, file.upload CAS, MCP list redact
- `companion/src/server.ts` — pending originWs, close grace scoped, handleToolResult origin, broadcast redact
- `companion/src/config.ts` — outbound require_grant default true
- `companion/src/outbound-mcp/companion-http.ts` — explicit requireGrant false honored
- `companion/src/voice/whisper-state.ts`, `stt-session-service.ts` — PATH fallback gated
- `companion/src/host-use/darwin/host.swift`, `host-skylight.swift` — cuPidForWindow
- `docs/TESTING.md` — 0.5.0 counts
- Tests: thread-path-sanitize, tool-persistence-redact, mcp-stdio-l2-gate, pending-tool-origin-ws, llm-supersede-generation

---

## Machine evidence (implementer)

```
59+ targeted tests pass (path, redact, mcp L2, originWs, outbound grants, security-thread, supersede gate)
tsc -p tsconfig.test.json clean
```

---

## Intentionally deferred (P1+, not claimed closed)

- Full Whisper Tier-1 multi-arch SHA256 pin matrix (VOICE-02 remainder)
- Real startServer() integration boot tests
- server.ts / message-router god-file split
- Release pipeline re-test + SBOM + codesign
- thread JSON backfill scrub of pre-fix tapes
- DESIGN.md ↔ tokens sync; broader docs badges

---

## Final closeout dual-review

| Field | Value |
|-------|--------|
| batch | `p0-optimization-closeout` |
| Claude | **APPROVE** |
| Pi | **APPROVE_WITH_NITS** |
| both_ok | **true** |
| verdict | `docs/audit/reviews/p0-optimization-closeout-verdict-20260809-160142.json` |

**P0 optimization is dual-confirmed complete.** Residual nits (VOICE-02 pin matrix, god-file split, startServer tests, release signing) remain P1 and are not overclaimed.
