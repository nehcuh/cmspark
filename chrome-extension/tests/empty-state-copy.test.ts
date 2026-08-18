import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { emptyStateCopy } from "../src/sidepanel/empty-state-copy"

test("S0.1 D″: L0 empty has no page-operate invitation", () => {
  const copy = emptyStateCopy("chat")
  const blob = `${copy.title}\n${copy.hint}\n${copy.items.map((i) => i.label).join("\n")}`
  assert.match(copy.title, /要我帮你做什么/)
  assert.match(copy.hint, /描述任务/)
  assert.ok(!/当前打开的页面/.test(blob))
  assert.ok(!/操作当前标签/.test(blob))
  assert.ok(!/随便聊/.test(blob))
  assert.ok(copy.items.some((i) => i.label.includes("起草")))
  assert.ok(copy.items.some((i) => i.label.includes("装配") && i.label.includes("技能")))
})

test("S0.1 D″: L1 empty is the page-task surface", () => {
  const copy = emptyStateCopy("browser")
  assert.match(copy.title, /这页/)
  assert.match(copy.hint, /操作当前标签/)
  assert.ok(copy.items.some((i) => i.label.includes("当前打开的页面")))
})

test("S0.1: L2 empty points at 确认台", () => {
  const copy = emptyStateCopy("computer")
  assert.match(copy.title, /确认台/)
  assert.ok(copy.items.some((i) => i.kind === "action" && i.action === "cockpit"))
})

test("S2.1 EmptyState consumes emptyStateCopy only", () => {
  const src = readFileSync(
    join(process.cwd(), "src/sidepanel/components/ChatView.tsx"),
    "utf8",
  )
  const emptyFn = src.slice(src.indexOf("function EmptyState"), src.indexOf("const markdownCSS"))
  assert.match(emptyFn, /emptyStateCopy\(level\)/)
  assert.ok(!/畅所欲问/.test(emptyFn))
  assert.ok(!/接下来想做什么/.test(emptyFn))
})
