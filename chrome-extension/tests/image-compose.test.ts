// Composer image paste / drop / picker helpers (Task 9).

import test from "node:test"
import assert from "node:assert/strict"

import {
  IMAGE_GIF_SHRINK_FIRST,
  IMAGE_MAX_COUNT,
  IMAGE_MAX_DECODED,
  IMAGE_MAX_EDGE,
  IMAGE_MAX_TOTAL_DECODED,
  IMAGE_PREFLIGHT_NO_VISION,
  checkComposerImageCaps,
  classifyDrop,
  clipboardImageDisplayName,
  compressImageBlob,
  captionOnlyForEdit,
  defaultCaption,
  isAllowlistedImageMime,
  mimeFromName,
  needsCompress,
  pasteImageDisplayName,
  previewDataUrl,
  visionRailOpen,
} from "../src/sidepanel/utils/image-compose"

// --- isAllowlistedImageMime ---

test("isAllowlistedImageMime: png/jpeg/jpg/gif/webp true", () => {
  for (const t of [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/webp",
    "IMAGE/PNG",
    "image/jpeg; charset=binary",
    " image/webp ",
  ]) {
    assert.equal(isAllowlistedImageMime(t), true, t)
  }
})

test("isAllowlistedImageMime: svg/heic/bmp/empty false", () => {
  for (const t of [
    "image/svg+xml",
    "image/heic",
    "image/heif",
    "image/bmp",
    "image/tiff",
    "application/pdf",
    "text/plain",
    "",
    "image/",
  ]) {
    assert.equal(isAllowlistedImageMime(t), false, t)
  }
})

// --- classifyDrop ---

test("classifyDrop: reject text/uri-list", () => {
  const r = classifyDrop(["text/uri-list", "Files"], [
    { type: "image/png", size: 1200, name: "shot.png" },
  ])
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /链接|远程/)
})

test("classifyDrop: reject text/x-moz-url", () => {
  const r = classifyDrop(["text/x-moz-url"], [])
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /链接|远程/)
})

test("classifyDrop: reject 0-byte file whose name looks like a URL", () => {
  const r = classifyDrop(["Files"], [
    { type: "", size: 0, name: "https://cdn.example.com/a.png" },
  ])
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /链接|远程/)
})

test("classifyDrop: reject 0-byte www. host name", () => {
  const r = classifyDrop(["Files"], [
    { type: "", size: 0, name: "www.example.com/shot.png" },
  ])
  assert.equal(r.ok, false)
})

test("classifyDrop: real local files ok", () => {
  const r = classifyDrop(["Files"], [
    { type: "image/png", size: 2048, name: "shot.png" },
    { type: "application/pdf", size: 4096, name: "spec.pdf" },
  ])
  assert.deepEqual(r, { ok: true })
})

test("classifyDrop: empty files rejected", () => {
  const r = classifyDrop(["Files"], [])
  assert.equal(r.ok, false)
})

test("classifyDrop: 0-byte non-URL name is not a URI-drag (ok at classify)", () => {
  const r = classifyDrop(["Files"], [
    { type: "image/png", size: 0, name: "empty.png" },
  ])
  assert.deepEqual(r, { ok: true })
})

test("classifyDrop: reject html/plain-only drops and data/blob/file names", () => {
  const html = classifyDrop(["text/html"], [])
  assert.equal(html.ok, false)
  const plain = classifyDrop(["text/plain"], [])
  assert.equal(plain.ok, false)
  const data = classifyDrop(["Files"], [
    { type: "", size: 0, name: "data:image/png;base64,AAA" },
  ])
  assert.equal(data.ok, false)
  const blob = classifyDrop(["Files"], [
    { type: "", size: 12, name: "blob:https://example.com/abc" },
  ])
  assert.equal(blob.ok, false)
  const fileUri = classifyDrop(["Files"], [
    { type: "", size: 0, name: "file:///tmp/shot.png" },
  ])
  assert.equal(fileUri.ok, false)
})

test("mimeFromName: rasters + refuse heic/svg as image/*", () => {
  assert.equal(mimeFromName("a.png"), "image/png")
  assert.equal(mimeFromName("a.HEIC"), "image/heic")
  assert.equal(mimeFromName("icon.svg"), "image/svg+xml")
  assert.equal(mimeFromName("notes.md"), "text/markdown")
  assert.equal(mimeFromName("noext"), "application/octet-stream")
})

test("previewDataUrl: magic prefixes", () => {
  assert.match(previewDataUrl("iVBORxxxx"), /^data:image\/png;base64,/)
  assert.match(previewDataUrl("R0lGODxxxx"), /^data:image\/gif;base64,/)
  assert.match(previewDataUrl("UklGRxxxx"), /^data:image\/webp;base64,/)
  assert.match(previewDataUrl("/9j/xxxx"), /^data:image\/jpeg;base64,/)
})

// --- clipboardImageDisplayName ---

test("clipboardImageDisplayName: 截图 YYYY-MM-DD HH:mm", () => {
  const d = new Date(2026, 7, 17, 9, 5, 30) // local Aug 17 2026 09:05
  assert.equal(clipboardImageDisplayName(d), "截图 2026-08-17 09:05")
})

test("clipboardImageDisplayName: pads month/day/hour/minute", () => {
  const d = new Date(2026, 0, 2, 3, 4)
  assert.equal(clipboardImageDisplayName(d), "截图 2026-01-02 03:04")
})

test("pasteImageDisplayName: generic OS names → timestamp; real names kept", () => {
  const d = new Date(2026, 7, 17, 14, 0)
  assert.equal(pasteImageDisplayName("image.png", d), "截图 2026-08-17 14:00")
  assert.equal(pasteImageDisplayName("image.jpg", d), "截图 2026-08-17 14:00")
  assert.equal(pasteImageDisplayName("", d), "截图 2026-08-17 14:00")
  assert.equal(pasteImageDisplayName("blob", d), "截图 2026-08-17 14:00")
  assert.equal(pasteImageDisplayName("invoice.png", d), "invoice.png")
})

// --- defaultCaption ---

test("defaultCaption: user text wins", () => {
  assert.equal(
    defaultCaption({ images: 2, docs: 1, userText: "  帮我看下  " }),
    "帮我看下",
  )
})

test("defaultCaption: images only", () => {
  assert.equal(defaultCaption({ images: 1, docs: 0, userText: "" }), "请看这张图")
  assert.equal(defaultCaption({ images: 1, docs: 0, userText: "   " }), "请看这张图")
  assert.equal(defaultCaption({ images: 3, docs: 0, userText: "" }), "请看这些图片")
})

test("defaultCaption: docs only", () => {
  assert.equal(
    defaultCaption({ images: 0, docs: 2, userText: "" }),
    "请分析我上传的文件",
  )
})

test("defaultCaption: mixed attachments", () => {
  assert.equal(defaultCaption({ images: 1, docs: 1, userText: "" }), "请查看附件")
})

test("defaultCaption: empty everything", () => {
  assert.equal(defaultCaption({ images: 0, docs: 0, userText: "" }), "")
})

test("captionOnlyForEdit: strips 📎 line and vision block", () => {
  assert.equal(
    captionOnlyForEdit("看看这张图\n📎 shot.png"),
    "看看这张图",
  )
  assert.equal(
    captionOnlyForEdit("看看这张图\n\n<!-- 用户附图分析 -->\n[图片: shot.png] 一只橘猫\n📎 shot.png"),
    "看看这张图",
  )
  assert.equal(
    captionOnlyForEdit("hello\n\n📎 引用 2 个会话"),
    "hello",
  )
  assert.equal(captionOnlyForEdit("plain"), "plain")
  assert.equal(captionOnlyForEdit("📎 only.png"), "")
})

// --- visionRailOpen ---

test("visionRailOpen: vision_enabled && file_upload_vision !== false", () => {
  assert.equal(visionRailOpen({ vision_enabled: true }), true)
  assert.equal(visionRailOpen({ vision_enabled: true, file_upload_vision: true }), true)
  assert.equal(visionRailOpen({ vision_enabled: true, file_upload_vision: false }), false)
  assert.equal(visionRailOpen({ vision_enabled: false, file_upload_vision: true }), false)
  assert.equal(visionRailOpen({}), false)
  assert.equal(visionRailOpen({ file_upload_vision: true }), false)
})

// --- needsCompress ---

test("needsCompress: bytes > 4MiB", () => {
  assert.equal(needsCompress(IMAGE_MAX_DECODED + 1), true)
  assert.equal(needsCompress(IMAGE_MAX_DECODED), false)
  assert.equal(needsCompress(IMAGE_MAX_DECODED, 800, 600), false)
  assert.equal(needsCompress(IMAGE_MAX_DECODED + 1, 800, 600), true)
})

test("needsCompress: max(w,h) > 1568", () => {
  assert.equal(needsCompress(100, IMAGE_MAX_EDGE + 1, 100), true)
  assert.equal(needsCompress(100, 100, IMAGE_MAX_EDGE + 1), true)
  assert.equal(needsCompress(100, IMAGE_MAX_EDGE, IMAGE_MAX_EDGE), false)
  assert.equal(needsCompress(100, 800, 600), false)
})

test("needsCompress: missing dims only checks bytes", () => {
  assert.equal(needsCompress(1024), false)
  assert.equal(needsCompress(0), false)
})

// --- checkComposerImageCaps (client 4 / 4MiB / 6MiB) ---

test("checkComposerImageCaps: count / per-image / total", () => {
  assert.equal(checkComposerImageCaps([{ name: "a.png", size: 100 }]), undefined)
  const five = [0, 1, 2, 3, 4].map((i) => ({ name: `a${i}.png`, size: 100 }))
  assert.match(checkComposerImageCaps(five)!, /一次最多添加 4 张图片/)
  assert.equal(five.length, IMAGE_MAX_COUNT + 1)
  assert.match(
    checkComposerImageCaps([{ name: "big.png", size: IMAGE_MAX_DECODED + 1 }])!,
    /4MB/,
  )
  const half = Math.floor(IMAGE_MAX_TOTAL_DECODED / 2) + 256 * 1024
  assert.ok(half <= IMAGE_MAX_DECODED)
  assert.match(
    checkComposerImageCaps([
      { name: "a.png", size: half },
      { name: "b.png", size: half },
    ])!,
    /6MB/,
  )
})

// --- compressImageBlob: GIF refuse + no-canvas fallback ---

test("compressImageBlob: oversized GIF → 动画图请先缩小", async () => {
  const blob = new Blob([new Uint8Array(IMAGE_MAX_DECODED + 64)], { type: "image/gif" })
  let err: unknown
  try {
    await compressImageBlob(blob)
  } catch (e) {
    err = e
  }
  assert.ok(err instanceof Error, String(err))
  assert.equal((err as Error).message, IMAGE_GIF_SHRINK_FIRST)
})

test("compressImageBlob: small non-gif without canvas is a no-op", async () => {
  const blob = new Blob([new Uint8Array(256)], { type: "image/png" })
  const r = await compressImageBlob(blob)
  assert.equal(r.compressed, false)
  assert.equal(r.blob.size, 256)
})

test("compressImageBlob: oversized non-gif without canvas refuses", async () => {
  const blob = new Blob([new Uint8Array(IMAGE_MAX_DECODED + 1)], { type: "image/png" })
  let err: unknown
  try {
    await compressImageBlob(blob)
  } catch (e) {
    err = e
  }
  assert.ok(err instanceof Error, String(err))
  assert.match((err as Error).message, /过大|缩小/)
})

test("IMAGE_PREFLIGHT_NO_VISION copy is honest", () => {
  assert.match(IMAGE_PREFLIGHT_NO_VISION, /不支持直接看图/)
  assert.match(IMAGE_PREFLIGHT_NO_VISION, /视觉分析/)
})
