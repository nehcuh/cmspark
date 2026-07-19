// WP2 (§E.6) emergency-stop preflight unit tests. Pure in-memory fs — no
// PowerShell, no real %TEMP% writes. The production contract these lock:
//   ready.json must parse + hotkeyOk=true + heartbeat < 3s, else the server
//   refuses to start a computer task (EMERGENCY_STOP_UNAVAILABLE);
//   estop.flag existence is the hotkey-pressed signal, cleared at task start
//   so a STALE press never aborts a fresh run.

import test from "node:test"
import assert from "node:assert/strict"

import {
  checkEstopReady,
  clearEstopFlag,
  consumeEstopFlag,
  ensureEstopHelper,
  estopFlagPath,
  estopReadyPath,
  type EstopFsLike,
} from "../src/computer/estop"

class FakeEstopFs implements EstopFsLike {
  files = new Map<string, string>()
  readFileSync(p: string, _enc: "utf8"): string {
    const v = this.files.get(p)
    if (v === undefined) throw new Error(`ENOENT: ${p}`)
    return v
  }
  existsSync(p: string): boolean {
    return this.files.has(p)
  }
  rmSync(p: string) {
    this.files.delete(p)
  }
}

const DIR = "/tmp/estop-test"
const NOW = 1_000_000

function readyFile(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ pid: 1234, hotkeyOk: true, heartbeat: NOW - 100, ...overrides })
}

test("estop preflight: missing ready file -> not ready (helper not running)", () => {
  const fs = new FakeEstopFs()
  const s = checkEstopReady({ fs, now: () => NOW, dir: DIR })
  assert.equal(s.ok, false)
  assert.match(s.reason ?? "", /missing/)
})

test("estop preflight: corrupt ready file -> not ready", () => {
  const fs = new FakeEstopFs()
  fs.files.set(estopReadyPath(DIR), "{not json")
  const s = checkEstopReady({ fs, now: () => NOW, dir: DIR })
  assert.equal(s.ok, false)
  assert.match(s.reason ?? "", /corrupt/)
})

test("estop preflight: hotkeyOk=false -> not ready (hotkey registration failed)", () => {
  const fs = new FakeEstopFs()
  fs.files.set(estopReadyPath(DIR), readyFile({ hotkeyOk: false }))
  const s = checkEstopReady({ fs, now: () => NOW, dir: DIR })
  assert.equal(s.ok, false)
  assert.match(s.reason ?? "", /hotkey/)
})

test("estop preflight: heartbeat older than 3s -> not ready (stale)", () => {
  const fs = new FakeEstopFs()
  fs.files.set(estopReadyPath(DIR), readyFile({ heartbeat: NOW - 3100 }))
  const s = checkEstopReady({ fs, now: () => NOW, dir: DIR })
  assert.equal(s.ok, false)
  assert.match(s.reason ?? "", /stale/)
})

test("estop preflight: fresh heartbeat + hotkeyOk -> ready", () => {
  const fs = new FakeEstopFs()
  fs.files.set(estopReadyPath(DIR), readyFile())
  const s = checkEstopReady({ fs, now: () => NOW, dir: DIR })
  assert.equal(s.ok, true)
})

test("estop preflight: custom maxAgeMs honored", () => {
  const fs = new FakeEstopFs()
  fs.files.set(estopReadyPath(DIR), readyFile({ heartbeat: NOW - 500 }))
  assert.equal(checkEstopReady({ fs, now: () => NOW, dir: DIR, maxAgeMs: 1000 }).ok, true)
  assert.equal(checkEstopReady({ fs, now: () => NOW, dir: DIR, maxAgeMs: 400 }).ok, false)
})

test("estop flag: consume reflects existence; clear removes a stale press", () => {
  const fs = new FakeEstopFs()
  assert.equal(consumeEstopFlag({ fs, dir: DIR }), false)
  fs.files.set(estopFlagPath(DIR), String(NOW))
  assert.equal(consumeEstopFlag({ fs, dir: DIR }), true)
  clearEstopFlag({ fs, dir: DIR })
  assert.equal(consumeEstopFlag({ fs, dir: DIR }), false)
})

test("estop ensure: helper not ready -> spawn -> becomes ready -> ok", async () => {
  const fs = new FakeEstopFs()
  let spawns = 0
  const s = await ensureEstopHelper({
    fs,
    now: () => NOW,
    dir: DIR,
    spawnHelper: () => {
      spawns++
      // The spawned helper writes its first heartbeat on the next tick.
      fs.files.set(estopReadyPath(DIR), readyFile())
    },
    sleep: async () => {},
    intervalMs: 1,
  })
  assert.equal(spawns, 1)
  assert.equal(s.ok, true)
})

test("estop ensure: helper never comes up -> not ok after bounded attempts", async () => {
  const fs = new FakeEstopFs()
  let polls = 0
  const fsw: EstopFsLike = {
    readFileSync: (p, e) => { polls++; return fs.readFileSync(p, e) },
    existsSync: (p) => fs.existsSync(p),
    rmSync: (p) => fs.rmSync(p),
  }
  const s = await ensureEstopHelper({
    fs: fsw,
    now: () => NOW,
    dir: DIR,
    spawnHelper: () => {},
    sleep: async () => {},
    attempts: 4,
    intervalMs: 1,
  })
  assert.equal(s.ok, false)
  assert.ok(polls <= 5, `polling is bounded (1 initial + 4 attempts), got ${polls}`)
})

test("estop ensure: already ready -> no spawn at all", async () => {
  const fs = new FakeEstopFs()
  fs.files.set(estopReadyPath(DIR), readyFile())
  let spawns = 0
  const s = await ensureEstopHelper({
    fs,
    now: () => NOW,
    dir: DIR,
    spawnHelper: () => { spawns++ },
    sleep: async () => {},
  })
  assert.equal(s.ok, true)
  assert.equal(spawns, 0)
})
