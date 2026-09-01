// B3 / #268: listen-first — MCP start hang must not delay loopback accept.
//
// Production startServer() is hard to boot (UDS lock / initServices / process.exit).
// Order is extracted as attachWssListenThenStartMcp so a hanging startMcp can be
// injected. Current lifecycle.ts awaits mcpManager.start before listen — this file
// must fail until that order is flipped.

import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import http from "node:http"
import { WebSocketServer } from "ws"
import { attachWssListenThenStartMcp, handleHealthzRequest } from "../src/ws/lifecycle"

function lifecycleSrc(): string {
  const candidates = [
    path.join(__dirname, "..", "..", "src", "ws", "lifecycle.ts"),
    path.join(process.cwd(), "src", "ws", "lifecycle.ts"),
    path.join(process.cwd(), "companion", "src", "ws", "lifecycle.ts"),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8")
  }
  throw new Error("missing companion/src/ws/lifecycle.ts")
}

test("startServer source: construct WSS then listen before mcpManager.start", () => {
  const src = lifecycleSrc()
  const fn = src.slice(src.indexOf("export async function startServer"))
  assert.ok(fn.length > 0, "startServer must exist")

  const helperIdx = fn.indexOf("attachWssListenThenStartMcp")
  const awaitStartBeforeAccept = fn.search(
    /await\s+mcpManager\.start[\s\S]{0,400}httpServer\.listen/,
  )
  assert.equal(
    awaitStartBeforeAccept,
    -1,
    "must not await mcpManager.start before httpServer.listen (current lifecycle.ts:700-711 order is the bug)",
  )
  assert.ok(helperIdx >= 0, "startServer must use attachWssListenThenStartMcp")

  const helper = src.slice(src.indexOf("export function attachWssListenThenStartMcp"))
  const listenInHelper = helper.indexOf("httpServer.listen")
  const startInHelper = helper.search(/opts\.startMcp\s*\(/)
  assert.ok(listenInHelper >= 0, "helper must call httpServer.listen")
  assert.ok(startInHelper >= 0, "helper must invoke startMcp")
  assert.ok(
    listenInHelper < startInHelper,
    `listen (${listenInHelper}) must precede startMcp (${startInHelper})`,
  )
  const wssInHelper = helper.search(/createWss\s*\(/)
  assert.ok(wssInHelper >= 0 && wssInHelper < listenInHelper, "construct WSS before listen")
})

test("hanging mcp start: listen + /healthz happen before start settles", async () => {
  const events: string[] = []
  let startSettled = false
  const httpServer = http.createServer(handleHealthzRequest)
  const origListen = httpServer.listen.bind(httpServer)
  httpServer.listen = ((...args: Parameters<typeof origListen>) => {
    events.push("listen")
    return origListen(...args)
  }) as typeof httpServer.listen

  const startMcp = () => {
    events.push("mcp-start")
    return new Promise<void>(() => {
      /* never settles — hang injection */
    }).finally(() => {
      startSettled = true
    })
  }

  const wss = await Promise.race([
    Promise.resolve().then(() =>
      attachWssListenThenStartMcp({
        httpServer,
        port: 0,
        createWss: (server) => {
          events.push("wss")
          return new WebSocketServer({
            server,
            verifyClient: (_info, cb) => cb(true),
          })
        },
        startMcp,
      }),
    ),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("listen blocked by hanging mcp start (today's await-before-listen)")),
        250,
      ),
    ),
  ])

  try {
    assert.ok(events.includes("listen"), "listen must run while mcp start is hung")
    assert.equal(events[0], "wss", "WebSocketServer must be constructed before listen")
    assert.equal(events[1], "listen")
    assert.ok(events.indexOf("listen") < events.indexOf("mcp-start") || events.includes("mcp-start"))
    if (events.includes("mcp-start")) {
      assert.ok(events.indexOf("listen") < events.indexOf("mcp-start"))
    }
    assert.equal(startSettled, false, "hung startMcp must not have settled")

    await new Promise<void>((resolve, reject) => {
      if (httpServer.listening) return resolve()
      httpServer.once("listening", () => resolve())
      httpServer.once("error", reject)
    })
    const addr = httpServer.address()
    assert.ok(addr && typeof addr === "object" && "port" in addr)
    const { port } = addr as { port: number }
    const res = await fetch(`http://127.0.0.1:${port}/healthz`)
    assert.equal(res.status, 200, "/healthz is liveness, not MCP ready")
    const body = (await res.json()) as { status: string; uptime?: number }
    assert.equal(body.status, "ok")
    assert.equal(typeof body.uptime, "number")
    assert.equal(startSettled, false)
  } finally {
    wss.close()
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  }
})
