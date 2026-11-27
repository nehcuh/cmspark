// Run after npm run build in a disposable X11 desktop with GTK 3, xdotool and a window manager.
const assert = require("node:assert/strict")
const { execFileSync } = require("node:child_process")
const { mkdtempSync, readFileSync, rmSync } = require("node:fs")
const { tmpdir } = require("node:os")
const { join } = require("node:path")
const { setTimeout: sleep } = require("node:timers/promises")
const { LinuxMiniHost } = require("../dist/mini/linux-mini")

const xdo = (...args) => execFileSync("xdotool", args.map(String), { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
const visible = () => {
  try { return xdo("search", "--onlyvisible", "--name", "^CMspark Mini$").split("\n")[0] }
  catch { return "" }
}
const geometry = id => Object.fromEntries(xdo("getwindowgeometry", "--shell", id).split("\n").map(line => line.split("=")))
async function until(predicate, description) {
  const end = Date.now() + 5000
  while (Date.now() < end) {
    if (predicate()) return
    await sleep(40)
  }
  throw new Error(description)
}

async function run() {
  const dir = mkdtempSync(join(tmpdir(), "cmspark-mini-"))
  const actions = []
  let release
  const notices = []
  const host = new LinuxMiniHost(dir, async id => {
    actions.push(id)
    if (id === "todo") {
      assert.equal(visible(), "", "orb should be unmapped before region capture")
      await new Promise(resolve => { release = resolve })
    }
  }, msg => notices.push(msg))
  let restored
  try {
    await host.show()
    const id = visible()
    assert.ok(id)
    const before = geometry(id)
    xdo("mousemove", "--window", id, 20, 20, "click", "1")
    await until(() => actions.at(-1) === "chat", "click must launch quick chat")

    xdo("mousemove", "--window", id, 20, 20, "mousedown", "1", "mousemove_relative", "--", -14, -14)
    await sleep(120)
    xdo("mousemove_relative", "--", -60, -60, "mouseup", "1")
    await until(() => {
      try { return JSON.parse(readFileSync(join(dir, "linux-mini-position.json"))).x < Number(before.X) - 25 }
      catch { return false }
    }, "Linux Mini position did not follow the drag")
    const moved = geometry(id)
    assert.equal(actions.length, 1, "drag must not submit a chat")

    xdo("mousemove", "--window", id, 20, 20, "mousedown", "1")
    await sleep(650)
    xdo("mouseup", "1", "key", "Home", "Down", "Right", "Return")
    await until(() => !!release, "long press and capture submenu must dispatch todo")
    release()
    await until(visible, "orb did not restore after capture")
    xdo("mousemove", "--window", id, 20, 20, "click", "3", "key", "End", "Return")
    await until(() => actions.at(-1) === "meeting", "context menu must launch meetings")
    host.hide()
    await until(() => !visible(), "hide failed")
    await host.show()
    assert.ok(visible())
    await host.stop()
    await until(() => !visible(), "quit failed")

    restored = new LinuxMiniHost(dir, async () => {}, msg => notices.push(msg))
    await restored.show()
    const after = geometry(visible())
    assert.equal(after.X, moved.X)
    assert.equal(after.Y, moved.Y)
    assert.deepEqual(notices, [])
    console.log("PASS Linux Mini mapped, click, drag, long press, capture handoff, menu, hide, restored position, stop")
  } finally {
    release?.()
    await host.stop()
    await restored?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
