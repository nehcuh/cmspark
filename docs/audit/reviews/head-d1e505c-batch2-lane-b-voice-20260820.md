# Lane B (Voice) — independent adversarial review

**Lane:** B — Voice (did not implement this batch; do not rubber-stamp)
**Base:** `d1e505c`
**Frozen patch:** `docs/audit/reviews/head-d1e505c-batch2-diff-20260820.patch`
**Scope:** Chrome extension local STT adapter tests + production adapter (read-only)
**Date:** 2026-08-20

## Patch vs live tree

[executed] `git diff d1e505c` is byte-identical to the frozen patch (54988 bytes, sha256 prefix `52730daf49e185d1`). Voice production file `chrome-extension/src/sidepanel/voice/local-stt-adapter.ts` is **absent** from both diffs (empty vs base). This batch is **tests-only** for voice.

## Machine [executed]

```
cd chrome-extension && npx tsc -p tsconfig.test.json && \
  node --test .test-dist/tests/voice-local-stt-adapter-ws.test.js \
               .test-dist/tests/voice-local-continuous.test.js
```

15/15 pass, 0 fail, ~1.8s. Mutations below were applied only to compiled `.test-dist` artifacts and restored.

---

## Claim B1 — continuous `resource_conflict` uses a faithful start-conflict fake

**PASS, revert-sensitive.** [executed + inspected]

### Is the fake start-conflict (not end-conflict)?

Yes. Old test (base `d1e505c`) fired `resource_conflict` on the **first `voice.stt.end`** via `queueMicrotask` — a companion that does not exist. New `fakeCompanion` (voice-local-continuous.test.ts:277-368) rejects on **`voice.stt.start` while `holderBusy`** (lines 288-296).

Companion lock-step [inspected]:

| Event | Fake | Live |
|---|---|---|
| start while inferring | `code:"resource_conflict"`, `message:"previous STT infer still in progress"` (test:294-296) | `stt-session-service.ts:177-182` — **byte-identical** |
| chunk/end, unknown sid | `code:"session_unknown"`, `message:"no matching session"` (test:304-322) | `stt-session-core.ts:101 / 170` — identical **when no active session** |
| abort while slot held | `code:"aborted"`, `message:"session aborted"` (test:340-346) | `stt-handlers.ts:330` `sttError(sessionId, "aborted", "session aborted")` — **byte-identical** |
| abort, no slot | `code:"session_unknown"`, `message:"no active session"` (test:348-354) | `stt-session-core.ts:201` — identical |
| reply timing | `setTimeout(..., 0)` macrotask (test:281-283) | WS delivers each frame in its own turn |

The adapter uploads **start then immediately chunks+end in the same sync turn** (`uploadAndWait`, local-stt-adapter.ts:353-381) without waiting for a start ACK. A start-reject therefore **always** produces leftover `session_unknown` frames for those chunks/end, then the retry block sends `voice.stt.abort`. Macrotask replies are load-bearing: they let the `await uploadAndWait` continuation run (sid-swap) at the end of the conflict macrotask, **before** leftover ACKs. A microtask fake would deliver leftover ACKs *before* the sid-swap even with production code intact.

### Would reverting sid-swap fail B1?

**Yes.** [executed] Commenting out `sessionId = retrySid` in the continuous retry block (local-stt-adapter.ts:784; compiled line 735; classic swap at :982 left intact) turns B1 red on the **first** mid-backoff assertion:

```
AssertionError: stale-sid ACKs during backoff must not surface: session_unknown
  actual: [ 'session_unknown' ]
  expected: []
```

That is `voice-local-continuous.test.ts:414`. Mechanism [inspected]: without the swap, leftover `session_unknown` (same sid, `pending` already cleared by the start-conflict) falls through `onWs` to the no-pending kill path (local-stt-adapter.ts:325-327: `handlers.onError(code); handlers.onEnd(); reset()`). `reset()` bumps `loopGen`, so the retry never `sendStart`s `-r1`.

Assertions that go red, in order:

1. `:414` `errors` must be `[]` — gets `session_unknown` (not `aborted`; chunk/end rejects are queued *before* the abort ACK)
2. `:415` `ends === 0` — kill path already called `onEnd`
3. `:430-432` expected `-r1` retry start — loop aborted by `gen !== loopGen`

The old end-conflict microtask fake never produced leftover same-sid ACKs during the 250ms backoff, so reverting `:784` would have stayed green. That hole is closed.

### Tighter start-list asserts

[inspected] `:425` `startSids[0]` must match `/-s1$/`. `:430-432` requires some start ending in `-s1-r1` **or** `-r1`. First-start is tight (parent id would fail). Retry is slightly loose — see N2.

---

## Claim B2 — classic double-stop during delayed `handle.stop()`

**PASS for the current path; `delayMs` is not locked.** [executed + inspected]

Test (voice-local-stt-adapter-ws.test.ts:423-463): `fakeCaptureFactory(..., { delayMs: 80 })`; `stop(); await ~40ms; stop()`. Asserts `errors=[]`, `finals=["ok-classic-dblstop"]`, `ends===1`, zero `voice.stt.abort`. This is **not** three sync stops (that was the residuals-batch shape). The 40ms gap is inside the 80ms drain, so the second `stop()` hits:

```
capture === null && phase === "recording" && stopChainInFlight
```

→ local-stt-adapter.ts:951 `if (stopChainInFlight) return` — not the idle (`:923`) or uploading/waiting (`:941-942`) early-returns.

Mutations against compiled artifacts [executed]:

| Mutation | B2 |
|---|---|
| A. delete `if (opts?.delayMs) await timeout` in `fakeCaptureFactory` | **still PASS** |
| C. delete `if (stopChainInFlight) return` (delayMs kept) | **FAIL** `double-stop must not abort: aborted` (`:456`) |
| D. delete delayMs **and** the guard | **PASS** |

So:

- With `delayMs=80` present, the production guard **is** load-bearing (C). The second stop lands in the drain window; without the guard it takes the no-handle abort path (`:952-955`), `reset()` bumps `loopGen`, the in-flight `handle.stop().then` bails, recording discarded.
- `delayMs` itself is **not** load-bearing for the test remaining green (A). After 40ms with no drain delay, the first stop has already uploaded, `phase==="idle"`, second stop is a no-op at `:923`. The guard is never reached.
- Therefore A+C together: delayMs is a **silent prerequisite** for C. Delete it and you can also delete the production guard without B2 noticing (D).

This is a test-fragility nit, not an untested guard **in the current tree** (current execution with delayMs=80 does exercise `:951`). Rejecting would require treating “delayMs must be uniquely load-bearing” as a failed claim that leaves the guard untested — it is tested now. See N1 for the one-line lock.

Zero `voice.stt.abort` (`:460-461`) is true with or without the guard (the no-handle path errors locally and does not `send` abort). The load-bearing asserts are `:456` errors and `:457` finals.

---

## Hostile Q4 — duplicated `fakeCompanion`

[inspected] Two copies: continuous.test.ts:277 and ws.test.ts:200. Protocol-stripped they differ only in comments and whether `onMessage` is inlined vs extracted. Codes and message strings match. Hygiene only; they have not drifted. See N3.

## Hostile Q5 — did production voice code change?

[executed] No. `local-stt-adapter.ts` is not in the patch. Sid-swap (`:784` / `:982`) and `stopChainInFlight` (`:152`, `:951`) are pre-existing production; this batch only adds tests that lock them.

Streaming start-conflict (synthesis B3: streaming path does not abort / reclaim the slot) is **unchanged and still untested**. Out of scope; not re-opened as a reject.

---

## Findings (non-blocking nits)

### N1 — `delayMs` not asserted, so B2 stays green if it disappears

voice-local-stt-adapter-ws.test.ts:27-29, :446, :451-455.

Deleting the `delayMs` await keeps B2 green and (with the guard also gone) still green. The comment at `:451-452` states the intent; nothing in the assertion set enforces it.

One-line lock: after the first `stop()` and the 40ms wait, assert `sent` has no `voice.stt.start` yet (upload must still be blocked on `handle.stop()`). That fails if delayMs is 0 / stripped, which is the actual double-click-during-drain regime.

Not a reject: current `delayMs: 80` **does** make `:951` load-bearing (mutation C).

### N2 — retry sid assert allows any `*-r1`

voice-local-continuous.test.ts:430-432.

`startSids.some((s) => s.endsWith("-s1-r1") || s.endsWith("-r1"))` would accept `retry-parent-r1` (classic-style, skipping the segment infix). Production always does `` `${segSid}-r1` `` → `retry-parent-s1-r1` (local-stt-adapter.ts:779). Sid-swap revert already dies at `:414` before this line. Tighten to `/-s1-r1$/` if we want the start-list itself to pin the segment retry shape.

### N3 — duplicated `fakeCompanion`

Same protocol in two files. Fine until one grows a V2 abort tweak the other misses. Extract later; not a defect in this batch.

### N4 — chunk/end message string vs bound-mismatch

[inspected] While a *previous* session holds `bound`, live `requirePeer` returns `session_unknown` / **`"session id mismatch"`** (stt-session-service.ts:648-649), not `"no matching session"`. The fake always emits `"no matching session"`. Adapter keys on `msg.code` only (`onWs` :271), so B1 revert-sensitivity is unaffected. Fidelity nit on the message field the tests never read.

---

## Claim table

| Claim | Result | Evidence |
|---|---|---|
| B1 fake is start-conflict + session_unknown + abort ACK, macrotasks | **PASS** | [inspected] test:288-355 vs companion strings; [executed] 15/15 |
| Reverting continuous sid-swap fails B1 | **PASS** | [executed] first red is `:414` `session_unknown`; then `:415` ends; then `:430` no `-r1` |
| Tighter start-list `-s1` / `-r1` | **PASS** (retry slightly loose) | [inspected] `:425`, `:430-432` |
| B2 `stop(); ~40ms; stop()` inside 80ms drain; 0 errors, 1 end, 0 abort | **PASS** | [executed] test green; mutation C proves guard is hit |
| `delayMs` uniquely load-bearing with `stopChainInFlight` | **PARTIAL** | [executed] delayMs stripped → still green (N1) |
| Production voice changed | **No** | [executed] empty diff |
| fakeCompanion drift | **None** (hygiene) | [inspected] N3 |

No P0/P1. B1 is actually revert-sensitive against the real start-conflict leftover-ACK regime. B2 exercises `:951` under the current `delayMs=80` clock; lock that clock with an assertion when convenient.

VERDICT: APPROVE_WITH_NITS
