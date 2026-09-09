## Independent Read-Only Review — CMspark Issue #490 (Test-Only Delta)

### Scope

This follow-up reviews the test-only delta in `test-knowledge-graph-ui.py`: actual keyboard event coverage and trusted CDP pointer-cancel regression coverage. Production `KnowledgeGraphApp.tsx` is unchanged from the prior review packet. I also adjudicate the prior DeepSeek claims against the new evidence and the full source provided.

### Adjudication of prior claims

**P1-1 (`onPointerCancel` stuck drag / pointer capture leak): DISPROVEN.**

The production handler remains `onPointerCancel={() => { dragRef.current = null }}`. The prior review speculated that this skips `endDrag` cleanup, causing capture leaks or missed selection. The new trusted CDP touch test directly exercises the browser's actual input pipeline:

- `pointerdown` (trusted, `captureDuringEvent: true`)
- `gotpointercapture` (trusted, `captureDuringEvent: true`)
- `pointermove` (trusted)
- `pointercancel` (trusted, `captureDuringEvent: true` — note capture is still held during the cancel event itself)
- `lostpointercapture` (trusted, `captureDuringEvent: false`)

This matches W3C Pointer Events §9.5 exactly: the user agent releases implicit capture automatically after `pointercancel` and fires `lostpointercapture`. The test then verifies:

- No document open was sent (`knowledge_graph.open_doc` count unchanged)
- No relation/reason panel opened
- Camera position unchanged after `touchCancel` followed by unpressed mouse moves at different coordinates (`after_hover` matches `after_cancel` within 0.1px)

The "no document/reason opening on cancel" behavior is intentional: the production code's `endDrag` only runs the click-completion path on `pointerup`. On `pointercancel`, the UA has already invalidated the stream; treating cancel as click would be semantically wrong. The test's mouse-move-after-cancel check proves no residual drag ref retains capture or continues panning. This is direct, trusted, reproducible evidence. **Not a defect.**

**P1-2 (refresh error detection / offline hang): NOT SUPPORTED as a P1.**

The background route shown in evidence is:

```ts
const sent = wsClient?.send(frame) === true
if (!sent) { untrackGraphRequest(reqId) }
return { ok: true, sent }
```

The UI checks `chrome.runtime.lastError || res?.ok === false || res?.sent === false`. The `sent` return value is a concrete send-layer failure signal from the service worker. The prior review claimed the callback couldn't reliably distinguish companion-hung from companion-responded-with-error. That is true for a *hung companion after a successful send* — but the production code never claims to detect that in this single response path. The UI has separate recovery paths for that scenario:

- `applySnap` clears `requestError` on every accepted snapshot (including `organizing: false`), so any later push corrects the visible state.
- The rebuilding state has bounded polling (`REBUILD_POLL_MAX = 40` at 2.5s intervals = 100s), after which `pollExhausted` produces an honest manual-refresh prompt.
- `sendOrganize` has a 35s fallback for a lost organize completion.

The test suite explicitly passes the failed-send path (`window.sendFailure=true` → connection error → usable snapshot preserved). That is the scope of the DoD claim. Treating "hung companion after acknowledged send" as a send-layer failure is an overreach. Broad hung-peer watchdog is legitimately separate robustness work, not a blocker for this T2 panel repair. **Downgrade to nonblocking observation.**

**P1-3 (organizing lost-response one-way error): DISPROVEN as a committed-actual-defect.**

The prior review claimed the error message is one-way and may persist misleadingly. The full source shows `applySnap` calls `setRequestError("")` unconditionally after a successful parse — including when `parsed.organizing === false`. So if the 35s fallback fires ("尚未收到整理结果"), and the completion push later arrives with `organizing: false`, `applySnap` clears the stale error. The only residual edge is if the push arrives *while* the requestError shows and the push has `organizing: true` (unlikely mid-completion) — but then the organize is genuinely still running. The state machine is two-way on acknowledge. **Not a defect.**

**P2-2 (resize clobbers user camera): EXPLICIT UX DECISION, not a defect.**

The resize handler unconditionally calls `fitViewRef.current()`. The production source comments: "Reflow changes the actual canvas area, not an overlay on the old area. `fitViewRef.current()`." This is deliberate: when the canvas bitmap changes size, the prior camera coordinates are in a different physical space. Fitting on reflow preserves visibility. The responsive test suite (320/390/760/960/1440) verifies real canvas sizes, painted nodes, no overlap, no horizontal overflow. The prior review itself noted the base had no resize observer, so this is new intended behavior, not a regression. **Downgrade to nonblocking observation at most.**

**P2-3 / Nit-1 / Nit-3 (per-render compute, missing animation): NONBLOCKING.**

`relatedEdges` is computed inline in render and `shortKnowledgeTitle` in the draw loop. At ≤200 nodes with 12 relations max and a single panel page, this is sub-millisecond and below actionable threshold. No frame defect is measured in the test evidence. The test suite's painted-probe assertions confirm real drawing at 1/4/20/200 nodes. **Not a blocker.**

### Keyboard coverage assessment

The new actual-keyboard test section exercises real `page.keyboard.press()` against a focused Canvas, with pre-settlement stabilization (6 consecutive stable frames) before assertions. Verified:

- `ArrowLeft` and `ArrowRight` change native Canvas arc positions by exactly the expected 40px (within 0.1px)
- `Home` and `0` restore fitted position
- `+` and `-` change native radii by exactly 1.25× and 0.8× (within 0.01px)
- List Enter on a focused document button selects the correct document (aria-pressed=true, correct title, no spurious open_doc) and Canvas Escape clears selection

The `Escape`-before-snapshot-camera-stability trick is sound: it makes clear the measured position changes are keyboard events, not the force-layout animation. The assertions against `drawProbe.latestArcs[0]` are race-free because they wait on exact expectations, not timeouts.

### Test evidence quality

The `pointercancel.json` artifact is generated directly from real CDP `Input.dispatchTouchEvent` with touch emulation enabled. All events are `isTrusted: true`. The sequence `pointerdown → gotpointercapture → pointermove → pointercancel → lostpointercapture` with capture true→false is exactly the §9.5 contract. The camera-before/after comparison uses a stable settled frame baseline, and the unpressed-move check uses real mouse moves to prove no leftover drag state.

The `ui-keyboard.log` and `ui-pointercancel.log` both show the full suite passing consistently, including the pointercancel-specific PASS line with the complete trusted event evidence.

### Verdict

The prior reviewer's three P1 findings are addressed:

- **P1-1**: Disproven by trusted CDP evidence.
- **P1-2**: Not supported; send-layer detection is implemented and tested; hung-companion watchdog is out of scope.
- **P1-3**: Disproven; `applySnap` clears requestError on every accepted snapshot.

The P2/nit-level observations (resize camera fit, per-render compute, missing locate animation) are explicit UX decisions or sub-actionable performance notes, not blockers.

The test-only delta adds concrete, trusted, reproducible regression coverage for the exact interaction the prior review flagged as untested. Production source remains coherent with the test's assertions.

**VERDICT: APPROVE**