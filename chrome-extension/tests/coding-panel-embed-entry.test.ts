// #502 C — Side Panel entry for the in-plugin embedded terminal.
//
// The companion half is landed: an opt-in Mode C start records a THREAD-KEYED embed intent
// (agent binary + argv + cwd) and spawns nothing. This file pins the browser-side half:
//   1. the panel button exists, is gated on `embedded_terminal.enabled`, is click-only
//      (never auto-opens on mount/render/state change), and is THREAD-BOUND (R7a);
//   2. the panel carries no terminal emulator / no Alacritty / no new `terminal.*` message;
//   3. the Mode C copy for `local_terminal: "embed_intent"` stops describing an outer
//      Terminal.app process that does not exist (R7b).
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  shouldShowEmbeddedTerminalEntry,
  isModeCInvolved,
  isModeCMonitorStop,
  modeCBannerText,
} from "../src/sidepanel/coding-handoff/embed-entry"
import { codingHandoffCopy } from "../src/sidepanel/coding-handoff/copy"
import { buildTerminalOpenBinding, openOrFocusEmbeddedTerminal } from "../src/background/terminal"

const PANEL = "src/sidepanel/components/CodingAgentPanel.tsx"
const CHIP = "src/sidepanel/components/CodingSessionChip.tsx"
const COPY = "src/sidepanel/coding-handoff/copy.ts"
const HELPER = "src/sidepanel/coding-handoff/embed-entry.ts"

const raw = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")

/**
 * Comments carry prose about `terminal.open` / `terminal.open_tab` (and about the outer
 * Terminal.app); the locks below are about executable code, so strip prose first. Mirrors
 * scripts/check-sidepanel-raw-colors.mjs (keeps `://` inside strings).
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")
}
const src = (rel: string) => stripComments(raw(rel))

// ── Entry gate (pure helper) ────────────────────────────────────────────────

test("entry gate: only the NESTED embedded_terminal.enabled===true enables the entry", () => {
  assert.equal(shouldShowEmbeddedTerminalEntry({ embedded_terminal: { enabled: true } }), true)
  assert.equal(shouldShowEmbeddedTerminalEntry({ embedded_terminal: { enabled: false } }), false)
  assert.equal(shouldShowEmbeddedTerminalEntry({ embedded_terminal: {} }), false)
  assert.equal(shouldShowEmbeddedTerminalEntry({}), false)
  assert.equal(shouldShowEmbeddedTerminalEntry(undefined), false)
  assert.equal(shouldShowEmbeddedTerminalEntry(null), false)
  // There is no flattened alias — an unrelated key must not open the entry.
  assert.equal(
    shouldShowEmbeddedTerminalEntry({ embedded_terminal_enabled: true } as never),
    false,
  )
  // Truthy-but-not-true must not pass (config writes are `{ enabled: v }` booleans only).
  assert.equal(shouldShowEmbeddedTerminalEntry({ embedded_terminal: { enabled: 1 } } as never), false)
})

// ── Panel source locks ──────────────────────────────────────────────────────

test("panel renders the entry through the gate, label from copy (R1/R2)", () => {
  const panel = src(PANEL)
  assert.match(
    panel,
    /import\s*\{[^}]*shouldShowEmbeddedTerminalEntry[^}]*\}\s*from\s*"\.\.\/coding-handoff\/embed-entry"/,
  )
  assert.match(panel, /shouldShowEmbeddedTerminalEntry\(/)
  // The gate must actually drive the render: enabled === true AND this thread's embed_intent.
  assert.match(
    panel,
    /const showEmbedEntry =\s*shouldShowEmbeddedTerminalEntry\(embeddedTerminalConfig\) &&\s*session\?\.localTerminal === "embed_intent"/,
  )
  assert.match(panel, /\{showEmbedEntry \? \(/)
  assert.match(panel, /codingHandoffCopy\.panelOpenEmbeddedTerminal/)
  // The visible label is the locked string, declared once in copy.ts (no ad-hoc UI chrome).
  assert.equal(codingHandoffCopy.panelOpenEmbeddedTerminal, "在本插件打开终端")
  assert.ok(!raw(PANEL).includes("在本插件打开终端"))
})

test("panel opener is thread-bound and uses the existing terminal.open_tab message (R3/R7a)", () => {
  const panel = src(PANEL)
  const sends = [...panel.matchAll(/type:\s*"terminal\.open_tab"/g)]
  assert.equal(sends.length, 1, "exactly one open_tab call site")
  const at = sends[0].index!
  // The companion keys the embed intent by THREAD id and `terminal.open` claims it with the
  // same key; a thread-less open lands the user on a plain login shell.
  assert.match(panel.slice(at, at + 220), /thread_id:\s*embedThreadId/)
  assert.match(panel.slice(at, at + 220), /void chrome\.runtime\.lastError/)
})

test("no auto-open: the opener identifier is only ever declared or wired to onClick", () => {
  const panel = src(PANEL)
  const positions = [...panel.matchAll(/\bopenEmbeddedTerminalTab\b/g)].map(m => m.index!)
  assert.ok(positions.length >= 2, "opener must be declared AND wired to a click")
  for (const at of positions) {
    const before = panel.slice(Math.max(0, at - 80), at)
    assert.ok(
      /onClick=\{$|const $/.test(before),
      `opener referenced outside an onClick handler (auto-open risk): …${before}openEmbeddedTerminalTab`,
    )
  }
  // and no effect may send the frame at all
  for (const block of effectBlocks(panel)) {
    assert.ok(!/"terminal\./.test(block), `useEffect must not send a terminal.* frame: ${block.slice(0, 120)}`)
  }
})

test("no terminal emulator in the panel; the xterm surface stays in the full-page tab (C4)", () => {
  const panel = src(PANEL)
  assert.doesNotMatch(panel, /xterm/i)
  assert.doesNotMatch(panel, /TerminalApp/)
  assert.doesNotMatch(panel, /new Terminal\(/)
})

test("no Alacritty on the panel entry path (C3)", () => {
  for (const rel of [PANEL, HELPER]) assert.doesNotMatch(raw(rel), /alacritty/i)
})

test("no new terminal.* message type is introduced by the panel (C2)", () => {
  const panel = src(PANEL)
  const verbs = [...new Set([...panel.matchAll(/terminal\.[a-zA-Z_]+/g)].map(m => m[0]))]
  assert.deepEqual(verbs, ["terminal.open_tab"])
})

// ── R7(a): the intent must be claimable ─────────────────────────────────────

test("R7(a): a thread-only open_tab keeps thread_id (no review_id required)", () => {
  assert.deepEqual(buildTerminalOpenBinding({ thread_id: "th-1" }), { thread_id: "th-1" })
  assert.deepEqual(buildTerminalOpenBinding({ thread_id: "th-1", review_id: "rv-1" }), {
    thread_id: "th-1",
    review_id: "rv-1",
  })
  // An unbound (Settings) open and a review-less unbound open stay unbound.
  assert.equal(buildTerminalOpenBinding({}), undefined)
  assert.equal(buildTerminalOpenBinding({ review_id: "rv-1" }), undefined)
  assert.equal(buildTerminalOpenBinding(undefined), undefined)
  assert.equal(buildTerminalOpenBinding({ thread_id: "" }), undefined)
  assert.equal(buildTerminalOpenBinding({ thread_id: 42, review_id: "rv-1" }), undefined)
})

test("R7(a): the opened tab carries thread_id even without a review_id", async () => {
  const url = "chrome-extension://test/tabs/embedded-terminal.html"
  const created: Array<{ url: string }> = []
  ;(globalThis as any).chrome = {
    runtime: { id: "test", getURL: () => url },
    tabs: {
      query: async () => [],
      create: async (opts: { url: string }) => created.push(opts),
      update: async () => {},
    },
    windows: { update: async () => {} },
  }
  await openOrFocusEmbeddedTerminal(buildTerminalOpenBinding({ thread_id: "th-1" }))
  assert.equal(created.length, 1)
  assert.match(created[0].url, /thread_id=th-1/)
  assert.doesNotMatch(created[0].url, /review_id=/)
  created.length = 0
  await openOrFocusEmbeddedTerminal(buildTerminalOpenBinding({ thread_id: "th-2", review_id: "rv-2" }))
  assert.match(created[0].url, /thread_id=th-2/)
  assert.match(created[0].url, /review_id=rv-2/)
})

// ── R7(b): embed_intent copy honesty ────────────────────────────────────────

test("R7(b): embed_intent gets in-plugin copy that points at the button — never the outer-Terminal banner", () => {
  const text = modeCBannerText("embed_intent")
  assert.equal(text, codingHandoffCopy.modeCEmbedIntentBanner)
  assert.notStrictEqual(text, codingHandoffCopy.modeCDualProcessBanner)
  // The old copy describes an OUTER Terminal.app process while nothing is running at all.
  assert.doesNotMatch(text, /Terminal 内 Agent 需在终端自行退出/)
  assert.doesNotMatch(text, /在终端自行退出/)
  // It must be actionable: name the button the user has to click.
  assert.ok(text.includes(codingHandoffCopy.panelOpenEmbeddedTerminal))
})

test("R7(b): the outer-Terminal banner is still selected for the states that really opened one", () => {
  for (const state of ["opened", undefined]) {
    assert.equal(modeCBannerText(state), codingHandoffCopy.modeCDualProcessBanner)
  }
  // L0 keeps the manual-paste honesty.
  assert.match(modeCBannerText("opened_l0"), /手动粘贴/)
  assert.match(modeCBannerText("pending"), /正在打开本机终端/)
  assert.match(modeCBannerText("failed"), /本机终端未打开/)
})

test("R7(b): both Mode C sites go through the helper, so neither re-selects the lying ladder", () => {
  for (const rel of [PANEL, CHIP]) {
    const s = src(rel)
    assert.match(s, /modeCBannerText\(/, `${rel} must render Mode C copy from the helper`)
    // The bare fallthrough that produced the false copy must be gone from both sites.
    assert.doesNotMatch(s, /codingHandoffCopy\.modeCDualProcessBanner/)
  }
  const chip = src(CHIP)
  // The chip hint is gated on "Mode C involved", not on monitor-stop: `embed_intent` is the
  // former but not the latter, so gating on the latter would hide the entry hint entirely.
  assert.match(chip, /const modeCHint = isModeCInvolved\(/)
  assert.match(chip, /\{live && modeCHint \?/)
  assert.doesNotMatch(chip, /\{live && modeCMonitorStop \?/)
  // Stop label/title must stay keyed on monitor-stop (never on "Mode C involved").
  assert.match(src(PANEL), /const modeCMonitorStop = isModeCMonitorStop\(/)
  assert.match(chip, /const modeCMonitorStop = isModeCMonitorStop\(/)
})

test("R7(b): embed_intent is not a monitor-stop state (nothing is running in a terminal yet)", () => {
  assert.equal(isModeCMonitorStop("embed_intent", true), false)
  assert.equal(isModeCMonitorStop("opened", true), true)
  assert.equal(isModeCMonitorStop("opened_l0", true), true)
  assert.equal(isModeCMonitorStop("pending", true), true)
  assert.equal(isModeCMonitorStop("skipped", true), false)
  assert.equal(isModeCMonitorStop("failed", true), false)
  // …but it IS Mode C: the hint and the entry must still render for it.
  assert.equal(isModeCInvolved("embed_intent", true), true)
  // Invariant: monitor-stop and "Mode C involved" agree for every pre-#502 state.
  for (const state of ["opened", "opened_l0", "pending", "skipped", "failed", "pending", undefined]) {
    assert.equal(
      isModeCMonitorStop(state, true),
      isModeCInvolved(state, true),
      `#502 C must not change the pre-existing stop label for ${state}`,
    )
  }
})

// ── helpers ────────────────────────────────────────────────────────────────

/** Extract `useEffect(() => { … })` bodies by brace matching (comment-stripped source). */
function effectBlocks(text: string): string[] {
  const blocks: string[] = []
  const marker = "useEffect("
  let from = text.indexOf(marker)
  while (from !== -1) {
    let depth = 0
    let i = text.indexOf("{", from)
    const start = i
    for (; i < text.length; i++) {
      if (text[i] === "{") depth++
      else if (text[i] === "}") {
        depth--
        if (depth === 0) break
      }
    }
    if (start !== -1) blocks.push(text.slice(start, i + 1))
    from = text.indexOf(marker, i)
  }
  return blocks
}
