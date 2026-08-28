// B2 Darwin estop DATA_DIR identity (spec pin 12 / DoD B2).
//
// CONNECT-first on an anonymous /tmp socket is NOT armed. Proof-of-life is a
// long-lived EOF hold on a DATA_DIR socket after nonce greeting + 0600.
// Tests must not unlink a live production /tmp/cmspark-estop.sock.

import test from "node:test"
import assert from "node:assert/strict"
import * as net from "node:net"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { createServer, type Server } from "node:net"

import {
  ensureEstopHelper,
  estopFlagPath,
  estopNoncePath,
  estopSocketPath,
  resetDarwinEstopForTests,
} from "../src/computer/darwin-estop"

const ANON_SOCK = "/tmp/cmspark-estop.sock"
const ANON_FLAG = "/tmp/cmspark-estop.flag"
const SUN_PATH_MAX = 104

const ROOT = path.resolve(__dirname, "..", "..")

function srcFile(...parts: string[]): string {
  const candidates = [
    path.join(ROOT, "src", ...parts),
    path.join(__dirname, "..", "src", ...parts),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]
}

function unixOk(): boolean {
  return process.platform !== "win32"
}

function mkDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "e-"))
}

function restoreEnv(prev: {
  data?: string
  spawn?: string
  attempts?: string
  gap?: string
}): void {
  if (prev.data === undefined) delete process.env.CMSPARK_DATA_DIR
  else process.env.CMSPARK_DATA_DIR = prev.data
  if (prev.spawn === undefined) delete process.env.CMSPARK_ESTOP_NO_DAEMON_SPAWN
  else process.env.CMSPARK_ESTOP_NO_DAEMON_SPAWN = prev.spawn
  if (prev.attempts === undefined) delete process.env.CMSPARK_ESTOP_CONNECT_ATTEMPTS
  else process.env.CMSPARK_ESTOP_CONNECT_ATTEMPTS = prev.attempts
  if (prev.gap === undefined) delete process.env.CMSPARK_ESTOP_CONNECT_GAP_MS
  else process.env.CMSPARK_ESTOP_CONNECT_GAP_MS = prev.gap
}

function beginEstopTest(t: { after: (fn: () => void) => void }, dir: string): void {
  const prev = {
    data: process.env.CMSPARK_DATA_DIR,
    spawn: process.env.CMSPARK_ESTOP_NO_DAEMON_SPAWN,
    attempts: process.env.CMSPARK_ESTOP_CONNECT_ATTEMPTS,
    gap: process.env.CMSPARK_ESTOP_CONNECT_GAP_MS,
  }
  process.env.CMSPARK_DATA_DIR = dir
  process.env.CMSPARK_ESTOP_NO_DAEMON_SPAWN = "1"
  process.env.CMSPARK_ESTOP_CONNECT_ATTEMPTS = "3"
  process.env.CMSPARK_ESTOP_CONNECT_GAP_MS = "20"
  t.after(() => {
    resetDarwinEstopForTests()
    restoreEnv(prev)
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* */
    }
  })
}

async function listenUnix(
  sockPath: string,
  onConnect?: (c: net.Socket) => void,
): Promise<Server> {
  fs.mkdirSync(path.dirname(sockPath), { recursive: true })
  try {
    fs.unlinkSync(sockPath)
  } catch {
    /* */
  }
  const server = createServer((c) => {
    onConnect?.(c)
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(sockPath, () => resolve())
  })
  return server
}

function chmod0600(p: string): void {
  try {
    fs.chmodSync(p, 0o600)
  } catch {
    /* best-effort on platforms that ignore socket mode */
  }
}

test("B2: estop socket and flag live under DATA_DIR, not anonymous /tmp", () => {
  const dir = mkDataDir()
  const prev = process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR = dir
  try {
    const sock = estopSocketPath()
    const flag = estopFlagPath()
    const nonce = estopNoncePath()
    assert.equal(sock, path.join(dir, "estop.sock"))
    assert.equal(flag, path.join(dir, "estop.flag"))
    assert.equal(nonce, path.join(dir, "estop.nonce"))
    assert.notEqual(sock, ANON_SOCK)
    assert.notEqual(flag, ANON_FLAG)
    assert.ok(sock.startsWith(dir), "socket must be under DATA_DIR")
    assert.ok(flag.startsWith(dir), "flag must be under DATA_DIR")
    assert.ok(Buffer.byteLength(sock, "utf8") < SUN_PATH_MAX, "sun_path 104")
  } finally {
    if (prev === undefined) delete process.env.CMSPARK_DATA_DIR
    else process.env.CMSPARK_DATA_DIR = prev
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("B2: default DATA_DIR (no env) is ~/.cmspark-agent, not /tmp/cmspark-estop.*", () => {
  const prev = process.env.CMSPARK_DATA_DIR
  delete process.env.CMSPARK_DATA_DIR
  try {
    const sock = estopSocketPath()
    const flag = estopFlagPath()
    const home = os.homedir()
    assert.equal(sock, path.join(home, ".cmspark-agent", "estop.sock"))
    assert.equal(flag, path.join(home, ".cmspark-agent", "estop.flag"))
    assert.notEqual(sock, ANON_SOCK)
    assert.notEqual(flag, ANON_FLAG)
    assert.ok(Buffer.byteLength(sock, "utf8") < SUN_PATH_MAX)
  } finally {
    if (prev === undefined) delete process.env.CMSPARK_DATA_DIR
    else process.env.CMSPARK_DATA_DIR = prev
  }
})

test("B2: Node spawn args lockstep --socket-path/--flag-path; no /tmp literals", () => {
  const src = fs.readFileSync(srcFile("computer", "darwin-estop.ts"), "utf8")
  assert.match(src, /"--socket-path"/)
  assert.match(src, /"--flag-path"/)
  assert.match(src, /"--nonce-file"/)
  assert.doesNotMatch(src, /"\/tmp\/cmspark-estop\.sock"/)
  assert.doesNotMatch(src, /"\/tmp\/cmspark-estop\.flag"/)
})

test("B2: host.swift Aqua spawn lockstep DATA_DIR --socket-path, not hardcoded /tmp", () => {
  const src = fs.readFileSync(srcFile("host-use", "darwin", "host.swift"), "utf8")
  assert.match(src, /func launchAgentTrayAndExit/)
  assert.match(src, /"--socket-path"/)
  assert.match(src, /func cmsparkDataDir/)
  assert.doesNotMatch(src, /let estopSock = "\/tmp\/cmspark-estop\.sock"/)
  assert.doesNotMatch(src, /"\/tmp\/cmspark-estop\.sock"/)
  assert.doesNotMatch(src, /"\/tmp\/cmspark-estop\.flag"/)
})

test("B2: host-skylight.swift --socket-path required; flag default leaves /tmp", () => {
  const src = fs.readFileSync(srcFile("host-use", "darwin", "host-skylight.swift"), "utf8")
  assert.match(src, /estop: --socket-path required/)
  assert.doesNotMatch(src, /"\/tmp\/cmspark-estop\.sock"/)
  assert.doesNotMatch(src, /"\/tmp\/cmspark-estop\.flag"/)
  assert.match(src, /"--flag-path"/)
  assert.match(src, /cmspark-estop /)
})

test("B2-1: pre-bind of /tmp/cmspark-estop.sock does not arm ensureEstopHelper", async (t) => {
  if (!unixOk()) {
    t.skip("unix sockets")
    return
  }
  const dir = mkDataDir()
  beginEstopTest(t, dir)

  let tmpServer: Server | null = null
  try {
    tmpServer = await listenUnix(ANON_SOCK)
  } catch {
    // Live product helper may already hold /tmp — do not steal or unlink it.
    tmpServer = null
  }
  t.after(() => {
    if (tmpServer) {
      tmpServer.close()
      try {
        fs.unlinkSync(ANON_SOCK)
      } catch {
        /* we created it */
      }
    }
  })

  const r = await ensureEstopHelper()
  assert.equal(r.ok, false, "CONNECT to anonymous /tmp must not arm")
  assert.match(r.reason ?? "", /NO_DAEMON_SPAWN|not available|identity|nonce|tray/i)
})

test("B2-2: pre-bind of DATA_DIR socket without nonce/greeting is fail-closed", async (t) => {
  if (!unixOk()) {
    t.skip("unix sockets")
    return
  }
  const dir = mkDataDir()
  beginEstopTest(t, dir)
  const sock = estopSocketPath()
  const server = await listenUnix(sock)
  chmod0600(sock)
  t.after(() => {
    server.close()
    try {
      fs.unlinkSync(sock)
    } catch {
      /* */
    }
  })

  const r = await ensureEstopHelper()
  assert.equal(r.ok, false, "CONNECT-first without nonce/peer must not arm")
  assert.match(r.reason ?? "", /NO_DAEMON_SPAWN|not available|identity|nonce|greeting|tray/i)
})

test("B2: DATA_DIR socket + 0600 + nonce greeting arms; hold is long-lived EOF", async (t) => {
  if (!unixOk()) {
    t.skip("unix sockets")
    return
  }
  const dir = mkDataDir()
  beginEstopTest(t, dir)
  const sock = estopSocketPath()
  const noncePath = estopNoncePath()
  const nonce = "a".repeat(32)
  fs.writeFileSync(noncePath, nonce, { encoding: "utf8", mode: 0o600 })
  chmod0600(noncePath)

  const server = await listenUnix(sock, (c) => {
    c.write(`cmspark-estop ${nonce}\n`)
  })
  chmod0600(sock)
  t.after(() => {
    server.close()
    try {
      fs.unlinkSync(sock)
    } catch {
      /* */
    }
  })

  const r = await ensureEstopHelper()
  assert.equal(r.ok, true, "identity (DATA_DIR + nonce) must arm")

  const { estopHeartbeatLost } = await import("../src/computer/darwin-estop")
  assert.equal(estopHeartbeatLost(), false, "held socket is proof-of-life")
})

test("B2: DATA_DIR socket with wrong nonce greeting is fail-closed", async (t) => {
  if (!unixOk()) {
    t.skip("unix sockets")
    return
  }
  const dir = mkDataDir()
  beginEstopTest(t, dir)
  const sock = estopSocketPath()
  const noncePath = estopNoncePath()
  fs.writeFileSync(noncePath, "b".repeat(32), { encoding: "utf8", mode: 0o600 })
  chmod0600(noncePath)

  const server = await listenUnix(sock, (c) => {
    c.write(`cmspark-estop ${"c".repeat(32)}\n`)
  })
  chmod0600(sock)
  t.after(() => {
    server.close()
    try {
      fs.unlinkSync(sock)
    } catch {
      /* */
    }
  })

  const r = await ensureEstopHelper()
  assert.equal(r.ok, false, "wrong nonce must not arm")
})
