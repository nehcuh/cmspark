import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { McpClient } from "../src/mcp/client"
import { defaultFilesystemServerConfig } from "../src/mcp/filesystem-home"
import { isLocalOfficialFilesystem, MCP_FILESYSTEM_PACKAGE } from "../src/mcp/filesystem-identity"
import { resolveBundledFilesystemConfig } from "../src/mcp/filesystem-launch"
import type { McpStdioServerConfig } from "../src/mcp/types"

const entry = require.resolve("@modelcontextprotocol/server-filesystem/dist/index.js")

test("only the unversioned official npx launch is rewritten to the bundled server", () => {
  const config = defaultFilesystemServerConfig("linux", "/owned/home")
  const resolved = resolveBundledFilesystemConfig(config, {
    entryPath: entry,
    execPath: "/opt/cmspark/node",
  }) as McpStdioServerConfig

  assert.equal(resolved.command, "/opt/cmspark/node")
  assert.deepEqual(resolved.args, [entry, "/owned/home"])
  assert.equal(isLocalOfficialFilesystem(resolved), true)
  assert.equal(resolved.roots, config.roots)
  assert.equal(resolved.cwd, config.cwd)

  const versioned: McpStdioServerConfig = {
    transport: "stdio",
    command: "npx",
    args: ["-y", `${MCP_FILESYSTEM_PACKAGE}@1.0.0`, "/owned/home"],
    enabled: true,
    trust_level: "trusted",
  }
  assert.equal(resolveBundledFilesystemConfig(versioned, { entryPath: entry }), versioned)

  const other: McpStdioServerConfig = {
    transport: "stdio",
    command: "echo",
    enabled: true,
    trust_level: "trusted",
  }
  assert.equal(resolveBundledFilesystemConfig(other, { entryPath: entry }), other)
  assert.equal(resolveBundledFilesystemConfig(config, { entryPath: entry, exists: () => false }), config)
})

test("official filesystem connects and reads a file through the bundled Node entry", { timeout: 30_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-mcp-bundled-"))
  const emptyPath = path.join(root, "empty-path")
  fs.mkdirSync(emptyPath)
  fs.writeFileSync(path.join(root, "owned.txt"), "owned-body\n")
  const previousPath = process.env.PATH
  process.env.PATH = emptyPath
  const client = new McpClient("filesystem", {
    ...defaultFilesystemServerConfig(process.platform, root),
    startup_timeout_ms: 20_000,
  })

  try {
    await client.connect()
    assert.equal(client.connection.status, "connected")
    assert.ok(client.getMeta().tools.some(tool => tool.name === "read_text_file"))
    const result = await client.callTool("read_text_file", { path: path.join(root, "owned.txt") })
    assert.equal(result.isError, false)
    assert.ok(JSON.stringify(result).includes("owned-body"))
  } finally {
    await client.close().catch(() => {})
    process.env.PATH = previousPath
    fs.rmSync(root, { recursive: true, force: true })
  }
})
