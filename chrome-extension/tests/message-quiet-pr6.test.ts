// #321 PR-6 — 消息行降噪 acceptance tests.
//
// Hard acceptances pinned here:
//  1. Keyboard reachability: the quiet bar is hidden via opacity (NOT
//     display:none / visibility:hidden) so its buttons stay in the tab order
//     and :focus-within genuinely reveals it.
//  2. Coarse-pointer fallback: every message row keeps a ⋯ (更多操作) that
//     expands the full action set (fork / export / </>接力 included).
//  3. Red line (FINAL-SYNTHESIS §1.1-5): failure / security disclosure never
//     default-collapses — NoticeCard has no collapsed state, warning userHint /
//     settings pointer render unconditionally, RunProgress mount is untouched.
//  4. data-testid contract: existing ids unchanged (settings-pointer-card,
//     settings-pointer-open-btn); only visibility timing changed.

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  isCoarsePointer,
  messageActionMode,
} from "../src/sidepanel/components/message-actions"

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")

/** Color-aware like the PR-1 hygiene gate: strip comments before hex/pattern scans. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")

// ---------------------------------------------------------------------------
// 1. Pure policy: gated / persistent / coarse
// ---------------------------------------------------------------------------

test("PR-6 messageActionMode truth table", () => {
  assert.equal(messageActionMode({ coarse: false, isLast: false }), "gated")
  assert.equal(messageActionMode({ coarse: false, isLast: true }), "persistent")
  // coarse wins over isLast: touch rows always use the ⋯ fallback
  assert.equal(messageActionMode({ coarse: true, isLast: false }), "coarse")
  assert.equal(messageActionMode({ coarse: true, isLast: true }), "coarse")
})

test("PR-6 isCoarsePointer: media-query driven, fail-closed without matchMedia", () => {
  assert.equal(isCoarsePointer({ matchMedia: () => ({ matches: true }) }), true)
  assert.equal(isCoarsePointer({ matchMedia: () => ({ matches: false }) }), false)
  // no matchMedia at all (SSR-ish / exotic) → fine pointer gating, never crash
  assert.equal(isCoarsePointer({}), false)
  // throwing matchMedia must not take the row down
  assert.equal(
    isCoarsePointer({ matchMedia: () => { throw new Error("denied") } }),
    false,
  )
})

// ---------------------------------------------------------------------------
// 2. Keyboard reachability: the CSS gate must keep buttons tabbable
// ---------------------------------------------------------------------------

test("PR-6 quiet-action CSS hides by opacity and reveals on hover/focus-within/is-last", () => {
  const chat = read("src/sidepanel/components/ChatView.tsx")
  const start = chat.indexOf("const quietActionsCSS = `")
  const end = chat.indexOf("`", start + "const quietActionsCSS = `".length)
  assert.ok(start > 0, "quietActionsCSS must exist in ChatView")
  const css = chat.slice(start, end)
  // hidden = opacity 0 + pointer-events none (no ghost clicks)
  assert.match(css, /\.cmspark-msg-actions\s*\{\s*opacity:\s*0/)
  assert.match(css, /pointer-events:\s*none/)
  // THE keyboard-reachability invariant: nothing may remove the bar from the
  // tab order — display:none / visibility:hidden would make focus-within dead
  assert.ok(!/display:\s*none/.test(css), "display:none would break Tab reachability")
  assert.ok(!/visibility:\s*hidden/.test(css), "visibility:hidden would break Tab reachability")
  // reveal triggers: row hover, focus-within on the bar, last-message class
  assert.match(css, /\.cmspark-msg-row:hover\s+\.cmspark-msg-actions/)
  assert.match(css, /\.cmspark-msg-actions:focus-within/)
  assert.match(css, /\.cmspark-msg-actions\.is-last/)
})

test("PR-6 ChatView wires row className + gated bar + isLast passthrough", () => {
  const chat = read("src/sidepanel/components/ChatView.tsx")
  // row wrapper carries the hover scope; the bar carries the gated class
  assert.match(chat, /className="cmspark-msg-row"/)
  assert.match(
    chat,
    /className=\{actionMode === "persistent" \? "cmspark-msg-actions is-last" : "cmspark-msg-actions"\}/,
  )
  // call site passes isLast; memo comparator includes it (else the old last row
  // would keep the persistent bar after a new message lands)
  assert.match(chat, /isLast=\{i === messages\.length - 1\}/)
  assert.match(chat, /prev\.isLast === next\.isLast/)
})

// ---------------------------------------------------------------------------
// 3. Coarse-pointer ⋯ fallback (hard acceptance)
// ---------------------------------------------------------------------------

test("PR-6 coarse rows keep one ⋯ per message expanding the full action set", () => {
  const chat = read("src/sidepanel/components/ChatView.tsx")
  const coarse = chat.slice(
    chat.indexOf('actionMode === "coarse" ? ('),
    chat.indexOf(") : (\n              <div\n                className="),
  )
  assert.ok(coarse.length > 0, "coarse branch must exist")
  // the always-visible kebab: aria-expanded toggle, not a hover-revealed strip
  assert.match(coarse, /aria-label="更多操作"/)
  assert.match(coarse, /aria-expanded=\{moreOpen\}/)
  // the expansion carries the SAME button set as the hover bar (renderActionButtons)
  assert.match(coarse, /renderActionButtons\(\)/)
  assert.match(coarse, /role="group"/)
  // the full action set includes the fork/export/relay trio named by the ticket
  const buttons = chat.slice(chat.indexOf("const renderActionButtons = () => ("), chat.indexOf("  return (\n    <div className=\"cmspark-msg-row\""))
  assert.match(buttons, /创建分支/)
  assert.match(buttons, /导出此条为 Markdown/)
  assert.match(buttons, /派给终端助手/)
  assert.match(buttons, /复制/)
})

// ---------------------------------------------------------------------------
// 4. NoticeCard primitive + red line: disclosure never default-collapses
// ---------------------------------------------------------------------------

test("PR-6 four-variant compact banner rides NoticeCard (warning tone, role=status)", () => {
  const chat = read("src/sidepanel/components/ChatView.tsx")
  assert.match(chat, /<NoticeCard tone="warning" role="status" testId="context-notice-card">/)
  // all four variants still behind it, copy intact (copy tests live in
  // context-window-copy.test.ts; here we pin presence)
  for (const s of ["工具结果已截断", "上下文可能已被压缩", "上下文可能超预算", "模型上下文已压缩"]) {
    assert.ok(chat.includes(s), `banner variant copy must survive: ${s}`)
  }
  // the old hand-rolled banner style object is gone — its distinctive margin
  // now lives ONLY inside NoticeCard (fakeEnd / other warning styles untouched)
  assert.ok(!chat.includes('8px 10px 4px'), "banner margin must belong to NoticeCard alone")
  const ncBanner = read("src/sidepanel/components/ui/NoticeCard.tsx")
  assert.ok(ncBanner.includes('"8px 10px 4px"'), "NoticeCard owns the banner margin")
})

test("PR-6 NoticeCard has no collapsed state (red line §1.1-5)", () => {
  const nc = read("src/sidepanel/components/ui/NoticeCard.tsx")
  const code = stripComments(nc)
  // no collapsed/expanded/open prop can ever gate the render (comment prose
  // may SAY "never collapsed" — the pin is on the code surface)
  assert.ok(!/\bcollapsed\b/i.test(code), "NoticeCard must never grow a collapsed state")
  assert.ok(!/\bexpanded\b/i.test(code), "no expansion gating either")
  assert.ok(!/\bopen\b\s*[?:]/.test(code), "no open prop either")
  // warning family tokens, not resurrected literals
  assert.match(nc, /tokens\.warningSoft/)
  assert.match(nc, /tokens\.warningText/)
  assert.ok(!stripComments(nc).includes("#7a5b00"), "the pre-PR-1 literal must stay dead")
})

test("PR-6 ToolCallCard disclosures ride NoticeCard with stable testids, unconditional render", () => {
  const chat = read("src/sidepanel/components/ChatView.tsx")
  // settings pointer: SAME testids as before, only the shell changed
  assert.match(chat, /testId="settings-pointer-card"/)
  assert.match(chat, /data-testid="settings-pointer-open-btn"/)
  // warning userHint renders whenever present — no expanded/delay/collapse gate
  const hint = chat.slice(chat.indexOf('{userHint && ('), chat.indexOf('{/* SEC-C redacted stub'))
  assert.match(hint, /tone="warning"/)
  assert.match(hint, /testId="tool-user-hint"/)
  assert.ok(!/expanded/.test(hint), "userHint must not be gated behind expansion")
  // the settings pointer likewise mounts unconditionally when extracted
  const ptr = chat.slice(chat.indexOf("{settingsPointer && ("), chat.indexOf("{userHint && ("))
  assert.ok(!/expanded &&/.test(ptr), "settings pointer must not be gated behind expansion")
})

test("PR-6 ToolCallCard cascade untouched: status derivation + red-line mappings intact", () => {
  const chat = read("src/sidepanel/components/ChatView.tsx")
  // error signal semantics unchanged (hasResult = result && !error)
  assert.match(chat, /const hasResult = tc\.result && !tc\.error/)
  // failure tone mappings (error card hairline + glyph) still present
  assert.match(chat, /borderLeftColor: shellFailed \? tokens\.danger : statusTone/)
  assert.match(chat, /derivedStatus === "error" \? "!" : "–"/)
  // SEC-C stub hint + failed-suffix copy intact (security disclosure)
  assert.match(chat, /data-testid="redacted-stub-hint"/)
  assert.match(chat, /该调用当时已失败/)
})

test("PR-6 RunProgress collapse semantics untouched (same-red-line neighbor)", () => {
  // PR-6 must not touch RunProgress's count-based collapse; the mount gate in
  // ChatView stays the runItems check pinned by run-progress-ui.test.ts.
  const chat = read("src/sidepanel/components/ChatView.tsx")
  assert.match(chat, /runItems && runItems\.length\s*>\s*0/)
  const rp = read("src/sidepanel/components/RunProgress.tsx")
  assert.match(rp, /defaultExpanded\(count\)/)
  // collapsed preview still surfaces the first undone item (折叠摘要红线)
  assert.match(rp, /firstUndone/)
})

test("PR-6 no raw hex left behind in the touched shells", () => {
  // the raw-color hygiene gate covers PR-1's 4-file scope; keep the files THIS
  // slice touched honest under the same color-aware (comment-excluding) rule
  const files = [
    "src/sidepanel/components/ui/NoticeCard.tsx",
    "src/sidepanel/components/message-actions.ts",
  ]
  for (const f of files) {
    const code = stripComments(read(f))
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(code), `${f} must stay token-only`)
  }
})
