// #321 PR-4 — empty + composer same face, honest canon revision.
// Copy (empty-state-copy) is NOT in this file — those tests stay the SoT for words.

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { tokens } from "../src/sidepanel/ui/tokens"

const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")

test("#321 PR-4: CompanionMark empty imprint is 48px (wireframe), still red calf", () => {
  const emptyFn = src("src/sidepanel/components/ChatView.tsx").slice(
    src("src/sidepanel/components/ChatView.tsx").indexOf("function EmptyState"),
    src("src/sidepanel/components/ChatView.tsx").indexOf("const markdownCSS"),
  )
  assert.match(emptyFn, /<CompanionMark size=\{48\}\s*\/>/)
  assert.doesNotMatch(emptyFn, /size=\{92\}/)
  const mark = src("src/sidepanel/ui/icons.tsx").slice(
    src("src/sidepanel/ui/icons.tsx").indexOf("export function CompanionMark"),
    src("src/sidepanel/ui/icons.tsx").indexOf("export function IconSend"),
  )
  assert.match(mark, /tokens\.brandRed/)
  assert.doesNotMatch(mark, /#111|#000|black/i)
  assert.match(mark, /viewBox="0 0 92 92"/)
})

test("#321 PR-4: greeting stays 22px; three invites live in EmptyState (above the fold)", () => {
  assert.equal(tokens.emptyTitle, 22)
  const chat = src("src/sidepanel/components/ChatView.tsx")
  const emptyFn = chat.slice(chat.indexOf("function EmptyState"), chat.indexOf("const markdownCSS"))
  assert.match(emptyFn, /InvitationRows/)
  assert.match(emptyFn, /emptyTitle/)
  // Empty hero has no composer/send/attach — those sit in InputArea below the fold.
  assert.doesNotMatch(emptyFn, /ComposerChips|IconSend|IconAttach|handleSend/)
  // No extra chrome after invites besides the optional page chip.
  const afterInvites = emptyFn.slice(emptyFn.indexOf("InvitationRows"))
  assert.doesNotMatch(afterInvites, /cockpit\.open|SettingsSlideout|StatusRail/)
})

test("#321 PR-4: first-screen budget — mark+title+3 invites fit above composer", () => {
  // Side panel ~400px short; rail ~48 + composer ~52 + pad ~24 → ~276 left.
  const mark = 48
  const title = tokens.emptyTitle + 20 // line + margins
  const invites = 3 * 32
  const pageChip = 36
  const composer = 52
  const rail = 48
  const used = mark + title + invites + pageChip
  assert.ok(used < 400 - rail - composer, `above-fold used ${used}px`)
  const app = src("src/sidepanel/App.tsx")
  const capsule = app.slice(app.indexOf("composerCapsule:"), app.indexOf("textarea:"))
  assert.match(capsule, /minHeight:\s*52/)
  assert.doesNotMatch(capsule, /minHeight:\s*72/)
})

test("#321 PR-4: composer minHeight ~52 leaves 32px attach/mic/send room", () => {
  const app = src("src/sidepanel/App.tsx")
  const attach = app.slice(app.indexOf("attachBtn:"), app.indexOf("sendBtn:"))
  assert.match(attach, /width:\s*32/)
  assert.match(attach, /height:\s*32/)
  const textarea = app.slice(app.indexOf("textarea:"), app.indexOf("attachBtn:"))
  const taMin = Number(textarea.match(/minHeight:\s*(\d+)/)?.[1] ?? 0)
  assert.ok(taMin > 0 && taMin <= 36, `textarea minHeight ${taMin} must fit in 52px capsule`)
  // Voice capsule is a sibling of the capsule, not inside minHeight.
  assert.match(app, /VoiceStatusCapsule/)
  const voiceIdx = app.indexOf("<VoiceStatusCapsule")
  const capIdx = app.indexOf("styles.composerCapsule")
  assert.ok(voiceIdx >= 0 && capIdx > voiceIdx)
})

test("#321 PR-4: canon revision — user bubble is not a filled indigo slab", () => {
  assert.equal(tokens.userBubbleBg, "#ffffff")
  assert.equal(tokens.accent, "#4f46e5")
  assert.ok(String(tokens.userBubbleBg) !== String(tokens.accent))
  const tokenFile = src("src/sidepanel/ui/tokens.ts")
  assert.match(tokenFile, /canon revision|#321 PR-4/i)
  assert.match(tokenFile, /userBubbleBorder/)
  const chat = src("src/sidepanel/components/ChatView.tsx")
  const bubble = chat.slice(chat.indexOf("userBubble:"), chat.indexOf("agentBubble:"))
  assert.match(bubble, /tokens\.userBubbleBg/)
  assert.match(bubble, /tokens\.userBubbleInk|tokens\.text/)
  assert.match(bubble, /tokens\.userBubbleBorder|tokens\.border/)
  assert.doesNotMatch(bubble, /shadowAccent/)
})

test("#321 PR-4: unarmed send is muted, armed send is indigo", () => {
  const app = src("src/sidepanel/App.tsx")
  assert.match(app, /canSend \? tokens\.accent : tokens\.(sendDisabledBg|bgMuted)/)
  assert.match(app, /sendDisabledBg/)
})

test("#321 PR-4: L0 装配 chip is quiet (primary flag kept, strong fill dropped)", () => {
  const chips = src("src/sidepanel/components/ComposerChips.tsx")
  assert.match(chips, /chip\.primary/) // data/flag not deleted
  assert.doesNotMatch(chips, /chipPrimary/)
  assert.doesNotMatch(chips, /tokens\.accentSoft/)
})
