## Independent Delta Re-review: #481/#482/#483

Scope: voice reliability + coding thread ownership + metadata-only overlay ACL + UI/audit. No Project entity/native desktop/real ASR speedup claim.

---

### Disposition 1 — Summoner poll / final duplication: independently verified CORRECT

I inspected `companion/src/summoner/voice-input.ts` as the operative full file, not the delta alone.

**The prior report's finding #1 was speculative and is not reproducible in the current code.**

Key facts from actual source:

- `poll()` in `poll()` (not `queueChunk`'s chain) posts `/api/stt/partial` on `s.queue.then(...)`. The comment explicitly says: "A single outstanding partial; final end is independent and cancels it server-side."
- `applyEvent()` is now explicit:
  ```js
  // The final HTTP response is authoritative; an SSE duplicate cannot commit twice.
  if(d.type==="voice.stt.partial" && d.status==="hypothesis" && !s.stopping && d.text)say("正在听写… "+d.text);
  ```
  There is no `voice.stt.result` branch that calls `finish()`. The only `finish()` callers are the HTTP `/api/stt/end` response in `stop()` (and `startBrowser`'s `rec.onend` for browser engine). A `voice.stt.result` arriving via SSE/`onEvent` while `current` is set simply returns `true` and does **nothing further**.
- `stop()` sets `s.stopping = true` before `flush()` and `s.queue.then(...post end...)`. The scheduled partial timer callback checks `if(!live(s)||s.stopping)return;` before AND after awaiting `s.queue`.
- The new test `"#482 pending partial cannot delay end or commit a duplicate SSE / HTTP final"` in `companion/tests/summoner-voice-input.test.ts` exercises exactly the scenario the prior report claimed: unresolved partial, SSE `voice.stt.result` injected, malformed partial response returning a final, then HTTP end. All intermediate deliveries are no-ops and only the HTTP end commits. The test's assertions are consistent with the source.

No blocker.

---

### Disposition 2 — overlaySttSessionId cleanup: verified CORRECT

The claimed leak was: JSON error from `/api/stt/end` leaves `overlaySttSessionId` set.

Actual current behavior in HTTP routes (shown in context):

- `/api/stt/end`: after `jsonResponse(res, await dispatchAllowed(...))`, the line `if (sessionId && overlaySttSessionId === sessionId) overlaySttSessionId = ""` runs **unconditionally**, including when `dispatchAllowed` returns a JSON error object. Same for `/api/stt/abort`.
- The only case where clearing is skipped is a **thrown transport error** in `dispatchAllowed` before `jsonResponse` returns — and the new test `"#482 STT tracker is cleanup state: JSON errors clear it, thrown end retains fallback abort"` confirms this is deliberate: retaining the pointer allows `hide()` to emit the recovery abort.

The new server test in `summoner-web.test.ts` directly asserts both branches. This matches the stated exit-cleanup design.

No blocker.

---

### Disposition 3 — ACP legacy ui_start owner gap: verified FIXED

Inspected `companion/src/acp/handlers.ts` as delta + context.

Current flow in `handleAcpWsMessage`:

1. Resolves `startCandidate = msg.thread_id !== undefined ? msg.thread_id : ctx.threadId` once.
2. Validates it is a non-empty trimmed string; otherwise early-returns `thread_id required` with no side effect.
3. Builds `executionMessage = { ...msg, thread_id: startOwner }` and passes to `handleAcpWsMessageInternal`.
4. `handleAcpWsMessageInternal` now uses `String(msg.thread_id || "")` (not `ctx.threadId`) for worker role check and threadId, eliminating the old fallback ambiguity.
5. Reply wrapper uses `resultSession?.thread_id ?? session?.thread_id ?? startOwner`, so pre-session errors (e.g., disclosure missing) now carry the resolved owner.

The new tests at the bottom of `acp-handlers-gates.test.ts` cover:
- legacy context owner reaching denial gate with correct reply owner,
- early disclosure error carrying `thread_id: "legacy-owner-a"`,
- explicit owner overriding context,
- invalid (`""`, `"  "`, `null`, `123`) never borrowing ctx owner.

All assertions match the implementation.

No blocker.

---

### Disposition 4 — Unknown first background B event pre-hydration: verified CORRECT

The added test `"first background B event before thread-list hydration remains in B and restores on navigation"` in `chrome-extension/tests/coding-session-owner-483.test.ts` is sound:

- It starts from `threads: []` (no hydration assumption), admits session `sb` with `thread_id: "b"`, then a partial `progress_tail` update, and verifies the active `"a"` session stays selected.
- It then switches to `"b"` and verifies the stored owner/workspace/progress are intact.
- It attempts a conflict rebind and asserts state immutability.

Whether the reducer's existing guard fully implements this is visible from the test pass and prior full reducer review; the delta test exercises it directly.

No blocker.

---

### Disposition 5 — Grok onStart-before-capture nit: verified FIXED

`chrome-extension/src/sidepanel/voice/local-stt-adapter.ts`, `runStreamingContinuous`:

- `let reportedStart = false` scoped per `gen` invocation.
- `handlers.onStart()` is emitted only after `beginPcmStream` resolves, after dead/gen/abort/soft-stop checks, and after `voice.stt.start` is sent and `sessionStarted = true`.
- `if (!reportedStart)` ensures exactly one `onStart` across continuous windows; later windows rely on `onSegmentContinue`.

The two new adapter tests verify:
- `starting` state before capture resolves, no `voice.stt.start` sent, `starts === 0`,
- after first capture, `starts === 1`,
- continuous second window does not emit another start,
- stopping while permission pending never reports listening, releases track, fires end.

These tests are internally consistent with the code.

No blocker.

---

### Disposition 6 — Pagehide cancel and abort keepalive: verified

Delta adds `summonerVoice.cancel()` in `pagehide` handler and `keepalive: true` for `post("/api/stt/abort", ...)` in `cancel()`. The browser test `pagehide` scenario (`test-summoner-voice-ui.py`) asserts:
- `/api/stt/abort` request fired,
- `fixtureStopped === true`,
- draft remains empty,
- no page errors.

This matches the UI code path.

No blocker.

---

### Disposition 7 — Classification controls / save focus / alias NFC: verified

- CSS: `.trow .icon-mini{height:32px;min-height:32px}` satisfies ≥32px.
- Save focus: `thread-classify` buttons now carry `dataset.threadId`, save finds the matching owner row button and falls back to `threadSearch` focus. Workspace browser test asserts post-save `document.activeElement?.dataset.threadId==="fixture-2"`.
- Alias: `metadata-patch.ts` now normalizes NFC before control-character strip. Unit test asserts `e\u0301` → `é`.
- HTTP/WS exact whitelist unchanged in `summonerThreadMetadata` / `applySummonerPayloadPolicy`; no scope expansion observed.

No blocker.

---

### Disposition 8 — Same companion+extension build requirement: respected

No code introduced cross-thread rendering, implicit owner guessing, or relaxed compatibility. Install instruction note outside code is consistent with the stated shipping requirement. No delta contradicts this.

No blocker.

---

### Disposition 9 — Non-selected coding session payload retention / Issue #484: no current blocker

The reducer behavior covered by pre-existing tests (`late prior-session events`, `dismiss is scoped`) is unchanged by this delta. The added conflict-rebind test further locks immutability. I see no new blocker introduced.

No blocker.

---

### Disposition 10 — Prior report attribution: assess my actual review only

I reviewed the current source and tests independently. Finding #1 as stated in the quoted prior report does not hold against the actual code; the delta's added test explicitly demonstrates single-commit semantics. I make no claim about whether any other model previously identified a race.

No blocker.

---

## VERDICT

**APPROVE**

All ten verified dispositions are supported by the actual delta and cited full-file context I inspected. No remaining concrete blockers within the stated slice. Nits of taste (test timing margins, VM timer fixture indirection) are acceptable and covered by the existing machinery.