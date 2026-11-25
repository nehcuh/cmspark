import "./helpers/require-isolated-config-825"
import test from "node:test"
import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { getConfig } from "../src/config"
import { desktopFrameInspector, desktopImagePoint } from "../src/computer/main-model-vision"

test("desktop image consent applies to one frame, model and request only", async () => {
  const received: Array<{ path: string; body: any }> = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    received.push({ path: req.url!, body: JSON.parse(Buffer.concat(chunks).toString()) })
    if (req.url!.startsWith("/redirect/")) {
      res.writeHead(307, { location: "/unapproved" }).end()
      return
    }
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify(req.url === "/v1/messages"
      ? { content: [{ type: "text", text: "synthetic circle" }], stop_reason: "end_turn" }
      : { choices: [{ message: { content: "synthetic circle" }, finish_reason: "stop" }] }))
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port
  try {
    for (const protocol of ["anthropic", "openai"] as const) {
      const model = { ...getConfig().llm, model_name: "vision-fixture", protocol, base_url: base + "/v1", api_key: "fixture-only" }
      const frame = { image: "cGl4ZWxz", app: "Synthetic Pad", assertCurrent() {} }
      let current = true
      let permit = false
      let retireOnConsent = false
      const inspector = desktopFrameInspector({ model, current: () => current }, async details => {
        assert.equal(details.autoConfirmEligible, false)
        assert.equal(details.previewImage, frame.image)
        assert.ok(details.fullPreview?.includes(model.base_url))
        assert.ok(details.fullPreview?.includes(model.model_name))
        if (retireOnConsent) current = false
        return permit
      })
      const start = received.length
      assert.equal(await inspector.inspect(frame), undefined)
      permit = true
      retireOnConsent = true
      assert.equal(await inspector.inspect(frame), undefined)
      assert.equal(received.length, start)
      current = true
      retireOnConsent = false
      assert.equal(await inspector.inspect(frame), "synthetic circle")
      assert.equal(received.length, start + 1)
      const { path, body } = received.at(-1)!
      assert.equal(body.model, model.model_name)
      assert.equal(body.tools, undefined)
      assert.equal(path, protocol === "anthropic" ? "/v1/messages" : "/v1/chat/completions")
      assert.ok(JSON.stringify(body.messages).includes(frame.image))
      const redirect = desktopFrameInspector({ model: { ...model, base_url: base + "/redirect" }, current: () => true }, async () => true)
      assert.equal(await redirect.inspect(frame), undefined)
      assert.equal(received.length, start + 2)
      assert.ok(received.at(-1)!.path.startsWith("/redirect/"))
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test("desktop model suggestions use the full source bitmap and reject ambiguous coordinates", () => {
  const shot = { rect: { x: 0, y: 0, width: 800, height: 500 }, imageWidth: 1600, imageHeight: 1000 }
  assert.deepEqual(desktopImagePoint('{"x":0.25,"y":0.5}', shot), { x: 400, y: 500 })
  for (const bad of ["null", "yes", '{"x":0,"y":1}', '{"x":0,"y":0,"text":"click"}', '{"x":"1","y":0}']) {
    assert.equal(desktopImagePoint(bad, shot), undefined)
  }
})
