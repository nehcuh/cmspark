import test from "node:test"
import assert from "node:assert/strict"
import * as crypto from "node:crypto"
import { once } from "node:events"
import { WebSocketServer, WebSocket } from "ws"
import { isAllowedWsOrigin } from "../../src/server"
import { issueChallenge, verifyProof } from "../../src/ws-auth"
import { surfaceFromOrigin, TRAY_WS_ORIGIN } from "../../src/ws/handshake-surface"
import { validateWsMessage } from "../../src/ws/validate"
import { negotiateProtocolVersion } from "../../src/protocol"

// E2E (not just the predicate): verify the production verifyClient wiring — isAllowedWsOrigin
// fed by ws's info.origin + the cb(false,403)/cb(true) contract — actually accepts/rejects REAL
// WebSocket handshakes carrying different Origin headers. This exercises the same verifyClient
// lambda attached in startServer(), closing the gap left by ws-roundtrip (which spins up a bare
// server without the gate). Audit C1 / P0-2.

async function startGatedServer(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer(
      {
        port: 0,
        host: "127.0.0.1",
        verifyClient: (info, cb) => {
          // Mirrors the production verifyClient in startServer() exactly.
          const ok = isAllowedWsOrigin(info.origin)
          if (!ok) cb(false, 403, "Forbidden")
          else cb(true)
        },
      },
      () => {
        const addr = wss.address() as { port: number }
        resolve({ port: addr.port, close: () => wss.close() })
      },
    )
  })
}

function dial(port: number, origin: string | undefined): Promise<"open" | "error"> {
  return new Promise((resolve) => {
    const opts = origin === undefined ? {} : { headers: { Origin: origin } }
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, opts)
    let settled = false
    const done = (r: "open" | "error") => {
      if (!settled) { settled = true; try { ws.close() } catch { /* ignore */ }; resolve(r) }
    }
    ws.on("open", () => done("open"))
    ws.on("unexpected-response", () => done("error")) // 403 surfaces here, not as "error"
    ws.on("error", () => done("error"))
  })
}

test("WS verifyClient e2e: extension origin accepted, web/missing origins rejected (C1 / P0-2)", async () => {
  const { port, close } = await startGatedServer()
  try {
    assert.equal(
      await dial(port, "chrome-extension://abcdefghijklmnopabcdefghijklmnop"),
      "open",
      "chrome-extension:// origin must be accepted (this is what the real MV3 extension sends)",
    )
    assert.equal(await dial(port, "https://evil.com"), "error", "https web origin must be rejected")
    assert.equal(await dial(port, "http://127.0.0.1:8080"), "error", "http origin must be rejected")
    assert.equal(
      await dial(port, undefined),
      "error",
      "missing Origin header must be rejected (local process w/o -H)",
    )
  } finally {
    close()
  }
})

// =============================================================================
// #252: handshake surface gate e2e — surfaceFromOrigin wired into the
// auth.handshake path (lifecycle.ts:1023-1032) must terminate mis-labelled
// peers over a REAL ws handshake, not just in the pure-function unit tests
// (batch-e-handshake-p2.test.ts).
//
// The production gate lives inside startServer()'s connection handler, which no
// test calls directly — so, exactly like startAuthedServer() in
// ws-auth-handshake.test.ts replicates the auth gate, this harness replicates
// the post-upgrade handshake path using the SAME production functions:
// validateWsMessage → verifyProof → negotiateProtocolVersion → surfaceFromOrigin.
// Keep in sync with companion/src/ws/lifecycle.ts (auth.handshake block).
// =============================================================================

const EXT_ORIGIN = "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef"

/** HMAC-SHA256(secret, nonce) as hex — exactly what real clients compute. */
function proofFor(secret: string, nonce: string): string {
  return crypto.createHmac("sha256", secret).update(nonce).digest("hex")
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

/**
 * Origin-gated wss whose connection handler mirrors startServer()'s
 * auth.handshake path (lifecycle.ts): challenge on connect → pre-auth gate
 * (only auth.handshake allowed) → validateWsMessage → verifyProof →
 * negotiateProtocolVersion → surfaceFromOrigin → auth.ok + connected.
 * Any failure terminates the socket, exactly like the production handler.
 */
function startSurfaceGatedServer(secret: string): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer(
      {
        port: 0,
        host: "127.0.0.1",
        verifyClient: (info, cb) => {
          // Same Origin gate as startGatedServer above / startServer().
          const ok = isAllowedWsOrigin(info.origin)
          if (!ok) cb(false, 403, "Forbidden")
          else cb(true)
        },
      },
      () => {
        const addr = wss.address() as { port: number }
        resolve({ port: addr.port, close: () => wss.close() })
      },
    )
    const authState = new WeakMap<WebSocket, { nonce: string; authenticated: boolean; origin?: string }>()
    wss.on("connection", (ws, req) => {
      const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined
      const nonce = issueChallenge()
      authState.set(ws, { nonce, authenticated: false, origin })
      ws.send(JSON.stringify({ type: "auth.challenge", nonce }))
      ws.on("message", (raw) => {
        let msg: any
        try { msg = JSON.parse(raw.toString()) } catch { return }
        // Pre-auth gate: only auth.handshake may be sent before authenticating.
        if (!authState.get(ws)?.authenticated && msg?.type !== "auth.handshake") {
          try { ws.terminate() } catch { /* closing */ }
          return
        }
        const validation = validateWsMessage(msg)
        if (!validation.valid) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "error", error: `Invalid message: ${validation.error}` }))
          }
          return
        }
        if (msg.type !== "auth.handshake") return
        const st = authState.get(ws)
        if (!st) { try { ws.terminate() } catch { /* */ }; return }
        if (st.authenticated) return
        if (!verifyProof(secret, st.nonce, String(msg.proof))) {
          try { ws.terminate() } catch { /* */ }
          return
        }
        const nego = negotiateProtocolVersion(msg.protocol_version)
        if (!nego.ok) { try { ws.terminate() } catch { /* */ }; return }
        // #252: the gate under test — Origin class vs claimed surface.
        const resolved = surfaceFromOrigin(st.origin, msg.surface)
        if (!resolved.ok) { try { ws.terminate() } catch { /* */ }; return }
        st.authenticated = true
        ws.send(JSON.stringify({ type: "auth.ok", negotiated_protocol_version: nego.negotiated }))
        ws.send(JSON.stringify({ type: "connected" }))
      })
    })
  })
}

/** Open a client with the given Origin and complete the proof handshake (with optional surface claim). */
async function dialHandshake(
  port: number,
  secret: string,
  origin: string,
  surface: "tray" | "summoner" | undefined,
): Promise<{ ws: WebSocket; events: any[] }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { Origin: origin } })
  const events = collector(ws)
  await once(ws, "open")
  const challenge = await waitFor(events, (m) => m.type === "auth.challenge")
  ws.send(JSON.stringify({
    type: "auth.handshake",
    proof: proofFor(secret, challenge.nonce),
    ...(surface === undefined ? {} : { surface }),
  }))
  return { ws, events }
}

test("WS surface gate e2e: extension origin claiming surface:\"summoner\" is terminated, never authenticated (#252)", async () => {
  const secret = crypto.randomBytes(32).toString("hex")
  const { port, close } = await startSurfaceGatedServer(secret)
  try {
    const { ws, events } = await dialHandshake(port, secret, EXT_ORIGIN, "summoner")
    await once(ws, "close")
    assert.equal(
      events.find((m) => m.type === "auth.ok" || m.type === "connected"),
      undefined,
      "extension peer claiming summoner must be terminated before auth.ok/connected",
    )
  } finally {
    close()
  }
})

test("WS surface gate e2e: tray origin omitting surface is terminated, never authenticated (#252)", async () => {
  const secret = crypto.randomBytes(32).toString("hex")
  const { port, close } = await startSurfaceGatedServer(secret)
  try {
    const { ws, events } = await dialHandshake(port, secret, TRAY_WS_ORIGIN, undefined)
    await once(ws, "close")
    assert.equal(
      events.find((m) => m.type === "auth.ok" || m.type === "connected"),
      undefined,
      "tray peer must claim a surface explicitly — omit terminates",
    )
  } finally {
    close()
  }
})

test("WS surface gate e2e: tray origin with surface:\"tray\" authenticates normally (regression, #252)", async () => {
  const secret = crypto.randomBytes(32).toString("hex")
  const { port, close } = await startSurfaceGatedServer(secret)
  try {
    const { ws, events } = await dialHandshake(port, secret, TRAY_WS_ORIGIN, "tray")
    assert.equal((await waitFor(events, (m) => m.type === "auth.ok")).type, "auth.ok")
    assert.equal((await waitFor(events, (m) => m.type === "connected")).type, "connected")
    ws.close()
  } finally {
    close()
  }
})
