I've verified enough to render a verdict. Findings below.

---

# Review — Dictation+ D1c local continuous segments

## Capability declaration (ADR-020)
Present and consistent with the diff (Surface L0, no L2/Compose/Autonomy, Trust = mic + local WS residual + privacy v3, Channel community). No new gate / tool / runtime. ✅

## Floor verification (vs. implementer prompt)
- **Floor 1 (no companion cap raise)**: ✅ — `git diff --name-only main..HEAD` shows zero companion files; `companion/src/voice/session-caps.ts:4` still `STT_MAX_RECORD_MS = 45_000`. Per-segment `voice.stt.start` uses `segmentMs = Math.min(LOCAL_STT_MAX_RECORD_MS, remaining)` (≤45s).
- **Floor 2 (serial only)**: ✅ — `runContinuous` is a single sequential `while`/`await` loop; no concurrent capture.
- **Floor 3 (no fake interim)**: ✅ — `onResult` always sends `interim: ""`; `voice.stt.partial` is dropped (`local-stt-adapter.ts:142`).
- **Floor 4 (classic regression)**: ✅ — `runClassic` preserves one-shot path; 553 tests pass (executed).
- **Floor 5 (hard cap wall-clock; user stop ends after current segment)**: ❌ — see blocker #1.

## Machine
`cd chrome-extension && npm test` → **553 pass / 0 fail** (executed, not just claimed). ✅

---

## BLOCKING ISSUES

### B1. Floor 5 violation — stop during continuous `processing` loses *all* accumulated finals
- `chrome-extension/src/sidepanel/hooks/useVoiceInput.ts:423-428` — `toggle()`'s `processing` branch fires `USER_TOGGLE_STOP` + `stopEngine("abort")` for **both** classic and continuous modes:
  ```ts
  if (s.phase === "processing") {
    dispatchEv({ type: "USER_TOGGLE_STOP" })
    stopEngine("abort")
    return
  }
  ```
- `USER_TOGGLE_STOP` from `processing` sets `committed: true` (`session-reducer.ts:113-122`), and `ENGINE_END` then `resetToIdle(state)` with no patch → `finals: []` (`types.ts:71`). Verified by existing test `tests/voice-session-processing.test.ts:146-160` (`finals` deep-equals `[]`).
- For continuous, the user spends the session accumulating finals across `parent-s1`, `-s2`, … via `SEGMENT_CONTINUE`. Clicking the mic once during any `processing` window (~90s infer per segment, i.e. roughly half the wall time) wipes every prior segment. The implementer's own `adapter.stop()` already encodes the correct intent (`local-stt-adapter.ts:451-458`: *"Continuous: finish current segment early, then exit after upload; uploading/waiting: let segment complete, loop exits"*) — but `toggle()` bypasses it via `stopEngine("abort")`.
- This is a T2-scaled data-loss bug, not a paper cut: 5+ minutes of recorded transcript vanish on a single click with no undo. The tooltip at `App.tsx:522-524` reads `本机分段识别中… · 剩余 …` (no "点击取消" suffix unlike the classic line right below), so the user has no warning that click = destructive cancel.

**Fix sketch (implementer-side, not applied by reviewer):** in `toggle()`, special-case continuous+processing to call `stopEngine("stop")` (no `USER_TOGGLE_STOP`) — the adapter's existing branch will let the in-flight segment finish and the loop exits with `committed: false`, so the draft merge path runs.

### B2. Missing test for the stop-during-processing case in continuous mode
- `tests/voice-local-continuous.test.ts:129-171` ("abort mid-session ends once") aborts **before any segment completes** (20ms wait, hardCap 60s). It only asserts `errors===1 && ends===1` — does not verify whether prior `finals` survive an abort fired after segments have committed text. The B1 failure mode is uncovered.

### B3. Multi-segment serial path is not actually exercised
- `tests/voice-local-continuous.test.ts:39` is named *"two segments → two finals then onEnd"* and uses `hardCapMs: 2000` + 80ms wait. But `recordSegment`'s timer is `setTimeout(done, segmentMs)` with `segmentMs = min(LOCAL_STT_MAX_RECORD_MS=45_000, remaining≈2000)` = **2000ms** (`local-stt-adapter.ts:277`, `:332`). At 80ms only one capture can have begun; `stop()` then triggers `segmentStopTrigger` so exactly one segment finalizes. The block at lines 121-124 (`if (finals.length >= 2) { … }`) is unreachable in this run. The test name and the multi-segment assertion are misleading; the genuine serial-segment loop body never runs more than one iteration under test.

---

## Nits (non-blocking, listed for completeness)

- **N1.** `chrome-extension/src/sidepanel/hooks/useVoiceInput.ts:568-572` — dead `if (cont) { stopEngine("stop") } else { stopEngine("stop") }`. Both arms identical; collapse to one call (and update the stale comment).
- **N2.** `chrome-extension/src/sidepanel/voice/detect.ts:125` — `LOCAL_CONTINUOUS_SEGMENT_MS = 45_000` is exported but never imported anywhere (grep confirms only the definition site). The actual segment cap uses `LOCAL_STT_MAX_RECORD_MS` from `local-stt-detect.ts`. Dead constant; either wire it in or drop it.
- **N3.** `App.tsx:496-503` — `capturing` is computed but unused after the `continuousCapturing`/`continuousProcessing` split added the processing variant (`localCapturing = sttEngine === "local" && capturing` still uses it; OK) — ignore; verified `capturing` is still consumed by `localCapturing`. Withdrawn.
- **N4.** Wall-clock cap is soft: `remaining` is checked at the top of each loop iteration, but a single segment's record (≤45s) + infer (~90s) can extend total wall time past `hardCapMs`. Mic-live time is strictly bounded; total wall time is not. Acceptable, but worth a comment near `local-stt-adapter.ts:328-330`.

---

## Verdict

Blocking issues B1–B3 must be resolved before merge. B1 in particular is a user-data-loss regression vs. the documented Floor 5 contract.

VERDICT: REJECT
