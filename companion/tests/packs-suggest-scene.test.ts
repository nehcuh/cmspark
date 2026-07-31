import test from "node:test"
import assert from "node:assert/strict"
import {
  heuristicSuggestScene,
  parseSceneSuggestion,
  suggestSceneConfig,
} from "../src/packs/suggest-scene"

test("parseSceneSuggestion keeps only allowlisted ids", () => {
  const raw = JSON.stringify({
    skill_ids: ["browse", "evil-invented", "demo-research"],
    mcp_server_ids: ["filesystem", "nope"],
    system_prompt_append: "你是助手",
    rationale_zh: "匹配研究",
  })
  const parsed = parseSceneSuggestion(raw, ["browse", "demo-research"], ["filesystem"], {
    source: "llm",
  })
  assert.ok(parsed)
  assert.deepEqual(parsed!.skill_ids, ["browse", "demo-research"])
  assert.deepEqual(parsed!.mcp_server_ids, ["filesystem"])
  assert.equal(parsed!.system_prompt_append, "你是助手")
  assert.equal(parsed!.source, "llm")
})

test("parseSceneSuggestion accepts fenced JSON and alternate keys", () => {
  const raw = "```json\n" + JSON.stringify({ skills: ["a"], mcp: ["m1"], rationale: "ok" }) + "\n```"
  const parsed = parseSceneSuggestion(raw, ["a", "b"], ["m1", "m2"])
  assert.ok(parsed)
  assert.deepEqual(parsed!.skill_ids, ["a"])
  assert.deepEqual(parsed!.mcp_server_ids, ["m1"])
  assert.equal(parsed!.rationale_zh, "ok")
})

test("parseSceneSuggestion returns null on garbage", () => {
  assert.equal(parseSceneSuggestion("not json at all", ["a"], ["b"]), null)
})

test("heuristicSuggestScene ranks by keyword overlap", () => {
  const s = heuristicSuggestScene({
    brief: "网页安全审查 威胁建模 STRIDE checklist",
    skills: [
      { name: "threat-model", description: "STRIDE 威胁建模" },
      { name: "cooking", description: "菜谱与厨房" },
      { name: "page-audit", description: "网页安全 checklist" },
    ],
    mcp: [
      { name: "filesystem", description: "local files" },
      { name: "security-db", description: "安全审查 漏洞数据库" },
    ],
  })
  assert.equal(s.source, "heuristic")
  assert.ok(s.skill_ids.includes("threat-model"))
  assert.ok(s.skill_ids.includes("page-audit"))
  assert.ok(!s.skill_ids.includes("cooking"))
  assert.ok(s.mcp_server_ids.includes("security-db"))
})

test("suggestSceneConfig falls back to heuristic without llm", async () => {
  const s = await suggestSceneConfig({
    brief: "research 投研 报告",
    skills: [{ name: "demo-research", description: "投研 research helper" }],
    mcp: [{ name: "brave-search", description: "web search" }],
    llm: null,
  })
  assert.equal(s.source, "heuristic")
  assert.ok(s.skill_ids.includes("demo-research"))
})
