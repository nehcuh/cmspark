// #325 Composer cruise picker — display is live deriveAutopilotTier, four slots,
// no unattended, no new config enum. Source scans lock the UI contract.

import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import {
  COMPOSER_CRUISE_SLOTS,
  COMPOSER_CRUISE_SCOPE_NOTE,
  AUTOPILOT_ARM_PHRASE,
  composerCruiseChipLabel,
  composerSlotFlags,
  composerPickNeedsArm,
  composerSlotWrites,
  deriveAutopilotTier,
  deriveDisplayTier,
  disarmAllFlags,
  flagsNeedingArm,
  targetFlagsForTier,
  tierShortLabel,
  type ComposerCruiseSlot,
} from "../src/sidepanel/components/autopilot-tier"

function srcFile(...parts: string[]): string {
  return path.join(process.cwd(), "src", ...parts)
}

test("#325 composer slots are four cruise tiers, never unattended", () => {
  assert.deepEqual([...COMPOSER_CRUISE_SLOTS], ["off", "browser", "full", "full_protocol"])
  assert.equal((COMPOSER_CRUISE_SLOTS as readonly string[]).includes("unattended"), false)
  assert.equal((COMPOSER_CRUISE_SLOTS as readonly string[]).includes("custom"), false)
})

test("#325 slot labels match Settings / matrix (no 自动编辑 / 完全访问)", () => {
  const labels = COMPOSER_CRUISE_SLOTS.map((s) => tierShortLabel(s))
  assert.deepEqual(labels, ["每次确认", "网页巡航", "全自动巡航", "全自动+协议"])
  const blob = labels.join("\n")
  assert.doesNotMatch(blob, /自动编辑/)
  assert.doesNotMatch(blob, /完全访问/)
  assert.doesNotMatch(blob, /无人值守/)
})

test("#325 chip label is live deriveAutopilotTier with zero module cache", () => {
  const a = composerCruiseChipLabel({})
  const b = composerCruiseChipLabel({ auto_approve_dangerous: true })
  const c = composerCruiseChipLabel({
    auto_approve_dangerous: true,
    auto_approve_enterprise_tools: true,
  })
  const d = composerCruiseChipLabel({
    auto_approve_dangerous: true,
    auto_approve_enterprise_tools: true,
    allow_all_schemes: true,
  })
  const e = composerCruiseChipLabel({})
  assert.equal(a, "每次确认")
  assert.equal(b, "网页巡航")
  assert.equal(c, "全自动巡航")
  assert.equal(d, "全自动+协议")
  assert.equal(e, "每次确认", "later call must not remember prior flags")
  assert.equal(composerCruiseChipLabel({ allow_all_schemes: true }), "自定义")
})

test("#325 composer chip shows 值守 when unattended grant is armed", () => {
  const flags = { auto_approve_dangerous: true }
  assert.equal(deriveDisplayTier(flags, true), "unattended")
  assert.equal(composerCruiseChipLabel(flags, true), tierShortLabel("unattended"))
  assert.match(composerCruiseChipLabel(flags, true), /值守/)
  assert.equal(composerCruiseChipLabel(flags, false), "网页巡航")
  assert.equal(composerCruiseChipLabel(flags), "网页巡航", "default unarmed is flags-only")
})

test("#325 composerSlotFlags reuses disarmAllFlags / targetFlagsForTier; browser is canonical", () => {
  assert.deepEqual(composerSlotFlags("off"), disarmAllFlags())
  assert.deepEqual(
    composerSlotFlags("browser"),
    targetFlagsForTier("browser", { auto_approve_enterprise_tools: false }),
  )
  assert.equal(composerSlotFlags("browser").auto_approve_enterprise_tools, false)
  assert.deepEqual(composerSlotFlags("full"), targetFlagsForTier("full", {}))
  assert.deepEqual(composerSlotFlags("full_protocol"), targetFlagsForTier("full_protocol", {}))
})

test("#325 upgrade needs phrase (flagsNeedingArm); downgrade / off does not", () => {
  const off = {}
  const browser = { auto_approve_dangerous: true }
  const full = {
    auto_approve_dangerous: true,
    auto_approve_enterprise_tools: true,
  }
  const proto = {
    auto_approve_dangerous: true,
    auto_approve_enterprise_tools: true,
    allow_all_schemes: true,
  }

  assert.equal(composerPickNeedsArm(off, "browser"), true)
  assert.equal(composerPickNeedsArm(off, "full"), true)
  assert.equal(composerPickNeedsArm(browser, "full_protocol"), true)
  assert.equal(composerPickNeedsArm(full, "off"), false)
  assert.equal(composerPickNeedsArm(proto, "browser"), false)
  assert.equal(composerPickNeedsArm(proto, "off"), false)
  assert.equal(composerPickNeedsArm(browser, "browser"), false)

  const up = composerSlotWrites(off, "browser")
  assert.ok(up.some((w) => w.needsPhrase && w.value === true))
  const down = composerSlotWrites(proto, "browser")
  assert.ok(down.length > 0)
  assert.ok(down.every((w) => w.value === false && w.needsPhrase === false))
  const toOff = composerSlotWrites(full, "off")
  assert.ok(toOff.every((w) => w.value === false && w.needsPhrase === false))
})

test("#325 custom mix: arming still gated; extra flags disarm without phrase", () => {
  const customSchemesOnly = { allow_all_schemes: true }
  assert.equal(deriveAutopilotTier(customSchemesOnly), "custom")
  assert.equal(composerPickNeedsArm(customSchemesOnly, "browser"), true)
  assert.deepEqual(
    flagsNeedingArm(customSchemesOnly, composerSlotFlags("browser")),
    ["auto_approve_dangerous"],
  )
  const writes = composerSlotWrites(customSchemesOnly, "browser")
  assert.ok(writes.some((w) => w.flag === "auto_approve_dangerous" && w.needsPhrase))
  assert.ok(writes.some((w) => w.flag === "allow_all_schemes" && w.value === false && !w.needsPhrase))
})

test("#325 scope copy is global v1, not per-thread", () => {
  assert.equal(COMPOSER_CRUISE_SCOPE_NOTE, "对本机全部对话生效")
  assert.equal(AUTOPILOT_ARM_PHRASE, "我了解风险")
})

test("#325 picker source: live derive, no display cache, no unattended slot, no banned words", () => {
  const picker = fs.readFileSync(
    srcFile("sidepanel", "components", "ComposerCruisePicker.tsx"),
    "utf8",
  )
  const app = fs.readFileSync(srcFile("sidepanel", "App.tsx"), "utf8")
  assert.match(app, /ComposerCruisePicker/)
  assert.match(picker, /composerCruiseChipLabel/)
  assert.match(picker, /deriveDisplayTier|unattendedArmed/)
  assert.match(picker, /COMPOSER_CRUISE_SCOPE_NOTE/)
  assert.match(picker, /AUTOPILOT_CONSEQUENCE_ROWS|AutopilotConsequenceMatrix/)
  assert.match(picker, /confirmation_phrase/)
  assert.match(picker, /config\.set/)
  assert.doesNotMatch(picker, /useState<[^>]*Tier/)
  assert.doesNotMatch(picker, /cachedTier|lastTier|storedTier/)
  assert.doesNotMatch(picker, /自动编辑/)
  assert.doesNotMatch(picker, /完全访问/)
  assert.doesNotMatch(picker, /arm_source|expires_at|ttl/i)
  // Slots stay cruise-only — grant may appear in display/disarm paths, never as a slot.
  assert.equal((COMPOSER_CRUISE_SLOTS as readonly string[]).includes("unattended"), false)
  assert.doesNotMatch(COMPOSER_CRUISE_SLOTS.join(","), /unattended/)
  const slots: ComposerCruiseSlot[] = ["off", "browser", "full", "full_protocol"]
  assert.equal(slots.length, 4)
})

test("#325 applySlot sends unattended.disarm before cruise flag writes", () => {
  const picker = fs.readFileSync(
    srcFile("sidepanel", "components", "ComposerCruisePicker.tsx"),
    "utf8",
  )
  const apply = picker.slice(picker.indexOf("const applySlot"), picker.indexOf("const onPick"))
  const disarmAt = apply.indexOf('type: "security.unattended.disarm"')
  const clearAt = apply.indexOf("clear_cruise: false")
  const writeAt = apply.indexOf("sendSecurityFlagConfig")
  assert.ok(disarmAt >= 0, "must send security.unattended.disarm")
  assert.ok(clearAt > disarmAt, "clear_cruise:false (flags written next)")
  assert.ok(writeAt > clearAt, "disarm must precede config.set flag writes")
  assert.match(apply, /ADD_SECURITY_AUDIT/)
})

test("#325 picker chip label is deriveDisplayTier of live flags + grant", () => {
  const picker = fs.readFileSync(
    srcFile("sidepanel", "components", "ComposerCruisePicker.tsx"),
    "utf8",
  )
  assert.match(picker, /state\.unattended\?\.armed === true/)
  assert.match(picker, /composerCruiseChipLabel\(flags,\s*unattendedArmed\)/)
})
