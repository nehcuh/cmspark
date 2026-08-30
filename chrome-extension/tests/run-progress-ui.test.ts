import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")

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

// --- Wave 1 测试锁（spec 2026-08-30-runprogress-sticky-collapse-design.md §2.6） ---

test("RunProgress defaults to collapsed; header is a button; checkboxes not in collapsed branch", () => {
  const rp = src("src/sidepanel/components/RunProgress.tsx")
  // 默认收起：组件内 useState(false)，不写 thread / storage
  assert.match(rp, /useState\(false\)/)
  assert.ok(!/sessionStorage|localStorage/.test(rp))
  // 标题行是 button 且带 aria-expanded / aria-controls
  assert.match(rp, /<button/)
  assert.match(rp, /aria-expanded=\{expanded\}/)
  assert.match(rp, /aria-controls=\{listId\}/)
  // 收起分支不渲染勾选列表（checkbox 只出现在展开分支）
  assert.match(rp, /!expanded\s*\?/)
  const collapsedBranch = rp.slice(rp.indexOf("!expanded ?"), rp.indexOf(") : ("))
  assert.ok(!/checkbox/.test(collapsedBranch))
  assert.ok(!/<ul/.test(collapsedBranch))
})

test("RunProgress collapse resets per thread via key at ChatView mount", () => {
  const chat = src("src/sidepanel/components/ChatView.tsx")
  assert.match(chat, /<RunProgress\s+key=\{activeThreadId\}/)
})

test("RunProgress root is sticky to the scroll column top with solid bg and low z-index", () => {
  const rp = src("src/sidepanel/components/RunProgress.tsx")
  assert.match(rp, /position:\s*"sticky"/)
  assert.match(rp, /top:\s*0/)
  assert.match(rp, /zIndex:\s*1\b/)
  assert.match(rp, /background:\s*tokens\.bgMuted/)
})

test("RunProgress exposes aria-current=step on the expanded current row", () => {
  const rp = src("src/sidepanel/components/RunProgress.tsx")
  assert.match(rp, /aria-current/)
  assert.match(rp, /"step"/)
  // 2px accent 左条（附加于 aria-current）
  assert.match(rp, /borderLeft:\s*`2px solid \$\{tokens\.accent\}`/)
})

test("RunProgress collapsed summary: n/m count, current-step ellipsis, draft fallback", () => {
  const rp = src("src/sidepanel/components/RunProgress.tsx")
  // n/m 计数（草稿计入分母）
  assert.match(rp, /doneCount\}\s*\/\s*\{total\}/)
  // 当前步 = 第一条 done!==true 且非草稿
  assert.match(rp, /it\.done\s*!==\s*true\s*&&\s*it\.source\s*!==\s*"model_draft"/)
  // 全勾完只剩草稿 → 「草稿 · {首条草稿}」
  assert.match(rp, /草稿 · /)
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
