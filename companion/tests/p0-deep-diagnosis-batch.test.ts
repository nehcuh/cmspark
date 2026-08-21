/**
 * P0 deep-diagnosis batch regressions (2026-08-11 fanout).
 */
import test from "node:test"
import assert from "node:assert/strict"
import { buildMcpStdioEnv } from "../src/mcp/transport"

test("P0 SEC-02: MCP stdio env does not inherit arbitrary secrets", () => {
  const prev = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = "sk-secret-test-key"
  process.env.AWS_SECRET_ACCESS_KEY = "aws-secret"
  try {
    const env = buildMcpStdioEnv()
    assert.equal(env.OPENAI_API_KEY, undefined)
    assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined)
    assert.ok(env.PATH && env.PATH.length > 0)
  } finally {
    if (prev === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = prev
    delete process.env.AWS_SECRET_ACCESS_KEY
  }
})

test("P0 SEC-02: MCP stdio allows explicit config.env secrets (operator intent)", () => {
  const env = buildMcpStdioEnv({ MY_MCP_TOKEN: "tok", PATH: "/custom/bin" })
  assert.equal(env.MY_MCP_TOKEN, "tok")
  assert.equal(env.PATH, "/custom/bin")
})

test("MCP stdio env pins npm_config_prefix under the data dir (packaged Contents/lib)", () => {
  const env = buildMcpStdioEnv()
  assert.ok(env.npm_config_prefix, "npm_config_prefix must be set")
  assert.match(env.npm_config_prefix, /\.cmspark-agent[/\\]npm-prefix$/)
  const overridden = buildMcpStdioEnv({ npm_config_prefix: "/tmp/custom-prefix" })
  assert.equal(overridden.npm_config_prefix, "/tmp/custom-prefix")
})
