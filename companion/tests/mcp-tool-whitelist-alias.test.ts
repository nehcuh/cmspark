import test from "node:test"
import assert from "node:assert/strict"
import {
  isMcpToolAllowedByWhitelist,
  isFullAutonomyCruiseOpen,
  mcpServerIdsForWhitelistMatch,
  ThreadManager,
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

test("isFullAutonomyCruiseOpen requires all three flags", () => {
  assert.equal(isFullAutonomyCruiseOpen({}), false)
  assert.equal(
    isFullAutonomyCruiseOpen({
      auto_approve_dangerous: true,
      auto_approve_enterprise_tools: true,
      allow_all_schemes: false,
    }),
    false,
  )
  assert.equal(
    isFullAutonomyCruiseOpen({
      auto_approve_dangerous: true,
      auto_approve_enterprise_tools: true,
      allow_all_schemes: true,
    }),
    true,
  )
})

test("isToolAllowed: cruise expands restricted thread surface for non-workers", () => {
  const tm = new ThreadManager()
  const t = tm.create("cruise-wl")
  tm.update(t.id, { tool_whitelist: ["mcp__filesystem__*"] })

  assert.equal(tm.isToolAllowed(t.id, "list_tabs", { cruiseOpen: false }), false)
  assert.equal(tm.isToolAllowed(t.id, "mcp__filesystem__write_file", { cruiseOpen: false }), true)
  assert.equal(tm.isToolAllowed(t.id, "list_tabs", { cruiseOpen: true }), true)
  assert.equal(tm.isToolAllowed(t.id, "shell_exec", { cruiseOpen: true }), true)

  tm.update(t.id, { tool_whitelist: null })
  assert.equal(tm.isToolAllowed(t.id, "list_tabs", { cruiseOpen: false }), true)
})
