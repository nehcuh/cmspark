// Pure-JS preprocessing for Florence-2/TinyClick:
// PNG decode (pngjs) -> bilinear resize to 768x768 -> rescale 1/255 ->
// ImageNet normalize -> Float32Array CHW [1,3,768,768].
// Rationale: WP5's Windows host captures raw RGBA frames, so a dependency-free
// resize+normalize on raw buffers is the production path; PNG decode is only
// a spike convenience. PIL uses bicubic by default (HF CLIPImageProcessor
// resample=3); bilinear vs bicubic pixel deltas are small — the correctness
// arm (exact .npy inputs) isolates any preprocessing-fidelity effect.
const { PNG } = require("pngjs");

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

function bilinearResizeRGBA(src, sw, sh, dw, dh) {
  const dst = Buffer.alloc(dw * dh * 4);
  const xRatio = sw / dw;
  const yRatio = sh / dh;
  for (let y = 0; y < dh; y++) {
    const fy = (y + 0.5) * yRatio - 0.5;
    let y0 = Math.floor(fy);
    const wy = fy - y0;
    if (y0 < 0) y0 = 0;
    let y1 = y0 + 1;
    if (y1 > sh - 1) y1 = sh - 1;
    for (let x = 0; x < dw; x++) {
      const fx = (x + 0.5) * xRatio - 0.5;
      let x0 = Math.floor(fx);
      const wx = fx - x0;
      if (x0 < 0) x0 = 0;
      let x1 = x0 + 1;
      if (x1 > sw - 1) x1 = sw - 1;
      for (let c = 0; c < 4; c++) {
        const p00 = src[(y0 * sw + x0) * 4 + c];
        const p01 = src[(y0 * sw + x1) * 4 + c];
        const p10 = src[(y1 * sw + x0) * 4 + c];
        const p11 = src[(y1 * sw + x1) * 4 + c];
        const top = p00 + (p01 - p00) * wx;
        const bot = p10 + (p11 - p10) * wx;
        dst[(y * dw + x) * 4 + c] = Math.round(top + (bot - top) * wy);
      }
    }
  }
  return dst;
}

// rgba Buffer (768*768*4) -> Float32Array [1,3,768,768] normalized
function rgbaToCHW(rgba, size) {
  const out = new Float32Array(3 * size * size);
  const plane = size * size;
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      out[c * plane + i] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c];
    }
  }
  return out;
}

function preprocessPng(pngPath, size = 768) {
  const t0 = performance.now();
  const png = PNG.sync.read(require("fs").readFileSync(pngPath));
  const tDecode = performance.now();
  const resized =
    png.width === size && png.height === size
      ? png.data
      : bilinearResizeRGBA(png.data, png.width, png.height, size, size);
  const tResize = performance.now();
  const chw = rgbaToCHW(resized, size);
  const tNorm = performance.now();
  return {
    tensor: chw,
    srcSize: [png.width, png.height],
    timings: { decodeMs: tDecode - t0, resizeMs: tResize - tDecode, normalizeMs: tNorm - tResize },
  };
}

module.exports = { preprocessPng, bilinearResizeRGBA, rgbaToCHW };