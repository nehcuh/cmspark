import test from "node:test"
import assert from "node:assert/strict"
import {
  partitionUploadFiles,
  buildVisionAttachMessage,
  planStandaloneImageAnalysis,
  validateImageCaps,
  MAX_UPLOAD_IMAGES,
  MAX_UPLOAD_IMAGE_BYTES,
  MAX_UPLOAD_IMAGES_TOTAL_BYTES,
} from "../src/llm/split-upload-files"

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const PDF = Buffer.from("%PDF-1.4 minimal")

function pngOf(size: number): Buffer {
  const buf = Buffer.alloc(size)
  PNG.copy(buf)
  return buf
}

function file(name: string, type: string, buf: Buffer) {
  return { name, type, content: buf.toString("base64") }
}

test("partitionUploadFiles: 1 PNG + 1 PDF → one image, one doc", () => {
  const r = partitionUploadFiles([
    file("shot.png", "image/png", PNG),
    file("spec.pdf", "application/pdf", PDF),
  ])
  assert.equal(r.error, undefined)
  assert.equal(r.images.length, 1)
  assert.equal(r.docs.length, 1)
  assert.equal(r.images[0]!.name, "shot.png")
  assert.equal(r.images[0]!.type, "image/png")
  assert.deepEqual(r.images[0]!.buf, PNG)
  assert.equal(r.docs[0]!.name, "spec.pdf")
  assert.equal(r.docs[0]!.type, "application/pdf")
  assert.equal(r.docs[0]!.content, PDF.toString("base64"))
})

test("partitionUploadFiles: type=image/png + HTML bytes → error", () => {
  const r = partitionUploadFiles([file("x.png", "image/png", Buffer.from("<html>hello"))])
  assert.ok(r.error)
  assert.equal(r.images.length, 0)
  assert.match(r.error!, /不符|拒绝|类型/)
})

test("partitionUploadFiles: 5 images → error containing 一次最多添加 4 张图片", () => {
  const files = [0, 1, 2, 3, 4].map((i) => file(`a${i}.png`, "image/png", PNG))
  const r = partitionUploadFiles(files)
  assert.ok(r.error)
  assert.match(r.error!, /一次最多添加 4 张图片/)
})

test("partitionUploadFiles: decoded total > 6MiB → error", () => {
  // 3.5MiB + 3.5MiB = 7MiB > 6MiB; each under the 4MiB per-image cap
  const half = Math.floor(MAX_UPLOAD_IMAGES_TOTAL_BYTES / 2) + 256 * 1024
  assert.ok(half <= MAX_UPLOAD_IMAGE_BYTES)
  const r = partitionUploadFiles([
    file("a.png", "image/png", pngOf(half)),
    file("b.png", "image/png", pngOf(half)),
  ])
  assert.ok(r.error)
  assert.match(r.error!, /6\s*MB|6MiB|总/)
})

test("partitionUploadFiles: image types do not need to be in allowed_types", () => {
  // partition does not take / check allowed_types — PNG is an image even if a
  // caller would only allow application/pdf.
  const r = partitionUploadFiles([file("clip.png", "image/png", PNG)])
  assert.equal(r.error, undefined)
  assert.equal(r.images.length, 1)
  assert.equal(r.docs.length, 0)
})

test("partitionUploadFiles: svg / heic / pdf stay docs (normalizeImageMime null)", () => {
  const r = partitionUploadFiles([
    file("icon.svg", "image/svg+xml", Buffer.from("<svg></svg>")),
    file("raw.heic", "image/heic", Buffer.alloc(16, 1)),
    file("doc.pdf", "application/pdf", PDF),
  ])
  assert.equal(r.error, undefined)
  assert.equal(r.images.length, 0)
  assert.equal(r.docs.length, 3)
})

test("partitionUploadFiles: single image over 4MiB → error", () => {
  const r = partitionUploadFiles([
    file("big.png", "image/png", pngOf(MAX_UPLOAD_IMAGE_BYTES + 1)),
  ])
  assert.ok(r.error)
  assert.match(r.error!, /4\s*MB|过大/)
})

test("partitionUploadFiles: max 4 images under total cap ok", () => {
  const files = [0, 1, 2, 3].map((i) => file(`a${i}.png`, "image/png", PNG))
  const r = partitionUploadFiles(files)
  assert.equal(r.error, undefined)
  assert.equal(r.images.length, MAX_UPLOAD_IMAGES)
})

test("validateImageCaps re-checks count and decoded total", () => {
  assert.equal(validateImageCaps([{ name: "a.png", buf: PNG }]), undefined)
  const five = [0, 1, 2, 3, 4].map((i) => ({ name: `a${i}.png`, buf: PNG }))
  assert.match(validateImageCaps(five)!, /一次最多添加 4 张图片/)
  const half = Math.floor(MAX_UPLOAD_IMAGES_TOTAL_BYTES / 2) + 256 * 1024
  assert.match(
    validateImageCaps([
      { name: "a.png", buf: pngOf(half) },
      { name: "b.png", buf: pngOf(half) },
    ])!,
    /6/,
  )
})

test("buildVisionAttachMessage: §5.1a wraps user caption + descriptions", () => {
  const out = buildVisionAttachMessage("看看这张图", [
    { name: "shot.png", description: "一只橘猫坐在键盘上" },
  ])
  assert.equal(
    out,
    "看看这张图\n\n<!-- 用户附图分析 -->\n[图片: shot.png] 一只橘猫坐在键盘上",
  )
})

test("buildVisionAttachMessage: empty caption still emits the analysis block", () => {
  const out = buildVisionAttachMessage("", [
    { name: "a.png", description: "红点" },
    { name: "b.png", description: "蓝点" },
  ])
  assert.equal(
    out,
    "<!-- 用户附图分析 -->\n[图片: a.png] 红点\n[图片: b.png] 蓝点",
  )
})

test("planStandaloneImageAnalysis: useNative skips analyzeImage", () => {
  // Spy-level: native multimodal must never call analyzeImage on standalone images.
  const native = planStandaloneImageAnalysis({
    imageCount: 2,
    useNative: true,
    visionRailOn: true,
  })
  assert.equal(native.analyze, false)
  assert.equal(native.error, undefined)

  const rail = planStandaloneImageAnalysis({
    imageCount: 1,
    useNative: false,
    visionRailOn: true,
  })
  assert.equal(rail.analyze, true)
  assert.equal(rail.error, undefined)

  const off = planStandaloneImageAnalysis({
    imageCount: 1,
    useNative: false,
    visionRailOn: false,
  })
  assert.equal(off.analyze, false)
  assert.ok(off.error)

  const none = planStandaloneImageAnalysis({
    imageCount: 0,
    useNative: false,
    visionRailOn: false,
  })
  assert.equal(none.analyze, false)
  assert.equal(none.error, undefined)
})
