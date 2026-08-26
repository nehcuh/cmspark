/**
 * PR-B Task 8: waitForExtensionPeer is event-subscribed (extension auth.ok),
 * not a timer poll. Timeout rejects and is never approved: true.
 * Overlay close still rejectAll(overlay) / cancelConfirm(overlay key) only —
 * never the extension's tray-confirm set (Task 7 keys by trayOwnerWs).
 */
import test, { afterEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import type { WebSocket } from "ws"
import {
  bindExtensionPeerPicker,
  notifyExtensionPeerAuthenticated,
  resetExtensionPeerWaitersForTests,
  waitForExtensionPeer,
} from "../src/ws/extension-peer"

function companionSrc(rel: string): string {
  const candidates = [
    path.join(__dirname, "..", "..", "src", rel),
    path.join(process.cwd(), "src", rel),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8")
  }
  throw new Error(`missing src/${rel}`)
}

function fakeWs(id: string): WebSocket {
  return { id } as unknown as WebSocket
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

afterEach(() => {
  resetExtensionPeerWaitersForTests()
})

test("waitForExtensionPeer resolves when subscribe fires, not via timer poll", async () => {
  const ext = fakeWs("ext")
  let peer: WebSocket | null = null
  bindExtensionPeerPicker(() => peer)

  const pending = waitForExtensionPeer({ timeoutMs: 1500 })
  let settled: WebSocket | "pending" | "rejected" = "pending"
  pending.then(
    (ws) => {
      settled = ws
    },
    () => {
      settled = "rejected"
    },
  )

  // pick() would now succeed — a setInterval / while-sleep poll would resolve.
  // Subscribe-on-auth.ok must stay pending until notify fires.
  peer = ext
  await sleep(80)
  assert.equal(settled, "pending", "must not resolve by polling pick(); wait for auth.ok subscribe")

  notifyExtensionPeerAuthenticated(ext)
  const ws = await pending
  assert.equal(ws, ext)
  assert.notEqual(settled, "rejected")
})

test("waitForExtensionPeer timeout rejects; never approved", async () => {
  bindExtensionPeerPicker(() => null)

  let resolved: unknown
  try {
    resolved = await waitForExtensionPeer({ timeoutMs: 25 })
    assert.fail("timeout must reject, not resolve")
  } catch (err: unknown) {
    assert.ok(err, "timeout must reject")
    if (err && typeof err === "object" && "approved" in err) {
      assert.notEqual(
        (err as { approved: unknown }).approved,
        true,
        "timeout must never approved: true",
      )
    }
  }
  assert.equal(resolved, undefined, "must reject, not resolve (including approved: true)")
})

test("source: wait helper has no setInterval poll", () => {
  const src = companionSrc("ws/extension-peer.ts")
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
  assert.match(src, /export function waitForExtensionPeer/)
  assert.doesNotMatch(code, /setInterval\s*\(/)
  assert.doesNotMatch(code, /while\s*\(\s*!?\s*pick/)
  assert.doesNotMatch(code, /await\s+sleep\s*\(/)
  assert.doesNotMatch(code, /approved:\s*true/)
  assert.doesNotMatch(code, /sidePanel\.open/)
  assert.doesNotMatch(code, /skip-confirm|skipConfirm|auto-approve/)
})

test("source: auth.ok notifies extension peer waiters after authenticated", () => {
  const src = companionSrc("ws/lifecycle.ts")
  const authIdx = src.indexOf("st.authenticated = true")
  const notifyIdx = src.indexOf("notifyExtensionPeerAuthenticated(ws)")
  assert.ok(authIdx >= 0, "auth.ok path must set st.authenticated = true")
  assert.ok(notifyIdx >= 0, "auth.ok path must notify waiters")
  assert.ok(
    notifyIdx > authIdx,
    "notify must fire AFTER st.authenticated = true",
  )
  assert.match(
    src,
    /\^chrome-extension:\\\/\\\/[\s\S]{0,120}notifyExtensionPeerAuthenticated\(ws\)/,
  )
})

test("source: overlay close cancelConfirm uses closing ws key, not extension set", () => {
  const src = companionSrc("ws/lifecycle.ts")
  assert.match(src, /rejectAll\(\s*"disconnect"\s*,\s*ws\s*\)/)
  assert.match(src, /activeTrayConfirmsByWs\.get\(\s*ws\s*\)/)
  assert.doesNotMatch(src, /activeTrayConfirmsByWs\.get\(\s*pickAuthenticatedClientWs/)
  assert.doesNotMatch(
    src,
    /for\s*\([^)]*activeTrayConfirmsByWs[^)]*\)/,
  )
  // Must not cancelConfirm the extension peer's set when overlay closes.
  assert.doesNotMatch(
    src,
    /activeTrayConfirmsByWs\.get\([^)]*extension/i,
  )
})
