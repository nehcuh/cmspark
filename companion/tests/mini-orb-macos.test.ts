import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { parseMiniInvocation } from "../src/mini/actions"
import { promisify } from "node:util"

const run = promisify(execFile)
const enabled = process.platform === "darwin" && process.env.CMSPARK_MINI_NATIVE_ORB === "1"

test("macOS Mini gestures, native action menu, capture handoff and saved monitor position", {
  skip: !enabled, timeout: 60_000,
}, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cmspark-mini-appkit-"))
  try {
    const source = await readFile("src/tray/Tray.swift", "utf8")
    assert.equal(source.match(/^@main$/gm)?.length, 1)
    // Exercise the production menu/command handlers in AppKit with a controlled event stream.
    const tray = path.join(dir, "Tray.swift"), binary = path.join(dir, "test-orb")
    await writeFile(tray, source.replace(/^@main$/m, ""))
    await run("swiftc", [tray, "src/tray/MiniActionFan.swift", "src/tray/SummonerOverlay.swift", "tests/fixtures/mini-orb-driver.swift",
      "-o", binary, "-framework", "AppKit", "-framework", "AVFoundation", "-framework", "Carbon"])
    const opts = { env: { ...process.env, CMSPARK_DATA_DIR: dir }, timeout: 10_000 }
    const { stdout } = await run(binary, [], opts)
    assert.match(stdout, /PASS macOS Mini/)
    const frames = (output: string) => output.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line))
    const events = frames(stdout)
    assert.ok(events.some(e => e.action === "mini-toggle"))
    const picks = events.filter(e => e.action === "mini-action").map(e => e.id)
    const delayed = parseMiniInvocation(picks.pop())
    assert.equal(delayed?.action, "capture")
    assert.equal(delayed?.timing?.seconds, 3)
    assert.match(delayed?.timing?.region ?? "", /^-?\d+,-?\d+,51,35$/)
    assert.deepEqual(picks, ["chat", "todo", "chat", "search", "meeting", "ask", "ocr", "capture", "chat"])
    for (const id of ["todo", "ask", "ocr", "capture"]) {
      const previous = events[events.findIndex(e => e.id === id) - 1]
      assert.equal(previous.surface, "mini")
      assert.equal(previous.hidden, true)
    }
    const restored = frames((await run(binary, ["--restored-position"], opts)).stdout).find(e => e.width)
    const last = events.filter(e => e.width).at(-1)
    assert.ok(restored && last)
    assert.equal(restored.x, last.x)
    assert.equal(restored.y, last.y)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
