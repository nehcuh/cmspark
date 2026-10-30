// Qwen3-VL locator envelope + collapse (no real model).

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  QwenVlLocator,
  QWEN_VL_REASON,
  QWEN_VL_WORKER_RAW_CAP,
} from "../src/computer/qwen-vl-locator"
import type { CaptureMeta } from "../src/computer/types"
import { QwenVlRuntime } from "../src/computer/qwen-vl-runtime"
import { QwenVlSession } from "../src/computer/qwen-vl-session"

function shot(over: Partial<CaptureMeta> & { path?: string } = {}): CaptureMeta {
  return {
    path: over.path ?? "/tmp/shot.png",
    rect: { x: 0, y: 0, width: 1280, height: 720 },
    client: { x: 0, y: 0 },
    ...(over as any),
  } as CaptureMeta
}

test("empty command → skipped empty", async () => {
  const loc = new QwenVlLocator({
    session: { locate: async () => ({ point: { x: 1, y: 1 }, ms: 1 }) },
  })
  const r = await loc.locate({ command: "  ", shot: shot() })
  assert.deepEqual(r, { kind: "skipped", reason: QWEN_VL_REASON.EMPTY })
})

test("Chinese command allowed → hit", async () => {
  const loc = new QwenVlLocator({
    session: {
      locate: async (cmd) => {
        assert.match(cmd, /确定/)
        return { point: { x: 100, y: 200 }, ms: 12, raw: '{"x":100,"y":200}' }
      },
    },
  })
  const r = await loc.locate({ command: "点击确定按钮", shot: shot({ path: "/tmp/a.png" } as any) })
  assert.equal(r.kind, "hit")
  if (r.kind === "hit") {
    // Path C reparse wins (#423 always-map): 100/1000·1280=128, 200/1000·720=144
    assert.deepEqual(r.point, { x: 128, y: 144 })
  }
})

test("collapse same frame different command → skipped", async () => {
  const loc = new QwenVlLocator({
    session: { locate: async () => ({ point: { x: 50, y: 50 }, ms: 1 }) },
  })
  const s = shot({ path: "/tmp/b.png", sha256: "abc" } as any)
  const r1 = await loc.locate({ command: "click OK", shot: s })
  assert.equal(r1.kind, "hit")
  const r2 = await loc.locate({ command: "click Cancel", shot: s })
  assert.deepEqual(r2, { kind: "skipped", reason: QWEN_VL_REASON.COLLAPSE })
})

test("catalog migrate legacy hybrid → 2b", async () => {
  const { migrateLegacyModelVariant } = await import("../src/computer/qwen-vl-catalog")
  assert.equal(migrateLegacyModelVariant("hybrid"), "2b")
  assert.equal(migrateLegacyModelVariant("int8"), "2b")
  assert.equal(migrateLegacyModelVariant("4b"), "4b")
})

test("Path C: start_box four-number raw → box center via parseGuiClickPoint", async () => {
  const loc = new QwenVlLocator({
    session: {
      // Worker returns corner-ish point; raw has full box — reparse should win center.
      locate: async () => ({
        point: { x: 10, y: 20 },
        ms: 3,
        raw: "Action: click(start_box='(10,20,30,40)')",
      }),
    },
  })
  const r = await loc.locate({ command: "点保存", shot: shot({ path: "/tmp/box.png" } as any) })
  assert.equal(r.kind, "hit")
  if (r.kind === "hit") {
    // box center (20,30) in [0,1000] → 20/1000·1280≈26, 30/1000·720≈22
    assert.deepEqual(r.point, { x: 26, y: 22 })
    assert.match(String(r.raw), /start_box/)
  }
})

test("truncated worker raw cannot replace the full-text worker coordinate", async () => {
  const raw = ("a".repeat(486) + '{"x":1,"y":1000}').slice(0, 500)
  const loc = new QwenVlLocator({
    session: { locate: async () => ({ point: { x: 0, y: 499 }, ms: 1, raw }) },
  })
  const result = await loc.locate({ command: "click", shot: shot({ imageWidth: 500, imageHeight: 500 }) })
  assert.equal(result.kind, "hit")
  if (result.kind === "hit") assert.deepEqual(result.point, { x: 0, y: 499 })
})

test("ambiguous capped raw without a worker coordinate fails closed", async () => {
  const raw = ("a".repeat(486) + '{"x":1,"y":1000}').slice(0, 500)
  const loc = new QwenVlLocator({
    session: { locate: async () => ({ point: null, ms: 1, raw }) },
  })
  const result = await loc.locate({ command: "click", shot: shot({ imageWidth: 500, imageHeight: 500 }) })
  assert.deepEqual(result, { kind: "error", reason: QWEN_VL_REASON.ERROR })
})

test("worker success raw cap agrees with locator admission boundary", () => {
  const worker = readFileSync(join(process.cwd(), "src/computer/qwen-vl-worker.py"), "utf8")
  const match = worker.match(/return\s+\{"ok": True, "x": x, "y": y, "raw": raw\[:(\d+)\], "raw_complete": len\(raw\) < \1\}/)
  assert.ok(match, "worker success response must expose its raw slice limit")
  assert.equal(Number(match[1]), QWEN_VL_WORKER_RAW_CAP)
})

test("499-character raw preserves the existing reparse behavior", async () => {
  const point = '{"x":100,"y":200}'
  const raw = "a".repeat(499 - point.length) + point
  const loc = new QwenVlLocator({
    session: { locate: async () => ({ point: { x: 1, y: 1 }, ms: 1, raw }) },
  })
  const result = await loc.locate({ command: "click", shot: shot({ imageWidth: 500, imageHeight: 500 }) })
  assert.equal(result.kind, "hit")
  if (result.kind === "hit") assert.deepEqual(result.point, { x: 50, y: 100 })
})

test("complete Unicode raw below the Python cap is reparsed", async () => {
  // Python len(raw) is 499, while JavaScript raw.length is 500.
  const raw = "😀" + "a".repeat(485) + '{"x":1,"y":0}'
  assert.equal([...raw].length, 499)
  assert.equal(raw.length, 500)
  const loc = new QwenVlLocator({
    session: { locate: async () => ({ point: { x: 0, y: 0 }, ms: 1, raw, rawComplete: true }) },
  })
  const result = await loc.locate({ command: "click", shot: shot({ imageWidth: 500, imageHeight: 500 }) })
  assert.equal(result.kind, "hit")
  if (result.kind === "hit") assert.deepEqual(result.point, { x: 1, y: 0 })
})

test("explicit incomplete raw never overrides the worker point", async () => {
  const loc = new QwenVlLocator({
    session: { locate: async () => ({ point: { x: 0, y: 0 }, ms: 1, raw: '{"x":1,"y":0}', rawComplete: false }) },
  })
  const result = await loc.locate({ command: "click", shot: shot({ imageWidth: 500, imageHeight: 500 }) })
  assert.equal(result.kind, "hit")
  if (result.kind === "hit") assert.deepEqual(result.point, { x: 0, y: 0 })
})

test("legacy capped Unicode raw remains conservative", async () => {
  const raw = "😀" + "a".repeat(485) + '{"x":1,"y":0}'
  const loc = new QwenVlLocator({
    session: { locate: async () => ({ point: { x: 0, y: 0 }, ms: 1, raw }) },
  })
  const result = await loc.locate({ command: "click", shot: shot({ imageWidth: 500, imageHeight: 500 }) })
  assert.equal(result.kind, "hit")
  if (result.kind === "hit") assert.deepEqual(result.point, { x: 0, y: 0 })
})

test("producer responses preserve completeness through transport, runtime, and session", async () => {
  const fixture = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/qwen-raw-completeness-producer.json"), "utf8")) as Record<string, string>
  const runtime = new QwenVlRuntime({
    variant: "2b", pythonBin: process.execPath,
    workerScript: join(process.cwd(), "src/computer/qwen-vl-worker.py"),
  })
  const internal = runtime as any
  // Replace only the process request, keeping real transport decoding and the
  // real runtime/session/locator propagation. No Python worker is spawned.
  internal.prepared = true
  const session = new QwenVlSession({ variant: "2b" })
  ;(session as any).runtime = runtime
  const locator = new QwenVlLocator({ session })
  const check = async (wire: string, expectedX: number) => {
    internal.transport.request = async () => JSON.parse(wire)
    const result = await locator.locate({ command: "click", shot: shot({ imageWidth: 500, imageHeight: 500 }) })
    assert.equal(result.kind, "hit")
    if (result.kind === "hit") assert.deepEqual(result.point, { x: expectedX, y: 0 })
  }
  await check(fixture.unicode499, 1)
  await check(fixture.ascii500, 0)
  await check(fixture.surrogate500, 0)
  await check(fixture.truncated, 0)
  const legacy = JSON.parse(fixture.unicode499)
  delete legacy.raw_complete
  await check(JSON.stringify(legacy), 0)
  legacy.raw_complete = "true"
  await check(JSON.stringify(legacy), 0)
})
