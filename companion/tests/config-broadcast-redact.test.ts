// SRV-1: redactConfigForBroadcast masks secrets before config.updated fanout.
// Pure unit tests — no startServer / WebSocket.

import test from "node:test"
import assert from "node:assert/strict"
import { redactConfigForBroadcast } from "../src/server.js"

test("masks llm and vision api_key; empty when unset", () => {
  const out = redactConfigForBroadcast({
    llm: { base_url: "https://api.example/v1", api_key: "sk-live-secret", model_name: "m" },
    vision: { enabled: true, api_key: "vision-secret", model_name: "v" },
  })
  assert.equal(out.llm.api_key, "***")
  assert.equal(out.llm.base_url, "https://api.example/v1")
  assert.equal(out.llm.model_name, "m")
  assert.equal(out.vision.api_key, "***")
  assert.equal(out.vision.model_name, "v")

  const empty = redactConfigForBroadcast({
    llm: { api_key: "" },
    vision: { api_key: "" },
  })
  assert.equal(empty.llm.api_key, "")
  assert.equal(empty.vision.api_key, "")
})

test("masks mcp.servers env and headers values; preserves keys and non-secret fields", () => {
  const out = redactConfigForBroadcast({
    llm: { api_key: "k" },
    mcp: {
      enabled: true,
      servers: {
        local: {
          transport: "stdio",
          command: "npx",
          args: ["-y", "mcp-server"],
          env: { API_TOKEN: "super-secret", HOME: "/tmp/x" },
          enabled: true,
          trust_level: "manual",
        },
        remote: {
          transport: "http",
          url: "https://mcp.example/rpc",
          headers: { Authorization: "Bearer abc", "X-Custom": "val" },
          enabled: true,
          trust_level: "trusted",
        },
      },
    },
  })

  assert.equal(out.mcp.enabled, true)
  assert.equal(out.mcp.servers.local.command, "npx")
  assert.deepEqual(out.mcp.servers.local.args, ["-y", "mcp-server"])
  assert.deepEqual(out.mcp.servers.local.env, { API_TOKEN: "***", HOME: "***" })
  // Key names preserved so UI can list configured env var names.
  assert.deepEqual(Object.keys(out.mcp.servers.local.env).sort(), ["API_TOKEN", "HOME"])

  assert.equal(out.mcp.servers.remote.url, "https://mcp.example/rpc")
  assert.deepEqual(out.mcp.servers.remote.headers, {
    Authorization: "***",
    "X-Custom": "***",
  })
  assert.deepEqual(Object.keys(out.mcp.servers.remote.headers).sort(), [
    "Authorization",
    "X-Custom",
  ])
})

test("does not mutate the original config object", () => {
  const original = {
    llm: { api_key: "sk-real" },
    mcp: {
      enabled: true,
      servers: {
        s: {
          transport: "stdio",
          command: "echo",
          env: { SECRET: "value" },
        },
      },
    },
  }
  const out = redactConfigForBroadcast(original)
  assert.equal(out.llm.api_key, "***")
  assert.equal(original.llm.api_key, "sk-real")
  assert.equal(original.mcp.servers.s.env.SECRET, "value")
  assert.equal(out.mcp.servers.s.env.SECRET, "***")
})

test("preserves server names and mcp without servers", () => {
  const noServers = redactConfigForBroadcast({ mcp: { enabled: false } })
  assert.deepEqual(noServers.mcp, { enabled: false })

  const emptyServers = redactConfigForBroadcast({ mcp: { enabled: true, servers: {} } })
  assert.deepEqual(emptyServers.mcp.servers, {})
})
