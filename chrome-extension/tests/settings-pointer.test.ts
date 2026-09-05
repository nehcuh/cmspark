// GitHub #322: SETTINGS_REQUIRED pointer card — extractor + template + deep-link.
//
// The card renders fixed copy only; the deep-link lands on a whitelisted
// settings accordion section and pre-fills nothing. These tests pin:
//  * extractor shape (valid frame → view; every deviation → null, fail-closed)
//  * the exact template line (fixed label + companion static path)
//  * template never quotes the arming phrase (「我了解风险」)
//  * OPEN_SETTINGS_SECTION reducer lands settingsOpen + focusSection

import test from "node:test"
import assert from "node:assert/strict"

import {
  SETTINGS_POINTER_CTA,
  SETTINGS_POINTER_LABEL,
  extractSettingsPointer,
  settingsPointerLine,
} from "../src/sidepanel/utils/settings-pointer"
import { SETTINGS_SECTION_IDS } from "../src/sidepanel/utils/settings-sections"
import { agentReducer, initialState } from "../src/sidepanel/store/agentStore"

const FRAME = {
  success: false,
  error: "module_disabled:netsec — enable in settings (modules.set_enabled) before use\nsettings_path: 设置 → 本机与集成 → 网络扫描（NetSec）",
  data: {
    error_code: "SETTINGS_REQUIRED",
    reason: "module_disabled",
    settings_section: "integrations",
    settings_path: "设置 → 本机与集成 → 网络扫描（NetSec）",
  },
}

test("extractSettingsPointer: valid frame → view with whitelisted section", () => {
  const view = extractSettingsPointer(FRAME)
  assert.deepEqual(view, {
    settings_section: "integrations",
    settings_path: "设置 → 本机与集成 → 网络扫描（NetSec）",
  })
})

test("extractSettingsPointer: fail-closed on shape deviations", () => {
  // success result — no pointer
  assert.equal(extractSettingsPointer({ success: true, data: FRAME.data }), null)
  // wrong error_code
  assert.equal(
    extractSettingsPointer({ success: false, data: { ...FRAME.data, error_code: "NETSEC_SCOPE_DENIED" } }),
    null,
  )
  // section not in SETTINGS_SECTION_IDS — deep-link must never land elsewhere
  assert.equal(
    extractSettingsPointer({ success: false, data: { ...FRAME.data, settings_section: "evil" } }),
    null,
  )
  assert.equal(
    extractSettingsPointer({ success: false, data: { ...FRAME.data, settings_section: "constructor" } }),
    null,
  )
  // missing / non-string / oversized path
  assert.equal(extractSettingsPointer({ success: false, data: { ...FRAME.data, settings_path: undefined } }), null)
  assert.equal(extractSettingsPointer({ success: false, data: { ...FRAME.data, settings_path: "" } }), null)
  assert.equal(
    extractSettingsPointer({ success: false, data: { ...FRAME.data, settings_path: "x".repeat(121) } }),
    null,
  )
  // missing data / garbage input
  assert.equal(extractSettingsPointer({ success: false, error: "x" }), null)
  assert.equal(extractSettingsPointer(null), null)
  assert.equal(extractSettingsPointer("SETTINGS_REQUIRED"), null)
})

test("settingsPointerLine: template = fixed label + static path (no model free text)", () => {
  const view = extractSettingsPointer(FRAME)!
  assert.equal(
    settingsPointerLine(view),
    "此能力需要先在设置中开启：设置 → 本机与集成 → 网络扫描（NetSec）",
  )
})

test("template copy never quotes or explains the arming phrase", () => {
  for (const s of [SETTINGS_POINTER_LABEL, SETTINGS_POINTER_CTA]) {
    assert.ok(!s.includes("我了解风险"))
    assert.ok(!s.includes("短语"))
  }
  const view = extractSettingsPointer(FRAME)!
  assert.ok(!settingsPointerLine(view).includes("我了解风险"))
})

test("deep-link: OPEN_SETTINGS_SECTION lands settings open + integrations focus", () => {
  const next = agentReducer(initialState, { type: "OPEN_SETTINGS_SECTION", section: "integrations" })
  assert.equal(next.settingsOpen, true)
  assert.equal(next.settingsFocusSection, "integrations")
})

test("deep-link target must be a canonical section id (integrations exists)", () => {
  assert.ok((SETTINGS_SECTION_IDS as readonly string[]).includes("integrations"))
})
