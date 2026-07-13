// L12: healthz endpoint tests.
//
// 1. Unit tests for handleHealthzRequest mounted on a bare http.Server.
// 2. Integration test that the production-style combined HTTP + WS server works:
//    - HTTP GET /healthz returns 200
//    - HTTP GET / returns 404
//    - WebSocket upgrade still works on the same port

import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { WebSocketServer, WebSocket } from "ws"
import { handleHealthzRequest, isAllowedWsOrigin } from "../src/server"

async function get(server: http.Server, path: string): Promise<{ statusCode: number; body: string }> {
  const addr = server.address()
  assert.ok(addr && typeof addr === "object" && "port" in addr, "server must be listening on a TCP port")
  const { port } = addr as { port: number }
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}${path}`, (res) => {
        let body = ""
        res.on("data", (chunk) => {
          body += chunk
        })
        res.on("end", () => {
          resolve({ statusCode: res.statusCode ?? 0, body })
        })
      })
      .on("error", reject)
  })
}

async function listen(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
}

async function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

// Unit: handler mounted on bare http.Server (mirrors how startServer will use it).
test("handleHealthzRequest: GET /healthz returns 200 ok + uptime", async () => {
  const server = http.createServer(handleHealthzRequest)
  await listen(server)
  try {
    const { statusCode, body } = await get(server, "/healthz")
    assert.equal(statusCode, 200)
    const json = JSON.parse(body)
    assert.equal(json.status, "ok")
    assert.ok(typeof json.uptime === "number" && json.uptime >= 0)
  } finally {
    await close(server)
  }
})

test("handleHealthzRequest: non-/healthz paths return 404", async () => {
  const server = http.createServer(handleHealthzRequest)
  await listen(server)
  try {
    for (const path of ["/", "/healthz/", "/unknown", "/healthz/extra"]) {
      const { statusCode } = await get(server, path)
      assert.equal(statusCode, 404, `path ${path} must be 404`)
    }
  } finally {
    await close(server)
  }
})

test("handleHealthzRequest: non-GET /healthz returns 404", async () => {
  const server = http.createServer(handleHealthzRequest)
  await listen(server)
  try {
    const addr = server.address()
    assert.ok(addr && typeof addr === "object" && "port" in addr)
    const { port } = addr as { port: number }
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.request(
        { hostname: "127.0.0.1", port, path: "/healthz", method: "POST" },
        resolve,
      )
      req.on("error", reject)
      req.end()
    })
    assert.equal(res.statusCode, 404)
  } finally {
    await close(server)
  }
})

// Integration: HTTP and WS share one http.Server (the production F1-a wiring).
test("combined HTTP+WS server: healthz works and WS upgrade still accepted", async () => {
  const httpServer = http.createServer(handleHealthzRequest)
  const wss = new WebSocketServer({
    server: httpServer,
    verifyClient: (info, cb) => {
      cb(isAllowedWsOrigin(info.origin))
    },
  })
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve))

  try {
    const { statusCode, body } = await get(httpServer, "/healthz")
    assert.equal(statusCode, 200)
    const json = JSON.parse(body)
    assert.equal(json.status, "ok")
    assert.ok(typeof json.uptime === "number")

    const root = await get(httpServer, "/")
    assert.equal(root.statusCode, 404)

    const addr = httpServer.address()
    assert.ok(addr && typeof addr === "object" && "port" in addr)
    const { port } = addr as { port: number }
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
        headers: { Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" },
      })
      ws.on("open", () => {
        ws.close()
        resolve()
      })
      ws.on("error", reject)
    })
  } finally {
    wss.close()
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  }
})
