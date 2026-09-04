import test from "node:test"
import assert from "node:assert/strict"
import { capsuleView } from "../src/sidepanel/voice/capsule-view"

test("idle / unsupported → not visible", () => {
  assert.equal(capsuleView({ phase: "idle", engine: "local", locked: false, level: 0 }).visible, false)
  assert.equal(capsuleView({ phase: "unsupported", engine: "browser", locked: false, level: 0 }).visible, false)
})

test("listening local → red + uses level (breathing)", () => {
  const v = capsuleView({ phase: "listening", engine: "local", locked: false, level: 0.4 })
  assert.equal(v.visible, true)
  assert.equal(v.tone, "red")
  assert.equal(v.useLevel, true)
  assert.ok(v.live.length > 0)
})

test("listening browser → pulse, not level (must not pretend)", () => {
  const v = capsuleView({ phase: "listening", engine: "browser", locked: false, level: 0.9 })
  assert.equal(v.tone, "red")
  assert.equal(v.useLevel, false)
  assert.equal(v.pulse, true)
  assert.ok(v.label.includes("电平") || v.hint.includes("电平") || v.live.includes("脉冲"))
})

test("locked listening shows lock copy", () => {
  const v = capsuleView({ phase: "listening", engine: "local", locked: true, level: 0.2 })
  assert.ok(v.label.includes("已锁定"))
})

test("processing / stopping / refining → blue glow", () => {
  for (const phase of ["processing", "stopping", "refining"] as const) {
    const v = capsuleView({ phase, engine: "local", locked: false, level: 0 })
    assert.equal(v.tone, "blue")
    assert.equal(v.visible, true)
  }
})

test("starting local → warmup copy", () => {
  const v = capsuleView({ phase: "starting", engine: "local", locked: false, level: 0 })
  assert.equal(v.tone, "warmup")
  assert.ok(v.label.includes("预热"))
})
