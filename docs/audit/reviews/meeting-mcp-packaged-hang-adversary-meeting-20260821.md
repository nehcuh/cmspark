# Independent adversary review — meeting stop hang (lane: Meeting/STT)

| Field | Value |
|-------|--------|
| **Batch** | `meeting-mcp-packaged-hang-20260821` |
| **Date** | 2026-08-21 |
| **Reviewer** | Independent ADVERSARY (Meeting/STT skeptic). Did **not** implement the diff. |
| **Focus** | meeting stop hang, `local-stt-adapter` pending wait, MeetingPanel failsafe + disconnect debounce, last-window loss, `finalizeCapture` races, tests that would pass on old code |
| **Out of lane** | MCP `npx` PATH / `npm_config_prefix` (inspected only for ADR-020 / blast; not a full MCP verdict) |
| **Base / Diff** | `50869a9` / `docs/audit/reviews/meeting-mcp-packaged-hang-diff-20260821.patch` |
| **Blast tier** | T2 (L0 meeting UX). No new L2 tools, no confirm family, no god-mode. |
| **Evidence level** | Live files **[inspected]**. Tests **[inspected]** (logic: would they fail on old hang). Runtime **[not executed]** — this subagent has no shell. |

---

## 1. Summary (three layers)

| Layer | Result |
|-------|--------|
| **Outcome** | Incident hang is actually closed at two layers: adapter pending wait + stopGrace re-arm, and MeetingPanel 20s stop failsafe / 5s disconnect debounce. Stopping copy is no longer 「正在听…约 8 秒」 when `phase==="stopping"` and interim is empty. `finalizeCapture` stays single-flight via `finalizedRef`. |
| **Trajectory** | Meeting slice is incident-scoped (timeout + copy + failsafe). No new Surface/L2/confirm. Residual product holes (silent last-window drop, disconnect-first skips auto-minutes) are **honesty / completeness**, not a new runtime. |
| **Component** | Remaining holes are nits: interimText masking 正在结束; failsafe comment vs 12s adapter kill; turbo/WAV path `onError(empty_result)`; React effects untested. **No blocker** on the hang itself. |

The implementer claims 1–2 on meeting are **mostly true**. Claim that failsafe 20s “lets a live last-window infer finish” is **overstated** — the adapter already `empty_result`s at 12s.

---

## 2. Findings

### BLOCKER

None.

### NIT

**N1 — Stopping hint loses to leftover hypothesis**  
**file:line:** `chrome-extension/src/sidepanel/voice/meeting-caps.ts:54-55`  
**evidence:** `meetingLiveInterimHint` returns `识别中… ${interimText}` **before** checking `phase === "stopping"`.  
**inference:** If the user clicks 「结束并生成纪要」 while a partial is on screen, the interim box stays 「识别中…」 until `onEnd` clears it (`MeetingPanel.tsx:491`). Capture bar still shows 「结束中…」 (`MeetingPanel.tsx:1298`) so DoD “≠ 正在听…约 8 秒” still holds for the incident empty-interim case. Test (`meeting-caps.test.ts:40-47`) only covers `interimText: ""`.

**N2 — Failsafe 20s does not extend last-window infer**  
**file:line:** `meeting-caps.ts:30-35` (comment: longer than 12s “so a live last-window infer can finish”) vs `local-stt-adapter.ts:68-69,203,990-994` (`LOCAL_STT_STOP_GRACE_MS = 12_000`; `pendingWaitMs` after stop is `min(stopGrace, pendingTimeout)`).  
**evidence:** After user `stop()`, the pending timer is (re)armed to 12s and resolves `empty_result`. `onEnd` → `finalizeCapture` → `destroyAdapter` typically at ~12s. Failsafe at 20s is then a no-op (`finalizedRef`).  
**inference:** 20s is defense-in-depth if `stop()` never arms a pending (gUM/`handle.stop()` hang), **not** extra infer budget. Comment overclaims.

**N3 — Last window can drop silently (streaming / classic)**  
**file:line:** `local-stt-adapter.ts:213-216` (timeout code), `:725-727` (streaming `empty_result` → empty `onResult`, no `onError`), `:1052-1055` (classic skips `onError` for `empty_result`). Companion infer cap is 90s (`companion/src/voice/session-caps.ts:10`). Default meeting window is 8s (`LOCAL_STT_NEAR_REALTIME_SEGMENT_MS`); `large-v3-turbo` is forced to 45s (`local-stt-adapter.ts:946-948`).  
**evidence:** After stop, wait is 12s regardless of model/window. Streaming/classic then `onEnd` without a banner.  
**inference:** Default 8s+medium will often finish in 12s (not measured here). Turbo/slow medium on a 45s window can exceed 12s → last segment omitted from transcript **and** minutes, with copy 「等待最后一段识别」 implying it will land. Product-broken for turbo last-window; **not** worse than the infinite hang; honesty is incomplete.

**N4 — Continuous non-stream (turbo) still banners `empty_result` after stop**  
**file:line:** `local-stt-adapter.ts:851-881` — `isSoftSttSegmentError && wantListening` then `continue`; after stop `wantListening===false` falls through to `onError(errCode)` + `onEnd`.  
**evidence:** Meetings with `large-v3-turbo` use this WAV loop, not the streaming special-case at `:725`. `mapLocalSttError("empty_result")` is a banner (`error-map.ts:102-103`); MeetingPanel wraps soft codes with irreversible-loss copy (`MeetingPanel.tsx:481-488`).  
**inference:** Minutes still generate (`onEnd` still runs). Extra scary banner vs streaming’s silent drop. Inconsistent, not a hang regression.

**N5 — MeetingPanel failsafe / disconnect effects have no test that would fail if deleted**  
**file:line:** `MeetingPanel.tsx:406-434` (the two `useEffect`s); tests only in `meeting-caps.test.ts:32-57` (constants + pure hint) and `voice-local-stt-adapter-ws.test.ts:556-642` (adapter).  
**evidence:** Deleting the React effects leaves adapter hang tests green and the hint unit test green. Wiring of `meetingLiveInterimHint` in `MeetingPanel.tsx:1619-1624` is also unwired from tests.  
**inference:** Adapter tests **do** fail on the old hang (see §5). Failsafe is backup if adapter `stop()` never settles pending. Test gap, not a disproof of the fix.

**N6 — Duplicate phase type**  
**file:line:** `MeetingPanel.tsx:57` `type CapturePhase = ...` vs exported `MeetingCapturePhase` at `meeting-caps.ts:44`. Identical unions; panel already imports from `meeting-caps`. Drift risk only.

**N7 — Streaming test `waited < 300` is almost tautological**  
**file:line:** `voice-local-stt-adapter-ws.test.ts:632-640` — `stop()`, `await 120ms`, then `waited = Date.now()-t0` (≈120) and `waited < 300`.  
**evidence:** The assertion that **proves re-arm** is `events.includes("end")` within 120ms while leftover `pendingTimeoutMs` was 400ms (armed ~50ms before stop → would fire ~350ms later without re-arm).  
**inference:** Test **would fail on old code**. The `waited < 300` clause does not independently measure stopGrace vs pendingTimeout.

**N8 — Disconnect-first can eat `wantGenerate`**  
**file:line:** `MeetingPanel.tsx:422-434` (5s debounce `generate: wantGenerateRef`), `:742-746` (`stopLiveCapture` no-ops if `idle` or `stopping`).  
**evidence:** If companion is already dead ≥5s and the user has **not** clicked 「结束并生成纪要」, debounce finalizes with `generate: false`. Later click sees `phase==="idle"` and returns.  
**inference:** Not lost forever: 「生成会议纪要」 (`MeetingPanel.tsx:1683-1684`) is enabled when `!capturing`. Error copy at `:428` tells the user. Residual UX, matches implementer honesty.

---

## 3. Attack list (checked)

| # | Attack | Result |
|---|--------|--------|
| 1 | **Double finalize / lost minutes** | **Hold (safe).** `finalizeCapture` (`MeetingPanel.tsx:337-339`) is sync-guarded by `finalizedRef`. Failsafe, disconnect, `onEnd`, stop-without-adapter all share it. `wantGenerateRef` is snapshotted then cleared by the **first** winner. `destroy()` is silent (`destroyAdapter` comment `:248`; `local-stt-adapter.ts:1108-1147` `finishPending(aborted)` + `reset`, no `onEnd`). Streaming loop after destroy hits `if (dead \|\| gen !== loopGen) return` (`:716`) — no second `onEnd`. JS single-thread: no double `meeting.generate_minutes`. |
| 2 | **WS 1s blip false-stop** | **Hold for stated 1s blip.** Debounce 5s (`meeting-caps.ts:42`, effect `:432`). Side Panel `connectionState` is **polled every 3s** (`useWebSocket.ts:1889`) plus `type:"connected"` (`:1860-1863`); background does **not** push disconnect to the panel (`background/index.ts:278-288` badge only). A 1s socket blip is often invisible to React; if visible, 5s timer is cleared on reconnect. Companion `ws.client_disconnected` can also be **another** client. Residual: MV3 `chrome.alarms` reconnect floor (~30s keep-alive, `keep-alive.ts:16-18`) can make a real drop look “stuck” >5s and **intentionally** stop capture — that is the SIGTERM requirement, not a 1s false kill. |
| 3 | **Last window dropped** | **NIT N3.** 12s grace vs 90s server infer / 45s turbo window. Honesty copy is optimistic; default 8s near-rt is plausibly OK. Not a hang regression. |
| 4–7 | PATH / Windows / prefix / trust | **Out of lane.** Not used for this verdict. |
| 8 | **ready without minutes / no load-last-meeting** | **Residual, not blocker.** If user clicked generate **before** finalize, `wantGenerate` is true (`:745`) and `onEnd`/failsafe send `meeting.generate_minutes` (`:381-399`). If companion is dead, the WS send may still drop (pre-existing). Panel `generate()` remains (`:1070-1098`, `:1683`). No new “load last meeting” UI — pre-existing; not required to unstick 「正在听」. |
| 9 | **Tests that would pass on old code** | **Adapter tests: would FAIL** (see §5). **React failsafe: would PASS if effects deleted** (N5). |
| 10 | **Drive-by / installed .app** | **Hold.** This lane does not claim `/Applications/CMspark.app` is patched. |

### Race on `finalizeCapture` / `wantGenerateRef` (detail)

```text
User 结束并生成纪要
  stopLiveCapture(true)           // phase=stopping, wantGenerate=true
  adapter.stop()                  // wantListening=false; re-arm 12s if waiting
  failsafe timer 20s
  [optional] disconnect timer 5s if already !connected

T+12s adapter empty_result → onEnd
  gen = wantGenerateRef (true); wantGenerateRef=false
  finalizeCapture({generate:true})  // finalizedRef=true, destroyAdapter

T+20s failsafe
  finalizedRef → return
```

If disconnect fired **before** the click (`wantGenerate` still false): minutes are not auto-queued; user uses 「生成会议纪要」 (N8).

`onEnd` early-out `phase==="idle" && finalizedRef` (`MeetingPanel.tsx:494`) covers failsafe-first.

---

## 4. External DoD (meeting-relevant)

| DoD | Result | Evidence |
|-----|--------|----------|
| `adapter.stop()` with no STT ACK → `onEnd` within stopGrace (classic + streaming) | **HOLD [inspected]** | Classic `:556-586` (`stopGraceMs: 40`, wait 120ms, assert `end`). Streaming `:588-642` (stop while waiting after `voice.stt.end`, assert `end` and not 400ms pending). Live defaults: `LOCAL_STT_STOP_GRACE_MS=12_000` (`local-stt-adapter.ts:69`), re-arm `:992-994`. |
| Stopping hint ≠ 「正在听…约 8 秒」 | **HOLD** with N1 | `meeting-caps.ts:55`; wired `MeetingPanel.tsx:1619-1624`; test `:40-47`. |
| Disconnect debounce 5s < stop failsafe 20s | **HOLD** | `meeting-caps.ts:35,42`; test `:33-38`. |
| No new L2 / confirm / default-on | **HOLD** | Meeting diff is UI timers + adapter timeout + copy. No `securityConfirmations.request`, no `auto_approve`, no new tools. |
| MCP PATH / prefix / launch-companion / secrets | **Not scored** (other lane) | — |

---

## 5. Would the new tests fail on old code?

**Classic hang test** (`voice-local-stt-adapter-ws.test.ts:556-586`)  
Old `stop()` while recording started upload and **waited forever** for `voice.stt.result` (no `pendingTimer`). Test waits 120ms then `assert events.includes("end")`. **Would fail** (not hang the suite). Does **not** exercise continuous re-arm; classic arms after `stop()` with `wantListening` already false (`:979`, `:407`), so `pendingWaitMs()` is already `stopGrace`. That **is** the dictation/classic hang path.

**Streaming hang test** (`:588-642`)  
Old continuous `stop()` while `phase==="waiting"` was a no-op besides `wantListening=false` (prompt incident). No pending timeout. Test waits 120ms for `end`. **Would fail.** With pendingTimeout 400ms **but no re-arm**: timer armed at window end (~30–80ms), remaining ≈320ms at `stop()`; 120ms wait would **still fail** `includes("end")`. So this test also guards the re-arm, not only “some timeout exists”.

**Hint / constants test** (`meeting-caps.test.ts:32-57`)  
New exports — **would fail to import** on old tree. Does **not** prove MeetingPanel uses the helper (N5).

---

## 6. Component notes (adapter `stop()` — live file)

Continuous (`local-stt-adapter.ts:982-995`): recording → `segmentStopTrigger` / `pendingSoftStop`; **waiting/uploading + pending** → `armPendingTimer` (stopGrace because `wantListening` already false at `:979`).

Classic (`:998-1001`): if already uploading/waiting, **return without re-arm**. **OK [inspected]:** classic only enters waiting from the stop chain **after** `wantListening=false`, and `uploadAndWait` arms with `pendingWaitMs()` → 12s. Second stop is still a no-op (pre-existing `stopChainInFlight`).

`destroy()` / `abort()` call `finishPending` (`:1102`, `:1146`) which `clearPendingTimer` (`:269-270`). Failsafe `destroyAdapter` will not leave a zombie pending.

`reset()` still assigns `pending = null` **without resolving** (`:259`). Pre-existing; destroy/abort resolve first. Failsafe uses destroy. Not introduced.

---

## 7. What was executed

| Item | Level |
|------|--------|
| Dual-review prompt + capability checklist + frozen patch | **[inspected]** |
| Live: `local-stt-adapter.ts`, `MeetingPanel.tsx`, `meeting-caps.ts`, `voice-local-stt-adapter-ws.test.ts`, `meeting-caps.test.ts` | **[inspected]** |
| Call-path: `useWebSocket` poll 3s, `ws-client` onclose, `keep-alive` 0.5 min, `STT_INFER_MAX_MS`, `generate()` button, `finalizeCapture` IIFE | **[inspected]** |
| `chrome-extension` `tsc` / `node --test` meeting+adapter suite | **[not executed]** — no Bash/shell tool in this subagent. Implementer-reported 27 tests EXIT 0 is **unverified** here. |
| Installed `/Applications/CMspark.app` | **not checked** (explicitly not claimed patched). |

Falsification attempted: hang still possible if `stop()` never sets pending (mic `stop()` hang) — **bounded by 20s failsafe**. Hang still possible if both adapter and effects were missing — **adapter tests would fail**. Infinite 「正在听」 after user stop with this tree: **not found**.

---

## 8. Capability checklist (ADR-020)

```text
Surface:      L0 (会议工作台 STT / 结束并生成纪要)
L2-classes:   (none)
Compose:      mcp-server (batch-level; this lane does not add MCP surface)
Autonomy:     single
Trust:        无新确认门
Channel:      community
```

| Check | Result |
|-------|--------|
| Axes fit | Meeting hang is **Surface L0 UX**, not Composition-as-agent. MCP is Compose `mcp-server`, not a “中层 Agent”. |
| Pack-first | No new scenario chrome. |
| Confirm dialects | None added. |
| Trust monotonicity | No god-mode / auto_approve / CU skip. |
| originWs | No `securityConfirmations.request` change. |
| No new runtime | Timeouts + copy only. |
| Experimental layers | Unchanged (Qwen3-VL / TinyClick not in slice). |
| P1-1..P1-4 watchlist | Not touched by meeting files. |

---

## 9. Residual risks (non-blocking)

1. Last ~8–45s of audio omitted after stop if infer >12s; streaming/classic silent (N3). Turbo may also banner (N4).
2. Companion death ≥5s without 「结束并生成纪要」 → ready/idle without auto-minutes; user must click 「生成会议纪要」 (N8). If they close the panel, transcript is only on the server — still no load-last-meeting UI (pre-existing).
3. Failsafe/disconnect React effects untested (N5).
4. Side Panel disconnect visibility lags (3s poll); 5s debounce is on **UI** connection, not companion logs.
5. Packaged `.app` at `/Applications/CMspark.app` is not this source tree.

---

## 10. Verdict

Hang root cause (stop while `waiting` = infinite ACK wait; stopping copy still 「正在听」) is fixed in live code with tests that would have failed on the old adapter. Defense-in-depth UI timers are real but thinly tested. Last-window 12s vs 90s infer is an honesty nit, not a reason to keep the hang.

VERDICT: APPROVE_WITH_NITS
