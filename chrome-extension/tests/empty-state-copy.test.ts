import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { emptyStateCopy } from "../src/sidepanel/empty-state-copy"
import {
  CHAT_SHELL_CHIPS,
  CHAT_SHELL_TITLE_NONE,
  CHAT_SHELL_PAGE_CHIP_PREFIX,
} from "../src/sidepanel/chat-shell-copy"

test("S0.1 D″: L0 empty has no page-operate invitation", () => {
  const copy = emptyStateCopy("chat")
  const blob = `${copy.title}\n${copy.hint}\n${copy.items.map((i) => i.label).join("\n")}\n${copy.pageChip ?? ""}`
  assert.match(copy.title, /要我帮你做什么/)
  assert.ok(!/起草/.test(blob))
  assert.ok(!/装配/.test(blob))
  assert.ok(copy.items.every((i) => i.kind === "fill"))
  assert.ok(!copy.items.some((i) => i.label.includes("起草")))
  assert.ok(!copy.items.some((i) => i.label.includes("装配")))
})

test("S0.1 D″: L1 empty is the page-task surface", () => {
  const copy = emptyStateCopy("browser", "某页")
  const blob = `${copy.title}\n${copy.hint}\n${copy.items.map((i) => i.label).join("\n")}\n${copy.pageChip ?? ""}`
  assert.match(copy.title, /要对这页做什么/)
  assert.equal(copy.items.length, 3)
  assert.deepEqual(
    copy.items.map((i) => i.label),
    CHAT_SHELL_CHIPS.map((c) => c.label),
  )
  assert.ok(copy.items.every((i) => i.kind === "fill"))
  assert.ok(blob.includes(`${CHAT_SHELL_PAGE_CHIP_PREFIX}某页`))
  assert.ok(!/正在看/.test(blob))
  for (const i of copy.items) {
    if (i.kind === "fill") assert.ok(!i.fill.includes("某页"))
  }
})

test("S0.1: L2 empty points at 确认台", () => {
  const copy = emptyStateCopy("computer")
  assert.equal(copy.title, CHAT_SHELL_TITLE_NONE)
  assert.match(copy.hint, /确认在确认台/)
  assert.ok(!copy.items.some((i) => i.kind === "action" && i.action === "cockpit"))
  assert.equal(copy.items.length, 0)
})

test("S2.1 EmptyState consumes emptyStateCopy only", () => {
  const src = readFileSync(
    join(process.cwd(), "src/sidepanel/components/ChatView.tsx"),
    "utf8",
  )
  const emptyFn = src.slice(src.indexOf("function EmptyState"), src.indexOf("const markdownCSS"))
  assert.match(emptyFn, /emptyStateCopy\(|chatShellEmpty\(/)
  assert.ok(!/畅所欲问/.test(emptyFn))
  assert.ok(!/接下来想做什么/.test(emptyFn))
  assert.match(emptyFn, /chrome\.tabs\.query\(\{\s*active:\s*true,\s*lastFocusedWindow:\s*true/)
  assert.match(emptyFn, /omitPage/)
  assert.ok(!/弹出对话框/.test(emptyFn))
  assert.ok(!/dangerouslySetInnerHTML/.test(emptyFn))
  assert.ok(!/chat\.create/.test(emptyFn))
  assert.ok(!/config\.set/.test(emptyFn))
  assert.ok(!/tabUrlCache/.test(emptyFn))
  assert.ok(!/whitelist/.test(emptyFn))
  assert.match(emptyFn, /fillComposer\(it\.fill\)|InvitationRows/)
  assert.match(emptyFn, /CompanionMark/)
})
