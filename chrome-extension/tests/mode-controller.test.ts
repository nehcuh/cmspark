import test from "node:test"
import assert from "node:assert/strict"
import {
  BROWSER_TOOL_NAMES,
  deriveCapabilityLevel,
  contextBarTabsForLevel,
  levelBadgeLabel,
  type ModeInput,
} from "../src/sidepanel/mode/mode-controller"

const base: ModeInput = {
  now: 1_000_000,
  computerTaskStatus: null,
  computerTaskFinishedAt: null,
  pendingConfirmToolNames: [],
  lastBrowserToolAt: null,
  quiescenceMs: 30_000,
  modePin: null,
}

test("L0 when idle", () => {
  assert.equal(deriveCapabilityLevel(base), "chat")
})

test("L2 when computer task running", () => {
  assert.equal(
    deriveCapabilityLevel({ ...base, computerTaskStatus: "running" }),
    "computer",
  )
})

test("L2 when computer task paused", () => {
  assert.equal(
    deriveCapabilityLevel({ ...base, computerTaskStatus: "paused" }),
    "computer",
  )
})

test("L2 when finished computer task within quiescence window (D15 hysteresis)", () => {
  assert.equal(
    deriveCapabilityLevel({
      ...base,
      computerTaskStatus: "finished",
      computerTaskFinishedAt: base.now - 5_000,
    }),
    "computer",
  )
})

test("L0 when finished computer task outside quiescence", () => {
  assert.equal(
    deriveCapabilityLevel({
      ...base,
      computerTaskStatus: "finished",
      computerTaskFinishedAt: base.now - 60_000,
    }),
    "chat",
  )
})

test("L1 when pending browser-class confirm (e.g. evaluate)", () => {
  assert.equal(
    deriveCapabilityLevel({
      ...base,
      pendingConfirmToolNames: ["evaluate"],
    }),
    "browser",
  )
})

test("L2 when pending host_computer confirm", () => {
  assert.equal(
    deriveCapabilityLevel({
      ...base,
      pendingConfirmToolNames: ["host_computer"],
    }),
    "computer",
  )
})

test("L2 when pending host_app confirm (desktop class)", () => {
  assert.equal(
    deriveCapabilityLevel({
      ...base,
      pendingConfirmToolNames: ["host_app"],
    }),
    "computer",
  )
})

test("L1 when recent browser tool within quiescence", () => {
  assert.equal(
    deriveCapabilityLevel({
      ...base,
      lastBrowserToolAt: base.now - 5_000,
    }),
    "browser",
  )
})

test("L0 when browser tool outside quiescence", () => {
  assert.equal(
    deriveCapabilityLevel({
      ...base,
      lastBrowserToolAt: base.now - 60_000,
    }),
    "chat",
  )
})

test("L2 wins over recent browser tool", () => {
  assert.equal(
    deriveCapabilityLevel({
      ...base,
      computerTaskStatus: "running",
      lastBrowserToolAt: base.now - 1_000,
    }),
    "computer",
  )
})

test("pin blocks down-level only: pin browser stays browser even if idle", () => {
  assert.equal(
    deriveCapabilityLevel({
      ...base,
      modePin: "browser",
      lastBrowserToolAt: null,
    }),
    "browser",
  )
})

test("pin does not block up-level to computer", () => {
  assert.equal(
    deriveCapabilityLevel({
      ...base,
      modePin: "browser",
      computerTaskStatus: "running",
    }),
    "computer",
  )
})

test("BROWSER_TOOL_NAMES includes navigate and list_tabs, not host_computer", () => {
  assert.equal(BROWSER_TOOL_NAMES.has("navigate"), true)
  assert.equal(BROWSER_TOOL_NAMES.has("list_tabs"), true)
  assert.equal(BROWSER_TOOL_NAMES.has("host_computer"), false)
})

test("levelBadgeLabel LIVE only for computer when live=true", () => {
  assert.equal(levelBadgeLabel("computer"), "计算机")
  assert.equal(levelBadgeLabel("computer", { live: true }), "计算机 · LIVE")
  assert.equal(levelBadgeLabel("chat", { live: true }), "聊")
})

test("contextBarTabsForLevel L0", () => {
  assert.deepEqual(contextBarTabsForLevel("chat"), ["skills", "knowledge", "history"])
})

test("contextBarTabsForLevel L1", () => {
  assert.deepEqual(contextBarTabsForLevel("browser"), ["tabs", "skills"])
})

test("contextBarTabsForLevel L2", () => {
  assert.deepEqual(contextBarTabsForLevel("computer"), ["tabs", "apps", "mcp"])
})
