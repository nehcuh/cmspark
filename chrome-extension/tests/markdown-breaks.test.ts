import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { marked } from "marked"
import { CHAT_MARKED_OPTIONS } from "../src/sidepanel/utils/markdown-gfm"

const chatView = fs.readFileSync(
  path.join(process.cwd(), "src/sidepanel/components/ChatView.tsx"),
  "utf8",
)
const packs = fs.readFileSync(
  path.join(process.cwd(), "src/sidepanel/components/PacksPanel.tsx"),
  "utf8",
)

test("ChatView marked uses GFM breaks (single newline → hard break)", () => {
  assert.equal(CHAT_MARKED_OPTIONS.breaks, true)
  assert.equal(CHAT_MARKED_OPTIONS.gfm, true)
  assert.match(chatView, /CHAT_MARKED_OPTIONS/)
  assert.match(chatView, /from ["']\.\.\/utils\/markdown-gfm["']/)
  marked.use({ ...CHAT_MARKED_OPTIONS })
  const html = String(marked.parse("行1\n行2", { async: false, ...CHAT_MARKED_OPTIONS }))
  assert.match(html, /<br\s*\/?>/)
})

test("PacksPanel meeting card accent only when meeting-minutes is active", () => {
  assert.match(packs, /activePackId === "meeting-minutes" \? styles\.meetingCardActive/)
  assert.match(packs, /meetingCardActive:/)
  assert.match(packs, /itemActive:/)
  assert.match(packs, /meetingCard: \{[\s\S]*?background: tokens\.bg/)
})
