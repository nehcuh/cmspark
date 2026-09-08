## Independent delta re-review — #481 / #482 / #483

Reviewed from the supplied delta + full files only. Prior report and “verified dispositions” were treated as claims, not evidence. This is not native-desktop, Project-entity, real-ASR, or mixed-version runtime acceptance.

I am Grok. Findings below are from this pass. I did not inherit a “both judges found a duplicate race” claim; that is not in this source.

---

### 1. Summoner final commit — HTTP `/api/stt/end` only

`poll()` never writes `s.queue`. It schedules a 1400ms timer, then *observes* the current upload promise:

```js
s.queue.then(function(){if(!live(s)||s.stopping)return;return post("/api/stt/partial",{sessionId:s.sid})})
```

`stop()` sets `s.stopping` first, `cleanup(s,true)` clears `partialTimer`, and the timer/issue callbacks both bail on `stopping`. End is a sibling `s.queue.then(post /api/stt/end)`, so an in-flight partial cannot block it.

`applyEvent` never calls `finish`. SSE `voice.stt.result` is ignored. Hypothesis copy is gated on `!s.stopping`. `finish` runs only after a successful HTTP end (`d.type==="voice.stt.result"`), then `current=null` and `s.cancelled=true`.

Pinned by:
- VM: pending partial → stop → SSE final → partial HTTP fake final → end HTTP final, one commit
- Real HTML `pending-partial`: same sequence, composer `唯一结果` only
- VM: stop before 1400ms never issues partial

No duplicate-final path in this source.

---

### 2. `overlaySttSessionId` is cleanup state, not a start lock

`/api/stt/end` and `/api/stt/abort` clear the tracker only after `jsonResponse` (JSON errors included). A thrown `dispatchAllowed` never reaches that line, so hide can still abort. Start overwrites the tracker; it does not gate a later start.

Test `#482 STT tracker is cleanup state` covers json-error vs throw and a new start after both.

Do not clear the tracker on throw. Current code does not.

---

### 3. `#483` `acp.ui_start` owner is resolved once

Wrapper:

- `startCandidate = msg.thread_id !== undefined ? msg.thread_id : ctx.threadId`
- `startOwner` only if that value is a nonempty string (`trim()` as a gate)
- missing/invalid → `{ error: "acp: thread_id required" }` with **no** `thread_id` (explicit `""` / `"  "` / `null` / `123` do not borrow `ctx.threadId`)
- `executionMessage` injects `thread_id: startOwner` before any internal side effect
- internal no longer reads `ctx.threadId`
- reply owner = created session owner, else stored session, else `startOwner` (early failure still carries the requested conversation)

Tests cover early failure, invalid explicit, legacy omit, and correct owner into the existing confirm gate.

---

### 4. Background B before `thread.list`

New test: empty `state.threads`, event `{session_id:"sb", thread_id:"b"}` while A is selected → A still shows `sa`; B progress caches under B; `switchTo(b)` restores `sb` + workspace + tail; `{thread_id:"a"}` rebind is identity. Ownerless events still ignored. Auth ownership is not inferred from the active UI or a hydrated list.

Reducer body is unchanged in this delta; the new test is the contract pin.

---

### 5. Extension `onStart` after capture (classic+preview path)

Ordinary dictation is `classic && streamPartial` → `runStreamingContinuous`. `onStart` is no longer at loop entry. It runs once, after PCM capture resolves, after abort/soft-stop/`wantListening` checks, after `voice.stt.start`. Later windows use `onSegmentContinue`.

Adapter tests: starts stay 0 until capture resolve; second window does not emit another start; stop during pending gUM → 0 starts, abort, `onEnd`. Real `useVoiceInput` + production PCM: `starting` until `grantCapture()`, then `listening` → interim overlay → one final; switch discards late final.

**NIT (out of this batch’s enabled path):** non-stream `runContinuous` still calls `handlers.onStart()` before `recordSegment`. Do not reuse that path for ordinary dictation.

---

### 6. Hide / leave discards uncommitted dictation

`pagehide` now calls `summonerVoice.cancel()` before meeting `stopStt`. `cancel()` synchronously stops tracks / closes the context, then queues `/api/stt/abort` with `keepalive: true`. Owner poll + `live()` still drop late HTTP finals after switch. Real HTML `pagehide` expects abort, mic stop, empty composer.

Switch / new / close: no automatic write to the departed thread. Docs match.

**NIT:** `keepalive` is passed into `o.api(...)`. This packet does not include `api()`’s fetch construction. Mic teardown is synchronous and tested. A real document unload may still drop abort if `api()` does not forward `keepalive`; the Playwright case fires `pagehide` on a live document.

---

### 7. Metadata ACL + chrome

- `.trow .icon-mini` is `height/min-height: 32px`
- classify buttons stamp `dataset.threadId`; save focuses that owner, else `#threadSearch`
- workspace HTML test saves tags on fixture-2 and asserts focus `dataset.threadId==="fixture-2"`; fixture PATCH now updates the query `id`, not always fixture-1
- alias NFC on the shared allowlist (`e\u0301` → `é`); HTTP/WS still exact `alias | user_tags | topic_folder`

No scope expansion.

---

### 8. Mixed companion / extension

Client still fail-closed: missing/`""` `thread_id` ≠ active thread (`codingMessageTargetsThread({}, "b") === false`). Absent owner stays unknown. That is the correct default. Skew diagnostics must not authorize cross-thread render. Shipping companion+extension together is an operational requirement, not a code defect in this slice.

---

### 9. Dismissed coding-session retention (#484)

`CLEAR_CODING_SESSION` still drops selection only so a late event cannot resurrect a chip; the record stays in `codingSessionsById`. Tests still prove dismiss + late progress cannot replace a newer session or leak into the other thread.

Independent call for this slice: **not a blocker**. Retention is the anti-resurrect mechanism. Unbounded growth is product/memory debt, already tracked as #484. Do not GC in a way that rebinds `codingSessionIdByThread` on late events.

---

### Remaining defects

None that break voice commit-once, overlay ACL, or coding-session ownership in this slice.

Nits only:

1. Non-stream `runContinuous` still reports listening before capture.
2. Abort `keepalive` effectiveness depends on unshown `api()` plumbing; mic is already released on hide.
3. HTML EventSource stub no-ops `addEventListener` and injects `onmessage`; SSE-does-not-commit is proven by the VM controller test, not necessarily by the HTML SSE poke.
4. `#484` GC remains out of scope.

---

VERDICT: APPROVE_WITH_NITS
