import test from "node:test"
import assert from "node:assert/strict"
import {
  defaultUserOpenSections,
  isElevatedTrust,
  isSectionEffectivelyOpen,
  parseSettingsExpand,
  toggleSectionOpen,
  serializeSettingsExpand,
} from "../src/sidepanel/utils/settings-sections"

test("defaultUserOpenSections: unpaired opens connection+model; paired model only", () => {
  assert.deepEqual([...defaultUserOpenSections(false)].sort(), ["connection", "model"])
  assert.deepEqual([...defaultUserOpenSections(null)].sort(), ["connection", "model"])
  assert.deepEqual([...defaultUserOpenSections(true)], ["model"])
})

test("isElevatedTrust covers F-S3 set", () => {
  assert.equal(isElevatedTrust({}), false)
  assert.equal(isElevatedTrust({ auto_approve_dangerous: true }), true)
  assert.equal(isElevatedTrust({ auto_approve_enterprise_tools: true }), true)
  assert.equal(isElevatedTrust({ allow_all_schemes: true }), true)
  assert.equal(isElevatedTrust({ unattendedArmed: true }), true)
})

test("isSectionEffectivelyOpen: unpaired forces connection; elevated does not force security", () => {
  const empty = new Set([]) as Set<"connection" | "model" | "secrets" | "security" | "integrations" | "export" | "experimental">
  // unpaired forces connection even if user closed it
  assert.equal(
    isSectionEffectivelyOpen("connection", {
      userOpen: empty,
      wsPaired: false,
      elevatedTrust: false,
    }),
    true,
  )
  // paired + user closed connection → closed
  assert.equal(
    isSectionEffectivelyOpen("connection", {
      userOpen: empty,
      wsPaired: true,
      elevatedTrust: false,
    }),
    false,
  )
  // elevated trust no longer force-opens security (collapsible; badge is separate)
  assert.equal(
    isSectionEffectivelyOpen("security", {
      userOpen: empty,
      wsPaired: true,
      elevatedTrust: true,
    }),
    false,
  )
  assert.equal(
    isSectionEffectivelyOpen("security", {
      userOpen: new Set(["security"]),
      wsPaired: true,
      elevatedTrust: true,
    }),
    true,
  )
  // user open model
  assert.equal(
    isSectionEffectivelyOpen("model", {
      userOpen: new Set(["model"]),
      wsPaired: true,
      elevatedTrust: false,
    }),
    true,
  )
})

test("parse/serialize expand LS", () => {
  assert.equal(parseSettingsExpand(null), null)
  const s = parseSettingsExpand(JSON.stringify(["model", "secrets", "nope"]))
  assert.ok(s)
  assert.equal(s!.has("model"), true)
  assert.equal(s!.has("secrets"), true)
  assert.equal(s!.has("connection"), false)
  const again = parseSettingsExpand(serializeSettingsExpand(s!))
  assert.deepEqual([...again!].sort(), [...s!].sort())
})

test("toggleSectionOpen", () => {
  const a = toggleSectionOpen("export", new Set(["model"]))
  assert.equal(a.has("export"), true)
  assert.equal(a.has("model"), true)
  const b = toggleSectionOpen("model", a)
  assert.equal(b.has("model"), false)
})
