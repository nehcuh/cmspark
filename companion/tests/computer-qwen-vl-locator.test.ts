// Qwen3-VL locator envelope + collapse (no real model).

import test from "node:test"
import assert from "node:assert/strict"
import {
  QwenVlLocator,
  QWEN_VL_REASON,
} from "../src/computer/qwen-vl-locator"
import type { CaptureMeta } from "../src/computer/types"

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
