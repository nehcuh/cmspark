// WP5 I2 WI-2.3 — 预处理与坐标反变换测试。
// 锁定：stretch 逐轴语义（M1，禁 letterbox）、恒等路径、ImageNet 归一化数值、
// CHW 布局、bin→像素往返 ≤1px、spike 参考点一致性（s1 reference: loc 282,528 → 157,211 @560×400）。

import test from "node:test"
import assert from "node:assert/strict"

import {
  locBinToPixel,
  preprocessFrame,
  rgbaToCHW,
  stretchResizeRGBA,
  TINYCLOCK_INPUT_SIZE,
} from "../src/computer/tinyclick-preprocess"
import {
  argmaxLast,
  DECODER_START_ID,
  EOS_ID,
  greedyDecode,
  LOC_TOKEN_BASE,
  parseLocBins,
} from "../src/computer/tinyclick-decode"

// --- stretch 逐轴缩放（M1） --------------------------------------------------------

test("stretch: 同尺寸输入恒等（768² 直通路径）", () => {
  const src = new Uint8Array(4 * 4 * 4).map((_, i) => i % 251)
  const out = stretchResizeRGBA(src, 4, 4, 4, 4)
  assert.deepStrictEqual(out, src)
})

test("stretch: 逐轴独立缩放——x/y 比例不同，无 padding 无黑边（letterbox 反证）", () => {
  // 4×2 源：左半黑右半白 → 2×4 目标（x 缩 2:1、y 拉 1:2）
  const src = new Uint8Array(4 * 2 * 4)
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 4; x++)
      for (let c = 0; c < 4; c++) src[(y * 4 + x) * 4 + c] = x < 2 ? 0 : 255
  const out = stretchResizeRGBA(src, 4, 2, 2, 4)
  // x 向 4→2：左列应取源左半（黑），右列取源右半（白）
  for (let y = 0; y < 4; y++) {
    assert.strictEqual(out[(y * 2 + 0) * 4 + 0], 0, `y=${y} 左列应黑`)
    assert.strictEqual(out[(y * 2 + 1) * 4 + 0], 255, `y=${y} 右列应白`)
  }
  // y 向 2→4 拉伸铺满：若 letterbox 语义会出现整行黑边——逐轴拉伸下不存在
  // （源全行都有白色像素，目标每行都须有）
  for (let y = 0; y < 4; y++) {
    const rowHasWhite = out[(y * 2 + 1) * 4 + 0] === 255
    assert.ok(rowHasWhite, `y=${y} 不得出现 padding 黑行`)
  }
})

test("stretch: 中心对齐采样数值（2×2 → 4×4，clamp 保权重语义与 spike 一致）", () => {
  // 源 [[0,100],[200,255]]（灰度写入 RGBA 四通道）
  const px = [0, 100, 200, 255]
  const src = new Uint8Array(2 * 2 * 4)
  for (let i = 0; i < 4; i++) for (let c = 0; c < 4; c++) src[i * 4 + c] = px[i]!
  const out = stretchResizeRGBA(src, 2, 2, 4, 4)
  // spike 算法：wy/wx 在 clamp 前计算（角点权重不为 0）——角 (0,0)：fy=fx=-0.25→
  // y0=x0=0(clamp), wy=wx=0.75 → top=75, bot=241.25 → 75+0.75*166.25=199.7→200
  assert.strictEqual(out[0], 200)
  // 角 (3,3)：fy=fx=1.25→y0=x0=1，y1/x1 clamp 到 1 → 四采样同点 px[3]，权重失效 → 255
  assert.strictEqual(out[(3 * 4 + 3) * 4], 255)
  // 中心 (1,1)：fy=0.25,y0=0,wy=0.25 → top=25,bot=213.75 → 25+0.25*188.75=72.19→72
  assert.strictEqual(out[(1 * 4 + 1) * 4], 72)
})

test("stretch: 源长度不符 → 抛错（防静默错位）", () => {
  assert.throws(() => stretchResizeRGBA(new Uint8Array(10), 4, 4, 2, 2))
})

// --- 归一化与布局 ------------------------------------------------------------------

test("rgbaToCHW: ImageNet 归一化数值与 CHW 布局（size=2）", () => {
  // 单红点 (255,0,0) + 三杂点
  const rgba = new Uint8Array([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 255, 255,
  ])
  const out = rgbaToCHW(rgba, 2)
  const plane = 4
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-6
  // R 通道首位 = (1-0.485)/0.229
  assert.ok(close(out[0]!, (1 - 0.485) / 0.229))
  // G 通道第二位 = (1-0.456)/0.224
  assert.ok(close(out[plane + 1]!, (1 - 0.456) / 0.224))
  // B 通道第三位 = (1-0.406)/0.225
  assert.ok(close(out[2 * plane + 2]!, (1 - 0.406) / 0.225))
  // 白点三通道末位均为 (1-mean)/std
  assert.ok(close(out[2 * plane + 3]!, (1 - 0.406) / 0.225))
  // alpha 通道不参与
  assert.strictEqual(out.length, 3 * 4)
})

test("preprocessFrame: 端到端形状与恒等路径计时字段", () => {
  const rgba = new Uint8Array(TINYCLOCK_INPUT_SIZE * TINYCLOCK_INPUT_SIZE * 4).fill(128)
  const r = preprocessFrame(rgba, TINYCLOCK_INPUT_SIZE, TINYCLOCK_INPUT_SIZE)
  assert.strictEqual(r.tensor.length, 3 * TINYCLOCK_INPUT_SIZE * TINYCLOCK_INPUT_SIZE)
  assert.strictEqual(r.srcWidth, TINYCLOCK_INPUT_SIZE)
  // 中灰 (128/255-0.485)/0.229（R 通道首元素）
  const expect = (128 / 255 - 0.485) / 0.229
  assert.ok(Math.abs(r.tensor[0]! - expect) < 1e-5)
  assert.ok(r.timings.resizeMs >= 0 && r.timings.normalizeMs >= 0)
})

// --- 坐标反变换（M1 逐轴线性，往返 ≤1px） ------------------------------------------

test("locBinToPixel: spike 参考点一致（s1 reference loc 282,528 @560×400 → 157,211）", () => {
  const p = locBinToPixel(282, 528, 560, 400)
  assert.deepStrictEqual(p, { x: 158, y: 211 })
  // s1 reference.json 的 click_point 为 [157,211]（HF 侧 floor 取整）；
  // 本实现 Math.round 与 s3-run.js 一致——1px 差属取整约定差，容差内（±8px 门禁）
  assert.ok(Math.abs(p.x - 157) <= 1)
})

test("locBinToPixel: 边界 bin 0/999 与四角往返误差 ≤1px", () => {
  const W = 1920, H = 1080
  assert.deepStrictEqual(locBinToPixel(0, 0, W, H), { x: 0, y: 0 })
  // bin 999 → 1918.08→1918 / 1078.92→1079
  assert.deepStrictEqual(locBinToPixel(999, 999, W, H), { x: 1918, y: 1079 })
  // 往返：像素→bin→像素（多分辨率多点位）
  for (const [w, h] of [[560, 400], [1920, 1080], [960, 640]] as const) {
    for (const [px, py] of [[0, 0], [w - 1, h - 1], [w >> 1, h >> 1], [w >> 2, (h * 3) >> 2]] as const) {
      const bx = (px / w) * 1000, by = (py / h) * 1000
      const back = locBinToPixel(bx, by, w, h)
      assert.ok(Math.abs(back.x - px) <= 1 && Math.abs(back.y - py) <= 1, `${w}x${h} @(${px},${py}) 往返超差`)
    }
  }
})

// --- 贪心解码纯函数 ------------------------------------------------------------------

test("argmaxLast: 末位 argmax 正确（含负值）", () => {
  const vocab = 5
  const logits = new Float32Array(2 * vocab).fill(-1)
  logits[vocab + 3] = 0.5 // position 1 的最大值在 id 3
  assert.strictEqual(argmaxLast(logits, 1, vocab), 3)
  assert.strictEqual(argmaxLast(logits, 0, vocab), 0) // 全等取首个
})

test("greedyDecode: 复现 spike 输出结构并在 EOS 终止", async () => {
  const script = [0, 23008, 1437, LOC_TOKEN_BASE + 282, LOC_TOKEN_BASE + 528, EOS_ID]
  const vocab = LOC_TOKEN_BASE + 1000
  const ids = await greedyDecode(async (prefixIds) => {
    // 全前缀重算语义：logits 形状随前缀增长，目标 token 放在末位
    const tok = script[prefixIds.length - 1] ?? EOS_ID
    const logits = new Float32Array(prefixIds.length * vocab).fill(-Infinity)
    logits[(prefixIds.length - 1) * vocab + tok] = 0
    return logits
  }, { vocabSize: vocab })
  assert.deepStrictEqual(ids, [DECODER_START_ID, ...script])
})

test("greedyDecode: 永不 EOS → 步数上限截断（失控保险）", async () => {
  let calls = 0
  const ids = await greedyDecode(async () => {
    calls++
    return new Float32Array(3).fill(0) // argmax 恒 0，永不 EOS
  }, { maxSteps: 50, vocabSize: 1 })
  assert.strictEqual(calls, 50)
  assert.strictEqual(ids.length, 51) // 起始 + 50 步
})

test("parseLocBins: spike 参考序列 / 边界 bin / 非坐标诚实失败", () => {
  // s1 reference: [2,0,23008,1437,50551,50797,2] → [282,528]
  assert.deepStrictEqual(parseLocBins([2, 0, 23008, 1437, 50551, 50797, 2]), [282, 528])
  // 边界 bin 0 与 999
  assert.deepStrictEqual(
    parseLocBins([2, 0, LOC_TOKEN_BASE, LOC_TOKEN_BASE + 999, 2]),
    [0, 999],
  )
  // 无 loc / 单 loc → null（诚实失败，不编造坐标）
  assert.strictEqual(parseLocBins([2, 0, 23008, 2]), null)
  assert.strictEqual(parseLocBins([2, 0, LOC_TOKEN_BASE + 100, 2]), null)
  // ≥2 loc 取前两个（与 s3 idsToPoint 同语义）
  assert.deepStrictEqual(
    parseLocBins([2, LOC_TOKEN_BASE + 1, LOC_TOKEN_BASE + 2, LOC_TOKEN_BASE + 3, 2]),
    [1, 2],
  )
})
