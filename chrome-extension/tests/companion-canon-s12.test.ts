import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")

test("S1.2 装配 is the chip above the field, not a capsule icon", () => {
  const app = src("src/sidepanel/App.tsx")
  assert.match(app, /<ComposerChips/)
  assert.ok(!/title="装配 — 技能、场景、知识"/.test(app))
  assert.match(app, /添加文件或图片/)
  // Attach + mic icons stay visible by default — no empty-conversation gate
  // (users couldn't discover attach / dictation on a fresh thread).
  assert.match(app, /\{!showStop && !\(voice\.listening && showVoiceMic\) && \(/)
  assert.match(app, /\{showVoiceMic && \(\s*<VoiceMicButton/)
  // Negative tripwire: any return of the empty-conversation gate turns red.
  assert.ok(
    !/messages\.length === 0[\s\S]{0,160}text\.trim\(\)/.test(app),
    "empty-conversation icon gate must not return",
  )
  assert.ok(!/畅所欲问/.test(app))
})

test("S1.3 settings lives in ⋯ only; pin is left thumbtack", () => {
  const rail = src("src/sidepanel/components/StatusRail.tsx")
  const list = src("src/sidepanel/components/ThreadList.tsx")
  assert.ok(!/aria-label="设置"/.test(rail), "left gear removed — ⋯ owns 设置")
  const more = rail.slice(rail.indexOf("<span>设置</span>") - 400, rail.indexOf("<span>设置</span>"))
  assert.match(more, /connectionState !== "connected" \? "connection" : "model"/)
  assert.ok(!/title="设置"/.test(list), "history drawer no longer duplicates 设置")
  const badge = src("src/sidepanel/ui/ModeBadge.tsx")
  assert.match(badge, /IconPin/)
  assert.match(badge, /whisper \? IconPin/)
})

test("S1.4 ComposeDrawer has no ⋯编排 dead link", () => {
  const drawer = src("src/sidepanel/components/ComposeDrawer.tsx")
  assert.match(drawer, /使用 \/board/)
  assert.ok(!/⋯「编排」/.test(drawer))
})

test("S2.6 inviteRow color lives only in CSS so hover can win", () => {
  const chat = src("src/sidepanel/components/ChatView.tsx")
  const start = chat.indexOf("inviteRow:")
  const end = chat.indexOf("userMsg:", start)
  const block = chat.slice(start, end)
  assert.match(chat, /\.invite-row:hover/)
  assert.ok(!/color:/.test(block), "inline color would beat :hover")
})

test("S2 chrome: legal contrast, send arrow, brandRed mark, no IconPlus", () => {
  const app = src("src/sidepanel/App.tsx")
  const legal = app.slice(app.indexOf("legal:"), app.indexOf("legal:") + 180)
  assert.match(legal, /fontSize:\s*11/)
  assert.match(legal, /tokens\.textMuted/)
  const icons = src("src/sidepanel/ui/icons.tsx")
  assert.ok(!/export function IconPlus/.test(icons))
  const send = icons.slice(icons.indexOf("export function IconSend"), icons.indexOf("export function IconStop"))
  assert.match(send, /M12 19V6/)
  const mark = icons.slice(icons.indexOf("export function CompanionMark"), icons.indexOf("export function IconSend"))
  // #323: mark is the brandRed calf imprint — filled stamp, aria-hidden,
  // and must never fall back to danger-family red.
  assert.match(mark, /tokens\.brandRed/, "mark body is brandRed")
  assert.match(mark, /aria-hidden/, "mark stays decorative")
  assert.ok(!/tokens\.danger/.test(mark), "mark must not reuse danger red")
  assert.ok(!/#171717/.test(mark), "ink silhouette removed by #323")
  const rail = src("src/sidepanel/components/StatusRail.tsx")
  assert.match(rail, /role="status"/)
})
