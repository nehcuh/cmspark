import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { MiniProfileLock } from "../src/mini/profile-lock"
import { WindowsMini } from "../src/mini/windows-mini"

test("Mini profile ownership is exclusive across instances and transfers after release", { skip: process.platform !== "win32" }, async () => {
  const dir = join(tmpdir(), "cmspark-mini-" + randomUUID())
  const first = new MiniProfileLock(dir)
  const second = new MiniProfileLock(dir.toUpperCase() + "\\child\\..\\")
  const other = new MiniProfileLock(dir + "-other")
  try {
    const acquired = await Promise.all([first.acquire(), second.acquire()])
    assert.equal(acquired.filter(Boolean).length, 1)
    const [owner, waiting] = acquired[0] ? [first, second] : [second, first]
    assert.equal(await owner.acquire(), true)
    assert.equal(await other.acquire(), true)
    await waiting.release()
    assert.equal(await waiting.acquire(), false)
    await owner.release()
    assert.equal(await waiting.acquire(), true)
    assert.equal(await owner.acquire(), false)
  } finally {
    await Promise.all([first.release(), second.release(), other.release()])
  }
})

test("overlapping Mini lock operations finish in call order", { skip: process.platform !== "win32" }, async () => {
  const dir = join(tmpdir(), "cmspark-mini-" + randomUUID())
  const owner = new MiniProfileLock(dir)
  const contender = new MiniProfileLock(dir)
  try {
    const acquire = owner.acquire()
    const release = owner.release()
    const reacquire = owner.acquire()
    assert.deepEqual(await Promise.all([acquire, release, reacquire]), [true, undefined, true])
    assert.equal(await contender.acquire(), false)
    await Promise.all([owner.release(), owner.release()])
    assert.equal(await contender.acquire(), true)
  } finally {
    await Promise.all([owner.release(), contender.release()])
  }
})

test("a second tray cannot start shortcut settings or toggle the first tray's hidden orb", { skip: process.platform !== "win32" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "cmspark-mini-profile-"))
  const notices: string[] = []
  const tray = () => new WindowsMini(dir, async () => {}, () => {}, message => notices.push(message))
  const first = tray(), second = tray(), third = tray()
  try {
    await writeFile(join(dir, "mini-hidden"), "")
    await writeFile(join(dir, "mini-hotkeys.json"), '{"version":2,"bindings":{}}')
    await first.start()
    await second.start()
    await second.openHotkeySettings()
    await second.toggle()
    assert.equal(notices.length, 2)
    assert.ok(notices.every(message => message.includes("另一个 CMspark 托盘")))
    assert.equal(await readFile(join(dir, "mini-hidden"), "utf8"), "")
    await first.stop()
    await second.start()
    await third.openHotkeySettings()
    assert.equal(notices.length, 3)
  } finally {
    await Promise.all([first.stop(), second.stop(), third.stop()])
    await rm(dir, { recursive: true, force: true })
  }
})
