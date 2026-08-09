# Health Fanout P1/P2 Closeout (2026-08-09)

**Source:** `docs/audit/health-fanout-2026-08-09.md`  
**Base:** P0 closeout dual-approved (`d1f69ef` / PR #158)  
**Branch:** `fix/health-fanout-p1-p2`

---

## P1 status

| Area | Action | Status |
|------|--------|--------|
| Security | mcp.list / servers.updated redact | **Already FIXED in P0** (`redactMcpServersForBroadcast`) |
| Security | server-enforce `sttEngine` + `privacy_ack_v2` on `voice.stt.start` | **FIXED** |
| Security | origin fence on `voice.model.*` | **FIXED** |
| Security | `privacy_ack_v2` on `set_engine` local | **FIXED** |
| VOICE-02 | Tier-1 pin fail-closed when pin missing | **FIXED** (hashes for win/linux/darwin-x64 still need `--write-pins` builds) |
| Meeting | `retain_until` GC boot + 6h interval | **FIXED** |
| Product | CU `computer.set_enabled` UI toggle | **FIXED** (AppsPanel + background route) |
| Testing | loopback healthz integration | **FIXED** (not full `startServer` — lock/exit retained) |
| Release | `release.yml` preflight test+audit; SHA256SUMS | **FIXED** |
| Docs | README model, badges, broken nav, G21, ADR-023, TESTING 0.5.0 | **FIXED** (partial DESIGN↔tokens still deferred) |

## P2 status

| Item | Status |
|------|--------|
| Cross-platform test runner (no Unix `find`) | **FIXED** (`scripts/run-tests.mjs`) |
| CI Node 22 | **FIXED** |
| `package.sh` version lock-step | **FIXED** |
| Fail-closed unknown WS types | **FIXED** (`CMSPARK_WS_STRICT=1` or `NODE_ENV=production`) |
| `protocol_version` on `auth.ok` | **FIXED** (advertise v1; negotiation not yet enforced) |
| God-file extract (`server`/`message-router`) | **DEFERRED** — multi-week; residual MAINT-1/2 |
| Shared protocol package | **DEFERRED** — only wire version advertised |
| Surface L0 hard-gate | **DEFERRED** — decision not code |
| Developer ID / Authenticode | **BLOCKED** — needs org certificates (REL-1) |
| Full CycloneDX SBOM | **PARTIAL** — SHA256SUMS + notes; npm sbom operator-side |
| Archive `docs/audit/reviews` noise | **DEFERRED** — volume move needs explicit archive PR |
| thread JSON backfill scrub | **DEFERRED** — optional migration script |
| DESIGN.md ↔ tokens full sync | **DEFERRED** — design debt |

## Intentionally blocked / out of band

1. **Codesign / notarize** — no Developer ID / Authenticode secrets in CI  
2. **Complete Whisper multi-arch SHA256 pins** — requires building binaries on each Tier-1 host with `build-cmspark-whisper.sh --write-pins`  
3. **Full startServer() boot tests** — UDS lock + `process.exit` make pure unit harness unsafe; healthz loopback covers the listen pattern  
4. **God-module split** — tracked as architecture program, not this batch  

## Regression notes (P0 CI)

P0 landed with default `require_grant=true` and MCP L2 — updated:
- `adapter.test` deepEqual after redact clone  
- `message-router-config-security` L2 approve session for stdio seed  
- `outbound-mcp-http-e2e` grant tokens under require_grant  

## Test evidence (implementer — re-run before merge)

```
cd companion && npm test   # cross-platform runner
# targeted: meeting-audio-gc, voice-privacy-origin-p1, ws-validate-strict,
#   voice-stt-handlers, voice-whisper-handlers, outbound-mcp-http-e2e
```
