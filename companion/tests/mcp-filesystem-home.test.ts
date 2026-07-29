import test from "node:test"
import assert from "node:assert/strict"
import {
  mcpHomeDir,
  mcpHomeFileUri,
  isFilesystemAllowPathArg,
  ensureFilesystemAllowlist,
  defaultFilesystemServerConfig,
  MCP_FILESYSTEM_PACKAGE,
} from "../src/mcp/filesystem-home.js"
import type { McpStdioServerConfig } from "../src/mcp/types.js"

test("mcpHomeDir: win32 uses forward slashes", () => {
  assert.equal(mcpHomeDir("win32", "C:\\Users\\HuChen"), "C:/Users/HuChen")
})

test("mcpHomeDir: darwin keeps POSIX path", () => {
  assert.equal(mcpHomeDir("darwin", "/Users/huchen"), "/Users/huchen")
})

test("mcpHomeFileUri: windows and posix", () => {
  assert.equal(mcpHomeFileUri("win32", "C:/Users/HuChen"), "file:///C:/Users/HuChen")
  assert.equal(mcpHomeFileUri("darwin", "/Users/huchen"), "file:///Users/huchen")
})

test("isFilesystemAllowPathArg rejects package and flags", () => {
  assert.equal(isFilesystemAllowPathArg("-y"), false)
  assert.equal(isFilesystemAllowPathArg(MCP_FILESYSTEM_PACKAGE), false)
  assert.equal(isFilesystemAllowPathArg("C:/Users/x"), true)
  assert.equal(isFilesystemAllowPathArg("/Users/x"), true)
})

test("ensureFilesystemAllowlist injects home when missing", () => {
  const bare: McpStdioServerConfig = {
    transport: "stdio",
    command: "npx",
    args: ["-y", MCP_FILESYSTEM_PACKAGE],
    enabled: true,
    trust_level: "trusted",
  }
  const fixed = ensureFilesystemAllowlist("filesystem", bare, "win32", "C:\\Users\\HuChen") as McpStdioServerConfig
  assert.deepEqual(fixed.args, ["-y", MCP_FILESYSTEM_PACKAGE, "C:/Users/HuChen"])
  assert.equal(fixed.cwd, "C:/Users/HuChen")
  assert.equal(fixed.roots?.[0]?.uri, "file:///C:/Users/HuChen")
})

test("ensureFilesystemAllowlist is idempotent when path present", () => {
  const withPath: McpStdioServerConfig = {
    transport: "stdio",
    command: "npx",
    args: ["-y", MCP_FILESYSTEM_PACKAGE, "C:/Users/HuChen/Projects"],
    enabled: true,
    trust_level: "trusted",
  }
  const again = ensureFilesystemAllowlist("filesystem", withPath, "win32", "C:\\Users\\HuChen") as McpStdioServerConfig
  assert.deepEqual(again.args, withPath.args)
})

test("ensureFilesystemAllowlist respects existing roots", () => {
  const withRoots: McpStdioServerConfig = {
    transport: "stdio",
    command: "npx",
    args: ["-y", MCP_FILESYSTEM_PACKAGE],
    enabled: true,
    trust_level: "trusted",
    roots: [{ uri: "file:///D:/data", name: "data" }],
  }
  const again = ensureFilesystemAllowlist("filesystem", withRoots, "win32", "C:\\Users\\HuChen") as McpStdioServerConfig
  assert.deepEqual(again.args, withRoots.args)
  assert.equal(again.roots?.[0]?.uri, "file:///D:/data")
})

test("defaultFilesystemServerConfig: darwin home", () => {
  const cfg = defaultFilesystemServerConfig("darwin", "/Users/alice")
  assert.deepEqual(cfg.args, ["-y", MCP_FILESYSTEM_PACKAGE, "/Users/alice"])
  assert.equal(cfg.roots?.[0]?.uri, "file:///Users/alice")
})
