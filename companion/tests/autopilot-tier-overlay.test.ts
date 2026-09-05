import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import {
  deriveAutopilotTier,
  overlayCruiseChipLabel,
  sanitizeOverlayCruiseLabel,
  tierShortLabel,
} from "../src/security/autopilot-tier"

test("overlayCruiseChipLabel maps flags without writing them", () => {
  assert.equal(overlayCruiseChipLabel({}, false), "每次确认")
  assert.equal(
    overlayCruiseChipLabel({ auto_approve_dangerous: true }, false),
    "巡航中 · 网页巡航",
  )
  assert.equal(
    overlayCruiseChipLabel(
      { auto_approve_dangerous: true, auto_approve_enterprise_tools: true },
      false,
    ),
    "巡航中 · 全自动巡航",
  )
  assert.equal(
    overlayCruiseChipLabel(
      {
        auto_approve_dangerous: true,
        auto_approve_enterprise_tools: true,
        allow_all_schemes: true,
      },
      false,
    ),
    "巡航中 · 全自动+协议",
  )
  assert.equal(overlayCruiseChipLabel({}, true), "值守中 · 桌面")
})

test("sanitizeOverlayCruiseLabel strips controls and caps length", () => {
  assert.equal(sanitizeOverlayCruiseLabel(null), undefined)
  assert.equal(sanitizeOverlayCruiseLabel(""), undefined)
  assert.equal(sanitizeOverlayCruiseLabel("  每次确认  "), "每次确认")
  assert.equal(sanitizeOverlayCruiseLabel("a".repeat(80))?.length, 40)
  assert.equal(sanitizeOverlayCruiseLabel("ab\ncd"), "abcd")
})

test("#324 companion labels lockstep with extension AutopilotTier copy", () => {
  const ext = path.resolve(
    __dirname,
    "../../../chrome-extension/src/sidepanel/components/autopilot-tier.ts",
  )
  const src = fs.readFileSync(ext, "utf8")
  for (const label of [
    "每次确认",
    "网页巡航",
    "全自动巡航",
    "全自动+协议",
    "无人值守",
    "值守中 · 桌面",
  ]) {
    assert.ok(src.includes(label), `extension missing ${label}`)
  }
  assert.equal(tierShortLabel("off"), "每次确认")
  assert.equal(deriveAutopilotTier({ auto_approve_dangerous: true }), "browser")
})
