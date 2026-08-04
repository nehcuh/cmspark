# Dual external re-review: Outbound MCP L4+ Grant Design (P1 ship gate)

**Stage:** Design draft — **implementation has NOT started**  
**Date:** 2026-08-04  
**Batch id:** `outbound-mcp-l4-grant`  
**Repo:** CMspark (branch `docs/p0d-preflight-and-grant-design` or main + this file)

## Required reading (in order)

1. **Primary SoT (under review)**  
   `docs/decisions/outbound-mcp-l4-grant-design-2026-08-04.md`  
   Focus: §1 problem, §4 options A–D, §5 Phase 1 scheme, §6 threats, §8 relation to P0d, §9 open questions, §10 recommendation.

2. **ADR locks**  
   `docs/adr/022-outbound-mcp-server.md` — especially **L4**, **L4+**, **L3+**, Phase **P1** grant row, “stdio/loopback ≠ auth”.

3. **Capability ontology**  
   `docs/adr/020-capability-model-three-axes.md` — Trust monotonicity; Composition export; not “中层 Agent”.

4. **Current implementation reality (spot-check — do not rubber-stamp design against fantasy)**  
   - `companion/src/outbound-mcp/companion-http.ts` — `authorizeOutboundHttp` uses Bearer == `ws_secret`  
   - `companion/src/outbound-mcp/stdio-server.ts` — `getOrCreateSharedSecret()` into HTTP dispatcher  
   - `companion/src/outbound-mcp/http-client.ts` — Bearer token  
   - `companion/src/ws-auth.ts` — pairing secret purpose  
   - Optional: `docs/audit/reviews/outbound-mcp-p0d-preflight-20260804.md` (P0d preflight; L7 still INCONCLUSIVE)

5. **Checklist**  
   `docs/audit/reviews/_templates/dual-review-capability-checklist.md`

## Product premise (must not be weakened without REJECT-level argument)

```text
Today: Outbound MCP invoke/disclosure authenticate with Extension pairing ws_secret.
ADR-022 L4+: loopback/stdio/PID ≠ auth; MCP-caller grant is P1 ship gate.
Design proposes: Option D hybrid with Phase 1 = hashed client-secret grants
  bound to caller_id + profile + TTL; Extension keeps ws_secret; no confirm-skip.
Grant must NOT ship as product until P0d T1 PASS (L7) — design review only now.
```

## Capability declaration (implementer — design)

```text
Surface:      L1 outbound export only (no L2 in grant default profile)
L2-classes:   (none via grant)
Compose:      mcp-server (outbound) grant gate
Autonomy:     n/a (auth packaging)
Trust:        separate MCP-caller grant from Extension pairing; L2/URL confirm remain
Channel:      community; enterprise modules still out of default outbound set
```

## Your job

Independent **security architecture + product Trust packaging + ADR-022 fit** review of the **grant design document**.

1. **Do not rubber-stamp.** Challenge Option D/A vs B/C; challenge migration dual-mode; challenge self-ack disclosure still allowed under grant.
2. **Confirm or refute** each major claim:
   - Separating grant from `ws_secret` is necessary for L4+  
   - Hashed token store is adequate for Phase 1  
   - Fail-closed error codes are complete enough  
   - “No implement until T1 PASS” is correct gate  
3. **Hunt design holes**: TOCTOU, grant theft, confused deputy, dual-auth bypass, caller_id spoofing, disclosure without human HITL, Windows path/permissions, multi-IDE concurrent grants.
4. **Open questions §9**: pick recommended answers or demand more design before APPROVE.
5. Apply ADR-020 checklist (Trust monotonicity, no new runtime, confirm dialects).

## Verdict rules

- **REJECT** if the proposed scheme would violate L4+ when implemented as written, enables confirm-skip, or is fatally incomplete for a P1 ship claim **as a design direction**.  
  (Missing dual-review of *implementation* is not REJECT of the *design* if direction is sound.)
- **APPROVE_WITH_NITS** if direction is lockable with listed non-blocking nits / open questions resolved in synthesis.  
- **APPROVE** only if design is tight enough to implement without further product forks.

End with exactly one line:

VERDICT: APPROVE  
or  
VERDICT: APPROVE_WITH_NITS  
or  
VERDICT: REJECT  
