## Final small-delta review — CMspark #490

**Scope kept:** `html,body` reset in existing `graphStyles`; `type="button"` on 取消; fixture no longer injects a competing page reset; camera wait samples CSS box + bitmap + last completed frame in one evaluate.

### Production

`html, body { margin: 0; background: ${G.canvas} }` is the right host-document fix. Plasmo tab HTML has no UA reset; 8px default margin would shrink the canvas and show a light gutter. Module-scope interpolation of the existing canvas token is not a per-render alloc and does not touch graph logic, wire, or permissions.

`type="button"` on 取消 closes the leftover cosmetic hole. No form in this tree; still correct.

### Evidence (this packet only)

`built-smoke.log` on **actual Plasmo HTML/JS**: `bodyMargin`/`htmlMargin` `0px`, `overflow` false, canvas `1120×671` @1440 and `390×346` @390, colored pixels present. Product styles, not fixture CSS, are doing the work.

`camera-preservation.json` now holds a **stable** world-center offset (`xFromCenter` 116.98, `yFromCenter` 15.55, `r` 10) across list toggle and 1440/960/390/1280, while `width`/`cssWidth`/`drawnFrameWidth` (and height) move together and `drawnFrame > beforeFrame`. That is the ResizeObserver `pan += Δsize/2` path, not a pre-RO frame. Grok’s prior NIT-1 is **closed** by this artifact.

UI log still all PASS; pointercancel / details / organize isolation unchanged and out of this delta.

### Findings

**P0 / P1 / P2:** none in this delta.

No recycled nits: 35s busy fiction, title-line clip, unvirtualized 200-row list are unchanged and not in this surface.

**VERDICT: APPROVE**
