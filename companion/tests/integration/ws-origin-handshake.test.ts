import test from "node:test"
import assert from "node:assert/strict"
import { WebSocketServer, WebSocket } from "ws"
import { isAllowedWsOrigin } from "../../src/server"

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
