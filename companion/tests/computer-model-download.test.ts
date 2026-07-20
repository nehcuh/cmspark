// WP5 I1 — model-download 下载管理器测试（WI-1.2，全 fake fetch 零网络）。
// 覆盖：断点续传拼接、分片篡改最终哈希检出、原子 rename 不留半成品、预算/卷满
// 下载前拒下、file:// 镜像拒绝、失败审计事件形状、stale .part 四态清理（超期/
// revision 变更/url 变更/meta 孤儿）、Range 200 回退重写、416 删片重下、删除模型。

import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  DEFAULT_DISK_BUDGET_MB,
  deleteModelVariant,
  downloadModelVariant,
  ModelDownloadError,
  PART_STALE_MS,
  type ModelDownloadDeps,
} from "../src/computer/model-download"
import type { ModelManifest } from "../src/computer/model-manifest"

// --- fixtures -----------------------------------------------------------------

const REV = "0e1356f0b7cfb416099207121f6a766818ab8a66"

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

/** 生成确定性内容（内容含位置信息，篡改断言更稳）。 */
function contentOf(seed: number, size: number): Buffer {
  const buf = Buffer.alloc(size)
  for (let i = 0; i < size; i++) buf[i] = (seed + i) % 251
  return buf
}

const FILE_A = contentOf(7, 2048)
const FILE_B = contentOf(91, 1024)

function makeManifest(files: { name: string; content: Buffer }[] = [
  { name: "a.onnx", content: FILE_A },
  { name: "b.onnx", content: FILE_B },
]): ModelManifest {
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
          sourceSha256: sha256(contentOf(1, 64)),
          exportVendor: { configuration: sha256(contentOf(2, 64)), modeling: sha256(contentOf(3, 64)), processing: sha256(contentOf(4, 64)) },
          exportedAt: "2026-07-20",
        },
        variants: {
          hybrid: {
            files: files.map((f) => ({
              name: f.name,
              url: `https://models.cmspark.invalid/tinyclick/${REV}/hybrid/${f.name}`,
              sha256: sha256(f.content),
              size: f.content.byteLength,
            })),
          },
        },
      },
    },
  } as ModelManifest
}

// --- fake fetch -----------------------------------------------------------------

interface FakeRoute {
  body: Buffer
  /** 流中传满 N 字节后报错（断点模拟）；按本次响应计。 */
  failAfterBytes?: number
  /** 对 Range 请求返回的状态（默认 206；200=不支持续传；416=Range 不可满足）。 */
  rangeStatus?: number
  /** 在本次响应第 N 字节处翻转一位（分片篡改模拟）。 */
  corruptAt?: number
  /** 附加响应头（仅无 Range 的 200 响应；Content-Length 预检测试用）。 */
  headers?: Record<string, string>
  /** 消费端 destroy/取消后置 true（流内截流回归断言用）。 */
  cancelled?: boolean
  seenRanges: (string | undefined)[]
}

function bodyStream(body: Buffer, route: FakeRoute): ReadableStream<Uint8Array> {
  const failAt = route.failAfterBytes
  const corruptAt = route.corruptAt
  return new ReadableStream({
    async start(c) {
      const limit = failAt !== undefined ? Math.min(failAt, body.byteLength) : body.byteLength
      for (let off = 0; off < limit; off += 512) {
        const chunk = Buffer.from(body.subarray(off, Math.min(off + 512, limit)))
        if (corruptAt !== undefined && corruptAt >= off && corruptAt < off + chunk.byteLength) {
          chunk[corruptAt - off] = chunk[corruptAt - off]! ^ 0xff
        }
        c.enqueue(chunk)
        // 让出事件循环：模拟真实网络边传边收（同步全量 enqueue 后立刻 error 会让
        // Readable.fromWeb 丢弃未消费 chunk，测不到断点续传语义）
        await new Promise((r) => setImmediate(r))
      }
      if (failAt !== undefined && failAt < body.byteLength) {
        c.error(new Error("simulated connection reset"))
        return
      }
      c.close()
    },
    cancel() {
      route.cancelled = true
    },
  })
}

function makeFakeFetch(routes: Record<string, FakeRoute>): typeof fetch {
  return (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    const url = String(input)
    const route = routes[url]
    if (!route) return new Response("not found", { status: 404 })
    const range = init?.headers?.Range
    route.seenRanges.push(range)
    if (range) {
      const m = /^bytes=(\d+)-$/.exec(range)
      const from = m ? Number(m[1]) : 0
      if (route.rangeStatus === 416 || from >= route.body.byteLength) {
        return new Response(null, { status: 416 })
      }
      if (route.rangeStatus === 200) {
        return new Response(bodyStream(route.body, route) as any, { status: 200 })
      }
      const sliced = route.body.subarray(from)
      return new Response(bodyStream(sliced, route) as any, {
        status: 206,
        headers: { "Content-Range": `bytes ${from}-${route.body.byteLength - 1}/${route.body.byteLength}` },
      })
    }
    return new Response(bodyStream(route.body, route) as any, { status: 200, headers: route.headers })
  }) as unknown as typeof fetch
}

// --- helpers -----------------------------------------------------------------

function makeEnv() {
  const dir = mkdtempSync(path.join(tmpdir(), "cmspark-dl-"))
  const events: { event: string; payload: Record<string, unknown> }[] = []
  const deps: ModelDownloadDeps = {
    log: (event, payload) => events.push({ event, payload }),
    diskFreeBytes: async () => null, // 默认跳过 disk-full 检查
  }
  return {
    dir,
    deps,
    events,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
    routeFor: (manifest: ModelManifest): Record<string, FakeRoute> => {
      const routes: Record<string, FakeRoute> = {}
      for (const f of manifest.models.tinyclick!.variants.hybrid!.files) {
        routes[f.url] = { body: f.name === "a.onnx" ? FILE_A : FILE_B, seenRanges: [] }
      }
      return routes
    },
  }
}

function expectDownloadError(err: unknown, reason: string): void {
  assert.ok(err instanceof ModelDownloadError, `期望 ModelDownloadError，实际: ${String(err)}`)
  assert.strictEqual((err as ModelDownloadError).reason, reason)
}

// --- 主流程 ---------------------------------------------------------------------

test("download: 全新下载成功——文件齐全、无 .part 残留、totalBytes 正确", async () => {
  const env = makeEnv()
  try {
    const manifest = makeManifest()
    const routes = env.routeFor(manifest)
    const result = await downloadModelVariant(
      { manifest, modelId: "tinyclick", variant: "hybrid", destDir: env.dir },
      { ...env.deps, fetchImpl: makeFakeFetch(routes) },
    )
    assert.deepStrictEqual(readFileSync(path.join(env.dir, "a.onnx")), FILE_A)
    assert.deepStrictEqual(readFileSync(path.join(env.dir, "b.onnx")), FILE_B)
    assert.strictEqual(result.totalBytes, FILE_A.byteLength + FILE_B.byteLength)
    assert.deepStrictEqual(result.files, ["a.onnx", "b.onnx"])
    // 无 .part / meta 残留
    const left = readdirSync(env.dir).filter((n) => n.includes(".part"))
    assert.deepStrictEqual(left, [])
    assert.strictEqual(env.events.length, 0)
  } finally {
    env.cleanup()
  }
})

test("download: 断点续传拼接——第二请求带 Range，最终文件哈希通过", async () => {
  const env = makeEnv()
  try {
    const manifest = makeManifest([{ name: "a.onnx", content: FILE_A }])
    const url = manifest.models.tinyclick!.variants.hybrid!.files[0]!.url
    // 预置「上次部分下载」状态：1000 字节分片 + 有效 meta。
    // （不用流错误造断点：pipeline 在 source error 时 destroy 写流、丢弃未 flush
    // 字节，残留分片大小本质不确定——与真实 TCP RST 一致；断线残留由
    // 「原子 rename」用例覆盖存在性，本例专注续传拼接逻辑。）
    seedPart(env.dir, "a.onnx", FILE_A)
    const route: FakeRoute = { body: FILE_A, seenRanges: [] }
    await downloadModelVariant(
      { manifest, modelId: "tinyclick", variant: "hybrid", destDir: env.dir },
      { ...env.deps, fetchImpl: makeFakeFetch({ [url]: route }) },
    )
    assert.deepStrictEqual(route.seenRanges, ["bytes=1000-"])
    assert.deepStrictEqual(readFileSync(path.join(env.dir, "a.onnx")), FILE_A)
    assert.strictEqual(existsSync(path.join(env.dir, "a.onnx.part")), false)
    assert.strictEqual(existsSync(path.join(env.dir, "a.onnx.part.json")), false)
  } finally {
    env.cleanup()
  }
})

test("download: 分片篡改——最终全量哈希复验检出并删除分片", async () => {
  const env = makeEnv()
  try {
    const manifest = makeManifest([{ name: "a.onnx", content: FILE_A }])
    const url = manifest.models.tinyclick!.variants.hybrid!.files[0]!.url
    const route: FakeRoute = { body: FILE_A, corruptAt: 1500, seenRanges: [] }
    await assert.rejects(
      () =>
        downloadModelVariant(
          { manifest, modelId: "tinyclick", variant: "hybrid", destDir: env.dir },
          { ...env.deps, fetchImpl: makeFakeFetch({ [url]: route }) },
        ),
      (e) => (expectDownloadError(e, "hash-mismatch"), true),
    )
    // 被篡改分片不得留作续传基础
    assert.strictEqual(existsSync(path.join(env.dir, "a.onnx.part")), false)
    assert.strictEqual(existsSync(path.join(env.dir, "a.onnx.part.json")), false)
    assert.strictEqual(existsSync(path.join(env.dir, "a.onnx")), false)
    // 审计事件形状
    assert.strictEqual(env.events.length, 1)
    assert.strictEqual(env.events[0]!.event, "computeruse.model.unavailable")
    assert.strictEqual(env.events[0]!.payload.reason, "hash-mismatch")
    assert.strictEqual(env.events[0]!.payload.modelId, "tinyclick")
    assert.strictEqual(env.events[0]!.payload.variant, "hybrid")
  } finally {
    env.cleanup()
  }
})

test("download: 原子 rename——下载中途崩溃不留半成品最终文件", async () => {
  const env = makeEnv()
  try {
    const manifest = makeManifest([{ name: "a.onnx", content: FILE_A }])
    const url = manifest.models.tinyclick!.variants.hybrid!.files[0]!.url
    const route: FakeRoute = { body: FILE_A, failAfterBytes: 512, seenRanges: [] }
    await assert.rejects(() =>
      downloadModelVariant(
        { manifest, modelId: "tinyclick", variant: "hybrid", destDir: env.dir },
        { ...env.deps, fetchImpl: makeFakeFetch({ [url]: route }) },
      ),
    )
    assert.strictEqual(existsSync(path.join(env.dir, "a.onnx")), false) // 无半成品最终文件
    assert.strictEqual(existsSync(path.join(env.dir, "a.onnx.part")), true) // 分片残留供续传
  } finally {
    env.cleanup()
  }
})

test("download: 磁盘预算超限——下载前拒下，fetch 零调用", async () => {
  const env = makeEnv()
  try {
    const manifest = makeManifest()
    const routes = env.routeFor(manifest)
    const fetchImpl = makeFakeFetch(routes)
    await assert.rejects(
      () =>
        downloadModelVariant(
          { manifest, modelId: "tinyclick", variant: "hybrid", destDir: env.dir, diskBudgetMB: 0.001 },
          { ...env.deps, fetchImpl },
        ),
      (e) => (expectDownloadError(e, "disk-budget-exceeded"), true),
    )
    assert.strictEqual(routes[Object.keys(routes)[0]!]!.seenRanges.length, 0) // 下载前检查
    assert.strictEqual(env.events[0]!.payload.reason, "disk-budget-exceeded")
  } finally {
    env.cleanup()
  }
})

test("download: 卷剩余不足拒下；diskFreeBytes 不可用（null）时跳过该项", async () => {
  const env = makeEnv()
  try {
    const manifest = makeManifest([{ name: "a.onnx", content: FILE_A }])
    const routes = env.routeFor(manifest)
    await assert.rejects(
      () =>
        downloadModelVariant(
          { manifest, modelId: "tinyclick", variant: "hybrid", destDir: env.dir },
          { ...env.deps, fetchImpl: makeFakeFetch(routes), diskFreeBytes: async () => 10 },
        ),
      (e) => (expectDownloadError(e, "disk-full"), true),
    )
    // null（statfs 不可用）→ 跳过 disk-full，正常下载（预算检查仍在）
    const result = await downloadModelVariant(
      { manifest, modelId: "tinyclick", variant: "hybrid", destDir: env.dir },
      { ...env.deps, fetchImpl: makeFakeFetch(routes), diskFreeBytes: async () => null },
    )
    assert.strictEqual(result.files.length, 1)
  } finally {
    env.cleanup()
  }
})

test("download: file:// 镜像拒绝（mirror-scheme-denied + 审计）", async () => {
  const env = makeEnv()
  try {
    const manifest = makeManifest([{ name: "a.onnx", content: FILE_A }])
    await assert.rejects(
      () =>
        downloadModelVariant(
          { manifest, modelId: "tinyclick", variant: "hybrid", destDir: env.dir, mirror: "file:///C:/evil" },
          { ...env.deps, fetchImpl: makeFakeFetch({}) },
        ),
      (e) => (expectDownloadError(e, "mirror-scheme-denied"), true),
    )
    assert.strictEqual(env.events[0]!.payload.reason, "mirror-scheme-denied")
  } finally {
    env.cleanup()
  }
})

test("download: http-error（5xx）审计形状", async () => {
  const env = makeEnv()
  try {
    const manifest = makeManifest([{ name: "a.onnx", content: FILE_A }])
    const url = manifest.models.tinyclick!.variants.hybrid!.files[0]!.url
    const fetchImpl = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch
    await assert.rejects(
      () =>
        downloadModelVariant(
          { manifest, modelId: "tinyclick", variant: "hybrid", destDir: env.dir },
          { ...env.deps, fetchImpl },
        ),
      (e) => (expectDownloadError(e, "http-error"), true),
    )
    assert.strictEqual(env.events[0]!.event, "computeruse.model.unavailable")
    assert.strictEqual(env.events[0]!.payload.reason, "http-error")
    assert.strictEqual(url.includes("https://"), true)
  } finally {
    env.cleanup()
  }
})

// --- 超限流截流（M1，I1 对抗 P1-a） ----------------------------------------------

test("oversize: 申报 1000B 吐 8MB——流内截断、fetch 中止、落盘有界、分片清理", async () => {
  const env = makeEnv()
  try {
    const big = contentOf(3, 8 * 1024 * 1024)
    const manifest = makeManifest([{ name: "a.onnx", content: FILE_A }])
    const f = manifest.models.tinyclick!.variants.hybrid!.files[0]!
    f.size = 1000 // manifest 申报 1000B；线路吐 8MB（探针同款 8389× 场景）
    const route: FakeRoute = { body: big, seenRanges: [] }
    const progress: number[] = []
    await assert.rejects(
      () =>
        downloadModelVariant(
          { manifest, modelId: "tinyclick", variant: "hybrid", destDir: env.dir },
          {
            ...env.deps,
            fetchImpl: makeFakeFetch({ [f.url]: route }),
            onProgress: (_file, received) => progress.push(received),
          },
        ),
      (e) => (expectDownloadError(e, "oversize-stream"), true),
    )
    assert.strictEqual(route.cancelled, true, "超限即应中止 fetch（截断于中途，非流尽后拒绝）")
    assert.ok(progress.length > 0 && Math.max(...progress) < 100_000, "截断点应在 size+ε 量级，远小于 8MB")
    // 被污染分片+meta 已清理，不留续传基础；最终文件不存在
    assert.strictEqual(existsSync(path.join(env.dir, "a.onnx.part")), false)
    assert.strictEqual(existsSync(path.join(env.dir, "a.onnx.part.json")), false)
    assert.strictEqual(existsSync(path.join(env.dir, "a.onnx")), false)
    assert.strictEqual(env.events[0]!.payload.reason, "oversize-stream")
    assert.strictEqual(route.seenRanges.length, 1) // 单次请求内截断
  } finally {
    env.cleanup()
  }
})

test("oversize: Content-Length 预检——声明字节超申报，零写盘拒绝", async () => {
  const env = makeEnv()
  try {
    const big = contentOf(3, 8 * 1024 * 1024)
    const manifest = makeManifest([{ name: "a.onnx", content: FILE_A }])
    const f = manifest.models.tinyclick!.variants.hybrid!.files[0]!
    f.size = 1000
    const route: FakeRoute = {
      body: big,
      headers: { "Content-Length": String(big.byteLength) },
      seenRanges: [],
    }
    const progress: number[] = []
    await assert.rejects(
      () =>
        downloadModelVariant(
          { manifest, modelId: "tinyclick", variant: "hybrid", destDir: env.dir },
          {
            ...env.deps,
            fetchImpl: makeFakeFetch({ [f.url]: route }),
            onProgress: (_file, received) => progress.push(received),
          },
        ),
      (e) => (expectDownloadError(e, "oversize-stream"), true),
    )
    assert.deepStrictEqual(progress, [], "预检应在任何 body 字节写盘前拒绝")
    assert.strictEqual(existsSync(path.join(env.dir, "a.onnx.part")), false) // 零写盘
    assert.strictEqual(env.events[0]!.payload.reason, "oversize-stream")
  } finally {
    env.cleanup()
  }
})

// --- stale .part（M7） -----------------------------------------------------------

/** 预置 .part + meta（参数可覆写），返回 meta 路径。 */
function seedPart(dir: string, name: string, partContent: Buffer, metaOverrides: Record<string, unknown> = {}): void {
  const manifest = makeManifest([{ name, content: partContent }])
  const f = manifest.models.tinyclick!.variants.hybrid!.files[0]!
  writeFileSync(path.join(dir, `${name}.part`), partContent.subarray(0, Math.min(1000, partContent.byteLength)))
  writeFileSync(
    path.join(dir, `${name}.part.json`),
    JSON.stringify({
      url: f.url,
      revision: REV,
      sha256: f.sha256,
      size: f.size,
      startedAt: Date.now(),
      ...metaOverrides,
    }),
  )
}

test("stale: revision 变更 → 删旧分片从头重下（无 Range）", async () => {
  const env = makeEnv()
  try {
    const manifest = makeManifest([{ name: "a.onnx", content: FILE_A }])
    const url = manifest.models.tinyclick!.variants.hybrid!.files[0]!.url
    seedPart(env.dir, "a.onnx", FILE_A, { revision: "aaaaaaaabbbbbbbbccccccccddddddddeeeeeeee" })
    const route: FakeRoute = { body: FILE_A, seenRanges: [] }
    await downloadModelVariant(
      { manifest, modelId: "tinyclick", variant: "hybrid", destDir: env.dir },
      { ...env.deps, fetchImpl: makeFakeFetch({ [url]: route }) },
    )
    assert.deepStrictEqual(route.seenRanges, [undefined]) // 无 Range = 从头下
    assert.deepStrictEqual(readFileSync(path.join(env.dir, "a.onnx")), FILE_A)
  } finally {
    env.cleanup()
  }
})

test("stale: 超期（>PART_STALE_MS）→ 删旧分片从头重下", async () => {
  const env = makeEnv()
  try {
    const manifest = makeManifest([{ name: "a.onnx", content: FILE_A }])
    const url = manifest.models.tinyclick!.variants.hybrid!.files[0]!.url
    const t0 = 1_800_000_000_000
    seedPart(env.dir, "a.onnx", FILE_A, { startedAt: t0 - PART_STALE_MS - 1 })
    const route: FakeRoute = { body: FILE_A, seenRanges: [] }
    await downloadModelVariant(
      { manifest, modelId: "tinyclick", variant: "hybrid", destDir: env.dir },
      { ...env.deps, fetchImpl: makeFakeFetch({ [url]: route }), now: () => t0 },
    )
    assert.deepStrictEqual(route.seenRanges, [undefined])
  } finally {
    env.cleanup()
  }
})

test("stale: meta 缺失（孤儿 .part）→ 删了从头重下", async () => {
  const env = makeEnv()
  try {
    const manifest = makeManifest([{ name: "a.onnx", content: FILE_A }])
    const url = manifest.models.tinyclick!.variants.hybrid!.files[0]!.url
    writeFileSync(path.join(env.dir, "a.onnx.part"), FILE_A.subarray(0, 1000)) // 无 meta
    const route: FakeRoute = { body: FILE_A, seenRanges: [] }
    await downloadModelVariant(
      { manifest, modelId: "tinyclick", variant: "hybrid", destDir: env.dir },
      { ...env.deps, fetchImpl: makeFakeFetch({ [url]: route }) },
    )
    assert.deepStrictEqual(route.seenRanges, [undefined])
    assert.deepStrictEqual(readFileSync(path.join(env.dir, "a.onnx")), FILE_A)
  } finally {
    env.cleanup()
  }
})

test("stale: meta.url 与解析 url 不符（镜像变更）→ 从头重下", async () => {
  const env = makeEnv()
  try {
    const manifest = makeManifest([{ name: "a.onnx", content: FILE_A }])
    const url = manifest.models.tinyclick!.variants.hybrid!.files[0]!.url
    seedPart(env.dir, "a.onnx", FILE_A, { url: "https://old-mirror.example/x/a.onnx" })
    const route: FakeRoute = { body: FILE_A, seenRanges: [] }
    await downloadModelVariant(
      { manifest, modelId: "tinyclick", variant: "hybrid", destDir: env.dir },
      { ...env.deps, fetchImpl: makeFakeFetch({ [url]: route }) },
    )
    assert.deepStrictEqual(route.seenRanges, [undefined])
  } finally {
    env.cleanup()
  }
})

// --- Range 回退 ------------------------------------------------------------------

test("range: 服务端对 Range 返回 200（不支持续传）→ 从头重写，文件完整", async () => {
  const env = makeEnv()
  try {
    const manifest = makeManifest([{ name: "a.onnx", content: FILE_A }])
    const url = manifest.models.tinyclick!.variants.hybrid!.files[0]!.url
    seedPart(env.dir, "a.onnx", FILE_A)
    const route: FakeRoute = { body: FILE_A, rangeStatus: 200, seenRanges: [] }
    await downloadModelVariant(
      { manifest, modelId: "tinyclick", variant: "hybrid", destDir: env.dir },
      { ...env.deps, fetchImpl: makeFakeFetch({ [url]: route }) },
    )
    assert.deepStrictEqual(route.seenRanges, ["bytes=1000-"]) // 试过续传
    assert.deepStrictEqual(readFileSync(path.join(env.dir, "a.onnx")), FILE_A) // 从头重写后完整
  } finally {
    env.cleanup()
  }
})

test("range: 416（Range 不可满足）→ 删分片重发无 Range 请求", async () => {
  const env = makeEnv()
  try {
    const manifest = makeManifest([{ name: "a.onnx", content: FILE_A }])
    const url = manifest.models.tinyclick!.variants.hybrid!.files[0]!.url
    seedPart(env.dir, "a.onnx", FILE_A)
    const route: FakeRoute = { body: FILE_A, rangeStatus: 416, seenRanges: [] }
    await downloadModelVariant(
      { manifest, modelId: "tinyclick", variant: "hybrid", destDir: env.dir },
      { ...env.deps, fetchImpl: makeFakeFetch({ [url]: route }) },
    )
    assert.deepStrictEqual(route.seenRanges, ["bytes=1000-", undefined]) // 先 Range 后全量
    assert.deepStrictEqual(readFileSync(path.join(env.dir, "a.onnx")), FILE_A)
  } finally {
    env.cleanup()
  }
})

test("range: 分片已齐未 rename（上次崩在复验前）→ 零请求直接复验 rename", async () => {
  const env = makeEnv()
  try {
    const manifest = makeManifest([{ name: "a.onnx", content: FILE_A }])
    const url = manifest.models.tinyclick!.variants.hybrid!.files[0]!.url
    // 分片完整 + meta 有效
    writeFileSync(path.join(env.dir, "a.onnx.part"), FILE_A)
    const f = manifest.models.tinyclick!.variants.hybrid!.files[0]!
    writeFileSync(
      path.join(env.dir, "a.onnx.part.json"),
      JSON.stringify({ url: f.url, revision: REV, sha256: f.sha256, size: f.size, startedAt: Date.now() }),
    )
    const route: FakeRoute = { body: FILE_A, seenRanges: [] }
    await downloadModelVariant(
      { manifest, modelId: "tinyclick", variant: "hybrid", destDir: env.dir },
      { ...env.deps, fetchImpl: makeFakeFetch({ [url]: route }) },
    )
    assert.deepStrictEqual(route.seenRanges, []) // 零网络请求
    assert.deepStrictEqual(readFileSync(path.join(env.dir, "a.onnx")), FILE_A)
    assert.strictEqual(existsSync(path.join(env.dir, "a.onnx.part")), false)
  } finally {
    env.cleanup()
  }
})

// --- 幂等跳过（M5，I1 对抗 P3-c） --------------------------------------------------

test("idempotent: 全变体已在盘且哈希命中 → 零 fetch 跳过，残留分片顺手清理", async () => {
  const env = makeEnv()
  try {
    const manifest = makeManifest()
    // 预置「上次已成功」状态：最终文件 + 一个残留的过期分片
    writeFileSync(path.join(env.dir, "a.onnx"), FILE_A)
    writeFileSync(path.join(env.dir, "b.onnx"), FILE_B)
    writeFileSync(path.join(env.dir, "b.onnx.part"), FILE_B.subarray(0, 100))
    writeFileSync(path.join(env.dir, "b.onnx.part.json"), "{}")
    const routes = env.routeFor(manifest)
    const result = await downloadModelVariant(
      { manifest, modelId: "tinyclick", variant: "hybrid", destDir: env.dir },
      { ...env.deps, fetchImpl: makeFakeFetch(routes) },
    )
    for (const url of Object.keys(routes)) {
      assert.deepStrictEqual(routes[url]!.seenRanges, [], `${url} 不应有任何请求`)
    }
    assert.deepStrictEqual(result.files, ["a.onnx", "b.onnx"])
    assert.strictEqual(existsSync(path.join(env.dir, "b.onnx.part")), false)
    assert.strictEqual(existsSync(path.join(env.dir, "b.onnx.part.json")), false)
    assert.strictEqual(env.events.length, 0) // 幂等命中非失败，无审计噪音
  } finally {
    env.cleanup()
  }
})

test("idempotent: 在盘文件哈希不符（本地被改）→ 正常重下并替换", async () => {
  const env = makeEnv()
  try {
    const manifest = makeManifest([{ name: "a.onnx", content: FILE_A }])
    const url = manifest.models.tinyclick!.variants.hybrid!.files[0]!.url
    const tampered = Buffer.from(FILE_A)
    tampered[0] = tampered[0]! ^ 0xff
    writeFileSync(path.join(env.dir, "a.onnx"), tampered)
    const route: FakeRoute = { body: FILE_A, seenRanges: [] }
    await downloadModelVariant(
      { manifest, modelId: "tinyclick", variant: "hybrid", destDir: env.dir },
      { ...env.deps, fetchImpl: makeFakeFetch({ [url]: route }) },
    )
    assert.strictEqual(route.seenRanges.length, 1) // 发生了真实重下
    assert.deepStrictEqual(readFileSync(path.join(env.dir, "a.onnx")), FILE_A) // 被替换为正确字节
  } finally {
    env.cleanup()
  }
})

// --- 删除模型 --------------------------------------------------------------------

test("delete: 删除模型目录回收全部字节（含 .part/meta）；目录不存在返回 0", async () => {
  const env = makeEnv()
  try {
    writeFileSync(path.join(env.dir, "a.onnx"), FILE_A)
    writeFileSync(path.join(env.dir, "b.onnx.part"), FILE_B.subarray(0, 100))
    writeFileSync(path.join(env.dir, "b.onnx.part.json"), "{}")
    const result = await deleteModelVariant({ variant: "hybrid", destDir: env.dir })
    assert.strictEqual(result.removedBytes, FILE_A.byteLength + 100 + 2)
    assert.strictEqual(existsSync(env.dir), false)
    const again = await deleteModelVariant({ variant: "hybrid", destDir: env.dir })
    assert.strictEqual(again.removedBytes, 0)
  } finally {
    env.cleanup()
  }
})

// --- 常量 ------------------------------------------------------------------------

test("常量: 默认磁盘预算 2048MB（hybrid+int8 双变体余量）", () => {
  assert.strictEqual(DEFAULT_DISK_BUDGET_MB, 2048)
  assert.ok(PART_STALE_MS >= 60 * 60 * 1000, "stale 阈值至少 1h 量级")
})
