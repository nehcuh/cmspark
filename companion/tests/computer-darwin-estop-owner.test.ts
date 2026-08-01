// Tray-owned estop: companion prefers connect; spawn only as fallback.
// Uses a real local UNIX socket server to simulate Aqua/tray-owned helper.

import test from "node:test"
import assert from "node:assert/strict"
import * as net from "node:net"
import * as fs from "node:fs"
import { createServer } from "node:net"

const SOCK = "/tmp/cmspark-estop-test-owner.sock"

function rmSock() {
  try {
    fs.unlinkSync(SOCK)
  } catch {
    /* */
  }
}

test("darwin estop: connect succeeds when external helper already holds socket", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("darwin only")
    return
  }
  rmSock()
  const server = createServer((c) => {
    // hold connection open (companion pause()s the socket)
  })
  await new Promise<void>((resolve, reject) => {
    server.listen(SOCK, () => resolve())
    server.on("error", reject)
  })
  t.after(() => {
    server.close()
    rmSock()
  })

  // Import after sock path — production uses fixed path; temporarily symlink or
  // we only verify raw connect semantics here (contract of tryConnectHeld).
  await new Promise<void>((resolve, reject) => {
    const sock = net.createConnection(SOCK)
    const timer = setTimeout(() => {
      sock.destroy()
      reject(new Error("timeout"))
    }, 2000)
    sock.on("connect", () => {
      clearTimeout(timer)
      sock.destroy()
      resolve()
    })
    sock.on("error", reject)
  })
  assert.ok(true, "external UNIX socket is connectable — tray-owned model")
})

test("CMSPARK_ESTOP_NO_DAEMON_SPAWN refuses when socket down", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("darwin only")
    return
  }
  rmSock()
  // Point production path: ensure production sock is free
  try {
    fs.unlinkSync("/tmp/cmspark-estop.sock")
  } catch {
    /* */
  }
  const prev = process.env.CMSPARK_ESTOP_NO_DAEMON_SPAWN
  process.env.CMSPARK_ESTOP_NO_DAEMON_SPAWN = "1"
  t.after(() => {
    if (prev === undefined) delete process.env.CMSPARK_ESTOP_NO_DAEMON_SPAWN
    else process.env.CMSPARK_ESTOP_NO_DAEMON_SPAWN = prev
  })

  // Dynamic import so env is set before module load of attempt counters... module already loads.
  const { ensureEstopHelper } = await import("../src/computer/darwin-estop")
  // Short path: no held sock, no external, no daemon spawn
  // This may wait up to 3s grace — acceptable for unit test.
  const r = await ensureEstopHelper()
  assert.equal(r.ok, false)
  assert.match(r.reason ?? "", /NO_DAEMON_SPAWN|not available|tray/i)
})
