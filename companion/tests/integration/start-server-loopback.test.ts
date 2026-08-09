/**
 * TEST-1 / P1: real loopback HTTP server for healthz (not full startServer —
 * that process.exit/UDS-lock path stays integration-manual).
 *
 * Exercises the same handleHealthzRequest + ephemeral port pattern startServer uses.
 */
import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { handleHealthzRequest } from "../../src/server"

test("loopback healthz responds 200 via real http.Server", async () => {
  const server = http.createServer(handleHealthzRequest)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const addr = server.address()
  assert.ok(addr && typeof addr === "object")
  const port = (addr as { port: number }).port
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`)
    assert.equal(res.status, 200)
    const body = await res.text()
    assert.ok(body.length >= 0)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
