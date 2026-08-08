All verification complete. Here's my independent review.

## Review — Dictation+ D1c R2 (post-REJECT fix)

**Patch freshness**: `git diff 36f5f52..HEAD` matches the r2 patch exactly (HEAD `1f81e37`, working tree clean apart from untracked docs). Not stale. Companion: **0 files changed** (Floor 1 holds; `STT_MAX_RECORD_MS = 45_000`, `STT_UPLOAD_IDLE_MS = 10_000` untouched).

**Machine gate (executed, not claimed)**: `npm test` → **556 pass / 0 fail** (all 7 new local-continuous tests ran, incl. the 434ms multi-iteration loop test). `npx tsc -p tsconfig.json --noEmit` → **exit 0**.

### r1 blockers — all four verified fixed in source

1. **Pi #1 (tsc narrowing)** — FIXED. `result.ok === false` discriminants at `local-stt-adapter.ts:370` and `:495`; strict:false build is clean (executed).
2. **Pi #2 (companion 10s idle forceAbort)** — FIXED, verified end-to-end. `runContinuous` records first (`recordSegment`), then `sendStart` (line 366) immediately followed by `uploadAndWait` which synchronously streams chunks + `voice.stt.end` in the same tick. Companion arms the 10s idle + 45s record timers **only in `stt-session-service.ts` `start()`**, re-arms on each `chunk()`, clears on `end()`. During the 45s record no session is bound → no forceAbort; start→chunks gap ≈ 0ms. Real fix.
3. **Claude B1 (stop-during-processing wipes finals)** — FIXED. `useVoiceInput.ts:423-429` special-cases continuous+local+processing → `stopEngine("stop")` only (no `USER_TOGGLE_STOP`). Reducer verified: without `USER_TOGGLE_STOP`, `committed` stays false; `ENGINE_END` → `shouldApplyDraft` true → merge over accumulated finals. The mic tooltip intentionally omits "点击取消" now that the click is non-destructive — correct.
4. **Claude B2/B3 (test gaps)** — FIXED. `segmentMs: 40` / `hardCapMs: 200` override genuinely runs the loop body multiple iterations; idle-safe test asserts `captureBegin → captureStop → voice.stt.start` ordering; graceful-ENGINE_END reducer test preserves finals. All executed, passing.

### ADR-020 capability checklist — pass
- Declaration present and consistent (Surface L0, L2/Compose none, Autonomy n/a, Channel community). Correct axis — no "中层 Agent", no new runtime.
- **Trust monotonicity**: continuous now gates on privacy v3 for **local** too (`useVoiceInput.ts:468-474`), raised from v2-only — bar raised, not loosened.
- No new confirmation family, no `securityConfirmations.request`/originWs, no new primary chrome (mic button label variants only), no Pack-first concern, no experimental layers.

### Floors 1–5 — all hold, verified in source.

## Nits (non-blocking)

1. `local-stt-adapter.ts:547` — `destroy()` nulls `segmentStopTrigger` without invoking it (unlike `abort()` at :517-519). If destroy lands mid-`recordSegment`, the await never resolves; `dead=true` + `loopGen` guard prevent side effects and the closure is GC'd with the adapter, so it's a one-shot dangling promise. Mirror the abort pattern for symmetry.
2. `local-stt-adapter.ts:155-164` — the non-pending `onWs` result branch (shared with classic) can emit a duplicate `onResult` + `onEnd` + `reset` for a stale segment sid in the microtask window between `finishPending` and the next segment's `sessionId` update. Only reachable if the companion sends a duplicate result; the `sid !== sessionId` gate protects once the next segment starts. Epoch-guard if ever touched again.
3. `useVoiceInput.ts:571` — `cont` is computed in the hard-cap timer but unused in the local branch (only the browser `TIMEOUT` code consumes it). Hoist or drop.
4. Soft wall-clock cap: an in-flight segment at cap completion extends wall time by ≤45s record + infer (mic-live stays strictly bounded by the hard cap). Documented/accepted per Floor 5; a one-line comment near the `remaining` check would help future readers.

All four r1 blocking issues are resolved with verifying tests, machine gates are green, and the capability declaration is sound. The remaining items are cosmetic/symmetry nits that don't block merge.

VERDICT: APPROVE_WITH_NITS
