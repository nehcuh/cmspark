import test from "node:test"
import assert from "node:assert/strict"
import {
  tokens,
  riskColor,
  riskColorDark,
  riskLabel,
  statusColor,
  connectionColor,
  connectionLabel,
  connectionDotShadow,
} from "../src/sidepanel/ui/tokens"

test("tokens accent is quiet-professional blue not Material", () => {
  assert.equal(tokens.accent, "#2563eb")
  const accent: string = tokens.accent
  const danger: string = tokens.danger
  assert.ok(accent !== "#4A90D9")
  assert.ok(danger !== "#F44336")
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
  assert.ok(connectionDotShadow("connected").includes("22, 163, 74"))
  assert.equal(connectionDotShadow("disconnected"), "none")
})
