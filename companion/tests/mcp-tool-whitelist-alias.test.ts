import test from "node:test"
import assert from "node:assert/strict"
import {
  isMcpToolAllowedByWhitelist,
  mcpServerIdsForWhitelistMatch,
} from "../src/threads/thread-manager"

test("mcpServerIdsForWhitelistMatch: filesystem ↔ fs", () => {
  assert.deepEqual(mcpServerIdsForWhitelistMatch("filesystem").sort(), ["filesystem", "fs"].sort())
  assert.deepEqual(mcpServerIdsForWhitelistMatch("fs").sort(), ["filesystem", "fs"].sort())
  assert.deepEqual(mcpServerIdsForWhitelistMatch("brave-search"), ["brave-search"])
})

test("isMcpToolAllowedByWhitelist: mcp__fs__* allows mcp__filesystem__*", () => {
  const wl = ["mcp__fs__*"]
  assert.equal(isMcpToolAllowedByWhitelist(wl, "mcp__filesystem__list_allowed_directories"), true)
  assert.equal(isMcpToolAllowedByWhitelist(wl, "mcp__filesystem__write_file"), true)
  assert.equal(isMcpToolAllowedByWhitelist(wl, "mcp__other__x"), false)
})

test("isMcpToolAllowedByWhitelist: mcp__filesystem__* allows mcp__fs__*", () => {
  const wl = ["mcp__filesystem__*"]
  assert.equal(isMcpToolAllowedByWhitelist(wl, "mcp__fs__read_file"), true)
})

test("isMcpToolAllowedByWhitelist: mcp__* and exact and meta", () => {
  assert.equal(isMcpToolAllowedByWhitelist(["mcp__*"], "mcp__anything__t"), true)
  assert.equal(
    isMcpToolAllowedByWhitelist(
      ["mcp__filesystem__list_allowed_directories"],
      "mcp__filesystem__list_allowed_directories",
    ),
    true,
  )
  assert.equal(isMcpToolAllowedByWhitelist(["list_tabs"], "mcp_list_resources"), false)
  assert.equal(isMcpToolAllowedByWhitelist(["mcp_list_resources"], "mcp_list_resources"), true)
})
