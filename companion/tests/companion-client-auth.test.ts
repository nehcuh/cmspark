import "./_companion-client-auth-setup" // FIRST — pins DATA_DIR + writes ws_secret
import test from "node:test"
import assert from "node:assert/strict"
import * as crypto from "crypto"
import { WebSocketServer } from "ws"

import { CompanionClient } from "../src/tray/companion-client"
import { AUTH_TIMEOUT_MS } from "../src/ws-auth"
import { TEST_SECRET } from "./_companion-client-auth-setup"

// E2E for the tray CompanionClient's #35 (P0-2B) shared-secret handshake. Drives
// the REAL client through a mock companion server that mirrors the production
// auth flow (server.ts): challenge → auth.handshake (HMAC proof) → auth.ok, with
// app messages rejected until authenticated. Guards the regression where the tray
// connected with no Origin + no proof and was rejected every ~30s (803
// ws.rejected_origin events in one day's log).

const NONCE = "challenge-nonce-fixed-for-deterministic-proof"
const TRAY_ORIGIN = "cmspark-tray://local"

interface AuthServer {
  port: number
  /** The HMAC proof the client sent in its auth.handshake (null if none). */
  receivedProof: () => string | null
  /** App-level messages (everything after auth.ok) the client sent. */
  appMessages: () => any[]
  /** Total inbound connections (used to detect reconnect behavior). */
  connectionCount: () => number
  close: () => Promise<void>
}

/** Mock companion server. `serverSecret` is what the SERVER uses to verify the
 *  proof; the client computes its proof against ws_secret on disk (TEST_SECRET).
 *  Pass a mismatched secret to simulate a rejected handshake. `silent` skips the
 *  auth.challenge (to exercise the client's auth-watchdog). */
function startAuthServer(serverSecret: string, requireOrigin = true, silent = false): Promise<AuthServer> {
  return new Promise((resolve) => {
    let proofValue: string | null = null
    const app: any[] = []
    let connections = 0

    const wss = new WebSocketServer(
      {
        host: "127.0.0.1",
        port: 0,
        verifyClient: (info, cb) => {
          // Mirror server.ts isAllowedWsOrigin: only the trusted tray origin passes.
          if (requireOrigin && info.origin !== TRAY_ORIGIN) {
            cb(false, 403, "Forbidden")
            return
          }
          cb(true)
        },
      },
      () => {
        const { port } = wss.address() as { port: number }
        resolve({
          port,
          receivedProof: () => proofValue,
          appMessages: () => app,
          connectionCount: () => connections,
          close: () =>
            new Promise<void>((done) => {
              for (const c of wss.clients) {
                try { c.terminate() } catch { /* ignore */ }
              }
              wss.close(() => done())
            }),
        })
      },
    )

    wss.on("connection", (ws) => {
      connections++
      // Mirror server.ts: challenge immediately on connect (unless `silent`).
      if (!silent) {
        ws.send(JSON.stringify({ type: "auth.challenge", nonce: NONCE }))
      }

      ws.on("message", (raw) => {
        let msg: any
        try {
          msg = JSON.parse(raw.toString())
        } catch {
          return
        }

        if (msg.type === "auth.handshake") {
          proofValue = String(msg.proof)
          const expected = crypto
            .createHmac("sha256", serverSecret)
            .update(NONCE)
            .digest("hex")
          if (msg.proof === expected) {
            // Mirror server.ts: auth.ok then app-level "connected".
            ws.send(JSON.stringify({ type: "auth.ok" }))
            ws.send(JSON.stringify({ type: "connected" }))
          } else {
            // Bad proof → server.ts terminates.
            try { ws.close() } catch { /* ignore */ }
          }
          return
        }

        // App message — record it, then answer the data requests the client makes.
        app.push(msg)
        if (msg.type === "skill.list") {
          ws.send(
            JSON.stringify({
              id: msg.id,
              skills: [{ name: "summarize-page", builtin: false }],
            }),
          )
        } else if (msg.type === "thread.list") {
          ws.send(
            JSON.stringify({
              id: msg.id,
              threads: [
                {
                  id: "t-1",
                  alias: "Reading list",
                  updated_at: "2026-07-13T10:00:00Z",
                },
              ],
            }),
          )
        }
      })
    })
  })
}

test("CompanionClient completes the HMAC handshake, then fetches data after auth.ok (#35)", async () => {
  const server = await startAuthServer(TEST_SECRET)
  const client = new CompanionClient({
    host: "127.0.0.1",
    port: server.port,
    reconnectInterval: 100,
    maxReconnectAttempts: 0,
  })

  try {
    await client.connect()

    // auth.ok must have promoted the client to connected.
    assert.equal(
      client.connectionState,
      "connected",
      "client must reach 'connected' only after auth.ok",
    )

    // The proof the client sent must equal HMAC-SHA256(TEST_SECRET, NONCE) — i.e.
    // the same computation the production server's verifyProof() runs.
    const expectedProof = crypto
      .createHmac("sha256", TEST_SECRET)
      .update(NONCE)
      .digest("hex")
    assert.equal(
      server.receivedProof(),
      expectedProof,
      "client must send the correct HMAC proof for the on-disk shared secret",
    )

    // Post-auth data fetch must work (the client was rejected pre-fix before it
    // could ever get here).
    const actions = await client.fetchQuickActions()
    assert.ok(actions.length > 0, "quick actions must be populated from skill.list")
    assert.equal(actions[0].id, "skill:summarize-page")

    const threads = await client.fetchRecentThreads()
    assert.equal(threads.length, 1)
    assert.equal(threads[0].id, "t-1")
  } finally {
    client.disconnect()
    await server.close()
  }
})

test("CompanionClient sends the trusted tray Origin header (passes the server origin gate)", async () => {
  // Server rejects any Origin != cmspark-tray://local; the default client must pass.
  const server = await startAuthServer(TEST_SECRET, /* requireOrigin */ true)
  const client = new CompanionClient({
    host: "127.0.0.1",
    port: server.port,
    reconnectInterval: 100,
    maxReconnectAttempts: 0,
  })

  try {
    await client.connect()
    assert.equal(
      client.connectionState,
      "connected",
      "default client must present the allow-listed cmspark-tray://local origin",
    )
  } finally {
    client.disconnect()
    await server.close()
  }
})

test("CompanionClient must NOT authenticate or send app messages when the proof is rejected", async () => {
  // Server expects a DIFFERENT secret than the one on disk → proof won't match.
  const server = await startAuthServer("not-the-on-disk-secret")
  const client = new CompanionClient({
    host: "127.0.0.1",
    port: server.port,
    reconnectInterval: 100,
    maxReconnectAttempts: 0,
  })

  try {
    await client.connect() // resolves on close (rejected handshake), not on auth.ok

    assert.notEqual(
      client.connectionState,
      "connected",
      "client must NOT reach 'connected' when the HMAC proof is rejected",
    )
    assert.equal(
      server.appMessages().length,
      0,
      "no app message may be sent before authentication",
    )
  } finally {
    client.disconnect()
    await server.close()
  }
})

test("CompanionClient with a wrong Origin is rejected by the server gate", async () => {
  const server = await startAuthServer(TEST_SECRET, /* requireOrigin */ true)
  const client = new CompanionClient({
    host: "127.0.0.1",
    port: server.port,
    reconnectInterval: 100,
    maxReconnectAttempts: 0,
    origin: "https://evil.com", // web origin → must be rejected
  })

  try {
    await client.connect()
    assert.notEqual(
      client.connectionState,
      "connected",
      "a non-tray origin must not authenticate",
    )
    assert.equal(server.receivedProof(), null, "rejected at upgrade — no handshake reached")
  } finally {
    client.disconnect()
    await server.close()
  }
})

test("CompanionClient with no shared secret marks unpaired and suppresses the reconnect storm", async () => {
  const server = await startAuthServer(TEST_SECRET)
  const client = new CompanionClient({
    host: "127.0.0.1",
    port: server.port,
    reconnectInterval: 50,
    maxReconnectAttempts: -1, // infinite — only the unpaired guard should stop retries
    secretLoader: () => "", // simulate "no ws_secret on disk yet"
  })

  try {
    await client.connect() // resolves on close (no secret → respondToChallenge closes)

    assert.notEqual(
      client.connectionState,
      "connected",
      "unpaired client must not reach 'connected'",
    )
    assert.equal(server.receivedProof(), null, "must not send a handshake with no secret")

    // Wait well past one reconnect interval; unpaired must suppress ALL retries.
    await new Promise((r) => setTimeout(r, 250))
    assert.equal(
      server.connectionCount(),
      1,
      "unpaired client must NOT reconnect (storm suppressed until a secret exists)",
    )
  } finally {
    client.disconnect()
    await server.close()
  }
})

test("CompanionClient closes + reconnects when the server upgrades but never challenges (auth watchdog)", async () => {
  // `silent` server: accepts the WS upgrade but never sends auth.challenge. Without
  // the watchdog, connect() would park in "connecting" forever. With it, the client
  // closes at AUTH_TIMEOUT_MS and scheduleReconnect fires.
  const server = await startAuthServer(TEST_SECRET, true, /* silent */ true)
  const client = new CompanionClient({
    host: "127.0.0.1",
    port: server.port,
    reconnectInterval: 50,
    maxReconnectAttempts: -1,
  })

  try {
    const t0 = Date.now()
    await client.connect() // resolves once the watchdog closes the socket
    const elapsed = Date.now() - t0

    assert.notEqual(client.connectionState, "connected", "silent server must not authenticate")
    assert.ok(
      elapsed >= AUTH_TIMEOUT_MS - 100,
      `connect() must hang for ~the full watchdog (${AUTH_TIMEOUT_MS}ms), got ${elapsed}ms`,
    )

    // Watchdog closed the parked socket → scheduleReconnect fires ~interval later.
    await new Promise((r) => setTimeout(r, 300))
    assert.ok(
      server.connectionCount() >= 2,
      "watchdog must close the parked socket and trigger at least one reconnect",
    )
  } finally {
    client.disconnect()
    await server.close()
  }
})
