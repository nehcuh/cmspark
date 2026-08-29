/**
 * #250: WS progress fanout behavior tests — the sendToExtension wrapper in
 * startServer()'s connection handler (companion/src/ws/lifecycle.ts, the block
 * after `sendToExtension: (data: any) => {`, ~L1342-1374):
 *
 *   - sender always gets its own event (ws.send first);
 *   - only a 7-type whitelist (chat.token / chat.user / chat.done / chat.error /
 *     chat.aborted / run_status / thread.updated) is fanned out at all;
 *   - surface !== "summoner" senders fan out via pushSummonerWebEvent (SSE overlay);
 *   - surface === "summoner" senders fan out to other AUTHENTICATED,
 *     non-summoner ws clients — never back to other summoner clients.
 *
 * The fanout block is inline inside startServer() (which no test calls — every
 * message-exchange test uses a bare wss), so — exactly like
 * integration/ws-auth-handshake.test.ts replicates the auth gate — this harness
 * replicates the whitelist + surface-routing block over REAL ws sockets, calling
 * the REAL surfaceFromOrigin (handshake surface resolution) and the REAL
 * pushSummonerWebEvent (overlay push). Unlike the source-grep in
 * summoner-web.test.ts, this fails if the routing logic is inverted.
 * Keep in sync with companion/src/ws/lifecycle.ts (sendToExtension wrapper).
 */
import test from "node:test"
import assert from "node:assert/strict"
import { once } from "node:events"
import { WebSocketServer, WebSocket } from "ws"
import {
  surfaceFromOrigin,
  TRAY_WS_ORIGIN,
  type HandshakeSurface,
} from "../src/ws/handshake-surface"
import { pushSummonerWebEvent } from "../src/summoner-web"

const EXT_ORIGIN = "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef"

/** The 7-type fanout whitelist from lifecycle.ts sendToExtension (keep in sync). */
const WHITELIST = [
  "chat.token",
  "chat.user",
  "chat.done",
  "chat.error",
  "chat.aborted",
  "run_status",
  "thread.updated",
] as const

type AuthState = { authenticated: boolean; surface?: HandshakeSurface }

/**
 * Bare wss replicating the production fanout path: clients authenticate with an
 * Origin header + optional surface claim (resolved by the REAL surfaceFromOrigin),
 * then send { type:"emit", data } to simulate handleMessage pushing an event
 * through sendToExtension. `ssePushes` records every overlay-branch push (the
 * REAL pushSummonerWebEvent is invoked alongside, as production does).
 */
function startFanoutServer(): Promise<{ port: number; close: () => void; ssePushes: any[] }> {
  const ssePushes: any[] = []
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" }, () => {
      const addr = wss.address() as { port: number }
      resolve({ port: addr.port, close: () => { try { wss.close() } catch { /* */ } }, ssePushes })
    })
    const clients = new Set<WebSocket>()
    const wsAuth = new WeakMap<WebSocket, AuthState>()
    wss.on("connection", (ws, req) => {
      clients.add(ws)
      const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined
      wsAuth.set(ws, { authenticated: false })
      // Mirrors lifecycle.ts sendToExtension EXACTLY (whitelist gate + surface
      // routing). pushSummonerWebEvent is the REAL overlay push; ssePushes is
      // the test's observation point for that branch.
      const sendToExtension = (data: any) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(data))
        }
        const t = data?.type
        if (
          t !== "chat.token" &&
          t !== "chat.user" &&
          t !== "chat.done" &&
          t !== "chat.error" &&
          t !== "chat.aborted" &&
          t !== "run_status" &&
          t !== "thread.updated"
        ) {
          return
        }
        const surface = wsAuth.get(ws)?.surface
        if (surface !== "summoner") {
          ssePushes.push(data)
          pushSummonerWebEvent(data)
        } else {
          const payload = JSON.stringify(data)
          for (const c of clients) {
            if (c === ws || c.readyState !== WebSocket.OPEN) continue
            const st = wsAuth.get(c)
            if (st?.authenticated && st.surface !== "summoner") c.send(payload)
          }
        }
      }
      ws.on("message", (raw) => {
        let msg: any
        try { msg = JSON.parse(raw.toString()) } catch { return }
        if (msg?.type === "auth.handshake") {
          const resolved = surfaceFromOrigin(origin, msg.surface)
          if (!resolved.ok) { try { ws.terminate() } catch { /* */ }; return }
          wsAuth.set(ws, { authenticated: true, surface: resolved.surface })
          ws.send(JSON.stringify({ type: "auth.ok", surface: resolved.surface }))
          return
        }
        if (!wsAuth.get(ws)?.authenticated) {
          try { ws.terminate() } catch { /* */ }
          return
        }
        if (msg?.type === "emit") {
          sendToExtension(msg.data)
        }
      })
      ws.on("close", () => {
        clients.delete(ws)
        wsAuth.delete(ws)
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Connect + authenticate; returns with the event log cleared of handshake frames. */
async function connectAuthed(
  port: number,
  origin: string,
  surface?: "tray" | "summoner",
): Promise<{ ws: WebSocket; events: any[] }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { Origin: origin } })
  const events = collector(ws)
  await once(ws, "open")
  ws.send(JSON.stringify({
    type: "auth.handshake",
    ...(surface === undefined ? {} : { surface }),
  }))
  await waitFor(events, (m) => m.type === "auth.ok")
  events.length = 0
  return { ws, events }
}

function emit(ws: WebSocket, data: any): void {
  ws.send(JSON.stringify({ type: "emit", data }))
}

test("fanout: non-whitelist type (security.confirm_request) is never fanned out (#250)", async () => {
  const { port, close, ssePushes } = await startFanoutServer()
  try {
    const panel = await connectAuthed(port, EXT_ORIGIN)
    const tray = await connectAuthed(port, TRAY_WS_ORIGIN, "tray")
    const summoner = await connectAuthed(port, TRAY_WS_ORIGIN, "summoner")
    const confirm = {
      type: "security.confirm_request",
      id: "c1",
      tool_name: "evaluate",
      thread_id: "t1",
    }
    // From a panel client: sender echo only — no overlay push, no ws fanout.
    emit(panel.ws, confirm)
    await waitFor(panel.events, (m) => m.type === "security.confirm_request")
    await sleep(150)
    assert.equal(ssePushes.length, 0, "non-whitelist must not reach the SSE overlay push")
    assert.equal(
      tray.events.find((m) => m.type === "security.confirm_request"),
      undefined,
      "non-whitelist must not fan out to other ws clients",
    )
    assert.equal(
      summoner.events.find((m) => m.type === "security.confirm_request"),
      undefined,
      "non-whitelist must not fan out to summoner clients",
    )
    // From a summoner client: same — sender echo only, nothing to panel/tray.
    emit(summoner.ws, confirm)
    await waitFor(summoner.events, (m) => m.type === "security.confirm_request")
    await sleep(150)
    assert.equal(ssePushes.length, 0, "summoner-sourced non-whitelist must not reach the overlay push")
    assert.equal(
      panel.events.filter((m) => m.type === "security.confirm_request").length,
      1,
      "panel must keep only its own sender echo",
    )
    assert.equal(
      tray.events.find((m) => m.type === "security.confirm_request"),
      undefined,
      "summoner-sourced non-whitelist must not reach tray clients",
    )
    panel.ws.close()
    tray.ws.close()
    summoner.ws.close()
  } finally {
    close()
  }
})

test("fanout: summoner-sourced whitelist events do not reflow to other summoner clients (#250)", async () => {
  const { port, close, ssePushes } = await startFanoutServer()
  try {
    const s1 = await connectAuthed(port, TRAY_WS_ORIGIN, "summoner")
    const s2 = await connectAuthed(port, TRAY_WS_ORIGIN, "summoner")
    const panel = await connectAuthed(port, EXT_ORIGIN)
    const tray = await connectAuthed(port, TRAY_WS_ORIGIN, "tray")
    const token = { type: "chat.token", token: "hello", thread_id: "t1" }
    emit(s1.ws, token)
    // Fanout targets: authenticated non-summoner ws clients.
    await waitFor(panel.events, (m) => m.type === "chat.token")
    await waitFor(tray.events, (m) => m.type === "chat.token")
    // Sender echo: the originating summoner still gets its own event.
    await waitFor(s1.events, (m) => m.type === "chat.token")
    await sleep(150)
    assert.equal(
      s2.events.find((m) => m.type === "chat.token"),
      undefined,
      "summoner-sourced events must NOT reflow to other summoner clients",
    )
    assert.equal(
      ssePushes.length,
      0,
      "summoner-sourced events fan out to ws clients, not the SSE overlay push",
    )
    s1.ws.close()
    s2.ws.close()
    panel.ws.close()
    tray.ws.close()
  } finally {
    close()
  }
})

test("fanout: whitelist types route by surface — panel/tray senders reach the SSE overlay only (#250)", async () => {
  const { port, close, ssePushes } = await startFanoutServer()
  try {
    const panel = await connectAuthed(port, EXT_ORIGIN)
    const tray = await connectAuthed(port, TRAY_WS_ORIGIN, "tray")
    const summoner = await connectAuthed(port, TRAY_WS_ORIGIN, "summoner")
    // Every whitelisted type from a panel sender passes the gate → overlay push.
    for (const t of WHITELIST) {
      const before = ssePushes.length
      emit(panel.ws, { type: t, thread_id: "t1" })
      await waitFor(ssePushes, (m) => m.type === t)
      assert.equal(ssePushes.length, before + 1, `${t} from a panel sender must reach the overlay push`)
    }
    // Tray sender routes the same way.
    emit(tray.ws, { type: "chat.done", thread_id: "t1" })
    await waitFor(ssePushes, (m) => m.type === "chat.done")
    await sleep(150)
    // Non-summoner fanout goes to the SSE overlay ONLY — no ws client besides
    // the sender sees these frames.
    assert.equal(
      summoner.events.length,
      0,
      "panel/tray-sourced events must not fan out to summoner ws clients",
    )
    assert.equal(
      tray.events.filter((m) => WHITELIST.includes(m.type)).length,
      1,
      "tray keeps only its own chat.done sender echo",
    )
    panel.ws.close()
    tray.ws.close()
    summoner.ws.close()
  } finally {
    close()
  }
})
