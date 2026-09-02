import test from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

// #273 Wave A §3 / AC-6: 知识面板文案诚实 copy 扫描（含 tooltip/title/aria）
// Spec: docs/superpowers/specs/2026-09-02-knowledge-retrieval-scoring-design.md

const SRC_ROOT = join(process.cwd(), "src")

/** 递归收集 src 下全部 .ts/.tsx（无新依赖）。 */
function walkSource(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walkSource(full))
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

const src = readFileSync(
  join(SRC_ROOT, "sidepanel/components/KnowledgeSubPanel.tsx"),
  "utf8",
)

test("AC-6: dishonest '注入全部/所有知识索引' copy is gone from the whole extension src", () => {
  const offenders: string[] = []
  for (const file of walkSource(SRC_ROOT)) {
    const text = readFileSync(file, "utf8")
    if (text.includes("注入全部知识索引") || text.includes("注入所有知识索引")) {
      offenders.push(file)
    }
  }
  assert.deepEqual(offenders, [], "全 src 零命中（含 tooltip/title/aria 副本）")
})

test("AC-6: three mode hints use the honest spec wording", () => {
  assert.ok(src.includes("按这轮问题选相关知识；已钉的优先。当前站点加权。"), "auto modeHint")
  assert.ok(src.includes("在全库里检索，仍受条数/长度上限。"), "all modeHint")
  assert.ok(src.includes("只注入勾选的；超预算时从末尾截断并在芯片上可见。"), "manual modeHint")
})

test("AC-6: mode button tooltips are honest", () => {
  assert.ok(src.includes("按这轮问题选相关知识，当前站点加权"), "auto title")
  assert.ok(src.includes("在全库里检索，有总量上限"), "all title")
})

test("Wave A: 智能匹配 toggle exists and is honest when off", () => {
  assert.ok(src.includes("智能匹配"), "toggle label")
  assert.ok(src.includes("SET_KNOWLEDGE_SMART_MATCH"), "store action dispatch")
  assert.ok(src.includes("knowledge_smart_match"), "thread.update plumbing")
  assert.ok(src.includes("已关智能匹配"), "off state gets an honest hint suffix")
})
