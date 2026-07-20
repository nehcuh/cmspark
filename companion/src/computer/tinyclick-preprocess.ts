// WP5 I2 WI-2.3 — TinyClick 图像预处理（生产化；与 spike w1w2-worker-sea/preprocess.js
// 逐行同构，并与 HF Florence-2 processor 分布对齐）。
//
// M1 纪律（plan 对抗修订）：**stretch 逐轴缩放**——xRatio=sw/dw 与 yRatio=sh/dh
// 独立、零 padding；这是 S-1 parity / W2 / S-3 全部 spike 证据使用的预处理。
// letterbox 属证据地基之外的另一种预处理（已勘误，M1/P1-a）——本模块永不提供，
// 坐标反变换亦按逐轴线性映射（与缩放同构，往返误差 ≤1px 由测试锁定）。

/** 模型输入边长（Florence-2/TinyClick 恒 768²）。 */
export const TINYCLOCK_INPUT_SIZE = 768

const MEAN = [0.485, 0.456, 0.406] as const
const STD = [0.229, 0.224, 0.225] as const

/**
 * stretch 逐轴双线性缩放（RGBA → RGBA，dw×dh）。
 * 与 spike bilinearResizeRGBA 同算法：中心对齐采样 fy=(y+0.5)*yRatio-0.5，
 * 边界 clamp——逐轴独立缩放，任何长宽比都拉伸铺满，不留黑边（M1）。
 */
export function stretchResizeRGBA(
  src: Uint8Array,
  sw: number,
  sh: number,
  dw: number = TINYCLOCK_INPUT_SIZE,
  dh: number = TINYCLOCK_INPUT_SIZE,
): Uint8Array {
  if (src.byteLength !== sw * sh * 4) {
    throw new Error(`RGBA 帧长度不符：期望 ${sw * sh * 4}，实际 ${src.byteLength}`)
  }
  const dst = new Uint8Array(dw * dh * 4)
  const xRatio = sw / dw
  const yRatio = sh / dh
  for (let y = 0; y < dh; y++) {
    const fy = (y + 0.5) * yRatio - 0.5
    let y0 = Math.floor(fy)
    const wy = fy - y0
    if (y0 < 0) y0 = 0
    let y1 = y0 + 1
    if (y1 > sh - 1) y1 = sh - 1
    for (let x = 0; x < dw; x++) {
      const fx = (x + 0.5) * xRatio - 0.5
      let x0 = Math.floor(fx)
      const wx = fx - x0
      if (x0 < 0) x0 = 0
      let x1 = x0 + 1
      if (x1 > sw - 1) x1 = sw - 1
      for (let c = 0; c < 4; c++) {
        const p00 = src[(y0 * sw + x0) * 4 + c]!
        const p01 = src[(y0 * sw + x1) * 4 + c]!
        const p10 = src[(y1 * sw + x0) * 4 + c]!
        const p11 = src[(y1 * sw + x1) * 4 + c]!
        const top = p00 + (p01 - p00) * wx
        const bot = p10 + (p11 - p10) * wx
        dst[(y * dw + x) * 4 + c] = Math.round(top + (bot - top) * wy)
      }
    }
  }
  return dst
}

/** RGBA（size²×4）→ CHW Float32Array [3,size,size]：1/255 rescale + ImageNet 归一化。 */
export function rgbaToCHW(rgba: Uint8Array, size: number = TINYCLOCK_INPUT_SIZE): Float32Array {
  const out = new Float32Array(3 * size * size)
  const plane = size * size
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      out[c * plane + i] = (rgba[i * 4 + c]! / 255 - MEAN[c]!) / STD[c]!
    }
  }
  return out
}

export interface PreprocessResult {
  /** [1,3,768,768] 浮点 tensor 数据（CHW，已归一化）。 */
  tensor: Float32Array
  srcWidth: number
  srcHeight: number
  timings: { resizeMs: number; normalizeMs: number }
}

/**
 * raw RGBA 帧 → 模型输入 tensor（生产路径：主机采集即 RGBA，免 PNG 解码）。
 * 已 768² 的输入跳过缩放（恒等路径，与 spike 一致）。
 */
export function preprocessFrame(rgba: Uint8Array, width: number, height: number): PreprocessResult {
  const t0 = performance.now()
  const resized =
    width === TINYCLOCK_INPUT_SIZE && height === TINYCLOCK_INPUT_SIZE
      ? rgba
      : stretchResizeRGBA(rgba, width, height, TINYCLOCK_INPUT_SIZE, TINYCLOCK_INPUT_SIZE)
  const t1 = performance.now()
  const chw = rgbaToCHW(resized, TINYCLOCK_INPUT_SIZE)
  const t2 = performance.now()
  return {
    tensor: chw,
    srcWidth: width,
    srcHeight: height,
    timings: { resizeMs: t1 - t0, normalizeMs: t2 - t1 },
  }
}

/**
 * 坐标反变换纯函数：loc bin（0-1000 归一化坐标）→ 物理像素，逐轴线性映射
 * （与 s3-run.js idsToPoint 同函数：x=bin/1000×W，y=bin/1000×H，四舍五入）。
 */
export function locBinToPixel(
  locX: number,
  locY: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return { x: Math.round((locX / 1000) * width), y: Math.round((locY / 1000) * height) }
}
