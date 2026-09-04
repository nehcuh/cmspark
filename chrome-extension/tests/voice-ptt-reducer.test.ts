import test from "node:test"
import assert from "node:assert/strict"
import {
  VOICE_PTT_ACCIDENTAL_MS,
  VOICE_PTT_DOUBLE_TAP_MS,
  initialPtt,
  reducePtt,
} from "../src/sidepanel/voice/ptt-reducer"

test("constants pin spec §4", () => {
  assert.equal(VOICE_PTT_ACCIDENTAL_MS, 300)
  assert.equal(VOICE_PTT_DOUBLE_TAP_MS, 300)
})

test("keydown does not start — accidental window must stay silent", () => {
  const { state, effect } = reducePtt(initialPtt, { type: "down", now: 0 })
  assert.equal(state.phase, "holding")
  assert.equal(state.armed, false)
  assert.equal(effect, "none")
})

test("hold ≥300ms: tick arms start, then up → commit", () => {
  let { state, effect } = reducePtt(initialPtt, { type: "down", now: 0 })
  assert.equal(effect, "none")
  ;({ state, effect } = reducePtt(state, { type: "tick", now: VOICE_PTT_ACCIDENTAL_MS }))
  assert.equal(state.armed, true)
  assert.equal(effect, "start")
  ;({ state, effect } = reducePtt(state, { type: "up", now: VOICE_PTT_ACCIDENTAL_MS + 50 }))
  assert.equal(state.phase, "idle")
  assert.equal(effect, "commit")
})

test("hold <300ms then up → discard silent (never started)", () => {
  let { state, effect } = reducePtt(initialPtt, { type: "down", now: 1000 })
  assert.equal(effect, "none")
  ;({ state, effect } = reducePtt(state, { type: "up", now: 1000 + 299 }))
  assert.equal(state.phase, "await_double")
  assert.equal(effect, "discard")
  assert.equal(state.armed, false)
})

test("tick after double-tap window with no second press → idle, no extra effect", () => {
  let { state } = reducePtt(initialPtt, { type: "down", now: 0 })
  ;({ state } = reducePtt(state, { type: "up", now: 100 }))
  const { state: next, effect } = reducePtt(state, { type: "tick", now: 100 + VOICE_PTT_DOUBLE_TAP_MS + 1 })
  assert.equal(next.phase, "idle")
  assert.equal(effect, "none")
})

test("double-tap: second down within 300ms of short release → lock (starts immediately)", () => {
  let { state } = reducePtt(initialPtt, { type: "down", now: 0 })
  ;({ state } = reducePtt(state, { type: "up", now: 80 }))
  const { state: locked, effect } = reducePtt(state, { type: "down", now: 80 + 200 })
  assert.equal(locked.phase, "locked")
  assert.equal(locked.armed, true)
  assert.equal(effect, "lock")
})

test("locked: second chord down or ESC → commit (hands-free end)", () => {
  let { state } = reducePtt(initialPtt, { type: "down", now: 0 })
  ;({ state } = reducePtt(state, { type: "up", now: 50 }))
  ;({ state } = reducePtt(state, { type: "down", now: 100 }))
  assert.equal(state.phase, "locked")
  const chord = reducePtt(state, { type: "down", now: 5000 })
  assert.equal(chord.state.phase, "idle")
  assert.equal(chord.effect, "commit")
  const esc = reducePtt(state, { type: "esc", now: 5000 })
  assert.equal(esc.state.phase, "idle")
  assert.equal(esc.effect, "commit")
})

test("locked: keyup is ignored (hands free)", () => {
  let { state } = reducePtt(initialPtt, { type: "down", now: 0 })
  ;({ state } = reducePtt(state, { type: "up", now: 50 }))
  ;({ state } = reducePtt(state, { type: "down", now: 100 }))
  const { effect } = reducePtt(state, { type: "up", now: 200 })
  assert.equal(effect, "none")
})

test("blur while unarmed holding → silent discard (no start ever)", () => {
  let { state } = reducePtt(initialPtt, { type: "down", now: 0 })
  const { state: next, effect } = reducePtt(state, { type: "blur", now: 80 })
  assert.equal(next.phase, "idle")
  assert.equal(effect, "discard")
})

test("blur after armed hold → commit (restore D2 holdStop)", () => {
  let { state } = reducePtt(initialPtt, { type: "down", now: 0 })
  ;({ state } = reducePtt(state, { type: "tick", now: 300 }))
  const { state: next, effect } = reducePtt(state, { type: "blur", now: 400 })
  assert.equal(next.phase, "idle")
  assert.equal(effect, "commit")
})

test("blur while locked → commit", () => {
  let { state } = reducePtt(initialPtt, { type: "down", now: 0 })
  ;({ state } = reducePtt(state, { type: "up", now: 50 }))
  ;({ state } = reducePtt(state, { type: "down", now: 100 }))
  const { effect } = reducePtt(state, { type: "blur", now: 800 })
  assert.equal(effect, "commit")
})
