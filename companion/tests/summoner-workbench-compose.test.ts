/**
 * Overlay B1–B4 — packs / MCP toggle / skills / knowledge USE+import.
 * Companion-owned; overlay WS does not grow mcp.add or knowledge.import.
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { assertSummonerAllowed, applySummonerPayloadPolicy } from "../src/ws/summoner-acl"
import {
  encodeSummonerPackApply,
  encodeSummonerMcpToggle,
  encodeSummonerMcpAdd,
  encodeSummonerSkillToggle,
  encodeSummonerKnowledgeAttach,
  encodeSummonerKnowledgeImport,
  encodeSummonerMcpServers,
  encodeSummonerSkills,
  encodeSummonerKnowledge,
  decodeSummonerInbound,
  decodeSummonerOutbound,
} from "../src/summoner/protocol"
import { SUMMONER_WEB_DISPATCH_ALLOW } from "../src/summoner-web"
import { SUMMONER_RAIL_LIST_CAP } from "../src/summoner/protocol"

const ROOT = path.resolve(__dirname, "..", "..")
function srcFile(...parts: string[]): string {
  const candidates = [
    path.join(ROOT, "src", ...parts),
    path.join(__dirname, "..", "src", ...parts),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]
}

test("summoner ACL allows composition reads + overlay-safe writes; T3 mutates stay off WS", () => {
  for (const t of [
    "pack.list",
    "pack.apply",
    "mcp.list",
    "mcp.toggle_server",
    "skill.list",
    "skill.activate",
    "skill.deactivate",
    "knowledge.list",
    "knowledge.set_active",
  ]) {
    assert.equal(assertSummonerAllowed("summoner", t).ok, true, t)
  }
  for (const t of ["mcp.add", "knowledge.import", "knowledge.preview", "config.set", "skill.delete"]) {
    const r = assertSummonerAllowed("summoner", t)
    assert.equal(r.ok, false, t)
    assert.equal(r.error_code, "SUMMONER_ACL")
  }
})

test("knowledge.set_active overlay policy keeps only thread_id + string ids", () => {
  const msg: Record<string, unknown> = {
    type: "knowledge.set_active",
    thread_id: "t1",
    ids: ["k1", 2, "k2"],
    tool_whitelist: null,
  }
  const ok = applySummonerPayloadPolicy("summoner", msg)
  assert.equal(ok.ok, true)
  assert.deepEqual(msg.ids, ["k1", "k2"])
  assert.equal(Object.prototype.hasOwnProperty.call(msg, "tool_whitelist"), false)

  assert.equal(
    applySummonerPayloadPolicy("summoner", { type: "knowledge.set_active", ids: ["k1"] }).ok,
    false,
  )
})

test("workbench inbound events round-trip; mcp.add/knowledge.import are stdin-only", () => {
  const pack = encodeSummonerPackApply({ pack_id: "p1" })
  assert.deepEqual(decodeSummonerInbound(pack), pack)

  const tog = encodeSummonerMcpToggle({ name: "fs", enabled: false })
  assert.deepEqual(decodeSummonerInbound(tog), tog)

  const add = encodeSummonerMcpAdd({ name: "demo", command: "npx" })
  assert.deepEqual(decodeSummonerInbound(add), add)
  assert.equal(decodeSummonerInbound({ type: "summoner.mcp.add", name: "", command: "x" }), null)

  const sk = encodeSummonerSkillToggle({ name: "demo", on: true })
  assert.deepEqual(decodeSummonerInbound(sk), sk)

  const kn = encodeSummonerKnowledgeAttach({ id: "doc-1" })
  assert.deepEqual(decodeSummonerInbound(kn), kn)

  const imp = encodeSummonerKnowledgeImport({
    name: "note.md",
    mime: "text/plain",
    content: "YQ==",
  })
  assert.deepEqual(decodeSummonerInbound(imp), imp)
})

test("workbench outbound lists round-trip", () => {
  const mcp = encodeSummonerMcpServers({
    servers: [{ name: "fs", enabled: true, transport: "stdio" }],
  })
  assert.deepEqual(decodeSummonerOutbound(mcp), mcp)
  const skills = encodeSummonerSkills({ skills: [{ name: "s1", title: "S1", on: false }] })
  assert.deepEqual(decodeSummonerOutbound(skills), skills)
  const docs = encodeSummonerKnowledge({
    docs: [{ id: "k1", title: "K1", attached: true }],
  })
  assert.deepEqual(decodeSummonerOutbound(docs), docs)
})

test("menu-bar maps compose stdin to overlay-safe / tray-origin paths", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  assert.match(src, /handleSummonerPackApply/)
  assert.match(src, /handleSummonerMcpToggle/)
  assert.match(src, /handleSummonerMcpAdd/)
  assert.match(src, /handleSummonerSkillToggle/)
  assert.match(src, /handleSummonerKnowledgeAttach/)
  assert.match(src, /listThreads\(\)/)
  assert.match(src, /active_skill_ids/)
  assert.match(src, /active_knowledge_ids/)
  assert.match(src, /security.confirmation.request/)
  assert.match(src, /showConfirmDialog/)
  assert.match(src, /handleSummonerKnowledgeImport/)
  assert.match(src, /companionClient\.sendAppRequest\(\s*"mcp\.add"/)
  assert.match(src, /companionClient\.sendAppRequest\("knowledge\.import"/)
  const imp = src.slice(src.indexOf("handleSummonerKnowledgeImport"), src.indexOf("handleSummonerKnowledgeImport") + 900)
  assert.match(imp, /content,/)
  assert.doesNotMatch(imp, /file:\s*\{/)
  assert.doesNotMatch(src, /summonerClient\.sendAppRequest\("mcp\.add"/)
  assert.doesNotMatch(src, /summonerClient\.sendAppRequest\("knowledge\.import"/)
})

test("HUD workbench rails are live for packs/mcp/skills/knowledge", () => {
  const overlay = fs.readFileSync(srcFile("tray", "SummonerOverlay.swift"), "utf8")
  const tray = fs.readFileSync(srcFile("tray", "Tray.swift"), "utf8")
  assert.match(overlay, /summoner\.pack\.apply/)
  assert.match(overlay, /summoner\.mcp\.toggle/)
  assert.match(overlay, /summoner\.skill\.toggle/)
  assert.match(overlay, /summoner\.knowledge\.attach/)
  assert.match(overlay, /summoner\.knowledge\.import/)
  assert.match(overlay, /summoner\.mcp\.add/)
  assert.match(overlay, /func applyPacks/)
  assert.match(overlay, /func applyMcpServers|applyMcp\(/)
  assert.doesNotMatch(overlay, /这一类下一刀开放/)
  // Allow/Deny as *actions* only. Status copy 确认台 / 需要确认 / 打开确认台 is chrome-ok.
  assert.doesNotMatch(overlay, /允许|拒绝|Allow|Deny/)
  for (const allowed of ["确认台", "需要确认", "打开确认台"]) {
    assert.equal(/允许|拒绝|Allow|Deny/.test(allowed), false, allowed)
  }
  assert.match(tray, /summoner\.mcp\.servers/)
  assert.match(tray, /summoner\.skills/)
  assert.match(tray, /summoner\.knowledge/)
})

test("HUD list rail scrolls and shares SUMMONER_RAIL_LIST_CAP with tray push", () => {
  assert.equal(SUMMONER_RAIL_LIST_CAP, 64)
  const overlay = fs.readFileSync(srcFile("tray", "SummonerOverlay.swift"), "utf8")
  const agent = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  assert.match(overlay, /listScroll\.documentView = tStack/)
  assert.match(overlay, /hasVerticalScroller = true/)
  assert.match(overlay, /listCol\.heightAnchor\.constraint\(equalTo: workbench\.heightAnchor\)/)
  assert.doesNotMatch(overlay, /prefix\(12\)/)
  assert.match(overlay, /prefix\(64\)/)
  assert.match(agent, /SUMMONER_RAIL_LIST_CAP/)
  assert.doesNotMatch(agent, /hitsFromTitleSearch\(threads\)\.slice\(0,\s*8\)/)
})

test("Swift knowledge import fail-closes on non-UTF-8 (no base64 body)", () => {
  const overlay = fs.readFileSync(srcFile("tray", "SummonerOverlay.swift"), "utf8")
  const start = overlay.indexOf("func knowledgeImportClicked")
  assert.ok(start >= 0, "knowledgeImportClicked missing")
  const next = overlay.indexOf("\n  func ", start + 1)
  const body = overlay.slice(start, next > start ? next : start + 1200)
  assert.match(body, /只支持文本知识（md\/txt）/)
  assert.match(body, /String\(data: data, encoding: \.utf8\)/)
  assert.doesNotMatch(body, /base64EncodedString/)
})

test("C-thin HTML compose endpoints stay off mcp.add/knowledge.import", () => {
  assert.ok(SUMMONER_WEB_DISPATCH_ALLOW.has("pack.apply"))
  assert.ok(SUMMONER_WEB_DISPATCH_ALLOW.has("mcp.toggle_server"))
  assert.ok(SUMMONER_WEB_DISPATCH_ALLOW.has("skill.list"))
  assert.ok(SUMMONER_WEB_DISPATCH_ALLOW.has("knowledge.list"))
  assert.ok(SUMMONER_WEB_DISPATCH_ALLOW.has("knowledge.set_active"))
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("mcp.add"), false)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("knowledge.import"), false)
  const web = fs.readFileSync(srcFile("summoner-web.ts"), "utf8")
  assert.match(web, /mcp\.toggle_server/)
  assert.match(web, /knowledge\.set_active/)
  assert.match(web, /skill\.activate/)
  assert.match(web, /data-sec="packs"/)
  assert.match(web, /\/api\/packs/)
  assert.match(web, /\/api\/mcp/)
  assert.match(web, /\/api\/skills/)
  assert.match(web, /\/api\/knowledge/)
})

test("PR-C: MCP rail icon isHidden without deleting summoner.mcp.add", () => {
  const overlay = fs.readFileSync(srcFile("tray", "SummonerOverlay.swift"), "utf8")
  const web = fs.readFileSync(srcFile("summoner-web.ts"), "utf8")
  assert.match(overlay, /summoner\.mcp\.toggle/)
  assert.match(overlay, /summoner\.mcp\.add/)
  assert.match(overlay, /mcpAddClicked/)
  const railStart = overlay.indexOf("let railSpecs")
  const railEnd = overlay.indexOf("let listCol")
  assert.ok(railStart >= 0 && railEnd > railStart, "railSpecs loop missing")
  const rail = overlay.slice(railStart, railEnd)
  assert.match(rail, /"MCP", 4/)
  assert.match(rail, /isHidden/)
  const mcpList = overlay.slice(overlay.indexOf("func refreshMcpList"), overlay.indexOf("func refreshSkillList"))
  const knList = overlay.slice(
    overlay.indexOf("func refreshKnowledgeList"),
    overlay.indexOf("func tintRailButtons"),
  )
  assert.match(mcpList, /＋ 添加 MCP/)
  assert.match(mcpList, /isHidden\s*=\s*true/)
  assert.match(knList, /＋ 导入知识/)
  assert.match(knList, /isHidden\s*=\s*true/)
  assert.match(overlay, /railSection = 0/)
  assert.match(web, /data-sec="mcp"[^>]*\bhidden\b/)
  assert.match(web, /data-sec="threads"[^>]*aria-current="true"/)
  assert.ok(SUMMONER_WEB_DISPATCH_ALLOW.has("mcp.toggle_server"))
  assert.ok(SUMMONER_WEB_DISPATCH_ALLOW.has("skill.activate"))
})
