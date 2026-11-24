import test from "node:test"
import assert from "node:assert/strict"
import { normalizeConfig } from "../src/sidepanel/utils/normalize-config"
import { shouldOfferVisionReuse, clearNativeVisionProbe, rememberNativeVisionProbe } from "../src/sidepanel/components/vision-reuse-logic"

test("904 normalization preserves explicit reuse off and supports legacy main preference", () => {
  for (const reuse of [false, true]) {
    const normalized = normalizeConfig({ llm: {}, vision: { enabled: true, reuse_main_model: reuse } })
    assert.equal((normalized as any).vision_reuse_main_model, reuse)
  }
  assert.equal((normalizeConfig({ llm: {}, vision: { enabled: true } }) as any).vision_reuse_main_model, true)
})

test("904 reuse availability honors native override and endpoint-keyed probe results", () => {
  clearNativeVisionProbe()
  try {
    const disabled = { model_name: "gpt-4o", native_vision: "off" as const }
    assert.equal(shouldOfferVisionReuse(disabled), false)
    const forced = { model_name: "custom-model", native_vision: "on" as const }
    assert.equal(shouldOfferVisionReuse(forced), true)
    rememberNativeVisionProbe("https://main.invalid/v1", "gpt-4o", false)
    assert.equal(shouldOfferVisionReuse({ model_name: "gpt-4o", base_url: "https://main.invalid/v1" }), false)
    rememberNativeVisionProbe("https://main.invalid/v1", "custom-model", true)
    assert.equal(shouldOfferVisionReuse({ model_name: "custom-model", base_url: "https://main.invalid/v1" }), true)
  } finally { clearNativeVisionProbe() }
})
