// #502 slice E Task 2 — Glance 一行最近工具。
//
// 契约（plan 2026-09-18-502-e-fleet-inspect Task 2 / spec §6）：
//  - FleetStrip meta 行在「N 锁」后追加 `角色:工具名`（例 `抓取:get_page_text`）。
//  - 有 llm_active 的 worker 优先；否则取最后一只带 latest_tool 的。
//  - 没有 latest_tool → 文案完全不变（不加空段）。
//  - 仍然一行（styles.meta 的 nowrap/ellipsis 纪律，FocusBand ≤80px）。
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fleetGlanceLatestToolLabel } from "../src/sidepanel/components/focus-band-priority"

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")

test("glance label prefers the llm_active worker's latest_tool", () => {
  const label = fleetGlanceLatestToolLabel([
    { id: "w1", alias: "a1", worker_role_label: "检索", latest_tool: "search_knowledge" },
    { id: "w2", alias: "a2", worker_role_label: "抓取", latest_tool: "get_page_text", llm_active: true },
  ])
  assert.equal(label, "抓取:get_page_text")
})

test("without llm_active, the last worker with latest_tool wins", () => {
  const label = fleetGlanceLatestToolLabel([
    { id: "w1", alias: "a1", worker_role_label: "抓取", latest_tool: "get_page_text" },
    { id: "w2", alias: "a2", worker_role_label: "总结", latest_tool: "screenshot" },
  ])
  assert.equal(label, "总结:screenshot")
})

test("falls back to alias when worker_role_label is missing", () => {
  const label = fleetGlanceLatestToolLabel([
    { id: "w1", alias: "collector", latest_tool: "click" },
  ])
  assert.equal(label, "collector:click")
})

test("no latest_tool anywhere → empty string (meta line unchanged)", () => {
  assert.equal(
    fleetGlanceLatestToolLabel([{ id: "w1", alias: "a1", llm_active: true }]),
    "",
  )
  assert.equal(fleetGlanceLatestToolLabel([]), "")
  // llm_active but tool-less must not beat a later tool-bearing worker
  assert.equal(
    fleetGlanceLatestToolLabel([
      { id: "w1", alias: "a1", llm_active: true },
      { id: "w2", alias: "a2", latest_tool: "navigate" },
    ]),
    "a2:navigate",
  )
})

test("#502 E FleetStrip wires the glance suffix into the one-line meta", () => {
  const src = read("src/sidepanel/components/FleetStrip.tsx")
  // helper consumed at the meta span — the suffix must be part of that one span
  assert.match(src, /fleetGlanceLatestToolLabel\(/)
  const metaIdx = src.indexOf('style={styles.meta}')
  assert.ok(metaIdx > 0, "meta span must exist")
  const metaBlock = src.slice(metaIdx, src.indexOf("</span>", metaIdx))
  assert.match(metaBlock, /\{glanceTool \? `/ , "glance suffix must render inside the meta span")
  // no new row: the strip keeps a single meta span (no extra blocks added)
  assert.ok(!src.includes("glanceRow"), "glance must stay on the existing meta line")
})

test("#502 E FleetWorkerView type carries latest_tool from the companion snapshot", () => {
  const types = read("src/sidepanel/types.ts")
  assert.match(types, /latest_tool\?:\s*string/)
})
