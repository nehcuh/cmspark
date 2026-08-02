// Pixel-only coordinate clamp for Qwen3-VL experimental locate (SoT D3 / L-QW-3).
// Mirrors companion/src/computer/qwen-vl-worker.py::_normalize — keep in lockstep.

/**
 * Clamp model-reported (x,y) to image pixel bounds.
 * NEVER rescale 0–1000 relative spaces when values already fit the image.
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
  const px = Math.round(x)
  const py = Math.round(y)
  return {
    x: Math.max(0, Math.min(width - 1, px)),
    y: Math.max(0, Math.min(height - 1, py)),
  }
}
