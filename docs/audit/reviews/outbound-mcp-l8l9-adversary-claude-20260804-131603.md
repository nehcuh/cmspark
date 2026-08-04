I have all the evidence I need. Now I'll write the adversarial review.

---

# Independent Adversarial Review — Outbound MCP L8 + L9

## 1. Executive Summary

L8 confirm fan-out, tray label, OS notify, and L9 dual-entry tab lease are wired with the right **shape**. `dual-entry.ts` is clean and well-tested at the unit level (40/40 pass `[executed]`). However, the integration story has a **fatal gap**: the L9 tagging injects `__thread_id: "outbound_mcp:<caller>"` into `createToolExecutor`, which then enters the `isToolAllowed` gate (`server.ts:647`) for a synthetic thread ID that has no `ThreadManager` entry. `isToolAllowed` returns `false` for unknown threads (`thread-manager.ts:556`), so **every production outbound MCP call returns `tool_not_allowed`** before reaching CDP.

This is a **regression introduced by L8/L9** — pre-L8/L9 `companion-http.ts` did not set `__thread_id`, so `actingThreadId` was `undefined` and the gate was skipped. The 40/40 test suite misses it because every outbound e2e test calls `setOutboundToolRunner` with a mock that bypasses `createToolExecutor`. No test in the suite exercises the real `createToolExecutor(ws)` path with outbound tags.

## 2. Blockers

### B1 — `__thread_id` injection trips `isToolAllowed` gate (production broken)

- **Site**: `companion/src/outbound-mcp/companion-http.ts:238` sets `__thread_id: outboundHolderThreadId(caller_id)` → propagates to `finalParams.__thread_id` → `server.ts:603-608` reads it into `actingThreadId = "outbound_mcp:<caller>"` → `server.ts:635` enters `if (actingThreadId && threadManager)` (truthy in any booted companion) → `server.ts:647` calls `threadManager.isToolAllowed("outbound_mcp:<caller>", toolName)`.
- **Behavior**: `thread-manager.ts:554-559` returns `false` for unknown threads. Verified by isolated unit test `[executed]`: `new ThreadManager().isToolAllowed("outbound_mcp:x", "get_page_text") === false`. Also confirmed `threadManager.get()` has no auto-create (`thread-manager.ts:332`).
- **Effect**: `server.ts:647-672` returns `{ success: false, error: sceneHint, data: { error_code: "tool_not_allowed" } }` for **every** outbound invoke. The runner result propagates back to `companion-http.ts:243`, where the post-L8 mapping (`/timeout|denied|confirmation/i` does NOT match "tool_not_allowed") keeps `DISPATCH_FAILED`. So MCP clients see generic `DISPATCH_FAILED`, while internally every tool is blocked at the scene-whitelist gate.
- **Why tests pass anyway**: All 4 outbound test files (`outbound-mcp-companion-http.test.ts`, `outbound-mcp-dual-entry.test.ts`, `outbound-mcp-http-e2e.test.ts`, `outbound-mcp-facade.test.ts`) call `setOutboundToolRunner(async (...) => mock)` and never invoke the real `createToolExecutor(ws)`. `tests/integration/security-gates.test.ts` does mount `createToolExecutor`, but never with `__outbound_mcp=true`. `[inspected]`
- **Pre-L8/L9 state**: `git show e2c4efe:companion/src/outbound-mcp/companion-http.ts` confirms no `__thread_id` was set → `actingThreadId = undefined` → gate skipped. So this is a NEW regression, not a latent bug.
- **Fix options** (any one suffices, simplest first):
  1. Add `&& !isOutboundMcpCall` to the `isToolAllowed` guard at `server.ts:647` (mirror the multi-block pattern at line 700). Outbound is already gated by `gateOutboundCall` + disclosure rules in `facade.ts`; the per-thread whitelist is not the right gate for synthetic holders.
  2. Stop setting `__thread_id` in `companion-http.ts:238` (rely on `__outbound_mcp` + `__outbound_caller_id`). Then `actingThreadId` is `undefined` for outbound, skipping the whole `if (actingThreadId && threadManager)` block. Side Panel wins logic at `server.ts:622-633` still works (it uses `isOutboundHolder(actingThreadId)` defensively, and that returns false for `undefined`, which is fine since the sidePanelWins path is gated `!isOutboundMcpCall` anyway).
  3. Pre-register `outbound_mcp:<caller>` in `threadManager` with `tool_whitelist: null`. Heaviest; introduces thread-file lifecycle concerns.

Recommend (1) — minimal, symmetric with the existing multi-block skip.

## 3. Nits

### N1 — `OUTBOUND_CONFIRM_REQUIRED` regex over-maps CDP timeouts
- **Site**: `companion/src/outbound-mcp/companion-http.ts:247` — `/timeout|denied|confirmation/i`.
- **Effect**: A real CDP transport error like `"cdp timeout"` (no confirmation involved) is re-coded as `OUTBOUND_CONFIRM_REQUIRED`. The e2e test `runner DISPATCH_FAILED surfaces 422 over HTTP` was even weakened to assert this false positive (`outbound-mcp-http-e2e.test.ts:386-392`).
- **Recommendation**: Tighten to match only confirm-flow errors, e.g. `/confirmation.*timeout|security confirmation|denied by user|confirm required/i`. Keep original error text appended either way.

### N2 — `sidePanelWinsReleaseOutboundLease` does not drain in-flight CDP
- **Site**: `companion/src/outbound-mcp/dual-entry.ts:146` calls `forceReleaseTab(tabId, "side_panel_wins", { hasPending: false })` — instant free.
- **Effect**: If outbound CDP is mid-flight (e.g., `navigate` inflight, `wait_for` polling), Side Panel can race a parallel CDP on the same tab. Documented as "Side Panel wins" design choice, but residual risk for non-atomic DOM operations.
- **Recommendation**: Note as residual risk in ADR-022; consider passing `hasPending: true` for HELD_PENDING_L2 states if Mid-flight cancellation hook exists.

### N3 — Per-caller lease cap is 2 (same as workers)
- **Site**: `outbound-mcp/dual-entry.ts:110-114` acquires with `holderThreadId: "outbound_mcp:<caller>"`; `tab-lease.ts:275` caps at `max_tabs_leased_per_worker=2` per holder.
- **Effect**: An MCP agent operating on 3+ tabs in parallel will hit `TAB_LEASE_CAP`. Likely acceptable for single-tab workflows, but worth disclosing in `docs/mcp.md`.

### N4 — Audit `as any` casts
- `dual-entry.ts:94, 154` cast capability-audit objects to `any`. Type drift risk; consider a typed `OutboundMcpAuditEvent` variant.

## 4. Residual Bake-off Risks

- **B1 fix must be verified end-to-end** with a real paired extension (not just mock runner). Add an integration test that mounts `createToolExecutor(serverSideWs)` and dispatches `__outbound_mcp=true` calls through it — the existing `security-gates.test.ts` harness is the right template.
- Tray + Side Panel + IDE three-way bake-off not run (acceptable per non-goals).
- Multi-caller race (two MCP clients, same tab, same caller_id collision) untested.
- `node-notifier` is best-effort; Linux/no-tray path depends on Side Panel WS being open.

## 5. Three-layer check

- **Outcome (ADR-022 L8/L9 letter)**: Not met while B1 stands — outbound MCP cannot complete a single tool call in production. L8 fan-out and L9 lease state machine are individually correct but unreachable past the gate.
- **Trajectory**: L2 export, grant skip, cookie tools — all deferred to P1 per ADR-022, not a blocker.
- **Component**: Blocker and nits cited with `file:line` above.

```
VERDICT: REJECT
```
