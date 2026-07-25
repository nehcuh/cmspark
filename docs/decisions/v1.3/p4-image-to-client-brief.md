# P4 Diff Brief — locate-chain imageToClient integration

**Date**: 2026-07-25
**Scope**: Single-bug fix to v1.3 P3 merge. No new functionality.
**Trail**: `plan-approach-c-minus-v4-grok.md` §4 (Defect 3) → P3 (`dba8915`) landed but **missed wiring** `coords.imageToClient` into locate-chain.

## 1. Problem

User ran a 3-action `host_computer` task against WeChat (retina, scale=2). First two clicks hit OCR words near the top of the client area and succeeded. Third click targeted a word box lower in the window and failed:

```
computer: (269.3023242222588, 1004.6511631446756) outside client rect 880x640
```

`880×640` is the logical client; `1004.65` is an **image-pixel** y-coordinate. The chain is blessing an image-space point against logical-space bounds → false OOB.

## 2. Root cause

`coords.ts:60` defines `imageToClient(p, scales, clientImageRect)` — the canonical converter per v4 plan §4 ("single conversion site"). **Grep shows zero call sites.**

`locate-chain.ts` computes `pointClient` for OCR / TinyClick hits with the legacy formula:

```ts
{ x: ocrHit.x - shot.client.x, y: ocrHit.y - shot.client.y }
```

- `ocrHit.x` is image-pixel space (PNG pixel coordinates from Vision OCR)
- `shot.client.x` is logical space (AX-reported)
- Subtracting them is meaningful only when `scale === 1`

On retina the result is garbage. The first two clicks appeared to work because their image-y was small enough that `imageY - client.y` still fell inside the (coincidentally larger) client height.

### Why wasn't this caught

- v4 plan §4 specified the conversion contract, but the implementation ticket split P2 plumbing (host.swift retina fields) from P3 (hwnd drift). Neither phase touched the OCR/TinyClick pointClient lines.
- `executor.ts:901` has `maybeAutoscaleImageToClient` as an OOB-time fallback, but Pi R5's swap-orientation ambiguity rule refuses autoscale when both `(x/sx, y/sy)` and `(y/sy, x/sx)` land in client bounds — common when sx===sy. So the fallback doesn't save the L1/L2 path on retina.
- Unit tests in `computer-locate-chain.test.ts` use `shotAt()` defaults with scale=1, so the legacy formula and the correct formula produce identical results.

### L0 UIA path is correct

`locate-chain.ts:312-317` and `424-428` manually multiply by `sxL`/`syL` when computing `img`/`img2` for the UIA→image bbox. That math is right because UIA returns screen-logical points (not image pixels) and the multiply by scale is the correct screen→image transform. P4 does NOT touch this — only the `pointClient` return values.

## 3. Diff spec

### 3.1 `companion/src/computer/coords.ts`

Change `imageToClient` signature: accept logical-space client rect (matches `shot.client`) instead of image-space.

```ts
// BEFORE
export function imageToClient(
  p: PointImage,
  scales: CoordScales,
  clientImageRect: RectPx,
): PointClient {
  const sx = scales.scaleX > 0 ? scales.scaleX : 1
  const sy = scales.scaleY > 0 ? scales.scaleY : 1
  return {
    x: p.x / sx - clientImageRect.x,
    y: p.y / sy - clientImageRect.y,
  }
}

// AFTER
export function imageToClient(
  p: PointImage,
  scales: CoordScales,
  clientLogical: RectPx,
): PointClient {
  const sx = scales.scaleX > 0 ? scales.scaleX : 1
  const sy = scales.scaleY > 0 ? scales.scaleY : 1
  return {
    x: p.x / sx - clientLogical.x,
    y: p.y / sy - clientLogical.y,
  }
}
```

Math is identical (`p.x/sx - client.x` ≡ `(p.x - client.x*sx)/sx`); only the parameter contract changes. Doc comment updated to say "client-logical" instead of "image".

### 3.2 `companion/src/computer/locate-chain.ts`

Add import at top:

```ts
import { rectDriftPx, imageToClient } from "./coords"
```

Replace 6 `pointClient` returns:

| Line | Path | Current | New |
|---|---|---|---|
| 403 | L0 UIA direct | `{ x: img.x - shot.client.x, y: img.y - shot.client.y }` | `imageToClient(img, scalesOf(shot), shot.client)` |
| 462 | L0 UIA re-probe | `{ x: img2.x - shot.client.x, ... }` | `imageToClient(img2, scalesOf(shot), shot.client)` |
| 493 | L1 OCR region crop | `pointClient0 = { x: ocrHit.x - shot.client.x, ... }` | `pointClient0 = imageToClient({x: ocrHit.x, y: ocrHit.y}, scalesOf(shot), shot.client)` |
| 524 | L1 OCR stable | same | same replacement |
| 564 | L1 OCR relocate | same with `hit2` | `imageToClient({x: hit2.x, y: hit2.y}, ...)` |
| 600 | L2 TinyClick | `{ x: outcome.point.x - shot.client.x, ... }` | `imageToClient(outcome.point, scalesOf(shot), shot.client)` |

Helper at top of file (or inline):

```ts
const scalesOf = (s: CaptureMeta): CoordScales => ({
  imageWidth: s.imageWidth ?? s.rect.width,
  imageHeight: s.imageHeight ?? s.rect.height,
  scaleX: s.scaleX ?? 1,
  scaleY: s.scaleY ?? 1,
})
```

(Falls back to scale=1 when metadata missing — preserves legacy behavior for non-Retina / pre-v4 binaries.)

### 3.3 What stays unchanged

- L0 `img` and `imgBbox` calculations at 312-323 and 424-438 — these feed witness OCR (image-space) and must stay in image-pixel space.
- `executor.ts:901` `maybeAutoscaleImageToClient` — independent OOB-time fallback, separate concern.
- `screenToClient` / `clientToScreen` — not involved in this bug.

## 4. Test plan

### 4.1 `computer-coords.test.ts` (existing tests adapted + new)

- Adapt 3 existing `imageToClient:` tests to new signature (parameter rename only, math unchanged).
- Add: `imageToClient: retina image point with logical client offset` — image (1348, 1004) + scale 2 + client logical (0, 0, 880, 640) → (674, 502) (NOT 1348 or 962).
- Add: `imageToClient: non-retina matches legacy math` (scale=1 → identical to `p.x - client.x`).

### 4.2 `computer-locate-chain.test.ts`

- Add a `RETINA_SHOT` helper variant: `shotAt(path, rect, client, {scaleX: 2, scaleY: 2, imageWidth: 1760, imageHeight: 1280})`.
- Add test: **`P4 imageToClient integration: L1 OCR hit on retina produces logical pointClient (no false OOB)`**
  - FakeLocator word at image (1348, 1004) → pointClient should be `(674 - client.x, 502 - client.y)` = (674, 462) with default client.
  - Without the fix, pointClient.y would be 964 → outside the 640-tall client.
- Add test: **`P4 imageToClient integration: L2 TinyClick on retina produces logical pointClient`** — same shape, smaller scope.

### 4.3 Regression

- Existing 151 P3-area tests pass unchanged.
- `npx tsc --noEmit` clean.

## 5. Risk

- **Low**. 6 mechanical replacements + 1 signature change with zero external callers.
- Largest risk: the `scalesOf` helper defaults to scale=1 on missing metadata. If a real ShotMeta ever carries `scaleX: 0`, behavior is preserved (legacy math) rather than crashed. Verify `CaptureMeta.scaleX` field optionality.
- No new error codes; no schema changes; no IPC changes.

## 6. Out of scope

- L0 UIA's manual `img`/`imgBbox` multiplication — not broken, not touched.
- `maybeAutoscaleImageToClient` swap-orientation ambiguity (Pi R5) — separate design decision.
- Witness verdict OCR's image-space bbox — not broken.
- Frozen-contentful detector / staleIdCaret / CUBox daemon lock (carried Pi P2 deferred items).

## 7. Commit plan

Single commit: `fix(computer): P4 imageToClient wiring in locate-chain (D4.3 follow-up)`.

## 8. Review questions for Grok / Pi

1. Is changing `imageToClient` signature (image-space → logical-space client rect) the right call, or should the function keep image-space and the call sites convert?
2. Is the `scalesOf` helper's `?? 1` fallback for missing metadata correct, or should missing `scaleX/Y` on a retina display be a hard error?
3. Any path where the existing legacy formula is actually correct (e.g., non-PNG OCR source returning logical coords)? Grepped: PsLocator returns Vision OCR word boxes from `shot.path` (PNG) → all image-space. Verify.
4. L0 UIA keeps manual `* sxL` for `img`/`imgBbox` — witness invariant. Confirm witness must stay in image-space (per `ocrWitnessCheck` API).
