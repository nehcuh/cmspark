import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import {
  defaultExpanded,
  skipHeaderChrome,
  countNM,
  previewText,
  listSig,
} from "../src/sidepanel/components/run-progress-view"

const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")

test("defaultExpanded: 0 false, 1–3 true, 4–8 false", () => {
  assert.equal(defaultExpanded(0), false)
  assert.equal(defaultExpanded(1), true)
  assert.equal(defaultExpanded(3), true)
  assert.equal(defaultExpanded(4), false)
  assert.equal(defaultExpanded(8), false)
})

test("skipHeaderChrome only for a single seed|user row", () => {
  assert.equal(skipHeaderChrome([{ id: "a", text: "A", done: false, source: "seed" }]), true)
  assert.equal(skipHeaderChrome([{ id: "u", text: "U", done: false, source: "user" }]), true)
  assert.equal(skipHeaderChrome([{ id: "d", text: "D", done: false, source: "model_draft" }]), false)
  assert.equal(
    skipHeaderChrome([
      { id: "a", text: "A", done: false, source: "seed" },
      { id: "b", text: "B", done: false, source: "seed" },
    ]),
    false,
  )
})

test("countNM excludes drafts from n and m", () => {
  const items = [
    { id: "a", text: "A", done: true, source: "seed" as const },
    { id: "b", text: "B", done: false, source: "user" as const },
    { id: "c", text: "C", done: true, source: "model_draft" as const },
    { id: "d", text: "D", done: false, source: "model_draft" as const },
  ]
  assert.deepEqual(countNM(items), { n: 1, m: 2 })
})

test("previewText is first undone non-draft; drafts-only fallback", () => {
  assert.equal(
    previewText([
      { id: "a", text: "done", done: true, source: "seed" },
      { id: "b", text: "next", done: false, source: "seed" },
    ]),
    "next",
  )
  assert.equal(
    previewText([{ id: "d", text: "hint", done: false, source: "model_draft" }]),
    "草稿 · hint",
  )
  assert.equal(
    previewText([{ id: "a", text: "done", done: true, source: "seed" }]),
    null,
  )
})

test("ChatView imports and mounts RunProgress when items.length>0", () => {
  const chat = src("src/sidepanel/components/ChatView.tsx")
  assert.match(chat, /from ["']\.\/RunProgress["']/)
  assert.match(chat, /<RunProgress/)
  assert.match(chat, /items\.length\s*>\s*0/)
  const emptyFn = chat.slice(chat.indexOf("function EmptyState"), chat.indexOf("const markdownCSS"))
  // node-shims Assert has no doesNotMatch
  assert.ok(!/RunProgress/.test(emptyFn))
})

test("RunProgress copy is 本轮步骤 and drafts 草稿, not 进行中", () => {
  const rp = src("src/sidepanel/components/RunProgress.tsx")
  assert.match(rp, /本轮步骤/)
  assert.match(rp, /草稿/)
  assert.ok(!/进行中/.test(rp))
})

test("RunProgress does not import BoardPanel", () => {
  const rp = src("src/sidepanel/components/RunProgress.tsx")
  assert.ok(!/BoardPanel/.test(rp))
})

test("background forwards thread.run_progress.toggle for RunProgress", () => {
  const bg = src("src/background/index.ts")
  assert.match(bg, /case "thread\.run_progress\.toggle"/)
  assert.match(bg, /type:\s*["']thread\.run_progress\.toggle["']/)
})

// --- Wave 1 r2 源码锁（spec r2 · Task 2 RED until Task 3） ---

test("RunProgress uses defaultExpanded(items.length) not useState(false)", () => {
  const rp = src("src/sidepanel/components/RunProgress.tsx")
  assert.match(rp, /from ["']\.\/run-progress-view["']/)
  assert.match(rp, /defaultExpanded\(/)
  assert.ok(!/useState\(false\)/.test(rp))
  assert.ok(!/sessionStorage|localStorage/.test(rp))
  assert.match(rp, /aria-expanded=\{expanded\}/)
  const listStart = rp.indexOf("<ul id")
  assert.ok(listStart > 0, "expanded list marker <ul id missing")
  const collapsedBranch = rp.slice(rp.indexOf("!expanded"), listStart)
  assert.ok(!/type=["']checkbox["']/.test(collapsedBranch))
  assert.ok(!/<ul\b/.test(collapsedBranch))
})

test("RunProgress collapse resets per thread via key at ChatView mount", () => {
  const chat = src("src/sidepanel/components/ChatView.tsx")
  assert.match(chat, /listSig\(runItems\)/)
  assert.match(chat, /key=\{`\$\{activeThreadId\}:\$\{listSig\(runItems\)\}`\}/)
})

test("RunProgress wrap stays sticky; expanded ul has maxHeight", () => {
  const rp = src("src/sidepanel/components/RunProgress.tsx")
  assert.match(rp, /position:\s*["']sticky["']/)
  assert.match(rp, /top:\s*0/)
  assert.match(rp, /background:\s*tokens\.bgMuted/)
  assert.match(rp, /maxHeight:\s*["']min\(40vh,\s*240px\)["']/)
  assert.match(rp, /maxHeight:\s*["']min\(40vh,\s*240px\)["'],\s*\n\s*overflowY:\s*["']auto["']/)
  assert.ok(!/aria-current/.test(rp))
  assert.ok(!/当前步/.test(rp))
})

test("RunProgress count comes from countNM not items.length denominator", () => {
  const rp = src("src/sidepanel/components/RunProgress.tsx")
  assert.match(rp, /countNM\(/)
  assert.ok(!/doneCount\}\s*\/\s*\{total\}/.test(rp))
})

test("RunProgress skipHeaderChrome hides the chip on 1 item", () => {
  const rp = src("src/sidepanel/components/RunProgress.tsx")
  assert.match(rp, /skipHeaderChrome\(/)
})

test("RunProgress collapsed summary: n/m count, preview ellipsis, draft fallback", () => {
  const rp = src("src/sidepanel/components/RunProgress.tsx")
  // first undone non-draft via inline find; collapsed second line via previewText()
  assert.match(rp, /it\.done\s*!==\s*true\s*&&\s*it\.source\s*!==\s*"model_draft"/)
  assert.match(rp, /previewText\(/)
  // 收起第二行单行截断
  assert.match(rp, /whiteSpace:\s*"nowrap"/)
  assert.match(rp, /textOverflow:\s*"ellipsis"/)
})

test("RunProgress never copy: no 进行中 / 任务清单 / progress %, no motion, no scrollIntoView", () => {
  const rp = src("src/sidepanel/components/RunProgress.tsx")
  assert.ok(!/进行中/.test(rp))
  assert.ok(!/任务清单/.test(rp))
  assert.ok(!/进度|<progress|百分比/.test(rp))
  // prefers-reduced-motion：无高度动画、无 chevron 旋转（glyph 切换，不用 transform/transition）
  assert.ok(!/rotate/.test(rp))
  assert.ok(!/transition/.test(rp))
  // 滚动锚定：不为展开/收起新增 scrollIntoView 或滚动补偿
  assert.ok(!/scrollIntoView|scrollTop/.test(rp))
})

test("App.tsx chrome stack gains no RunProgress band", () => {
  const app = src("src/sidepanel/App.tsx")
  assert.ok(!/RunProgress/.test(app))
})

test("ChatView scrollPaddingTop is set on the scroller", () => {
  const chat = src("src/sidepanel/components/ChatView.tsx")
  assert.match(chat, /scrollPaddingTop/)
})

test("live density constants have not silently reverted to 44/28", () => {
  const rail = src("src/sidepanel/components/StatusRail.tsx")
  const scene = src("src/sidepanel/components/SceneStatusBar.tsx")
  const fb = src("src/sidepanel/components/focus-band-priority.ts")
  assert.match(rail, /minHeight:\s*48/)
  assert.match(scene, /maxHeight:\s*36/)
  assert.match(fb, /FOCUS_BAND_MAX_PX\s*=\s*80/)
  assert.ok(!/minHeight:\s*44/.test(rail))
})

test("listSig changes when texts change even if ids stay live:0", () => {
  const a = listSig([{ id: "live:0", text: "开列表" }, { id: "live:1", text: "点" }])
  const b = listSig([
    { id: "live:0", text: "开列表" },
    { id: "live:1", text: "点" },
    { id: "live:2", text: "标已读" },
  ])
  const c = listSig([{ id: "live:0", text: "别的" }, { id: "live:1", text: "点" }])
  // node-shims Assert has equal/notStrictEqual, not notEqual
  assert.notStrictEqual(a, b)
  assert.notStrictEqual(a, c)
  assert.equal(listSig([{ id: "live:0", text: "开列表" }]), listSig([{ id: "live:0", text: "开列表" }]))
  const doneTrue = [{ id: "live:0", text: "开列表", done: true }]
  const doneFalse = [{ id: "live:0", text: "开列表", done: false }]
  assert.equal(listSig(doneTrue), listSig(doneFalse))
})

test("ChatView keys RunProgress with listSig not first id only", () => {
  const cv = src("src/sidepanel/components/ChatView.tsx")
  assert.match(cv, /listSig\(runItems\)/)
  assert.doesNotMatch(cv, /<RunProgress key=\{activeThreadId\}/)
  assert.doesNotMatch(cv, /items\[0\]\?\.id/)
})

test("overlay/summoner sources do not paint 本轮步骤 checklist", () => {
  const summonerDir = join(process.cwd(), "..", "companion", "src", "summoner")
  const roots = [
    join(process.cwd(), "..", "companion", "src", "summoner-web.ts"),
    ...readdirSync(summonerDir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => join(summonerDir, f)),
  ]
  for (const p of roots) {
    assert.ok(existsSync(p), `missing ${p}`)
  }
  for (const p of roots) {
    const stripped = readFileSync(p, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
    assert.ok(!/本轮步骤/.test(stripped), p)
    assert.ok(!/run_progress/.test(stripped), p)
  }
})
