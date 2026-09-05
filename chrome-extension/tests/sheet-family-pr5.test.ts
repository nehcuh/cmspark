// #321 PR-5 · Sheet 家族统一 — acceptance guards.
//
// Three bare sheets migrated onto the shared shell (ui/BottomSheet → ui/Modal
// → useModalDialog focus trap / Escape / focus restore), nine library panels
// unified on the Host header, and the packs/meeting/board icon collision fixed.
// Source-level assertions follow the chat-shell-popout.test.ts pattern; the
// focus-trap algorithm itself stays pinned by use-modal-dialog.test.ts.

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CONTEXT_PANEL_TABS } from "../src/sidepanel/components/ContextPanelHost"
import { IconSkills } from "../src/sidepanel/ui/icons"
import {
  VOICE_PRIVACY_ACK_V1_BODY,
  VOICE_PRIVACY_ACK_V2_BODY,
  VOICE_PRIVACY_ACK_V3_BODY,
  voicePrivacyBodyForKind,
} from "../src/sidepanel/voice/privacy-copy"

const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")

// ── Shared shell ────────────────────────────────────────────────────────────

test("PR-5: BottomSheet primitive wraps ui/Modal (single focus-trap path)", () => {
  const sheet = src("src/sidepanel/components/ui/BottomSheet.tsx")
  assert.match(sheet, /from "\.\/Modal"/)
  assert.match(sheet, /<Modal/)
  assert.match(sheet, /radiusSheet/)
})

test("PR-5: ComposeDrawer / KnowledgeImportModal / VoicePrivacySheet all ride BottomSheet", () => {
  for (const f of [
    "src/sidepanel/components/ComposeDrawer.tsx",
    "src/sidepanel/components/KnowledgeImportModal.tsx",
    "src/sidepanel/components/VoicePrivacySheet.tsx",
  ]) {
    const s = src(f)
    assert.match(s, /from "\.\/ui\/BottomSheet"/, `${f} must import BottomSheet`)
    assert.match(s, /<BottomSheet/, `${f} must render BottomSheet`)
    assert.doesNotMatch(s, /<div[^>]*role="dialog"/, `${f} must not hand-roll a dialog shell`)
  }
})

// ── KnowledgeImportModal migration ───────────────────────────────────────────

test("PR-5: KnowledgeImportModal is cut out of ChatView into its own component file", () => {
  const chat = src("src/sidepanel/components/ChatView.tsx")
  assert.doesNotMatch(chat, /function KnowledgeImportModal/)
  assert.match(chat, /import \{ KnowledgeImportModal \} from "\.\/KnowledgeImportModal"/)
  assert.match(chat, /<KnowledgeImportModal \/>/)
  const modal = src("src/sidepanel/components/KnowledgeImportModal.tsx")
  assert.match(modal, /export function KnowledgeImportModal/)
})

test("PR-5 red line: knowledge.import keeps user_gesture:true and duplicate force semantics verbatim", () => {
  const modal = src("src/sidepanel/components/KnowledgeImportModal.tsx")
  assert.match(modal, /type: "knowledge\.import"/)
  assert.match(modal, /user_gesture: true/)
  assert.match(modal, /force: p\.duplicate_of \? true : undefined/)
  assert.match(modal, /KNOWLEDGE_IMPORT_FORCE_LABEL/)
  assert.match(modal, /KNOWLEDGE_IMPORT_CONFIRM_LABEL/)
})

test("PR-5: Escape/scrim semantics — Escape closes via 取消 path, scrim stays non-dismissing", () => {
  const modal = src("src/sidepanel/components/KnowledgeImportModal.tsx")
  // onClose must abort any in-flight extract and drop the preview (same as 取消).
  const onCloseBlock = modal.slice(modal.indexOf("const cancelImport"), modal.indexOf("<BottomSheet"))
  assert.match(onCloseBlock, /abortExtract\(\)/)
  assert.match(onCloseBlock, /CLEAR_KNOWLEDGE_PREVIEW/)
  // Backdrop click previously did nothing; a mis-click must not drop edited fields.
  assert.match(modal, /backdropDismiss=\{false\}/)
})

test("PR-5: every button in KnowledgeImportModal is token-styled (no bare <button>)", () => {
  const modal = src("src/sidepanel/components/KnowledgeImportModal.tsx")
  const openTags = modal.match(/<button\b[\s\S]*?>/g) ?? []
  assert.ok(openTags.length >= 4, "expected the 4 migrated buttons")
  for (const tag of openTags) {
    assert.match(tag, /style=\{/, `unstyled button: ${tag.slice(0, 80)}…`)
  }
  assert.match(modal, /tokens\.accent/)
})

// ── Voice privacy sheet migration ────────────────────────────────────────────

test("PR-5: voice privacy sheet extracted from App.tsx onto BottomSheet", () => {
  const app = src("src/sidepanel/App.tsx")
  assert.match(app, /<VoicePrivacySheet/)
  assert.doesNotMatch(app, /可选麦克风：浏览器将语音转成文字后填入输入框/)
  const sheet = src("src/sidepanel/components/VoicePrivacySheet.tsx")
  assert.match(sheet, /data-testid="voice-privacy-sheet"/)
  assert.match(sheet, /voicePrivacyBodyForKind\(kind\)/)
})

test("PR-5 red line: privacy copy v1/v2/v3 bodies byte-identical after extraction", () => {
  assert.equal(
    VOICE_PRIVACY_ACK_V1_BODY,
    "可选麦克风：浏览器将语音转成文字后填入输入框，默认不自动发送。转写可能使用 Chrome 语音服务（音频可能经网络发送至浏览器厂商），不经过 CMspark Companion。发送后的文字与键入相同，仍受现有确认与信任设置约束。",
  )
  assert.equal(voicePrivacyBodyForKind("v1"), VOICE_PRIVACY_ACK_V1_BODY)
  assert.equal(voicePrivacyBodyForKind("v2"), VOICE_PRIVACY_ACK_V2_BODY)
  assert.equal(voicePrivacyBodyForKind("v3"), VOICE_PRIVACY_ACK_V3_BODY)
  // No JSX ternary picking copy inline anymore — the helper is the single branch point.
  const app = src("src/sidepanel/App.tsx")
  assert.doesNotMatch(app, /voicePrivacyKind === "v3"\s*\?\s*VOICE_PRIVACY/)
})

// ── Nine-panel header + icon collision ───────────────────────────────────────

test("PR-5: Host header is the one panel header — 15px title + 「收起」 close copy", () => {
  const host = src("src/sidepanel/components/ContextPanelHost.tsx")
  const titleStyle = host.slice(host.indexOf("panelTitle: {"), host.indexOf("panelCloseBtn:"))
  assert.match(titleStyle, /fontSize: 15/)
  assert.match(host, />\s*收起\s*<\//)
  assert.match(host, /aria-label="收起面板"/)
  // MeetingPanel's own close rides the same copy (its sync-end behavior is unchanged).
  const meeting = src("src/sidepanel/components/MeetingPanel.tsx")
  assert.match(meeting, /fontSize: 15 \}\}>会议记录/)
  assert.doesNotMatch(meeting, />\s*关闭\s*<\/button>/)
})

test("PR-5: packs/meeting/board icons no longer collide on IconSkills (all distinct)", () => {
  const iconFor = (id: string) => CONTEXT_PANEL_TABS.find((t) => t.id === id)?.Icon
  const packs = iconFor("packs")
  const meeting = iconFor("meeting")
  const board = iconFor("board")
  assert.ok(packs && meeting && board)
  assert.notStrictEqual(packs, IconSkills)
  assert.notStrictEqual(meeting, IconSkills)
  assert.notStrictEqual(board, IconSkills)
  assert.notStrictEqual(packs, meeting)
  assert.notStrictEqual(meeting, board)
  assert.notStrictEqual(packs, board)
})
