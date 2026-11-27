import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DesktopMini } from "../src/mini/desktop-mini"

test("Mini restores only live captures and remembers an explicit hide across tray restarts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mini-pref-"))
  const events: string[] = []
  let capturing: AbortSignal | undefined
  let release: () => void = () => {}
  const make = () => new DesktopMini(dir, {
    show: async () => { events.push("shown") }, hide: () => { events.push("hidden") }, stop: async () => {},
  }, async (key, signal) => {
    if (key === "chat") return
    capturing = signal
    await new Promise<void>(resolve => { release = resolve })
  }, () => {}, msg => { throw new Error(msg) }, () => { events.push("restored") })
  let mini = make()
  try {
    await mini.start()
    assert.deepEqual(events, ["shown"])
    const first = mini.perform("capture")
    release()
    await first
    assert.deepEqual(events, ["shown", "restored"])
    const next = mini.perform("ocr")
    await mini.toggle()
    assert.equal(capturing?.aborted, true)
    release()
    await next
    await mini.stop()
    mini = make()
    await mini.start()
    assert.deepEqual(events, ["shown", "restored", "hidden", "hidden"])
    await mini.toggle()
    assert.equal(events.at(-1), "shown")
  } finally {
    release()
    await mini.stop()
    await rm(dir, { recursive: true, force: true })
  }
})
