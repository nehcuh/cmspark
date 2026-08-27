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
