## Independent Final Delta Review — CMspark #490

### Scope

This review examines the production delta relative to the previously reviewed sources, plus the new test-only evidence. I do not inherit Grok or DeepSeek verdicts. I assessed the supplied current sources (`KnowledgeGraphApp.tsx`, `explorer.ts`, both test scripts) and the claim summary.

### Production delta findings

**Delta (1) — fit every frame until stable; stop simulation on user pan/zoom/selection.**

Current code:

```ts
for (let step = 0; step < ...; step++) {
  const e = forceLayoutTick(...)
  simTicksRef.current++
  if ((e < 0.06 && simTicksRef.current > 50) || simTicksRef.current >= 320) {
    simTicksRef.current = 999
    if (!userCameraRef.current) fitViewRef.current()
  }
}
if (!userCameraRef.current && (!fittedRef.current || simTicksRef.current < 320)) fitViewRef.current()
```

This means every frame until settled re-fits. `initial-200-frames.json` records 200/200 visible in each of the first 20 frames. Settlement still ends at ≤320 ticks or energy<0.06 with >50 ticks, and `if (!userCameraRef.current) fitViewRef.current()` runs until `simTicksRef.current >= 320`. The early-fit loop doesn't leave nodes off-canvas because the draw loop re-fits each frame during layout. No defect found.

**Delta (2) — ResizeObserver preserves custom camera.**

Current resize handler:

```ts
if (userCameraRef.current) {
  panRef.current.x += (rect.width - previousSize.w) / 2
  panRef.current.y += (rect.height - previousSize.h) / 2
} else fitViewRef.current()
```

`camera-preservation.json` demonstrates custom scale/pan preserved across list toggle and 4 viewport resizes, with center-offset math validating the half-delta pan. This is consistent and correct.

**Delta (3) — unrelated send failures do not clear organize state.**

`sendLock` and `onLlmChange` use `onActionResponse` alone, which only mutates `requestError`. `sendOrganize` uniquely restores `confirmedOrganizingRef.current` on failed send. The UI test exercises exactly this: failed lock and failed LLM toggle during `organizing` keep the button disabled; failed new organize restores enabled state. Correct.

**Delta (4) — precomputed titles, related-edge memo, singleton matchMedia.**

Title map is built in a `useEffect` dependent on `payloadNodes`, `colorMode`, `labels`. `relatedEdges` is now `useMemo`. `motionPreference` is created inside the mount effect, so once per canvas mount. These match the delta description.

**Delta (5) — `type="button"` on lock-dissolved notice.**

Confirmed in source. Design header not inspected in this packet, but this was a stated nit from prior review and appears addressed in the notice control.

### Adjudication of prior reviewer disagreements

**Grok P2-1: controlled `<details>` resets on unrelated renders.**

Current React reconciliation does *not* repatch the DOM `open` attribute on renders where the prop value is unchanged. A native `<details>` remains user-toggled. The claimed test evidence is `details-toggle.json`, showing manual collapse at 4 and expansion at 20 surviving query/hover. However, this test also performs a fixture republish for the 20-node case (`locked20`), which changes `payloadNodes` and therefore changes the `open` prop. But the sequence shows the manual `open` state surviving the query and hover. The unlock at 20 being reachable is verified. The static claim alone cannot outweigh the real browser behavior. No P1/P2.

**DeepSeek P1-1 pointercancel capture leak.**

The production `onPointerCancel` only nulls `dragRef`. The trusted CDP evidence shows implicit capture release by the UA after `pointercancel`, with `lostpointercapture` delivered. Subsequent unpressed mouse moves do not pan. W3C Pointer Events §5.2.2 and §9.5 confirm implicit capture release on pointercancel. No defect.

**DeepSeek P1-2 offline hang.**

The service worker send path returns `{ok: true, sent: true/false}`. The UI checks `ok === false || sent === false` and renders an explicit connection error. `applySnap` clears `requestError` when a valid snapshot arrives (including `organizing: false`), so stale error clears on next push. Rebuild polling is bounded at 40×2.5s. This is a narrow, honest transport-failure scope; a universal hung-companion watchdog is not claimed. No P1.

**DeepSeek P1-3 one-way organizing error.**

`applySnap` unconditionally calls `setRequestError("")` after successful parse. A completion push (`organizing: false`) clears the 35s fallback message. Not one-way. No defect.

### Residual observations

- `graphStyles` is still a new template string every render, inline `<style>` node, but the claim did not include styling memoization. Nonblocking.
- `titleByIdRef` recomputed when colorMode changes even though titles don't depend on colorMode; negligible.
- The 200-node test records only first 20 frames and `after.json` shows painted counts. The prior 191/200 discrepancy is resolved by the new per-frame fit; `initial-200-frames.json` is 200/200 for 20 frames. No P2 remains.
- The backend boolean `organizing` fix and 19→20 group gating are unchanged from prior review and remain correct in the provided source.
- #491 remains not addressed, and is explicitly not part of this delta.

### Verdict

The production delta addresses the substantive defects from the prior round: camera stability and user gesture preservation, organize-state isolation from unrelated send failures, and performance hygiene. The test-only delta adds direct browser evidence resolving the two contested claims (details persistence, pointercancel capture release). No new P0/P1/P2 defects are present in the reviewed sources.

VERDICT: APPROVE