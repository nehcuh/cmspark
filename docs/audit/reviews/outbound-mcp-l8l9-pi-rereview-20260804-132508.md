All verification complete. Summary of my re-review:

## B1 — CONFIRMED REAL and CLOSED

**B1 was real**: `thread-manager.ts:554-559` — `isToolAllowed()` returns `false` for unknown threads (`get()` → undefined → `return false`). Outbound injected `__thread_id: "outbound_mcp:<caller>"` (companion-http.ts:238), which has no `ThreadManager` entry. Pre-fix, every production outbound invoke hit `tool_not_allowed` at server.ts:647. Verified by reading the live gate.

**Fix closes B1**: `server.ts:640` — `if (actingThreadId && threadManager && !isOutboundMcpCall)`. The entire ThreadManager block (paused / `isToolAllowed` / multi-agent `TAB_ID_REQUIRED` / HARD lease) is skipped for outbound, symmetric with the existing `!isOutboundMcpCall` skip at line 623. `isOutboundMcpCall` correctly matches `__outbound_mcp === true` (constant stable-tested).

**L9 lease intact**: outbound lease acquired pre-dispatch in companion-http.ts (`gateOutboundTabLease`); the server-side HARD acquire block is `multi && !isOutboundMcpCall` (line 705) → no double-acquire. **Side Panel wins intact**: `sidePanelWinsReleaseOutboundLease` runs in the `!isOutboundMcpCall` block (line 623) — non-outbound actors still force-release outbound-held tabs. L8 fan-out at 1573-1710 operates off `isOutboundMcpCall`/`actingThreadId`, computed independently of the skipped block — unaffected.

## N1–N4 spot-check

- **N1 — FIXED**: regex tightened to `/security confirmation|confirmation (timeout|denied|expired)|denied by user|high.?risk.*denied|OUTBOUND_CONFIRM/i`. E2e test now asserts `cdp timeout` → `DISPATCH_FAILED` (not remapped) **and** new test asserts confirm timeout → `OUTBOUND_CONFIRM_REQUIRED`. ✓
- **N2 — REMAINS** (nit): `sidePanelWinsReleaseOutboundLease` still uses `hasPending: false` (dual-entry.ts:146) — documented "Side Panel wins" design risk.
- **N3 — FIXED**: `docs/mcp.md` documents the 2-lease per-caller cap. ✓
- **N4 — REMAINS** (nit): `as any` casts in dual-entry.ts:94,154 untouched.

## Tests

`tsc -p tsconfig.test.json` clean; `node --test .test-dist/tests/outbound-mcp-*.test.js` → **42/42 pass**, including the new B1-hazard doc test and both N1 e2e assertions.

## New blockers?

None. Remaining dispatch gates (host_computer lease check, cookie trust domain, browser_download) are intentional cross-actor policies, not per-thread gates. Residual bake-off risk stands: no integration test mounting real `createToolExecutor(ws)` with `__outbound_mcp=true` (the adversary's recommended follow-up) — the skip is trivially correct by inspection but only hazard-documented, not exercised end-to-end. Recommend as follow-up, not a blocker.

```
VERDICT: APPROVE_WITH_NITS
```

Nits: N2 (in-flight CDP not drained on Side-Panel-win release), N4 (`as any` audit casts), and the missing real-`createToolExecutor` integration test.
