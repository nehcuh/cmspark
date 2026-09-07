/**
 * P0 deep-diagnosis batch regressions (2026-08-11 fanout).
 */
import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import os from "node:os"
import fs from "node:fs"
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

test("Batch C C2: MCP stdio rejects loader env keys by name", () => {
  assert.throws(() => buildMcpStdioEnv({ NODE_OPTIONS: "--require ./x" }), /NODE_OPTIONS/)
})

test("MCP stdio env pins npm_config_prefix under a custom data dir", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-prefix-test-"))
  const previous = process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR = dataDir
  try {
    const env = buildMcpStdioEnv()
    assert.ok(env.npm_config_prefix, "npm_config_prefix must be set")
    assert.equal(path.dirname(env.npm_config_prefix), dataDir)
    assert.equal(path.basename(env.npm_config_prefix), "npm-prefix")
    const overridden = buildMcpStdioEnv({ npm_config_prefix: "/tmp/custom-prefix" })
    assert.equal(overridden.npm_config_prefix, "/tmp/custom-prefix")
  } finally {
    if (previous === undefined) delete process.env.CMSPARK_DATA_DIR
    else process.env.CMSPARK_DATA_DIR = previous
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
