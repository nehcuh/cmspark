// Bridge module tests
// Tests for tab-resolver.ts and tool-definitions.ts

import test from "node:test"
import assert from "node:assert/strict"
import { resolveTargetTab } from "../src/bridge/tab-resolver.js"
import { getToolDefinitions } from "../src/bridge/tool-definitions.js"

test("tab-resolver: explicit returns explicit tabId when valid", () => {
  const tab = (id: number, url: string, title: string, active = false, index = 0) => ({
    id,
    url,
    title,
    active,
    index,
    status: "complete" as const,
  })

  const tabs = [tab(1, "https://example.com", "Example"), tab(2, "https://google.com", "Google")]
  const result = resolveTargetTab(tabs, [], "test query", 2)

  assert.equal(result.tabId, 2)
  assert.equal(result.matched, "explicit")
})

test("tab-resolver: explicit ignores invalid explicit tabId and falls back to pinned", () => {
  const tab = (id: number, url: string, title: string, active = false, index = 0) => ({
    id,
    url,
    title,
    active,
    index,
    status: "complete" as const,
  })

  const tabs = [tab(1, "https://example.com", "Example"), tab(2, "https://google.com", "Google", true)]
  const result = resolveTargetTab(tabs, [2], "test query", 999)

  assert.equal(result.tabId, 2)
  assert.equal(result.matched, "pinned")
})

test("tab-resolver: pinned returns first available pinned tab", () => {
  const tab = (id: number, url: string, title: string, active = false, index = 0) => ({
    id,
    url,
    title,
    active,
    index,
    status: "complete" as const,
  })

  const tabs = [
    tab(1, "https://example.com", "Example"),
    tab(2, "https://google.com", "Google", true),
    tab(3, "https://github.com", "GitHub"),
  ]
  const result = resolveTargetTab(tabs, [3, 1], "test query")

  assert.equal(result.tabId, 3)
  assert.equal(result.matched, "pinned")
})

test("tab-resolver: pinned skips pinned tabs that no longer exist", () => {
  const tab = (id: number, url: string, title: string, active = false, index = 0) => ({
    id,
    url,
    title,
    active,
    index,
    status: "complete" as const,
  })

  const tabs = [tab(1, "https://example.com", "Example", true)]
  const result = resolveTargetTab(tabs, [999, 888], "test query")

  assert.equal(result.tabId, 1)
  assert.equal(result.matched, "active")
})

test("tab-resolver: active returns active tab when query is relevant", () => {
  const tab = (id: number, url: string, title: string, active = false, index = 0) => ({
    id,
    url,
    title,
    active,
    index,
    status: "complete" as const,
  })

  const tabs = [
    tab(1, "https://other.com", "Some Site"),
    tab(2, "https://example.com", "Example Page", true, 1),
  ]
  const result = resolveTargetTab(tabs, [], "example page")

  assert.equal(result.tabId, 2)
  assert.equal(result.matched, "active")
})

test("tab-resolver: active returns active tab for short query", () => {
  const tab = (id: number, url: string, title: string, active = false, index = 0) => ({
    id,
    url,
    title,
    active,
    index,
    status: "complete" as const,
  })

  const tabs = [tab(1, "https://example.com", "Example", true)]
  const result = resolveTargetTab(tabs, [], "hi")

  assert.equal(result.tabId, 1)
  assert.equal(result.matched, "active")
})

test("tab-resolver: semantic searches tabs in reverse open order", () => {
  const tab = (id: number, url: string, title: string, active = false, index = 0) => ({
    id,
    url,
    title,
    active,
    index,
    status: "complete" as const,
  })

  const tabs = [
    tab(1, "https://example.com", "Example Page", false, 0),
    tab(2, "https://google.com", "Google Search", true, 1),
    tab(3, "https://github.com", "GitHub Repository", false, 2),
  ]
  const result = resolveTargetTab(tabs, [], "github code repository")

  assert.equal(result.tabId, 3)
  assert.equal(result.matched, "semantic")
})

test("tab-resolver: semantic matches keywords in tab URL", () => {
  const tab = (id: number, url: string, title: string, active = false, index = 0) => ({
    id,
    url,
    title,
    active,
    index,
    status: "complete" as const,
  })

  const tabs = [
    tab(1, "https://example.com", "Unrelated", true, 0),
    tab(2, "https://github.com/user/cmspark", "Some Repo", false, 1),
  ]
  const result = resolveTargetTab(tabs, [], "cmspark")

  assert.equal(result.tabId, 2)
  assert.equal(result.matched, "semantic")
})

test("tab-resolver: semantic handles Chinese query with bigrams", () => {
  const tab = (id: number, url: string, title: string, active = false, index = 0) => ({
    id,
    url,
    title,
    active,
    index,
    status: "complete" as const,
  })

  const tabs = [
    tab(1, "https://example.com", "Example", true, 0),
    tab(2, "https://bilibili.com", "哔哩哔哩 B站", false, 1),
  ]
  const result = resolveTargetTab(tabs, [], "打开哔哩哔哩")

  // "哔哩哔哩" has high keyword match rate
  assert.equal(result.tabId, 2)
  assert.equal(result.matched, "semantic")
})

test("tab-resolver: fallback returns active tab when not relevant", () => {
  const tab = (id: number, url: string, title: string, active = false, index = 0) => ({
    id,
    url,
    title,
    active,
    index,
    status: "complete" as const,
  })

  const tabs = [
    tab(1, "https://example.com", "Example Site", false, 0),
    tab(2, "https://google.com", "Google", true, 1),
  ]
  const result = resolveTargetTab(tabs, [], "some unrelated query xyz")

  assert.equal(result.tabId, 2)
  assert.equal(result.matched, "active")
})

test("tab-resolver: fallback returns first tab when no active tab exists", () => {
  const tab = (id: number, url: string, title: string, active = false, index = 0) => ({
    id,
    url,
    title,
    active,
    index,
    status: "complete" as const,
  })

  const tabs = [tab(1, "https://example.com", "Example"), tab(2, "https://google.com", "Google")]
  const result = resolveTargetTab(tabs, [], "test query")

  assert.equal(result.tabId, 1)
  assert.equal(result.matched, "active")
})

test("tab-resolver: throws error when no tabs available", () => {
  assert.throws(() => resolveTargetTab([], [], "test"), /No tabs available/)
})

test("tab-resolver: keyword matching ignores stop words", () => {
  const tab = (id: number, url: string, title: string, active = false, index = 0) => ({
    id,
    url,
    title,
    active,
    index,
    status: "complete" as const,
  })

  const tabs = [
    tab(1, "https://other.com", "Unrelated Site", true, 0),
    tab(2, "https://github.com", "GitHub code repository", false, 1),
  ]
  const result = resolveTargetTab(tabs, [], "github code repository")

  // Active tab is not relevant, falls back to semantic matching
  assert.equal(result.tabId, 2)
  assert.equal(result.matched, "semantic")
})

test("tab-resolver: keyword matching 30% threshold for relevance", () => {
  const tab = (id: number, url: string, title: string, active = false, index = 0) => ({
    id,
    url,
    title,
    active,
    index,
    status: "complete" as const,
  })

  const tabs = [
    tab(1, "https://example.com", "Example with many words here", true, 0),
    tab(2, "https://github.com", "GitHub", false, 1),
  ]
  const result = resolveTargetTab(tabs, [], "example with other stuff")

  assert.equal(result.tabId, 1)
  assert.equal(result.matched, "active")
})

// Tool definitions tests
test("tool-definitions: returns non-empty array", () => {
  const tools = getToolDefinitions()
  assert.ok(Array.isArray(tools))
  assert.ok(tools.length > 0)
})

test("tool-definitions: includes all tab tools", () => {
  const tools = getToolDefinitions()
  const toolNames = tools.map((t: any) => t.function.name)

  assert.ok(toolNames.includes("list_tabs"))
  assert.ok(toolNames.includes("create_tab"))
  assert.ok(toolNames.includes("close_tab"))
  assert.ok(toolNames.includes("navigate"))
  assert.ok(toolNames.includes("screenshot"))
})

test("tool-definitions: includes all page read tools", () => {
  const tools = getToolDefinitions()
  const toolNames = tools.map((t: any) => t.function.name)

  assert.ok(toolNames.includes("get_page_text"))
  assert.ok(toolNames.includes("get_page_html"))
  assert.ok(toolNames.includes("get_element_info"))
})

test("tool-definitions: includes all page interaction tools", () => {
  const tools = getToolDefinitions()
  const toolNames = tools.map((t: any) => t.function.name)

  assert.ok(toolNames.includes("click"))
  assert.ok(toolNames.includes("dblclick"))
  assert.ok(toolNames.includes("type"))
  assert.ok(toolNames.includes("fill_form"))
  assert.ok(toolNames.includes("scroll"))
  assert.ok(toolNames.includes("press_key"))
  assert.ok(toolNames.includes("hover"))
  assert.ok(toolNames.includes("select_option"))
  assert.ok(toolNames.includes("drag_and_drop"))
})

test("tool-definitions: includes advanced tools", () => {
  const tools = getToolDefinitions()
  const toolNames = tools.map((t: any) => t.function.name)

  assert.ok(toolNames.includes("wait_for"))
  assert.ok(toolNames.includes("evaluate"))
})

test("tool-definitions: includes cookie tools", () => {
  const tools = getToolDefinitions()
  const toolNames = tools.map((t: any) => t.function.name)

  assert.ok(toolNames.includes("get_cookies"))
  assert.ok(toolNames.includes("set_cookie"))
  assert.ok(toolNames.includes("delete_cookie"))
  assert.ok(toolNames.includes("list_all_cookies"))
})

test("tool-definitions: includes companion direct tools", () => {
  const tools = getToolDefinitions()
  const toolNames = tools.map((t: any) => t.function.name)

  assert.ok(toolNames.includes("use_skill"))
  assert.ok(toolNames.includes("osascript_eval"))
  assert.ok(toolNames.includes("record_experience"))
})

test("tool-definitions: each tool has required OpenAI function-calling format", () => {
  const tools = getToolDefinitions()

  tools.forEach((tool: any) => {
    assert.equal(tool.type, "function")
    assert.ok(tool.function)
    assert.ok(tool.function.name)
    assert.ok(tool.function.description)
    assert.equal(tool.function.parameters.type, "object")
    assert.ok(tool.function.parameters.properties)
  })
})

test("tool-definitions: list_tabs has no required parameters", () => {
  const tools = getToolDefinitions()
  const listTabs = tools.find((t: any) => t.function.name === "list_tabs")

  assert.ok(listTabs)
  assert.deepEqual(listTabs.function.parameters.required, [])
})

test("tool-definitions: create_tab requires url parameter", () => {
  const tools = getToolDefinitions()
  const createTab = tools.find((t: any) => t.function.name === "create_tab")

  assert.ok(createTab)
  assert.ok(createTab.function.parameters.required.includes("url"))
  assert.equal(createTab.function.parameters.properties.url.type, "string")
})

test("tool-definitions: evaluate requires tabId and code", () => {
  const tools = getToolDefinitions()
  const evaluate = tools.find((t: any) => t.function.name === "evaluate")

  assert.ok(evaluate)
  assert.ok(evaluate.function.parameters.required.includes("tabId"))
  assert.ok(evaluate.function.parameters.required.includes("code"))
})

test("tool-definitions: wait_for has enum for state parameter", () => {
  const tools = getToolDefinitions()
  const waitFor = tools.find((t: any) => t.function.name === "wait_for")

  assert.ok(waitFor)
  assert.deepEqual(waitFor.function.parameters.properties.state.enum, ["visible", "hidden"])
})

test("tool-definitions: record_experience has enum for target and category", () => {
  const tools = getToolDefinitions()
  const recordExperience = tools.find((t: any) => t.function.name === "record_experience")

  assert.ok(recordExperience)
  assert.deepEqual(recordExperience.function.parameters.properties.target.enum, ["site", "domain"])
  assert.deepEqual(recordExperience.function.parameters.properties.category.enum, ["problem", "success", "tip", "rule"])
})
