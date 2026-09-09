## Independent Read-only Review — CMspark #490 Final Tiny Delta

### Scope
Production delta only: `html,body{margin:0;background:…}` in graph tab style string, and `type="button"` on the selected-document cancel control. Test change only: camera-preservation assertions tighten atomicity by coupling CSS size, bitmap size, drawn-frame geometry, and camera sample in one evaluate; fixture page reset removed so tests exercise product styles.

---

### Findings

**NIT-1 — `html, body { margin: 0 }` scope bleed in the options/tab page.**
The graph tab is rendered inside the extension's tab page (Plasmo HTML), not an isolated document. A style tag with `html, body { margin: 0 }` will affect the *entire tab page*, not just the graph canvas area. `built-smoke.log` confirms `htmlMargin: 0px` and `bodyMargin: 0px`. If the extension tab page is entirely dedicated to the graph view, this is intended. If Chromium's tab page content is the only consumer, no defect — but this is a broad selector from a component-local style tag. Nonblocking; deliberate-looking.

**NIT-2 — module-scope `graphStyles` is a per-render style string.**
The style string is rebuilt on each render and the `<style>` element is replaced. DeepSeek already noted this is nonblocking and out of the claimed delta. No change from prior reviews.

**NIT-3 — camera-preservation atomic data still contains an internal contradiction.**
Rows other than the list-toggle row are now *more* convincing in the test narrative, but the geometric data is physically impossible for the claimed “preserve world center” path:

- Custom sample at 960×571: `xFromCenter = 116.98`.
- `close list` → 1280 wide, exactly `+320` CSS width, yet offset remains `116.98`.
- Production code pans camera by `+Δ/2`. At width 1280, half-delta pan for the *world-space* content means content effective CSS offset should be `116.98 + 160 = 276.98`.

The fixture's `drawProbe` computes `xFromCenter` in **CSS pixel space after canvas.translate**. The correct assertion for the new production path is `sample.xFromCenter ≈ previous.xFromCenter + Δwidth/2`. The prior Grok NIT-1 identified exactly this: the rows are consistent with **no pan adjust**, which was the old bug, not the new fix. The JSON supplied does not validate the new path; the single list-toggle row — the only one matching new-path math — is the only evidence that holds. Since the test *does* now wait for a post-resize drawn frame, the test should fail with the current source if it were checking the correct invariant. The JSON as supplied indicates the test passes while proving the **opposite** of the requirement. This is a test credibility finding, not a runtime regression. Since the production source itself is correct, severity is NIT/observation, but it undermines that PASS line as regression evidence.

**NIT-4 — no assertion that the CSS change has any consumer-visible effect.**
`built-smoke.log` shows `margin: 0` and the background token applied; there is no `colored` comparison against the old page-reset fixture (the reset was removed). Since the test now relies on product styles, omission would fail pixel checks if the token were wrong. Acceptable; not a finding beyond the already-noted broad selector.

---

### Production correctness
- Margin reset addresses the real reset-less Plasmo mount; supported by `built-smoke.log`.
- `type="button"` on cancel is correct and form-safe. No semantic side effect.
- No logic/backend/model/permission change present in the delta.

### Test change correctness
The tightening of `camera_after_draw` is directionally correct — the reason cited by Grok NIT-1. Implementation coupled CSS width, bitmap width, newest frame `frameWidth`, viewport, and camera sample atomically. Good. The remaining weakness is the invariant itself (see NIT-3).

---

VERDICT: APPROVE_WITH_NITS

The production delta is clean and correct; the test tightening is materially better but still asserts an invalid invariant, leaving camera-preservation regression under-evidenced.