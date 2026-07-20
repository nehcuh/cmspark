// WP5 I1 — model-manifest 下载门禁核心测试（WI-1.1）。
// 覆盖：manifest 三要素 schema（缺字段/坏哈希拒绝）、网络 manifest 源拒绝、
// 镜像主机替换与 scheme 白名单（file:///UNC 拒绝、query 忽略 + loud log）、
// 校验即加载（同 buffer 返回、改 1 字节拒绝、size 先败）、真实 manifest 防漂移。

import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  loadModelManifest,
  loadVerifiedFileBytes,
  ModelGateError,
  modelDirFor,
  parseModelManifest,
  resolveDownloadUrl,
} from "../src/computer/model-manifest"

// --- helpers ----------------------------------------------------------------

/** 断言非空并收窄类型（本仓库 @types/node 的 assert.ok 不带 asserts 签名）。 */
function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error("expected non-null")
  return v
}

function captureConsoleError(fn: () => void): string[] {
  const lines: string[] = []
  const orig = console.error
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "))
  }
  try {
    fn()
  } finally {
    console.error = orig
  }
  return lines
}

const H = (ch: string) => ch.repeat(64) // 合法 64 hex
const REV = "0e1356f0b7cfb416099207121f6a766818ab8a66"

function makeFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "decoder_model.onnx",
    url: "https://models.cmspark.invalid/tinyclick/rev/hybrid/decoder_model.onnx",
    sha256: H("a"),
    size: 1024,
    ...overrides,
  }
}

function makeManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    models: {
      tinyclick: {
        repo: "Krystianz/TinyClick",
        revision: REV,
        license: "MIT",
        licenseCopyright: "Copyright (c) 2024 Samsung R&D Poland",
        baseModelNotice: { repo: "microsoft/Florence-2-base", license: "MIT" },
        provenance: {
          sourceFile: "model.safetensors",
          sourceSha256: H("d"),
          exportVendor: { configuration: H("1"), modeling: H("2"), processing: H("3") },
          exportedAt: "2026-07-20",
        },
        variants: { hybrid: { files: [makeFile()] } },
      },
    },
    ...overrides,
  }
}

function expectGateError(err: unknown, code: string): void {
  assert.ok(err instanceof ModelGateError, `期望 ModelGateError，实际: ${String(err)}`)
  assert.strictEqual((err as ModelGateError).code, code)
}

// --- parseModelManifest：合法解析 -------------------------------------------

test("parse: 合法最小 manifest 解析通过并保留三要素", () => {
  const m = parseModelManifest(JSON.stringify(makeManifest()))
  const tk = must(m.models.tinyclick)
  assert.strictEqual(tk.revision, REV)
  assert.strictEqual(tk.license, "MIT")
  const files = must(tk.variants.hybrid).files
  assert.strictEqual(files.length, 1)
  assert.strictEqual(must(files[0]).sha256, H("a"))
  assert.strictEqual(must(files[0]).size, 1024)
})

test("parse: 仓库内真实 models.manifest.json 通过校验（防漂移）", async () => {
  const realPath = path.join(__dirname, "..", "..", "models.manifest.json")
  const m = await loadModelManifest(realPath)
  const tk = must(m.models.tinyclick)
  assert.strictEqual(tk.repo, "Krystianz/TinyClick")
  assert.strictEqual(tk.revision, REV)
  assert.strictEqual(tk.provenance.sourceSha256.length, 64)
  const hybrid = must(tk.variants.hybrid)
  const int8 = must(tk.variants.int8)
  assert.strictEqual(hybrid.files.length, 5) // 4 ONNX + tokenizer.json
  assert.strictEqual(int8.files.length, 5)
  // 每文件三要素齐全且自洽
  for (const f of [...hybrid.files, ...int8.files]) {
    assert.match(f.url, /^https:\/\//)
    assert.match(f.sha256, /^[0-9a-f]{64}$/)
    assert.ok(f.size > 0)
  }
})

// --- parseModelManifest：缺字段/坏值拒绝 -------------------------------------

test("parse: 非 JSON 文本 → manifest-invalid", () => {
  assert.throws(() => parseModelManifest("{not json"), (e) => (expectGateError(e, "manifest-invalid"), true))
})

test("parse: 缺 revision → manifest-invalid", () => {
  const bad = makeManifest()
  delete (bad.models as any).tinyclick.revision
  assert.throws(() => parseModelManifest(JSON.stringify(bad)), (e) => (expectGateError(e, "manifest-invalid"), true))
})

test("parse: revision 非 40 hex → manifest-invalid", () => {
  const bad = makeManifest()
  ;(bad.models as any).tinyclick.revision = "0e1356f0" // 截断形式不允许
  assert.throws(() => parseModelManifest(JSON.stringify(bad)), (e) => (expectGateError(e, "manifest-invalid"), true))
})

test("parse: 文件 sha256 非 64 hex → manifest-invalid", () => {
  const bad = makeManifest()
  ;(bad.models as any).tinyclick.variants.hybrid.files = [makeFile({ sha256: "d52f9370" })]
  assert.throws(() => parseModelManifest(JSON.stringify(bad)), (e) => (expectGateError(e, "manifest-invalid"), true))
})

test("parse: 文件 size 非正整数 → manifest-invalid", () => {
  for (const size of [0, -1, 1.5, "1024"]) {
    const bad = makeManifest()
    ;(bad.models as any).tinyclick.variants.hybrid.files = [makeFile({ size })]
    assert.throws(
      () => parseModelManifest(JSON.stringify(bad)),
      (e) => (expectGateError(e, "manifest-invalid"), true),
      `size=${String(size)} 应被拒绝`,
    )
  }
})

test("parse: 文件 url 非 https → manifest-invalid（file:///http 本地替换面关闭）", () => {
  for (const url of ["http://evil.example/m.onnx", "file:///C:/models/m.onnx", "\\\\nas\\share\\m.onnx"]) {
    const bad = makeManifest()
    ;(bad.models as any).tinyclick.variants.hybrid.files = [makeFile({ url })]
    assert.throws(
      () => parseModelManifest(JSON.stringify(bad)),
      (e) => (expectGateError(e, "manifest-invalid"), true),
      `url=${url} 应被拒绝`,
    )
  }
})

test("parse: 缺默认变体 hybrid → manifest-invalid", () => {
  const bad = makeManifest()
  ;(bad.models as any).tinyclick.variants = { int8: { files: [makeFile()] } }
  assert.throws(() => parseModelManifest(JSON.stringify(bad)), (e) => (expectGateError(e, "manifest-invalid"), true))
})

test("parse: 变体 files 为空 → manifest-invalid", () => {
  const bad = makeManifest()
  ;(bad.models as any).tinyclick.variants = { hybrid: { files: [] } }
  assert.throws(() => parseModelManifest(JSON.stringify(bad)), (e) => (expectGateError(e, "manifest-invalid"), true))
})

test("parse: 文件 name 含路径分隔符 → manifest-invalid（M6：path.join 逃逸面关闭）", () => {
  for (const name of ["../evil.onnx", "a/b.onnx", "a\\b.onnx", "..\\evil.onnx"]) {
    const bad = makeManifest()
    ;(bad.models as any).tinyclick.variants.hybrid.files = [makeFile({ name })]
    assert.throws(
      () => parseModelManifest(JSON.stringify(bad)),
      (e) => (expectGateError(e, "manifest-invalid"), true),
      `name=${name} 应被拒绝`,
    )
  }
})

// --- loadModelManifest：网络源拒绝 -------------------------------------------

test("load: 网络/UNC manifest 源一律拒绝（manifest 永不运行时网络更新）", async () => {
  const remoteSources = [
    "https://evil.example/models.manifest.json",
    "http://evil.example/models.manifest.json",
    "file:///C:/cmspark/models.manifest.json",
    "ftp://evil.example/m.json",
    "\\\\nas\\share\\models.manifest.json",
    "//nas/share/models.manifest.json",
  ]
  for (const src of remoteSources) {
    await assert.rejects(
      () => loadModelManifest(src),
      (e) => (expectGateError(e, "manifest-source-remote"), true),
      `源 ${src} 应被拒绝`,
    )
  }
})

// --- resolveDownloadUrl：镜像主机可配、哈希不可配 ------------------------------

const FILE_URL = "https://models.cmspark.invalid/tinyclick/rev/hybrid/decoder_model.onnx"

test("mirror: 缺省 → 返回 manifest 登记 url 原样", () => {
  assert.strictEqual(resolveDownloadUrl(FILE_URL, undefined), FILE_URL)
  assert.strictEqual(resolveDownloadUrl(FILE_URL, ""), FILE_URL)
})

test("mirror: 合法 https 主机 → 仅替换 origin，path 保留", () => {
  assert.strictEqual(
    resolveDownloadUrl(FILE_URL, "https://hf-mirror.example"),
    "https://hf-mirror.example/tinyclick/rev/hybrid/decoder_model.onnx",
  )
  assert.strictEqual(
    resolveDownloadUrl(FILE_URL, "https://mirror.example:8443/"),
    "https://mirror.example:8443/tinyclick/rev/hybrid/decoder_model.onnx",
  )
})

test("mirror: 非 https scheme 拒绝（http/file/UNC/畸形）", () => {
  for (const mirror of ["http://evil.example", "file:///C:/models", "not a url", "//nas/share"]) {
    assert.throws(
      () => resolveDownloadUrl(FILE_URL, mirror),
      (e) => (expectGateError(e, "mirror-scheme-denied"), true),
      `mirror=${mirror} 应被拒绝`,
    )
  }
})

test("mirror: 带 path/query/fragment → 忽略并 loud log（哈希不可配）", () => {
  const evilHash = H("e")
  const logs = captureConsoleError(() => {
    const resolved = resolveDownloadUrl(
      FILE_URL,
      `https://mirror.example/prefix?sha256=${evilHash}#frag`,
    )
    // 仅 origin 生效：无 prefix、无 query、无 fragment——URL 参数无从影响预期哈希
    assert.strictEqual(resolved, "https://mirror.example/tinyclick/rev/hybrid/decoder_model.onnx")
    assert.strictEqual(resolved.includes(evilHash), false)
    assert.strictEqual(resolved.includes("?"), false)
  })
  assert.ok(logs.length >= 1, "应有 loud log")
  assert.ok(logs[0]!.includes("modelMirror"), "loud log 应指明字段")
})

// --- loadVerifiedFileBytes：校验即加载（同 buffer、每次复验） ------------------

test("verify-load: 字节与登记一致 → 通过并返回同一内容 buffer", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cmspark-model-"))
  try {
    const content = Buffer.from("fake onnx bytes \u0001\u0002 model payload")
    const filePath = path.join(dir, "m.onnx")
    writeFileSync(filePath, content)
    const sha256 = createHash("sha256").update(content).digest("hex")
    const buf = await loadVerifiedFileBytes(filePath, { sha256, size: content.byteLength })
    assert.ok(Buffer.isBuffer(buf))
    assert.deepStrictEqual(buf, content) // 校验的字节 == 返回给调用方建 session 的字节
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("verify-load: 改 1 字节 → model-hash-mismatch 拒绝加载", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cmspark-model-"))
  try {
    const content = Buffer.from("fake onnx bytes payload")
    const filePath = path.join(dir, "m.onnx")
    const sha256 = createHash("sha256").update(content).digest("hex")
    const tampered = Buffer.from(content)
    tampered[0] = tampered[0]! ^ 0xff // 翻转首字节全部位
    writeFileSync(filePath, tampered)
    await assert.rejects(
      () => loadVerifiedFileBytes(filePath, { sha256, size: content.byteLength }),
      (e) => (expectGateError(e, "model-hash-mismatch"), true),
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("verify-load: 大小不符 → model-size-mismatch 先于哈希失败", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cmspark-model-"))
  try {
    const content = Buffer.from("short")
    const filePath = path.join(dir, "m.onnx")
    writeFileSync(filePath, content)
    const sha256 = createHash("sha256").update(content).digest("hex")
    await assert.rejects(
      () => loadVerifiedFileBytes(filePath, { sha256, size: content.byteLength + 1 }),
      (e) => (expectGateError(e, "model-size-mismatch"), true),
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- modelDirFor：下载目录约定 -------------------------------------------------

test("modelDirFor: 指向 <base>/models/tinyclick-<variant>", () => {
  const dir = modelDirFor("hybrid", "C:\\base")
  assert.strictEqual(dir, path.join("C:\\base", "models", "tinyclick-hybrid"))
})
