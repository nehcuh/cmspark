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

// --- #273 Wave B（AC-16）：分布视图/簇路由新文案 copy 扫描（含 tooltip/title/aria） ---

const WAVE_B_FILES = [
  "sidepanel/components/KnowledgeSubPanel.tsx",
  "sidepanel/components/ChatView.tsx",
  "sidepanel/components/RetrievedSourcesChips.tsx",
  "sidepanel/utils/knowledge-distribution.ts",
]

// 禁词 = F-UX-NOUN-1 全表（图谱/双链/相关网络/第二大脑/会话关系图/孤立点/wiki…）
// + 「分类树 / 自动分类 / 簇 / 聚类 / 知识地图」；路由未过门不得宣称「精准匹配」。
const WAVE_B_BANNED = [
  "图谱",
  "双链",
  "相关网络",
  "第二大脑",
  "会话关系图",
  "孤立点",
  "类 Obsidian",
  "导出到 Obsidian",
  "分类树",
  "自动分类",
  "簇",
  "聚类",
  "知识地图",
  "精准匹配",
]

test("AC-16: banned words absent from all Wave B knowledge UI copy (incl. tooltip/title/aria)", () => {
  for (const rel of WAVE_B_FILES) {
    const text = readFileSync(join(SRC_ROOT, rel), "utf8")
    for (const word of WAVE_B_BANNED) {
      assert.ok(!text.includes(word), `${rel} must not contain banned word 「${word}」`)
    }
    assert.ok(!/wiki/i.test(text), `${rel} must not contain 「wiki」`)
  }
})

test("AC-16: 诚实句 + 「按堆选文」开关 + 超 cap 诚实文案都在面板上", () => {
  assert.ok(src.includes("KNOWLEDGE_DISTRIBUTION_HONESTY_COPY"), "诚实句引用")
  const util = readFileSync(join(SRC_ROOT, "sidepanel/utils/knowledge-distribution.ts"), "utf8")
  assert.ok(util.includes("自动分组，不准就移到文件夹。"), "诚实句逐字")
  assert.ok(util.includes("库超过 200 篇，未自动分组"), "超 cap 诚实文案逐字")
  assert.ok(src.includes("按堆选文"), "「按堆选文」开关")
  assert.ok(src.includes("knowledge_route_by_group"), "thread.update plumbing")
  assert.ok(src.includes("SET_KNOWLEDGE_ROUTE_BY_GROUP"), "store action dispatch")
  // 分布 chips 是过滤 chips（aria-pressed 切换），不是第三个视图 mode
  assert.ok(src.includes('aria-label="分布"'), "分布 chips 容器")
})

test("开闸轮（2026-09-03）: 「按堆选文」开关下方有可读的原理说明（tooltip 不够）", () => {
  const util = readFileSync(join(SRC_ROOT, "sidepanel/utils/knowledge-distribution.ts"), "utf8")
  // 原理说明逐字钉（禁词扫描由 AC-16 覆盖本文件）
  assert.ok(
    util.includes("开：先按你的文件夹与自动分组粗选候选，再按这轮问题在候选里精选"),
    "原理说明·开",
  )
  assert.ok(
    util.includes("「本轮附带」芯片会显示 N/M 与来源分组，分组概览占用注入上限并如实标注"),
    "原理说明·芯片口径与概览占位",
  )
  assert.ok(
    util.includes("关（默认）：直接按这轮问题在全库打分选文。匹配不到时自动退回普通匹配"),
    "原理说明·关与降级",
  )
  // 开关下方灰字引用（不是只挂 tooltip）
  assert.ok(src.includes("KNOWLEDGE_ROUTE_BY_GROUP_EXPLAIN_COPY"), "面板引用说明文案常量")
})

test("AC-18 copy: 分组概览两态标注与来源分组词（RetrievedSourcesChips）", () => {
  const chips = readFileSync(join(SRC_ROOT, "sidepanel/components/RetrievedSourcesChips.tsx"), "utf8")
  assert.ok(chips.includes("含分组概览"), "概览注入标注")
  assert.ok(chips.includes("未含分组概览"), "概览省略标注（groupmap_omitted 可识别）")
  assert.ok(chips.includes("来源分组"), "group_label 用户可见词「分组」")
  // Gate9 MAJOR-1: N/M 口径渲染（N=|S_post|、M=|S_pre|）
  assert.ok(chips.includes("本轮附带 {sources.length}"), "N 渲染")
  assert.ok(chips.includes("/${routing.m}"), "M 渲染")
  const chat = readFileSync(join(SRC_ROOT, "sidepanel/components/ChatView.tsx"), "utf8")
  assert.ok(chat.includes("RetrievedSourcesChips"), "ChatView 使用抽出的芯片组件")
})
