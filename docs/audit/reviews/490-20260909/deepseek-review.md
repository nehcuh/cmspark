## Independent Read-Only Review — CMspark Issue #490

### Scope and trajectory assessment

The change is a T2 panel-only knowledge graph usability repair. Base aada096a exhibits a concrete rendering failure — canvas 300×150, zero draw calls, zero opaque pixels despite 4 real snapshot nodes. The proposed diff fixes the mount lifecycle (`useEffect []` → `[showCanvas]`), adds a searchable list, camera controls, refresh recovery, and an honest `organizing` job-state flag. The backend lane fix (`buildKnowledgeGraph` gating stale LLM groups on `llmLane`) addresses a real cross-lane contamination bug where unlocked LLM groups leaked into the ≥20 TF lane without corresponding labels. The diff does not touch transport, trust, actions, permissions, or user data/config. The plan explicitly scopes out threshold/retrieval/content changes and preserves all existing AI naming, organizing, lock/unlock, and provenance capabilities.

The machine evidence is substantive: the baseline capture reproduces the dead canvas; the after-capture shows real pixel drawing at 1/4/20/200 nodes; the Python suite exercises delayed storage, stale-result race protection, error→refresh remount, responsive 320/760/1440, search/group intersection never dropping graph data, and the dashed AI/solid similarity distinction with pixel-level probes. Backend logs show 52→54 green tests with targeted red-green organize lifecycle evidence. The fixture harness reads the production `knowledgeGraphFrame` serializer from source rather than hand-copying wire keys — this materially strengthens the evidence quality.

### Findings

**P0**: None found. The canvas lifecycle fix is directly evidenced by the before/after capture against the stated base. The stale-storage guard (`receivedSnapshot`) prevents a legitimate race that would otherwise re-introduce the blank canvas under delayed `session.get` vs `onChanged`. No trust/ACL expansion; the only new wire field (`organizing`) is additive, optional, and parse-fail closed.

**P1-1: `onPointerCancel` behavior change — potential stuck drag state.**

The diff changes the cancel handler from:

```
onPointerCancel={(ev) => endDrag(ev)}
```

to:

```
onPointerCancel={() => { dragRef.current = null }}
```

Whereas the old code routed pointer cancel through the full `endDrag` (which would run the click-to-locate or edge-open path if `moved` was false), the new code just nulls the drag ref. This means a pointer cancel on a node or edge no longer triggers document selection or edge-reason opening. More importantly, if the browser fires `pointercancel` without a corresponding `pointerup`, `endDrag` never runs its `releasePointerCapture` cleanup. In practice Chrome generally fires `pointerup` after `pointercancel`, so the practical impact is likely minor, but the asymmetry is real. This is a P1 because pointer capture leaks or missed selection on OS-level gesture interrupts (e.g., trackpad accidental gestures, window focus loss during drag) would degrade the interaction the issue set out to improve. It is not a regression from the base’s drawing failure, but it is a newly introduced interactive defect within this diff.

Location: `KnowledgeGraphApp.tsx`, canvas `onPointerCancel`.

Recommendation: reproduce the `pointercancel` path in the fixture and either route through `endDrag` or explicitly call `releasePointerCapture` before nulling the ref.

**P1-2: `refresh` guard `res?.ok` on Chrome runtime callback response is too weak for the claimed error state.**

The new `refresh` callback checks `chrome.runtime.lastError || res?.ok === false || res?.sent === false`, but the baseline code path in the visible fixture (`window.chrome.runtime.sendMessage` in the test harness) only ever responds with `{ sent: !window.sendFailure }`. In the real extension background, `chrome.runtime.sendMessage` from the content side to the service worker does *not* produce a `chrome.runtime.lastError` merely because the companion is offline — if the service worker is alive, it may respond with an ACK or error only after its own round-trip. The UI then relies on `applySnap`/`onChanged` to eventually deliver a failure frame. The `requestError` path is thus only partially reachable: it catches send-time failure but cannot reliably distinguish “companion did not respond” from “companion responded with an error frame.” That weakens the claimed “offline/failed distinct recovery copy” DoD item, because a hung companion can leave the refresh promise pending indefinitely without UI signal. The backend tests cover error frames, but nothing in the evidence exercises the extension transport failure at the service-worker level (only the synthetic `sendFailure` injection). This is a scope-relevant, P1 confidence gap rather than a proven user-facing defect.

Recommendation: either add a bounded timeout to `chrome.runtime.sendMessage` responses and surface “no response” as a distinct state, or explicitly claim “disconnected transport at the send layer” in the DoD and leave companion-hang detection to a separate ticket. As written, the copy claims “请确认程序运行后刷新图谱” which may not fire in the hang case.

**P1-3: `organizing` state races when the organize response is lost.**

When `sendOrganize` is clicked, the UI sets `organizing = true` locally. It then relies on either (a) the `knowledge.graph` response carrying `organizing: true` (from `knowledgeGraphOrganizeRun !== null`), or (b) the later push with `organizing: false` to clear the busy state. If the extension’s transport to the companion succeeds but the completion push is lost (e.g., service worker kill during the async LLM settle, or the push fails silently because the panel tab was closed/reopened), the UI has a 35-second timer that falls back to clearing `organizing` and showing “尚未收到整理结果.” That is the honest fallback, but it doesn’t recover the actual job state — a subsequent manual “refresh” would still be required. This is acceptable for a T2 repair, but the 35s fallback is a fixed magic number that can show the “尚未收到” copy while the job actually completes successfully later (the push may arrive after the timeout and set `organizing: false`, but the previous error copy remains). The evidence tests the fixture-level `organizing` transition, not the lost-push window. P1 nit-grade: the state machine is one-way for the error message and may mislead the user during slow-but-successful organization.

Location: `KnowledgeGraphApp.tsx`, `sendOrganize`, the 35s `setTimeout`, and `onActionResponse`.

Recommendation: when a push with `organizing: false` arrives, also clear the `requestError` if it was the “尚未收到整理结果” message, to correct the stale state.

**P2-1: `refresh` is a dependency of the mounting `useEffect` but is recreated on each render.**

`refresh` is `useCallback`-wrapped with `[]` deps, so it is stable across renders. The mount `useEffect` lists `[applySnap, refresh]` — both stable. No churn. This is fine; not a finding.

**P2-2: `fitView` called from `ResizeObserver` may clobber camera during a user drag/zoom.**

In the `resize` handler, the code unconditionally calls `fitViewRef.current()` whenever the parent container’s size changes, even if `userCameraRef.current` is true. During a live resize (e.g., opening a devtools panel, window snap on Windows), the user’s deliberate pan/zoom is discarded. The responsive test suite asserts non-overlapping layout and correct bitmap dimensions, but it does not assert camera preservation across a resize while the user has a custom camera. This is a minor UX regression from the base (which also reset camera on effect, but didn’t have a resize observer). P2.

Recommendation: in `resize`, skip `fitViewRef.current()` when `userCameraRef.current` is true, or clamp the existing pan/scale to the new geometry.

**P2-3: `locateNode` sets `scaleRef.current = Math.max(1, scaleRef.current)` but doesn’t recompute pan after forcing scale up.**

If the user is zoomed out to 0.08× and clicks a list node, `scaleRef.current` jumps to 1 instantly, then `panRef` is set to `{ x: w/2 - n.x * scale, y: h/2 - n.y * scale }`. Since `scale` is now 1, the node is centered correctly on screen. But the visual jump is abrupt and may feel like a bug; the base had no list or locate, so this is new behavior, not a regression. The code doesn’t animate the transition, which may be acceptable for a T2 repair but conflicts with the “calm, precise” design language in DESIGN.md. Nil-grade.

**Nit-1: `relatedEdges` recomputed inline in render, bypassing `useMemo`.**

`relatedEdges` maps `payloadEdges` and `payloadRelations` through `knowledgeGraphPairKey` on every render to find the selected node’s relations. This is O(n) with string concatenation in a hot path that re-renders on every `hoverCaptionText` change (because `setHoverCaptionText` in `onPointerMove` triggers a state update per pointer event, which re-renders the component, which recomputes `relatedEdges`). With 200 nodes and up to 12 relations this is not a practical problem on modern hardware, but it’s unnecessary churn. The base didn’t have this compute at all. A `useMemo` keyed on `[selected, payloadEdges, payloadRelations]` would be cleaner and aligns with the existing `useMemo` discipline elsewhere in the component.

**Nit-2: `selected` depends on `payloadNodes.find(n => n.id === focusId)` but `focusId` can be set from an old snapshot’s `focus_id` before the new snapshot is applied.**

The mount/effect cleans up invalid `focusId` when `showCanvas` turns true, so the stale `focusId` from an error/rebuilding frame is dropped when the new snapshot mounts. This is correct, but only because `showCanvas` is `false` during error/rebuilding, so the cleanup effect (gated on `showCanvas`) won’t run until a real node set is available. If a snapshot had `focus_id` set to an id that exists in fewer than all documents (e.g., a doc outside the 200-doc truncation cap), the cleanup runs and clears selection — reasonable. No change needed; noted for re-review.

**Nit-3: `KnowledgeGraphApp` keeps `captionByIdRef` and `nodesByIdRef` on `useMemo`/`useEffect` boundaries, but `shortKnowledgeTitle` is computed inside the `requestAnimationFrame` draw loop for every node, every frame.**

`shortKnowledgeTitle` calls `Array.from(title.trim() || id)`, iterates, slices, and joins each frame for up to 200 nodes at ~60 fps. This is a measurable but likely sub-millisecond cost at 200 nodes; the base app did no title computation at all. Could be memoized per node in the `useEffect` that builds `nodesByIdRef`. Nit.

---

### Regression vs. existing issues

- **Base blank canvas**: regression of the base’s failure, fully addressed with direct before/after evidence at the same base commit. This is the core fix.
- **Stale unlocked LLM groups at >=20**: base bug, fixed in backend with targeted red-green tests including lock preservation and label completeness.
- **`onPointerCancel`**: newly introduced behavior change in this diff, cannot be attributed to base.
- **Refresh error detection**: pre-existing general limitation of `chrome.runtime.sendMessage` callback semantics, now surfaced more prominently by the new refresh UI but not caused by this diff.
- **Camera reset on resize**: new interaction introduced by the `ResizeObserver` and `fitView` call; base had no resize observer.

### Verdict

The diff successfully fixes the original blank-canvas regression at the stated base commit, preserves all existing capabilities, and adds the requested discoverability features without scope creep into trust/ACL/data. The backend `organizing` field is correctly optional and parse-fail closed. The evidence is genuine: the production serializer is sourced from the router, the baseline is captured at aada096a, and pixel assertions validate real drawing.

The P1 items are all within the new interaction surface rather than the core rendering repair, and none of them nullify the central fix. They are, however, concrete and reproducible in the source with plausible user-visible consequences.

**VERDICT: APPROVE_WITH_NITS**