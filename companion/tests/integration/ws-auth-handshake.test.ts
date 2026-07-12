// Tests for WS shared-secret authentication — P0-2B / ws-auth.ts.
//
// Two layers:
//   1. Unit tests on the pure ws-auth functions (secret lifecycle, proof verify).
//   2. Integration tests of the connection-handler auth GATE.
//
// The production gate lives inside startServer()'s connection handler, which NO
// test calls directly (every message-exchange test uses a bare wss +
// createToolExecutor, deliberately bypassing the handler). So — exactly like
// ws-origin-handshake.test.ts replicates verifyClient to test the Origin gate —
// we replicate the auth gate here using the SAME ws-auth functions. A drift
// comment in server.ts's handler points back here and vice-versa.

import test, { before, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as crypto from "node:crypto"
import { once } from "node:events"
import { WebSocketServer, WebSocket } from "ws"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-wsauth-"))

// Deferred imports — DATA_DIR (used by ws-auth via config) is captured at module
// load, so the modules MUST be imported AFTER CMSPARK_DATA_DIR is pointed at the
// temp dir (same pattern as config.test.ts).
let getOrCreateSharedSecret: typeof import("../../src/ws-auth").getOrCreateSharedSecret
let consumeSecretFreshlyGenerated: typeof import("../../src/ws-auth").consumeSecretFreshlyGenerated
let consumeSecretPersistFailed: typeof import("../../src/ws-auth").consumeSecretPersistFailed
let clearSecretCache: typeof import("../../src/ws-auth").clearSecretCache
let resetSharedSecret: typeof import("../../src/ws-auth").resetSharedSecret
let getSharedSecretForDisplay: typeof import("../../src/ws-auth").getSharedSecretForDisplay
let issueChallenge: typeof import("../../src/ws-auth").issueChallenge
let verifyProof: typeof import("../../src/ws-auth").verifyProof
let AUTH_TIMEOUT_MS: number
let SECRET_PATH: string

before(async () => {
  process.env.HOME = tempHome
  process.env.CMSPARK_DATA_DIR = tempHome
  const m = await import("../../src/ws-auth")
  getOrCreateSharedSecret = m.getOrCreateSharedSecret
  consumeSecretFreshlyGenerated = m.consumeSecretFreshlyGenerated
  consumeSecretPersistFailed = m.consumeSecretPersistFailed
  clearSecretCache = m.clearSecretCache
  resetSharedSecret = m.resetSharedSecret
  getSharedSecretForDisplay = m.getSharedSecretForDisplay
  issueChallenge = m.issueChallenge
  verifyProof = m.verifyProof
  AUTH_TIMEOUT_MS = m.AUTH_TIMEOUT_MS
  SECRET_PATH = path.join(tempHome, "ws_secret")
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

beforeEach(() => {
  // Fresh, file-absent state per test so generation/persistence assertions are exact.
  clearSecretCache()
  try { fs.rmSync(SECRET_PATH, { force: true }) } catch { /* ignore */ }
})

// =============================================================================
// Unit: secret lifecycle
// =============================================================================

test("secret: generated on first use, persisted at 0o600", () => {
  const s = getOrCreateSharedSecret()
  assert.ok(s && s.length === 64, "32 random bytes as hex = 64 chars")
  assert.ok(fs.existsSync(SECRET_PATH), "secret persisted to disk")
  const stat = fs.statSync(SECRET_PATH)
  // Owner-only (0o600). Mask away file-type bits.
  assert.equal(stat.mode & 0o777, 0o600, "secret file must be owner-only")
  assert.equal(fs.readFileSync(SECRET_PATH, "utf8").trim(), s, "persisted value matches")
})

test("secret: idempotent — same value across calls and after re-read", () => {
  const a = getOrCreateSharedSecret()
  const b = getOrCreateSharedSecret()
  assert.equal(a, b, "in-memory cache returns the same value")
  clearSecretCache()
  const c = getOrCreateSharedSecret()
  assert.equal(a, c, "re-read from disk returns the same value (not regenerated)")
})

test("secret: fresh-generation flag set exactly once", () => {
  getOrCreateSharedSecret()
  assert.equal(consumeSecretFreshlyGenerated(), true, "first generation sets the flag")
  getOrCreateSharedSecret()
  assert.equal(consumeSecretFreshlyGenerated(), false, "cache/disk hit does not re-set it")
})

test("secret: persist-failed flag is false on a successful write", () => {
  // Happy path: the data dir is writable, so atomicWriteText succeeds and the
  // flag must NOT be set — otherwise startServer would spuriously warn that
  // pairing won't survive a restart. (The failure→true path isn't exercised
  // here because DATA_DIR/SECRET_PATH are captured at module load; the flag's
  // set-in-catch logic is trivial and inspected statically.)
  getOrCreateSharedSecret()
  assert.equal(consumeSecretPersistFailed(), false, "successful write must not flag a persist failure")
  assert.equal(consumeSecretPersistFailed(), false, "flag stays false once no failure occurred")
})

test("secret: resetSharedSecret changes the value and clears the file-then-regenerates", () => {
  const first = getOrCreateSharedSecret()
  const next = resetSharedSecret()
  assert.notEqual(first, next, "reset must produce a different secret")
  assert.ok(next.length === 64)
  assert.equal(fs.readFileSync(SECRET_PATH, "utf8").trim(), next)
})

test("secret: getSharedSecretForDisplay generates if absent", () => {
  assert.ok(!fs.existsSync(SECRET_PATH))
  const s = getSharedSecretForDisplay()
  assert.ok(s.length === 64)
  assert.ok(fs.existsSync(SECRET_PATH), "display helper materializes the secret")
})

test("issueChallenge: returns distinct 32-hex-char nonces", () => {
  const a = issueChallenge()
  const b = issueChallenge()
  assert.equal(a.length, 32, "16 random bytes as hex")
  assert.notEqual(a, b, "nonces must not repeat")
})

test("verifyProof: correct proof accepted; wrong/missing/garbage rejected", () => {
  const secret = getOrCreateSharedSecret()
  const nonce = issueChallenge()
  const good = crypto.createHmac("sha256", secret).update(nonce).digest("hex")
  assert.equal(verifyProof(secret, nonce, good), true)
  assert.equal(verifyProof(secret, nonce, crypto.randomBytes(32).toString("hex")), false, "wrong proof")
  assert.equal(verifyProof(secret, nonce, ""), false, "empty proof")
  assert.equal(verifyProof(secret, "", good), false, "empty nonce")
  assert.equal(verifyProof("", nonce, good), false, "empty secret")
  // A proof valid for nonce A must NOT validate nonce B (replay across challenges).
  const nonceB = issueChallenge()
  assert.equal(verifyProof(secret, nonceB, good), false, "proof bound to its nonce — not replayable")
})

test("hmac consistency: extension Web Crypto proof == companion node HMAC", async () => {
  // The handshake only works if BOTH sides derive the identical proof from the
  // same (secret, nonce). The companion uses node's crypto.createHmac; the
  // extension's MV3 service worker uses the Web Crypto subtle API. This test
  // runs the extension's EXACT algorithm (ws-client.ts hmacSha256Hex) via node's
  // webcrypto (the same Web Crypto implementation) and asserts byte-for-byte
  // equality with the companion's HMAC, then that the companion accepts it.
  const secret = getOrCreateSharedSecret()
  const nonce = issueChallenge()
  const companionProof = crypto.createHmac("sha256", secret).update(nonce).digest("hex")

  const enc = new TextEncoder()
  const key = await crypto.webcrypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  )
  const sig = await crypto.webcrypto.subtle.sign("HMAC", key, enc.encode(nonce))
  const extensionProof = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  assert.equal(extensionProof, companionProof,
    "extension Web Crypto and companion node HMAC must produce identical proofs")
  assert.equal(verifyProof(secret, nonce, extensionProof), true,
    "companion must accept the proof the extension actually computes")
})

// =============================================================================
// Integration: the connection-handler auth gate (replicated; see header)
// =============================================================================

/** HMAC-SHA256(secret, nonce) as hex — exactly what the extension computes. */
function proofFor(secret: string, nonce: string): string {
  return crypto.createHmac("sha256", secret).update(nonce).digest("hex")
}

/**
 * Bare wss wired with the SAME auth logic as startServer()'s connection handler
 * (server.ts): challenge on connect → auth.handshake verify → auth.ok + connected,
 * terminate on failure/timeout, reject pre-auth app messages. Returns the bound
 * port + a close() — Origin gating is intentionally omitted (tested separately in
 * ws-origin-handshake.test.ts); this isolates the post-upgrade auth layer.
 */
function startAuthedServer(secret: string): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" }, () => {
      const port = (wss.address() as { port: number }).port
      resolve({
        port,
        close: () => { try { wss.close() } catch { /* */ } },
      })
    })
    const authState = new WeakMap<WebSocket, { nonce: string; authed: boolean; timer: NodeJS.Timeout }>()
    wss.on("connection", (ws) => {
      const nonce = issueChallenge()
      const timer = setTimeout(() => {
        if (!authState.get(ws)?.authed) {
          try { ws.terminate() } catch { /* */ }
        }
      }, AUTH_TIMEOUT_MS)
      authState.set(ws, { nonce, authed: false, timer })
      ws.send(JSON.stringify({ type: "auth.challenge", nonce }))
      ws.on("message", (raw) => {
        let msg: any
        try { msg = JSON.parse(raw.toString()) } catch { return }
        if (msg.type === "auth.handshake") {
          const st = authState.get(ws)
          if (!st) { try { ws.terminate() } catch { /* */ }; return }
          if (verifyProof(secret, st.nonce, String(msg.proof))) {
            st.authed = true
            clearTimeout(st.timer)
            ws.send(JSON.stringify({ type: "auth.ok" }))
            ws.send(JSON.stringify({ type: "connected" }))
          } else {
            try { ws.terminate() } catch { /* */ }
          }
          return
        }
        if (!authState.get(ws)?.authed) {
          try { ws.terminate() } catch { /* */ }
          return
        }
        // App message — echo so tests can observe it reached the app layer.
        ws.send(JSON.stringify({ type: "app.echo", echo: msg }))
      })
      ws.on("close", () => {
        const st = authState.get(ws)
        if (st) { clearTimeout(st.timer); authState.delete(ws) }
      })
    })
  })
}

/** Collect inbound JSON messages on a client ws. */
function collector(ws: WebSocket): any[] {
  const events: any[] = []
  ws.on("message", (raw) => { try { events.push(JSON.parse(raw.toString())) } catch { /* */ } })
  return events
}

/** Resolve once a message matching pred arrives in events (or timeout). */
async function waitFor(events: any[], pred: (m: any) => boolean, timeoutMs = 1000): Promise<any> {
  const found = events.find(pred)
  if (found) return found
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout waiting for message")), timeoutMs)
    const iv = setInterval(() => {
      const m = events.find(pred)
      if (m) { clearTimeout(t); clearInterval(iv); resolve(m) }
    }, 10)
  })
}

test("gate: valid handshake → auth.ok then connected", async () => {
  const secret = getOrCreateSharedSecret()
  const { port, close } = await startAuthedServer(secret)
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const events = collector(ws)
    await once(ws, "open")
    const challenge = await waitFor(events, (m) => m.type === "auth.challenge")
    ws.send(JSON.stringify({ type: "auth.handshake", proof: proofFor(secret, challenge.nonce) }))
    assert.equal((await waitFor(events, (m) => m.type === "auth.ok")).type, "auth.ok")
    assert.equal((await waitFor(events, (m) => m.type === "connected")).type, "connected")
    ws.close()
  } finally {
    close()
  }
})

test("gate: wrong proof → terminated, no auth.ok/connected", async () => {
  const secret = getOrCreateSharedSecret()
  const { port, close } = await startAuthedServer(secret)
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const events = collector(ws)
    await once(ws, "open")
    const challenge = await waitFor(events, (m) => m.type === "auth.challenge")
    // Proof for a DIFFERENT nonce — must be rejected.
    ws.send(JSON.stringify({ type: "auth.handshake", proof: proofFor(secret, issueChallenge()) }))
    await once(ws, "close")
    assert.equal(events.find((m) => m.type === "auth.ok" || m.type === "connected"), undefined,
      "no auth.ok/connected must be sent on a failed handshake")
  } finally {
    close()
  }
})

test("gate: app message before authenticating → terminated, never echoed", async () => {
  const secret = getOrCreateSharedSecret()
  const { port, close } = await startAuthedServer(secret)
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const events = collector(ws)
    await once(ws, "open")
    await waitFor(events, (m) => m.type === "auth.challenge")
    // Send an app message WITHOUT authenticating first — must be rejected, not echoed.
    ws.send(JSON.stringify({ type: "config.get" }))
    await once(ws, "close")
    assert.equal(events.find((m) => m.type === "app.echo"), undefined,
      "pre-auth app message must never reach the app layer")
  } finally {
    close()
  }
})

test("gate: post-auth app message is delivered (happy path beyond auth)", async () => {
  const secret = getOrCreateSharedSecret()
  const { port, close } = await startAuthedServer(secret)
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const events = collector(ws)
    await once(ws, "open")
    const challenge = await waitFor(events, (m) => m.type === "auth.challenge")
    ws.send(JSON.stringify({ type: "auth.handshake", proof: proofFor(secret, challenge.nonce) }))
    await waitFor(events, (m) => m.type === "connected")
    ws.send(JSON.stringify({ type: "config.get" }))
    assert.equal((await waitFor(events, (m) => m.type === "app.echo")).echo.type, "config.get",
      "once authed, app messages reach the handler")
    ws.close()
  } finally {
    close()
  }
})
