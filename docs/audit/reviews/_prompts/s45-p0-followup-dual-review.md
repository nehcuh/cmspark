# Dual external review — S45 P0 multi-lane follow-up

**Branch**: `fix/s45-p0-multi-lane-followup`  
**Origin**: post-ship multi-adversarial on `4a2d02f..474df7e` → REQUEST_CHANGES  
**Report**: `docs/audit/reviews/multi-adversarial-review-20260805-main-s45.md`

## Scope (this batch only)

### P0 (must land)
1. **Upload error thread isolation** — `file.upload_error` / SW-fail always clear `threadBusyById[uploadTid]`; panel chrome (`isProcessing`, `ADD_MESSAGE`, stream clear) only when `shouldApplyStreamEvent(uploadTid, active)`.
2. **Fleet stop run scope** — when fleet scope is `run`, `fleet.stop_all` must include `orchestrator_run_id` (companion already filters). Honest confirm copy for parent/none process-wide.

### P1 (cheap, in same batch)
3. Gate `file.uploaded` panel `isProcessing` clear the same way.
4. Stamped `file.upload_error` for oversized / invalid `file.upload` WS messages (thread_id).
5. `safeUploadBasename` for Office temp write (no raw path join).
6. `plasmo.config.ts` version → 0.4.0.

## Files to inspect
- `chrome-extension/src/sidepanel/hooks/useWebSocket.ts`
- `chrome-extension/src/sidepanel/App.tsx`
- `chrome-extension/src/sidepanel/utils/thread-busy.ts` (`buildFleetStopAllMessage`)
- `chrome-extension/src/sidepanel/components/FleetStrip.tsx`
- `chrome-extension/src/sidepanel/components/FleetWorkerList.tsx`
- `companion/src/file-parser.ts`
- `companion/src/server.ts` (WS size / validation error paths)
- tests: `thread-busy.test.ts`, `stream-thread-gate.test.ts`, `file-parser-safe-name.test.ts`

## Acceptance
- Mid-upload thread switch + later `file.upload_error` must NOT unlock wrong composer or inject error into wrong transcript.
- Stop-all on a run-scoped board must not kill other runs' workers.
- No Trust / forceConfirm / cruise algebra changes in this batch.
- Tests cover `buildFleetStopAllMessage` run stamp + safe basename.

## Out of scope
- Parent-scoped stop filter (still process-wide with honest copy)
- Full busy dual-write SoT redesign
- architecture.md TinyClick doc lag

## Verdict rules
Inspect real code. Final line exactly one of:
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
