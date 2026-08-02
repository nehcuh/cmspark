// Pure tests for Trust IA Autopilot tier derivation (design 2026-08-02 §5.2)

import test from "node:test"
import assert from "node:assert/strict"
import {
  deriveAutopilotTier,
  targetFlagsForTier,
  disarmAllFlags,
  flagsNeedingArm,
  flagsNeedingDisarm,
  cruiseChipLabel,
  tierShortLabel,
} from "../src/sidepanel/components/autopilot-tier"

test("deriveAutopilotTier maps all false to off", () => {
  assert.equal(deriveAutopilotTier({}), "off")
  assert.equal(
    deriveAutopilotTier({
      auto_approve_dangerous: false,
      auto_approve_enterprise_tools: false,
      allow_all_schemes: false,
    }),
    "off",
  )
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

test("deriveAutopilotTier maps partial combos to custom", () => {
  assert.equal(deriveAutopilotTier({ allow_all_schemes: true }), "custom")
  assert.equal(deriveAutopilotTier({ auto_approve_enterprise_tools: true }), "custom")
  assert.equal(
    deriveAutopilotTier({
      auto_approve_dangerous: true,
      allow_all_schemes: true,
    }),
    "custom",
  )
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

test("targetFlagsForTier full and full_protocol triples", () => {
  assert.deepEqual(targetFlagsForTier("full", {}), {
    auto_approve_dangerous: true,
    auto_approve_enterprise_tools: true,
    allow_all_schemes: false,
  })
  assert.deepEqual(targetFlagsForTier("full_protocol", {}), {
    auto_approve_dangerous: true,
    auto_approve_enterprise_tools: true,
    allow_all_schemes: true,
  })
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

test("cruiseChipLabel", () => {
  assert.equal(cruiseChipLabel({}), null)
  assert.equal(
    cruiseChipLabel({ auto_approve_dangerous: true }),
    `巡航中 · ${tierShortLabel("browser")}`,
  )
})
