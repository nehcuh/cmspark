import test from "node:test"
import assert from "node:assert/strict"
import {
  tokens,
  riskColor,
  riskColorDark,
  riskLabel,
  statusColor,
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
