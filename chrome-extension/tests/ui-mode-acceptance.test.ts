// Spec §8 acceptance — automated subset (three-mode redesign P0–P2 + residual).
// Full hand-test checklist lives in docs; these tests pin product rules in code.

import test from "node:test"
import assert from "node:assert/strict"
import {
  deriveCapabilityLevel,
  contextBarTabsForLevel,
  contextBarOverflowTabsForLevel,
  levelBadgeLabel,
  levelEscalateToast,
  type ModeInput,
} from "../src/sidepanel/mode/mode-controller"
import { isCockpitTabUrl, COCKPIT_SESSION_KEY } from "../src/background/cockpit-window"
import { tokens, riskLabel } from "../src/sidepanel/ui/tokens"

const base: ModeInput = {
  now: 1_000_000,
  computerTaskStatus: null,
  computerTaskFinishedAt: null,
  pendingConfirmToolNames: [],
  lastBrowserToolAt: null,
  quiescenceMs: 30_000,
  modePin: null,
}

// --- P0 ---

test("§8 P0: idle chat is L0", () => {
  assert.equal(deriveCapabilityLevel(base), "chat")
  assert.equal(levelBadgeLabel("chat"), "聊")
})

test("§8 P0: first browser tool → L1", () => {
  assert.equal(
    deriveCapabilityLevel({ ...base, lastBrowserToolAt: base.now - 1_000 }),
    "browser",
  )
  assert.equal(levelEscalateToast("browser"), "已升级至网页 Agent — 可操作浏览器标签页")
})

test("§8 P0: host_computer task → L2", () => {
  assert.equal(
    deriveCapabilityLevel({ ...base, computerTaskStatus: "running" }),
    "computer",
  )
  assert.equal(levelBadgeLabel("computer", { live: true }), "计算机 · LIVE")
})

test("§8 P0: L0 BottomBar not six-pack (exactly Skills·Know·Hist)", () => {
  const tabs = contextBarTabsForLevel("chat")
  assert.deepEqual(tabs, ["skills", "knowledge", "history"])
  assert.ok(tabs.length <= 3)
})

test("§8 P0: short interleaved text does not yo-yo (quiescence holds L1)", () => {
  // Within 30s of last browser tool, still L1 even without new tools
  assert.equal(
    deriveCapabilityLevel({
      ...base,
      lastBrowserToolAt: base.now - 10_000,
    }),
    "browser",
  )
})

// --- P1 ---

test("§8 P1: L2 panel context bar empty (Cockpit owns power tools)", () => {
  assert.deepEqual(contextBarTabsForLevel("computer"), [])
})

test("§8 P1: packs/board available via overflow not permanent L0 tabs", () => {
  const primary = contextBarTabsForLevel("chat")
  const overflow = contextBarOverflowTabsForLevel("chat")
  assert.ok(!primary.includes("packs") && !primary.includes("board"))
  assert.ok(overflow.includes("packs") && overflow.includes("board"))
})

test("§8 P1: cockpit session key stable for SW reclaim", () => {
  assert.equal(COCKPIT_SESSION_KEY, "cmspark.cockpitWindowId")
  assert.equal(
    isCockpitTabUrl("chrome-extension://x/tabs/cockpit.html?t=1", "chrome-extension://x/tabs/cockpit.html"),
    true,
  )
})

// --- P2 residual ---

test("§8 residual: pin blocks auto-down only", () => {
  assert.equal(
    deriveCapabilityLevel({ ...base, modePin: "browser" }),
    "browser",
  )
  assert.equal(
    deriveCapabilityLevel({
      ...base,
      modePin: "browser",
      computerTaskStatus: "running",
    }),
    "computer",
  )
})

test("§8 residual: risk labels not color-only (text exists)", () => {
  assert.equal(riskLabel("high"), "高风险")
  assert.equal(riskLabel("low"), "低风险")
})

test("§8 residual: quiet-professional accent not Material blue", () => {
  assert.equal(tokens.accent, "#2563eb")
  assert.ok(tokens.darkWarning)
})
