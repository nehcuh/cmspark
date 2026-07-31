import test from "node:test"
import assert from "node:assert/strict"
import {
  tokens,
  riskColor,
  riskColorDark,
  riskLabel,
  statusColor,
  connectionColor,
  connectionColorDark,
  connectionLabel,
  connectionDotShadow,
  connectionDotShadowDark,
} from "../src/sidepanel/ui/tokens"

test("tokens accent is quiet-premium indigo not Material", () => {
  assert.equal(tokens.accent, "#4f46e5")
  const accent: string = tokens.accent
  const danger: string = tokens.danger
  assert.ok(accent !== "#4A90D9")
  assert.ok(danger !== "#F44336")
  assert.ok(accent !== "#2563eb") // former bright blue — upgraded for premium pass
})

test("darkWarning tokens exist for SafetyStrip", () => {
  assert.ok(tokens.darkWarning)
  assert.ok(tokens.darkWarningBg)
})

test("riskColor maps levels without Material hexes", () => {
  assert.equal(riskColor("low"), tokens.warning)
  assert.equal(riskColor("high"), tokens.danger)
  assert.equal(riskLabel("medium"), "中风险")
  assert.ok(!riskColor("high").includes("F44336"))
})

test("riskColorDark for dark surfaces", () => {
  assert.equal(riskColorDark("low"), tokens.darkWarning)
  assert.equal(riskColorDark("high"), tokens.darkDanger)
})

test("statusColor semantic", () => {
  assert.equal(statusColor("success"), tokens.success)
  assert.equal(statusColor("error"), tokens.danger)
  assert.equal(statusColor("running"), tokens.warning)
})

test("connectionColor uses status tokens only (no Material hex)", () => {
  assert.equal(connectionColor("connected"), tokens.success)
  assert.equal(connectionColor("connecting"), tokens.warning)
  assert.equal(connectionColor("disconnected"), tokens.danger)
  for (const s of ["connected", "connecting", "disconnected"] as const) {
    const c = connectionColor(s)
    assert.ok(c !== "#4CAF50" && c !== "#FF9800" && c !== "#F44336", c)
  }
  assert.equal(connectionLabel("connected"), "已连接")
  assert.equal(connectionLabel("connecting"), "连接中")
  assert.equal(connectionLabel("disconnected"), "未连接")
  assert.ok(connectionDotShadow("connected").includes("5, 150, 105"))
  assert.equal(connectionDotShadow("disconnected"), "none")
})

test("connectionColorDark uses dark status roles (Cockpit StatusRail)", () => {
  assert.equal(connectionColorDark("connected"), tokens.darkLive)
  assert.equal(connectionColorDark("connecting"), tokens.darkWarning)
  assert.equal(connectionColorDark("disconnected"), tokens.darkDanger)
  for (const s of ["connected", "connecting", "disconnected"] as const) {
    const c = connectionColorDark(s)
    assert.ok(c !== "#4CAF50" && c !== "#FF9800" && c !== "#F44336", c)
  }
  assert.ok(connectionDotShadowDark("connected").includes("52, 211, 153"))
  assert.equal(connectionDotShadowDark("disconnected"), "none")
  // Shared labels with Panel light grammar
  assert.equal(connectionLabel("connected"), "已连接")
})

test("radius SoT is 6/8/12 (UIUX v2)", () => {
  assert.equal(tokens.radiusSm, 6)
  assert.equal(tokens.radiusMd, 8)
  assert.equal(tokens.radiusLg, 12)
  assert.equal(tokens.radiusPill, 999)
})

test("semantic role hexes match Quiet Premium + G1 breath tokens", () => {
  // surface.canvas / elevated (G1 airier canvas)
  assert.equal(tokens.bg, "#f5f6fa")
  assert.equal(tokens.bgElevated, "#ffffff")
  assert.equal(tokens.darkBg, "#0b0d12")
  assert.equal(tokens.darkElevated, "#141820")
  // text
  assert.equal(tokens.text, "#0f172a")
  assert.equal(tokens.textSecondary, "#475569")
  // borders are translucent rgba (not flat gray)
  assert.ok(String(tokens.border).includes("rgba"))
  assert.ok(String(tokens.darkBorder).includes("rgba"))
  // status.live / warn / danger
  assert.equal(tokens.success, "#059669")
  assert.equal(tokens.warning, "#d97706")
  assert.equal(tokens.danger, "#dc2626")
  assert.equal(tokens.darkLive, "#34d399")
  assert.equal(tokens.darkWarning, "#fbbf24")
  assert.equal(tokens.darkDanger, "#f87171")
  assert.equal(tokens.accent, "#4f46e5")
  assert.equal(tokens.darkAccent, "#818cf8")
  assert.ok(tokens.shadowFocus)
  assert.ok(tokens.shadowLg)
  // G1 shape scale for hero surfaces
  assert.equal(tokens.radiusComposer, 18)
  assert.equal(tokens.radiusBubble, 18)
  assert.ok(tokens.dangerSurface.includes("220, 38, 38"))
  assert.ok(tokens.modeBrowserLine)
  assert.ok(tokens.modeComputerLine)
})
