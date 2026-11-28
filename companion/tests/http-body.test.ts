import assert from "node:assert/strict"
import { IncomingMessage } from "node:http"
import { Socket } from "node:net"
import test from "node:test"
import { readBody } from "../src/http-body"

test("local HTTP text preserves split UTF-8 at the exact byte limit", async () => {
  const req = new IncomingMessage(new Socket())
  const text = '{"title":"周会🎙"}'
  const bytes = Buffer.from(text)
  const result = readBody(req, bytes.length)
  for (const byte of bytes) req.push(Buffer.from([byte]))
  req.push(null)
  assert.equal(await result, text)
})

test("overflow destroys the request and preserves the caller's error", async () => {
  const req = new IncomingMessage(new Socket())
  const result = readBody(req, 2, "body_too_large")
  req.push(Buffer.from("会"))
  await assert.rejects(result, { message: "body_too_large" })
  assert.equal(req.destroyed, true)
})
