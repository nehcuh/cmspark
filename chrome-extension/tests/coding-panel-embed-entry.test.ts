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
  isDarwin,
  isModeCInvolved,
  isModeCMonitorStop,
  modeCBannerText,
} from "../src/sidepanel/coding-handoff/embed-entry"
import { codingHandoffCopy } from "../src/sidepanel/coding-handoff/copy"
import { buildTerminalOpenBinding, openOrFocusEmbeddedTerminal } from "../src/background/terminal"
import { normalizeConfig } from "../src/sidepanel/utils/normalize-config"

const PANEL = "src/sidepanel/components/CodingAgentPanel.tsx"
const CHIP = "src/sidepanel/components/CodingSessionChip.tsx"
const FOCUSBAND = "src/sidepanel/components/FocusBand.tsx"
const COPY = "src/sidepanel/coding-handoff/copy.ts"
const HELPER = "src/sidepanel/coding-handoff/embed-entry.ts"
const WS = "src/sidepanel/hooks/useWebSocket.ts"

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

// ── FIX 1: hydration — the gate reads the config the companion actually sent ─

/** A companion-shaped payload (`config.get` reply), NOT a hand-built gate object. */
const COMPANION_PAYLOAD = {
  llm: {
    base_url: "http://127.0.0.1:8765",
    model_name: "m",
    api_key: "***",
    temperature: 0,
    context_window: 1,
  },
  mcp: { enabled: true },
  coding_handoff: { auto_suggest: true, open_local_terminal: true },
  embedded_terminal: { enabled: true },
}

test("FIX 1: the entry gate is driven by the HYDRATED config, not by a literal", () => {
  // The value handed to the gate is what `normalizeConfig` produced from the wire payload —
  // a removed pass-through makes this fail (the feature was dead after every hydrate).
  const hydrated = normalizeConfig(COMPANION_PAYLOAD)
  assert.equal(shouldShowEmbeddedTerminalEntry(hydrated as never), true)
  // …and hydration keeps the NESTED shape SettingsSlideout writes: no flattened alias invented.
  assert.deepEqual((hydrated as any).embedded_terminal, { enabled: true })
  assert.equal((hydrated as any).embedded_terminal_enabled, undefined)
  // Wiring proof: the panel reads the gate's input from the hydrated state (`state.config`),
  // and SET_CONFIG is filled by `normalizeConfig(msg.config)` in useWebSocket.
  assert.match(
    src(PANEL),
    /const embeddedTerminalConfig = state\.config as \{ embedded_terminal\?: \{ enabled\?: boolean \} \}/,
  )
  assert.match(src(WS), /dispatch\(\{ type: "SET_CONFIG", config: normalizeConfig\(msg\.config\) \}\)/)
})

test("FIX 1: absent / non-boolean / {} / flattened never become truthy", () => {
  const base = { llm: COMPANION_PAYLOAD.llm }
  assert.equal((normalizeConfig(base) as any).embedded_terminal, undefined)
  assert.equal(shouldShowEmbeddedTerminalEntry(normalizeConfig(base) as never), false)
  for (const bad of [{ enabled: 1 }, { enabled: "true" }, {}, null, [], "true", true, { enabled: 0 }]) {
    const n = normalizeConfig({ ...base, embedded_terminal: bad })
    assert.equal((n as any).embedded_terminal, undefined, `must not carry ${JSON.stringify(bad)}`)
    assert.equal(shouldShowEmbeddedTerminalEntry(n as never), false)
  }
  // A genuine `false` IS carried (Settings renders the toggle off, not undefined→true).
  assert.deepEqual(
    (normalizeConfig({ ...base, embedded_terminal: { enabled: false } }) as any).embedded_terminal,
    { enabled: false },
  )
  assert.equal(
    shouldShowEmbeddedTerminalEntry(
      normalizeConfig({ ...base, embedded_terminal: { enabled: false } }) as never,
    ),
    false,
  )
  // No flattened key ever comes out of hydration.
  assert.equal((normalizeConfig({ ...base, embedded_terminal_enabled: true }) as any).embedded_terminal, undefined)
})

// ── FIX 2: darwin gate (product requirement: darwin AND enabled) ───────────

test("FIX 2: isDarwin reads userAgentData.platform first (the side-panel signal)", () => {
  assert.equal(isDarwin({ userAgentData: { platform: "macOS" } }), true)
  assert.equal(isDarwin({ userAgentData: { platform: "Windows" } }), false)
  assert.equal(isDarwin({ userAgentData: { platform: "Linux" } }), false)
  assert.equal(isDarwin({ userAgentData: { platform: "Chrome OS" } }), false)
  // Fallbacks when the UA-CH platform is absent/empty.
  assert.equal(isDarwin({ platform: "MacIntel" }), true)
  assert.equal(isDarwin({ platform: "Win32" }), false)
  assert.equal(isDarwin({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" }), true)
  assert.equal(isDarwin({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }), false)
  // iPad/iPhone UAs also say "like Mac OS X" — not a desktop embed target.
  assert.equal(
    isDarwin({ userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15" }),
    false,
  )
})

test("FIX 2: isDarwin is total and fails CLOSED (never throws, never guesses)", () => {
  for (const env of [
    {},
    { userAgentData: null },
    { userAgentData: { platform: undefined } },
    { userAgentData: { platform: "" }, platform: "", userAgent: "" },
    { platform: undefined, userAgent: undefined },
    { userAgentData: { platform: 42 }, platform: ["MacIntel"], userAgent: {} },
    null,
  ]) {
    assert.equal(isDarwin(env as never), false, `fail-closed for ${JSON.stringify(env)}`)
  }
  // Default (no argument) reads the real global; absent navigator / no signal must not throw
  // and must stay false — we never promise an embed the companion would refuse.
  const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator")
  const setNav = (value: unknown) =>
    Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true })
  try {
    setNav(undefined)
    assert.equal(isDarwin(), false)
    setNav({})
    assert.equal(isDarwin(), false)
    setNav({ userAgentData: { platform: "Windows" } })
    assert.equal(isDarwin(), false)
    // …and the global path really is the source of truth (the side panel reports "macOS").
    setNav({ userAgentData: { platform: "macOS" } })
    assert.equal(isDarwin(), true)
  } finally {
    if (saved) Object.defineProperty(globalThis, "navigator", saved)
    else setNav(undefined)
  }
})

// ── Panel source locks ──────────────────────────────────────────────────────

test("panel renders the entry through the gate, label from copy (R1/R2)", () => {
  const panel = src(PANEL)
  assert.match(
    panel,
    /import\s*\{[^}]*shouldShowEmbeddedTerminalEntry[^}]*\}\s*from\s*"\.\.\/coding-handoff\/embed-entry"/,
  )
  assert.match(panel, /shouldShowEmbeddedTerminalEntry\(/)
  // The gate must actually drive the render: enabled === true AND this darwin host AND this
  // thread's embed_intent (a darwin-less gate would promise an embed the companion refuses).
  assert.match(
    panel,
    /const showEmbedEntry =\s*shouldShowEmbeddedTerminalEntry\(embeddedTerminalConfig\) &&\s*isDarwin\(\) &&\s*session\?\.localTerminal === "embed_intent"/,
  )
  assert.match(
    panel,
    /import\s*\{[^}]*\bisDarwin\b[^}]*\}\s*from\s*"\.\.\/coding-handoff\/embed-entry"/,
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
  // The PANEL surface (button rendered below the banner).
  const text = modeCBannerText("embed_intent", { hasEntryButton: true })
  assert.equal(text, codingHandoffCopy.modeCEmbedIntentBanner)
  assert.notStrictEqual(text, codingHandoffCopy.modeCDualProcessBanner)
  assert.notStrictEqual(text, codingHandoffCopy.modeCEmbedIntentBannerNoButton)
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

test("FIX 5: the entry hook attribute is asserted (data-embed-terminal-entry)", () => {
  const panel = src(PANEL)
  const block = panel.match(/<div style=\{styles\.embedEntry\} data-embed-terminal-entry>[\s\S]*?<\/div>/)
  assert.ok(block, "the entry wrapper keeps its test/CSS hook attribute")
  // The hook sits on the wrapper that actually renders the button + footnote.
  assert.match(block![0], /panelOpenEmbeddedTerminal/)
  assert.match(block![0], /panelEmbeddedTerminalHint/)
})

test("FIX 5: panelEmbeddedTerminalHint renders once (footnote) — no duplicate title", () => {
  const panel = src(PANEL)
  assert.equal([...panel.matchAll(/panelEmbeddedTerminalHint/g)].length, 1)
  assert.doesNotMatch(panel, /title=\{codingHandoffCopy\.panelEmbeddedTerminalHint\}/)
})

// ── FIX 3: S6 embed-intent copy lock — CONTENT, not identity ───────────────

/**
 * The identity lock the reviewer mutated (`assert.equal(text, copy.x)` passes for ANY content).
 * These constants are introduced with the content they pin: required phrase + forbidden claims.
 */
const EMBED_INTENT_MUST_SAY = "尚无进程" // "no process yet / waiting to start"
const EMBED_INTENT_MUST_NOT_SAY = [
  "已在终端运行",
  "需自行退出",
  "需在终端自行退出",
  "本机 Terminal 内 Agent",
  "Terminal.app",
]

test("FIX 3: embed_intent copy asserts 'no process yet', and rejects outer-process claims", () => {
  const variants = [
    codingHandoffCopy.modeCEmbedIntentBanner,
    codingHandoffCopy.modeCEmbedIntentBannerNoButton,
  ]
  for (const text of variants) {
    assert.ok(
      text.includes(EMBED_INTENT_MUST_SAY),
      `must convey "no process yet / waiting to start" (missing ${EMBED_INTENT_MUST_SAY}): ${text}`,
    )
    assert.match(text, /确认后才会启动/, "must convey 'waiting for the user to confirm'")
    for (const bad of EMBED_INTENT_MUST_NOT_SAY) {
      assert.ok(!text.includes(bad), `must not claim ${bad}: ${text}`)
    }
  }
  // The exact mutation that slipped past the old lock must now be rejected by these constants.
  const mutation = "模式 C：Agent 已在终端运行，需自行退出。"
  assert.ok(EMBED_INTENT_MUST_NOT_SAY.some((bad) => mutation.includes(bad)))
  assert.ok(!mutation.includes(EMBED_INTENT_MUST_SAY))
})

// ── FIX 4: FocusBand renders no button — its copy must not point at one ────

test("FIX 4: the FocusBand/chip variant does not reference a button it does not render", () => {
  // Default surface = no adjacent button (the chip's call site).
  const chipText = modeCBannerText("embed_intent")
  assert.equal(chipText, codingHandoffCopy.modeCEmbedIntentBannerNoButton)
  assert.doesNotMatch(chipText, /点/, "FocusBand renders no button; copy must not tell the user to click")
  assert.doesNotMatch(chipText, /下方|此处/, "no deictic pointer to a control that is not there")
  assert.match(chipText, /「编程助手」面板/, "must point at the panel/button that does exist")
  // The panel, which really does render the button below the banner, keeps the deictic pointer.
  const panelText = modeCBannerText("embed_intent", { hasEntryButton: true })
  assert.equal(panelText, codingHandoffCopy.modeCEmbedIntentBanner)
  assert.match(panelText, /点下方「在本插件打开终端」/)
  // Wiring: the chip is only rendered by FocusBand and never opts into the button variant;
  // the panel opts in with `showEmbedEntry` (the same predicate that renders the button).
  assert.match(src(CHIP), /modeCBannerText\(session\.localTerminal\)/)
  assert.doesNotMatch(src(CHIP), /hasEntryButton/)
  assert.match(
    src(PANEL),
    /modeCBannerText\(session\?\.localTerminal, \{ hasEntryButton: showEmbedEntry \}\)/,
  )
  assert.match(src(FOCUSBAND), /CodingSessionChip/)
  assert.doesNotMatch(src(FOCUSBAND), /panelOpenEmbeddedTerminal/)
})

// ── FIX 5: the `failed` rung is not rendered, so it is not locked as rendered ─

test("FIX 5: neither Mode C render site can show the `failed` banner (defensive rung)", () => {
  // Both sites gate on a predicate that excludes failed/skipped by construction.
  assert.equal(isModeCInvolved("failed", true), false)
  assert.equal(isModeCInvolved("failed", undefined), false)
  assert.match(src(PANEL), /\{modeCLikely \? \(/)
  assert.match(src(CHIP), /\{live && modeCHint \?/)
  // If a site ever does render it, the copy is still honest (companion copy, one home).
  assert.equal(modeCBannerText("failed"), codingHandoffCopy.modeCTerminalFailedBanner)
  assert.match(modeCBannerText("failed"), /本机终端未打开/)
  assert.doesNotMatch(modeCBannerText("failed"), /已在终端运行|需自行退出/)
})

test("FIX 5: every Mode C banner string lives in copy.ts (one home for user-facing copy)", () => {
  const helper = src(HELPER)
  assert.doesNotMatch(helper, /"模式 C：/, "no prose literal left in the copy ladder")
  for (const key of [
    "modeCEmbedIntentBanner",
    "modeCEmbedIntentBannerNoButton",
    "modeCTerminalPendingBanner",
    "modeCTerminalOpenedL0Banner",
    "modeCTerminalFailedBanner",
    "modeCDualProcessBanner",
  ]) {
    assert.match(helper, new RegExp(`codingHandoffCopy\\.${key}\\b`), `${key} must be sourced from copy.ts`)
    assert.ok(key in codingHandoffCopy, `${key} must exist in copy.ts`)
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
