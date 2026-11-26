import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import { test } from "node:test"
import type { AddressInfo } from "node:net"
import type { LlmConfig } from "../src/config"
import { MiniChat } from "../src/mini/chat"

test("Mini quick chat includes previous answers only for the same model recipient", async t => {
  const calls: Array<{ messages: { role: string; content: string }[]; model: string }> = []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const part of req) chunks.push(part)
    calls.push(JSON.parse(Buffer.concat(chunks).toString("utf8")))
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "收到" + calls.length }, finish_reason: "stop" }] }))
  }).listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(() => { server.closeAllConnections(); server.close() })
  const model: LlmConfig = {
    base_url: "http://127.0.0.1:" + (server.address() as AddressInfo).port + "/v1",
    model_name: "mini-test", temperature: 0, context_window: 8192, api_key: "test-one",
    extra_headers: { "x-tenant": "one" },
  }
  const chat = new MiniChat(() => model)
  const signal = new AbortController().signal
  assert.equal(await chat.reply("第一条", signal), "收到1")
  await chat.reply("继续", signal)
  assert.deepEqual(calls[1].messages.map(m => m.content), ["第一条", "收到1", "继续"])
  model.extra_headers = { "x-tenant": "two" }
  await chat.reply("切换团队", signal)
  assert.deepEqual(calls[2].messages, [{ role: "user", content: "切换团队" }])
  model.api_key = "test-two"
  await chat.reply("切换账户", signal)
  assert.deepEqual(calls[3].messages, [{ role: "user", content: "切换账户" }])
  model.model_name = "other-mini"
  await chat.reply("新模型", signal)
  assert.equal(calls[4].model, "other-mini")
  assert.deepEqual(calls[4].messages, [{ role: "user", content: "新模型" }])
  await assert.rejects(chat.reply(" ", signal))
  assert.equal(calls.length, 5)
})
