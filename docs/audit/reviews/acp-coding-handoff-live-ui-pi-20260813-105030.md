I've completed the review. Here are my findings.

## Verification of the 5 required checks

**1. forceConfirm never waived under god-mode — ✅ PASS**
`companion/src/acp/handlers.ts:95` calls `ctx.requestConfirmation(...)` directly (not via `executeTool`/`l2-admission`), so the god-mode / `auto_approve_dangerous` / three-flag cruise skip logic in `l2-admission.ts` is never reached for `acp.ui_start`. It sets `autoConfirmEligible: false` + `criticalApis: ["acp_start_session"]`. If `requestConfirmation` is missing (`handlers.ts:89`) it fails closed with `mgr.cancel`. The pre-existing tool path (`acp_propose_session`/`acp_start_session`) is separately protected by `acpForceConfirm` in `l2-admission.ts:785` ("never waived … full autonomy cruise").

**2. FocusBand priority — ✅ PASS**
`focus-band-priority.ts:90-96` inserts `coding_session` between `l2_safety` and `fleet`. Order confirmed: confirm → l2_safety → coding_session → fleet → thread_tools. Covered by `focus-band-coding-session.test.ts` (passes, 1/1).

**3. Stop sends cancel only — ✅ PASS**
`CodingSessionChip.tsx:14-22` sends only `{ type: "acp.session.cancel", session_id }`. No `computer.task.abort` (急停) coupling; the chip is rendered in a distinct `coding_session` slot, separate from `SafetyStrip`.

**4. No free-exec from Phase A copy path — ✅ PASS**
`CodingTaskPackageModal.tsx` — `doCopy`/`doOpenTerminal` are clipboard-only (`task-package.ts`). `doAcpStart` gates on `threadId`, `pkg.hasWorkspace`, `agentId`, `goal`, and `acpEnabled`, then triggers companion-side mandatory L2 confirm. No auto-spawn.

**5. `acp.enabled` default false — ✅ PASS**
`config.ts:446` (`enabled: false`) and `sanitizeAcpConfig` (`types.ts:121`, `enabled: r.enabled === true`). Fail-closed verified by `acp-live-events.test.ts` (passes).

## ADR-020 checklist

- **Capability declaration present** in the prompt body. ✅
- **Axes fit**: Compose (acp client + task package); no bare "中层 Agent" labeling. ✅
- **originWs**: `session.requestConfirmation` is wired in `ws/lifecycle.ts:1168` with `{ originWs: ws }` — the ACP confirm inherits origin binding (no new `request()` call without it). ✅
- **No new confirm dialect**: reuses `securityConfirmations.request` + `criticalApis`. ✅
- **Trust monotonicity**: always-confirm; deeper Surface (spawn) never inherits looser L0 auto-approve semantics. ✅
- **Pack-first**: direction is sanctioned by existing `docs/adr/025-acp-coding-agent-client.md`; diff is incremental live-UI on an already-shipped Phase B manager. ✅
- **ValidateWsMessage** covers the 3 new types (`validate.ts:178-196`) before `handleMessage`. ✅

## Non-blocking nits

1. **No test for the confirm flow** — `handleAcpWsMessage` (approved→start, denied→cancel, missing-channel→fail-closed) has zero coverage. `acp-live-events.test.ts` only asserts disabled-fail-closed and cancel-unknown; `ws-validate-strict.test.ts` doesn't cover the new acp validators. Given this spawns a subprocess agent, a deny/cancel + originWs regression test is worth adding.
2. **Dead code**: `CLEAR_CODING_SESSION` action (`agentStore.tsx:322,949`) is never dispatched; `force_confirm_session_start` (`config.ts:451`, `types.ts:31/64/125`) and `require_workspace` are declared but never consulted (handler always confirms / always requires workspace — conservative but misleading config surface); `handback` state in `FocusBand.tsx:97` is never emitted (manager goes offered→running→closed directly).
3. **`acp.ui_start.denied` not surfaced** — `useWebSocket.ts:1182-1183` no-ops both accepted and denied despite the comment claiming "denied surfaces as toast". Denial is only indirectly reflected via the `cancelled` event → chip shows 完成.
4. **FocusBand edge case** — if a CU L2 task and an ACP session run concurrently, `l2_safety` wins the single primary slot and the ACP stop button is hidden until the CU task ends (cancel is safe and 急停 priority is correct, so non-blocking).
5. **`acp.list` returns `command` strings** to any authenticated loopback peer — pre-existing `listAgents` behavior, not a regression.

VERDICT: APPROVE_WITH_NITS
