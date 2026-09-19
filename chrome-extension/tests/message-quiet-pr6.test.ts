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
import { readFileSync, readdirSync, statSync } from "node:fs"
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
  // #502 A: the transcript renders grouped items (tool blocks + rows), so the
  // passthrough is per-item — `itemIsLast` marks the last render item.
  assert.match(chat, /isLast=\{itemIsLast\}/)
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

test("PR-6 round-2 NIT-1: coarse menu closes on executed action, Escape restores focus, aria-controls wired", () => {
  const chat = read("src/sidepanel/components/ChatView.tsx")
  const coarse = chat.slice(
    chat.indexOf('actionMode === "coarse" ? ('),
    chat.indexOf(") : (\n              <div\n                className="),
  )
  // any executed action dismisses the menu: capture-phase close on the group
  // means every button click (复制 included) folds the menu — the named
  // "sticky open after 复制" friction
  assert.match(coarse, /onClickCapture=\{\(\) => setMoreOpen\(false\)\}/)
  // keyboard close: Escape folds the menu and restores focus to the ⋯ toggle
  assert.match(coarse, /e\.key === "Escape"/)
  assert.match(coarse, /moreBtnRef\.current\?\.focus\(\)/)
  // the toggle and the group are programmatically linked
  assert.match(coarse, /aria-controls=\{`msg-more-\$\{msg\.id\}`\}/)
  assert.match(coarse, /id=\{`msg-more-\$\{msg\.id\}`\}/)
  assert.match(coarse, /ref=\{moreBtnRef\}/)
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

// ---------------------------------------------------------------------------
// #502 slice A — tool history folding (source contract)
// ---------------------------------------------------------------------------

test("#502 ChatView routes tool history through viewToolHistory with an accessible audit chip", () => {
  const chat = read("src/sidepanel/components/ChatView.tsx")
  // grouping + chip copy + button semantics (Enter/Space ride the native button)
  assert.match(chat, /viewToolHistory\(/)
  assert.match(chat, /groupToolTurnRows\(/)
  assert.match(chat, /展开审计/)
  assert.match(chat, /aria-expanded=\{auditOpen\}/)
  // cards render via the existing ToolCallCard only — no new card component
  assert.match(chat, /function ToolCallCard\(\{ tc \}/)
  // fold is view state, never persisted onto the thread
  assert.ok(!/thread\.collapsed/.test(chat), "fold state must not touch thread.collapsed")
})

test("#502 MessageRow no longer renders function-shape tool_calls inline (hydrate)", () => {
  const chat = read("src/sidepanel/components/ChatView.tsx")
  // Kimi MAJOR-1: hydrated assistant rows carry function-shape tool_calls —
  // the unconditional msg.tool_calls?.map produced nameless duplicate cards
  // next to the audit chip. The inline render must be gated.
  assert.match(chat, /shouldRenderInlineToolCards\(msg\)/)
  const mapIdx = chat.indexOf("msg.tool_calls?.map")
  assert.ok(mapIdx > 0, "inline map for flat live shape must still exist")
  const gateIdx = chat.indexOf("shouldRenderInlineToolCards(msg)")
  assert.ok(gateIdx > 0 && gateIdx < mapIdx, "gate must sit before the inline map")
})

test("#508 ToolHistoryBlock wirings: pendingConfirmIds / threadBusy last-item / chipTone warning", () => {
  const chat = read("src/sidepanel/components/ChatView.tsx")
  // (a) name→id goes through the tested pure function — emptying the memo
  // inline would no longer compile against this lock.
  assert.match(chat, /pendingConfirmIdsFromTools\(/)
  assert.match(chat, /pendingConfirmToolNamesForThread\(/)
  // last tools block only: historical turns never receive the live name set
  assert.match(chat, /pendingConfirmToolNames=\{itemIsLast \? pendingConfirmToolNames : EMPTY_CONFIRM_NAMES\}/)
  // (b) threadBusy is the last-item AND, not a hardcoded false
  assert.match(chat, /threadBusy=\{Boolean\(itemIsLast && threadBusy\)\}/)
  // (c) failure chipTone is a ternary on the run-wide failed count (#514
  // consolidated block: totalFailed across rounds), warning tokens
  assert.match(chat, /totalFailed\s*>\s*0/)
  assert.match(chat, /color: tokens\.warning/)
  assert.match(chat, /background: tokens\.warningSoft/)
})

test("#502 tool history stays sidepanel-only (no overlay wiring)", () => {
  const walk = (dir: string): string[] => {
    const out: string[] = []
    for (const name of readdirSync(join(process.cwd(), dir))) {
      if (name === "node_modules" || name.startsWith(".")) continue
      const rel = `${dir}/${name}`
      if (statSync(join(process.cwd(), rel)).isDirectory()) out.push(...walk(rel))
      else if (/\.(ts|tsx)$/.test(name)) out.push(rel)
    }
    return out
  }
  const offenders: string[] = []
  for (const rel of walk("src")) {
    if (!/\.tsx?$/.test(rel)) continue
    if (readFileSync(join(process.cwd(), rel), "utf8").includes("tool-history")) {
      offenders.push(rel)
    }
  }
  for (const f of offenders) {
    assert.ok(
      f === "src/sidepanel/components/ChatView.tsx" ||
        f === "src/sidepanel/components/tool-history-view.ts",
      `unexpected tool-history reference outside sidepanel: ${f}`,
    )
  }
})

// ---------------------------------------------------------------------------
// #502 slice A — covered rounds' thinking folds into the audit block
// ---------------------------------------------------------------------------

test("#502 ChatView folds covered rounds' reasoning into the audit block (no per-round header)", () => {
  const chat = read("src/sidepanel/components/ChatView.tsx")
  // MessageRow suppresses the standalone ReasoningBlock for folded rows
  assert.match(chat, /msg\.reasoning_content && !reasoningFolded/)
  // ChatView wires both directions: folded flag to the row, per-round split
  // (reasonings ride inside rounds) to the block
  assert.match(chat, /reasoningFolded=\{item\.reasoningFolded === true\}/)
  assert.match(chat, /rounds=\{item\.rounds\}/)
  // the audit view renders the thinking sections before the tool cards
  assert.match(chat, /function AuditReasoningSection\(/)
  assert.match(chat, /第 \{index\} 段思考/)
  assert.match(chat, /\(r\.reasonings \?\? \[\]\)\.map/, "thinking renders inside each round, before its cards")
  // memo comparator keeps the folded flag — a flip must re-render the row
  assert.match(chat, /prev\.reasoningFolded === next\.reasoningFolded/)
})

// ---------------------------------------------------------------------------
// #514 — ONE consolidated audit block per run, with a round pager
// ---------------------------------------------------------------------------

test("#514 ChatView consolidates per-round blocks into one run block with a pager", () => {
  const chat = read("src/sidepanel/components/ChatView.tsx")
  assert.match(chat, /consolidateRunToolTurns\(groupToolTurnRows\(messages\)\)/, "transcript uses the run consolidator")
  assert.match(chat, /rounds=\{item\.rounds\}/, "block receives the per-round split")
  // pager: ‹ › buttons page rounds in the done state, disabled at the edges
  assert.match(chat, /aria-label="上一段"/)
  assert.match(chat, /aria-label="下一段"/)
  assert.match(chat, /donePagerChipLabel\(page, totalPages, toolsAll\.length, totalFailed\)/, "chip label carries pager + run totals")
  // live semantics unchanged: current step expanded, completed folded ACROSS rounds
  assert.match(chat, /liveChipLabel\(completedTools\.length, completedFailed\)/)
})
