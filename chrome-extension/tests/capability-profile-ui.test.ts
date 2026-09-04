/**
 * #284: settings capability-profile switch UI logic.
 *
 *  - Confirm copy: upgrade spells the blast radius (shell_exec / netsec
 *    unlockability); downgrade spells the forced shell/netsec power-off.
 *  - 未确认绝不发消息: resolveProfileSwitchSend returns null unless the user
 *    confirmed AND the target differs — no live config write without consent.
 *  - Structure: SettingsSlideout embeds the section; the section sends only
 *    modules.set_profile through the helpers; gate-error-copy points the
 *    enterprise dead-end at the new settings entry.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  buildProfileSwitchConfirm,
  resolveProfileSwitchSend,
  type CapabilityProfile,
} from "../src/sidepanel/utils/capability-profile"

function confirmFor(to: CapabilityProfile, shellEnabled: boolean, netsecEnabled: boolean) {
  return buildProfileSwitchConfirm({
    from: to === "enterprise" ? "community" : "enterprise",
    to,
    shellEnabled,
    netsecEnabled,
  })
}

test("#284 upgrade confirm spells the blast radius", () => {
  const c = confirmFor("enterprise", false, false)
  if (!c) throw new Error("enterprise switch needs a confirm")
  assert.ok(/enterprise/.test(c.title))
  assert.ok(
    /shell_exec|netsec/.test(c.body),
    "body must name what enterprise unlocks (shell_exec / netsec)",
  )
  assert.ok(c.confirmLabel.length > 0)
})

test("#284 downgrade confirm spells the forced shell/netsec power-off when any is on", () => {
  const both = confirmFor("community", true, true)
  if (!both) throw new Error("downgrade switch needs a confirm")
  assert.ok(/强制|一并关闭|断电/.test(both.body), "body must say shell/netsec will be powered off")
  assert.ok(/shell/.test(both.body) && /netsec/.test(both.body))

  const shellOnly = confirmFor("community", true, false)
  if (!shellOnly) throw new Error("shell-only downgrade needs a confirm")
  assert.ok(/shell/.test(shellOnly.body))

  const none = confirmFor("community", false, false)
  assert.ok(none, "downgrade still confirms even with nothing to disable")
})

test("#284 same-profile switch needs no confirm (null)", () => {
  assert.equal(
    buildProfileSwitchConfirm({ from: "community", to: "community", shellEnabled: false, netsecEnabled: false }),
    null,
  )
  assert.equal(
    buildProfileSwitchConfirm({ from: "enterprise", to: "enterprise", shellEnabled: true, netsecEnabled: true }),
    null,
  )
})

test("#284 未确认不写 live config：send resolver refuses unconfirmed switches", () => {
  assert.equal(
    resolveProfileSwitchSend({ confirmed: false, from: "community", to: "enterprise" }),
    null,
    "unconfirmed → no message → no config write",
  )
  assert.equal(
    resolveProfileSwitchSend({ confirmed: false, from: "enterprise", to: "community" }),
    null,
  )
  assert.deepEqual(resolveProfileSwitchSend({ confirmed: true, from: "community", to: "enterprise" }), {
    type: "modules.set_profile",
    profile: "enterprise",
  })
  assert.deepEqual(resolveProfileSwitchSend({ confirmed: true, from: "enterprise", to: "community" }), {
    type: "modules.set_profile",
    profile: "community",
  })
  assert.equal(
    resolveProfileSwitchSend({ confirmed: true, from: "community", to: "community" }),
    null,
    "same-profile must never send",
  )
})

test("#284 structure: section is embedded, sends via helpers, gate copy points to the entry", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")

  const slideout = read("src/sidepanel/components/SettingsSlideout.tsx")
  assert.match(slideout, /<CapabilityProfileSection \/>/, "settings must embed the 能力档 section")

  const section = read("src/sidepanel/components/CapabilityProfileSection.tsx")
  assert.match(section, /buildProfileSwitchConfirm/, "confirm copy must come from the helper")
  assert.match(section, /resolveProfileSwitchSend/, "send must go through the consent-gated helper")
  assert.match(section, /modules\.set_profile/, "wire type must be modules.set_profile")
  assert.doesNotMatch(section, /config\.set/, "profile switch must not use the raw config.set channel")

  const copy = read("src/sidepanel/utils/gate-error-copy.ts")
  assert.match(
    copy,
    /能力档/,
    "enterprise_profile_required copy must point to the settings entry (no dead end)",
  )
})
