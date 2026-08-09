# Dual-review — PR #159 health-fanout P1/P2 (+ P0 stack)

**PR:** https://github.com/nehcuh/cmspark/pull/159  
**Branch:** `fix/health-fanout-p1-p2`  
**Commits vs main (`0de1760`):**  
1. `d1f69ef` fix(security): health-fanout P0 closeout  
2. `5ba41f0` feat(security): health-fanout P1/P2  

## Role

Independent senior review of the **full PR stack** (P0 security Highs + P1/P2 residuals).  
Do **not** rubber-stamp. Inspect real code paths and tests. Fail closed on security overclaims.

## Source of truth

- `docs/audit/health-fanout-2026-08-09.md` (9 High + P1/P2 plan)
- `docs/audit/health-fanout-p0-optimization-closeout-2026-08-09.md`
- `docs/audit/health-fanout-p1-p2-closeout-2026-08-09.md` (claim table for this batch)
- Prior P0 dual verdicts under `docs/audit/reviews/p0-*` (both_ok)
- Full diff file attached by the dual-review harness

## Capability declaration (implementer)

```text
Surface:      L0 voice (model/stt gates); L2 CU enable UI only (existing computer.set_enabled gate)
L2-classes:   no new confirm family — reuses computer.set_enabled biometric + MCP stdio L2 (P0)
Compose:      mcp-server / outbound (require_grant default already P0)
Autonomy:     no new multi-agent surface
Trust:        privacy_ack_v2 wire gate; whisper pin fail-closed; meeting audio GC; WS strict unknown (prod)
Channel:      community
```

## Scope checklist

### P0 (must remain FIXED — re-spot-check, do not re-open nits)

| ID | Claim |
|----|--------|
| SEC-A | thread id path sanitize + containment |
| SEC-B | mcp.add/update stdio L2 + enable bypass + `***` secret preserve |
| SEC-C | tool-tape redact before thread JSON |
| SEC-D | generation CAS + abort releases multi-agent gate |
| SEC-E | pendingToolCalls originWs + scoped close grace |
| SEC-F | cuPidForWindow kCGWindowNumber match |
| VOICE-01 | PATH whisper only with CMSPARK_WHISPER_PATH_FALLBACK=1 |
| MCPO-01 | outbound require_grant default true |

### P1 (this batch — must be code-real if claimed FIXED)

| Item | Claim |
|------|--------|
| voice.model origin | chrome-extension:// fence on all voice.model.* |
| privacy_ack_v2 + sttEngine | server validate + handler on voice.stt.start; set_engine local needs ack |
| VOICE-02 | missing pin → allowUnpinned:false (not full pin matrix inventing hashes) |
| Meeting GC | retain_until purge at boot + 6h |
| CU UI | AppsPanel computer.set_enabled (not fake toggle) |
| Release | preflight test+audit job; SHA256SUMS on release |
| Docs | README model, badges, G21/ADR-023, nav stub |

### P2 (partial OK if honestly deferred)

- run-tests.mjs, CI Node 22, package.sh version lock, WS strict, auth.ok protocol_version
- God-file split / full startServer / codesign / inventing multi-arch pins must **not** be claimed complete

### P0 CI regression fixes (must not break security)

- adapter deepEqual after redact clone
- handleMessage session is **3rd** arg for L2 approve tests
- outbound e2e uses cmg_ grants under require_grant=true

## Required verdict criteria

**APPROVE / APPROVE_WITH_NITS** only if ALL of:

1. P0 SEC-A–F / VOICE-01 / MCPO-01 still hold in the combined diff (spot-check key files).
2. P1 security gates (origin, privacy_ack_v2, sttEngine, pin fail-closed) are real and not client-only.
3. No new Critical/High regression (e.g. bypassing L2, leaking secrets, path escape, silent PATH whisper).
4. Closeout does not overclaim deferred items (god-file, full pin matrix hashes, codesign, full startServer).
5. Tests that assert security behavior were updated (grant e2e, L2 session, privacy/origin) and are not loosened into insecurity.

**REJECT** if:

- Any P0 High reopened or bypassed
- privacy_ack / origin / pin fail-closed is claim-only or easily skipped in production paths
- require_grant tests re-enable silent ws_secret success as the only happy path without documenting opt-out

Nits: docs polish, incomplete pin *hashes*, god-file debt, DESIGN↔tokens, dual-review nits from prior batches.

## Machine evidence (implementer claim)

- tsc clean; **132** targeted tests pass (P0 + P1 voice/meeting/ws/outbound e2e suite)
- Spot-check with tools if possible

## ADR-020

Apply `docs/audit/reviews/_templates/dual-review-capability-checklist.md`.  
No new runtime / confirm family beyond existing computer.set_enabled and MCP stdio L2.

End with exactly one line:
VERDICT: APPROVE
or
VERDICT: APPROVE_WITH_NITS
or
VERDICT: REJECT
