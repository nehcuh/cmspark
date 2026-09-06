// Qwen3-VL relative [0,1000] → image pixels, then clamp (L-QW-3 revised
// 2026-09-07, #423). Mirrors companion/src/computer/qwen-vl-worker.py::_normalize
// — keep in lockstep.
//
// Adjudication (#423, adversarial consensus grok empirical / pi official docs /
// claude spec): Qwen3-VL ALWAYS emits coordinates in relative [0,1000] of the
// original image — including values that happen to fit inside the pixel bounds
// (e.g. raw x=174 on a 640-wide image means 174/1000·640≈111px, NOT pixel 174).
// The old clamp-only ruling ("never rescale in-bounds values") rested on the
// wrong premise that the model speaks absolute pixels; it caused the 0/10 eval.

/**
 * Map a model-reported (x,y) from Qwen3-VL relative [0,1000] space to image
 * pixels, then clamp to bounds. The final clamp is the safety net for
 * out-of-range values (>1000 or negative), not a coordinate-space detector.
 */
export function normalizeQwenVlPoint(
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number } {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return { x: 0, y: 0 }
  }
  const px = Math.round((x / 1000) * width)
  const py = Math.round((y / 1000) * height)
  return {
    x: Math.max(0, Math.min(width - 1, px)),
    y: Math.max(0, Math.min(height - 1, py)),
  }
}
