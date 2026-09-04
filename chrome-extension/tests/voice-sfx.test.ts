import test from "node:test"
import assert from "node:assert/strict"
import {
  VOICE_SFX,
  shouldPlayVoiceSfx,
  type VoiceSfxKind,
} from "../src/sidepanel/voice/voice-sfx"

test("sfx table has start/stop/cancel/done with frequency + duration", () => {
  for (const kind of ["start", "stop", "cancel", "done"] as VoiceSfxKind[]) {
    const row = VOICE_SFX[kind]
    assert.ok(row.freqs.length >= 1)
    assert.ok(row.durMs > 0)
  }
  assert.ok(VOICE_SFX.start.freqs[0]! < VOICE_SFX.start.freqs[VOICE_SFX.start.freqs.length - 1]!)
  assert.ok(VOICE_SFX.stop.freqs[0]! > VOICE_SFX.stop.freqs[VOICE_SFX.stop.freqs.length - 1]!)
})

test("sound effects: default on; off / privacy sheet / accidental skip", () => {
  assert.equal(shouldPlayVoiceSfx({ enabled: true, privacySheetOpen: false, accidental: false }), true)
  assert.equal(shouldPlayVoiceSfx({ enabled: undefined, privacySheetOpen: false, accidental: false }), true)
  assert.equal(shouldPlayVoiceSfx({ enabled: false, privacySheetOpen: false, accidental: false }), false)
  assert.equal(shouldPlayVoiceSfx({ enabled: true, privacySheetOpen: true, accidental: false }), false)
  assert.equal(shouldPlayVoiceSfx({ enabled: true, privacySheetOpen: false, accidental: true }), false)
})
