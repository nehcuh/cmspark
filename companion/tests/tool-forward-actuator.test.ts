/**
 * L1 forward must target the actuator WS (Chrome extension), never tray/summoner.
 * Unit-tests forwardL1OrUnavailable with fakes — no startServer.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import * as fs from "node:fs"
import * as path from "node:path"
import {
  forwardL1OrUnavailable,
  browserUnavailableResult,
  BROWSER_UNAVAILABLE,
} from "../src/ws/l1-actuator"

function fakeWs(id: string) {
  const e = new EventEmitter() as any
  e.id = id
  e.readyState = 1
  e.OPEN = 1
  e.sent = [] as string[]
  e.send = (data: string) => {
    e.sent.push(data)
  }
  return e
}

function noopLog() {
  /* logToolFinish spy default */
}

test("tray originating + ext pick → forward is invoked with ext, not tray", async () => {
  const tray = fakeWs("tray")
  const ext = fakeWs("ext")
  const forwarded: any[] = []
  const finished: any[] = []
  const result = await forwardL1OrUnavailable({
    originatingWs: tray,
    getAuth: (w) =>
      w === tray
        ? { origin: "cmspark-tray://local", authenticated: true }
        : { origin: "chrome-extension://abc", authenticated: true },
    pickExtensionWs: () => ext,
    toolCallId: "tc-tray-ext",
    toolName: "list_tabs",
    startedAt: Date.now(),
    logToolFinish: (...args) => {
      finished.push(args)
    },
    forward: async ({ ws }) => {
      forwarded.push(ws)
      return { success: true, data: { actuator: (ws as any).id } }
    },
  })
  assert.equal(forwarded.length, 1)
  assert.equal(forwarded[0], ext)
  assert.notEqual(forwarded[0], tray)
  assert.equal(result.success, true)
  // logToolFinish is owned by forwardToolToExtension on the ok path
  assert.equal(finished.length, 0)
})

test("tray originating + pick null → browserUnavailableResult; forward NOT called", async () => {
  const tray = fakeWs("tray")
  let forwardCalls = 0
  const finished: any[] = []
  const result = await forwardL1OrUnavailable({
    originatingWs: tray,
    getAuth: () => ({ origin: "cmspark-tray://local", authenticated: true }),
    pickExtensionWs: () => null,
    toolCallId: "tc-tray-none",
    toolName: "navigate",
    startedAt: Date.now(),
    logToolFinish: (...args) => {
      finished.push(args)
    },
    forward: async () => {
      forwardCalls++
      return { success: true }
    },
  })
  assert.equal(forwardCalls, 0)
  assert.deepEqual(result, browserUnavailableResult())
  assert.equal(result.error_code, BROWSER_UNAVAILABLE)
  assert.equal(finished.length, 1)
  assert.equal(finished[0][0], "tc-tray-none")
  assert.equal(finished[0][1], "navigate")
  assert.deepEqual(finished[0][3], browserUnavailableResult())
})

test("chrome-extension originating → forward with same originating ws", async () => {
  const ext = fakeWs("ext")
  const other = fakeWs("other-ext")
  let pickCalls = 0
  const forwarded: any[] = []
  const result = await forwardL1OrUnavailable({
    originatingWs: ext,
    getAuth: () => ({ origin: "chrome-extension://abc", authenticated: true }),
    pickExtensionWs: () => {
      pickCalls++
      return other
    },
    toolCallId: "tc-ext",
    toolName: "list_tabs",
    startedAt: Date.now(),
    logToolFinish: noopLog,
    forward: async ({ ws }) => {
      forwarded.push(ws)
      return { success: true, data: { actuator: (ws as any).id } }
    },
  })
  assert.equal(forwarded.length, 1)
  assert.equal(forwarded[0], ext)
  assert.notEqual(forwarded[0], other)
  assert.equal(pickCalls, 0)
  assert.equal(result.success, true)
})

test("production createToolExecutor L1 path calls forwardL1OrUnavailable (lockstep)", () => {
  const candidates = [
    path.resolve(__dirname, "..", "..", "src", "server.ts"),
    path.resolve(__dirname, "..", "src", "server.ts"),
  ]
  const srcPath = candidates.find((p) => fs.existsSync(p))
  assert.ok(srcPath, "server.ts must exist")
  const src = fs.readFileSync(srcPath!, "utf8")
  assert.match(src, /from\s+["']\.\/ws\/l1-actuator["']/)
  assert.match(src, /forwardL1OrUnavailable\s*\(/)
  assert.match(src, /pickExtensionWs:\s*pickAuthenticatedClientWs/)
  assert.match(src, /getAuth:\s*\(w\)\s*=>\s*getWsAuthState\(w\)/)
  // actuator socket is what forwardToolToExtension receives
  assert.match(src, /ws:\s*actuatorWs/)
  // companion-tool confirm binding still uses originating ws (S6)
  assert.match(src, /originWs:\s*ws/)
})
