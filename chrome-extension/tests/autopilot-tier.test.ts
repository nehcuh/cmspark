// Pure tests for Trust IA Autopilot + ADR-021 unattended tier

import test from "node:test"
import assert from "node:assert/strict"
import {
  deriveAutopilotTier,
  deriveDisplayTier,
  targetFlagsForTier,
  disarmAllFlags,
  flagsNeedingArm,
  flagsNeedingDisarm,
  cruiseChipLabel,
  trustStatusChip,
  trustStatusChipShort,
  tierShortLabel,
} from "../src/sidepanel/components/autopilot-tier"

test("deriveAutopilotTier maps all false to off", () => {
  assert.equal(deriveAutopilotTier({}), "off")
})

test("deriveAutopilotTier maps browser / full / full_protocol", () => {
  assert.equal(deriveAutopilotTier({ auto_approve_dangerous: true }), "browser")
  assert.equal(
    deriveAutopilotTier({
      auto_approve_dangerous: true,
      auto_approve_enterprise_tools: true,
    }),
    "full",
  )
  assert.equal(
    deriveAutopilotTier({
      auto_approve_dangerous: true,
      auto_approve_enterprise_tools: true,
      allow_all_schemes: true,
    }),
    "full_protocol",
  )
})

test("deriveDisplayTier prefers unattended when grant armed", () => {
  assert.equal(
    deriveDisplayTier({ auto_approve_dangerous: true }, true),
    "unattended",
  )
  assert.equal(deriveDisplayTier({ auto_approve_dangerous: true }, false), "browser")
})

test("trustStatusChip unattended priority", () => {
  assert.equal(trustStatusChip({}, true), "值守中 · 桌面")
  assert.equal(
    trustStatusChip({ auto_approve_dangerous: true }, false),
    `巡航中 · ${tierShortLabel("browser")}`,
  )
  assert.equal(cruiseChipLabel({}), null)
})

test("trustStatusChipShort is two-hanzi rail compact", () => {
  assert.equal(trustStatusChipShort({}, true), "值守")
  assert.equal(trustStatusChipShort({ auto_approve_dangerous: true }, false), "巡航")
  assert.equal(
    trustStatusChipShort(
      { auto_approve_dangerous: true, auto_approve_enterprise_tools: true },
      false,
    ),
    "巡航",
  )
  assert.equal(trustStatusChipShort({}, false), null)
  assert.equal(trustStatusChip({}, true), "值守中 · 桌面")
})

test("targetFlagsForTier unattended with/without protocol", () => {
  assert.deepEqual(targetFlagsForTier("unattended", {}, { includeProtocol: false }), {
    auto_approve_dangerous: true,
    auto_approve_enterprise_tools: true,
    allow_all_schemes: false,
  })
  assert.deepEqual(targetFlagsForTier("unattended", {}, { includeProtocol: true }), {
    auto_approve_dangerous: true,
    auto_approve_enterprise_tools: true,
    allow_all_schemes: true,
  })
})

test("targetFlagsForTier browser keeps enterprise, clears protocol", () => {
  const t = targetFlagsForTier("browser", {
    auto_approve_enterprise_tools: true,
    allow_all_schemes: true,
  })
  assert.equal(t.auto_approve_dangerous, true)
  assert.equal(t.auto_approve_enterprise_tools, true)
  assert.equal(t.allow_all_schemes, false)
})

test("flagsNeedingArm only false→true", () => {
  assert.deepEqual(
    flagsNeedingArm(
      { auto_approve_dangerous: true },
      {
        auto_approve_dangerous: true,
        auto_approve_enterprise_tools: true,
        allow_all_schemes: true,
      },
    ),
    ["auto_approve_enterprise_tools", "allow_all_schemes"],
  )
})

test("flagsNeedingDisarm only true→false", () => {
  assert.deepEqual(
    flagsNeedingDisarm(
      {
        auto_approve_dangerous: true,
        allow_all_schemes: true,
      },
      disarmAllFlags(),
    ),
    ["auto_approve_dangerous", "allow_all_schemes"],
  )
})
