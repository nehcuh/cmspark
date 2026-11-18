import assert from "node:assert/strict"
import test from "node:test"
import { resolveLocalFallbackActive } from "../src/sidepanel/hooks/useVoiceInput"
import {
  externalCancelCopy,
  externalLanguageTag,
  externalLimitCopy,
  externalPrivacyCopy,
  externalShouldRefine,
} from "../src/sidepanel/voice/external-asr-ui"

test("language tag and refine gate", () => {
  assert.equal(externalLanguageTag("zh-CN"), "zh")
  assert.equal(externalShouldRefine(false, "你好"), false)
  assert.equal(externalShouldRefine(true, ""), false)
  assert.equal(externalShouldRefine(true, "你好"), true)
})

test("external does not use resolveLocalFallbackActive", () => {
  assert.equal(resolveLocalFallbackActive({
    configuredEngine: "external",
    autoFallbackToBrowser: true,
    companionConnected: true,
    localStateHydrated: true,
    localModelReady: false,
  }), false)
})

test("copy does not claim a probed connection or a keychain", () => {
  assert.match(externalLimitCopy("unprobed-local-default"), /不是探测/)
  assert.match(externalLimitCopy("deepseek-docs"), /8 MiB/)
  assert.match(externalCancelCopy(false), /没有发送音频/)
  assert.match(externalCancelCopy(true), /可能已经到达/)
})

test("privacy copy names the file permission and not a keychain", () => {
  assert.match(externalPrivacyCopy(), /不是系统钥匙串/)
})
