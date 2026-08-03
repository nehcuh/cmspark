// FocusBand §4.3 state machine — pure priority + fleet visibility

import test from "node:test"
import assert from "node:assert/strict"
import {
  FOCUS_BAND_MAX_PX,
  FOCUS_BAND_PRIMARY_MAX_PX,
  FOCUS_BAND_SECONDARY_MAX_PX,
  resolveFocusBandSlot,
  fleetStripShouldShow,
  classifyFleetActivity,
  fleetProcessingLabel,
  fleetPausedOnlyLabel,
  type FocusBandInput,
} from "../src/sidepanel/components/focus-band-priority"

const idle: FocusBandInput = {
  hasPendingConfirm: false,
  hasL2Task: false,
  l2AbortRequired: false,
  hasFleetActivity: false,
  isBrowserContext: false,
}

test("§4.3 height budget constants", () => {
  assert.equal(FOCUS_BAND_MAX_PX, 80)
  assert.equal(FOCUS_BAND_PRIMARY_MAX_PX, 56)
  assert.equal(FOCUS_BAND_SECONDARY_MAX_PX, 24)
  assert.equal(FOCUS_BAND_PRIMARY_MAX_PX + FOCUS_BAND_SECONDARY_MAX_PX, FOCUS_BAND_MAX_PX)
})

test("§4.3 idle → empty", () => {
  assert.deepEqual(resolveFocusBandSlot(idle), {
    primary: "empty",
    secondaryAbort: false,
    secondaryContext: false,
    secondaryTools: false,
  })
})

test("§4.3 ST-4 thread_tools beats L1 context", () => {
  const slot = resolveFocusBandSlot({
    ...idle,
    hasThreadTools: true,
    isBrowserContext: true,
  })
  assert.equal(slot.primary, "thread_tools")
})

test("§4.3 ST-4 fleet primary + tools secondary", () => {
  const slot = resolveFocusBandSlot({
    ...idle,
    hasFleetActivity: true,
    hasThreadTools: true,
  })
  assert.equal(slot.primary, "fleet")
  assert.equal(slot.secondaryTools, true)
})

test("§4.3 ST-4 confirm + tools secondary when no abort", () => {
  const slot = resolveFocusBandSlot({
    ...idle,
    hasPendingConfirm: true,
    hasThreadTools: true,
    isBrowserContext: true,
  })
  assert.equal(slot.primary, "confirm")
  assert.equal(slot.secondaryTools, true)
  assert.equal(slot.secondaryContext, false)
})

test("§4.3 P3 L1 context alone", () => {
  const slot = resolveFocusBandSlot({ ...idle, isBrowserContext: true })
  assert.equal(slot.primary, "l1_context")
  assert.equal(slot.secondaryAbort, false)
})

test("§4.3 P2 Fleet beats L1 Context", () => {
  const slot = resolveFocusBandSlot({
    ...idle,
    hasFleetActivity: true,
    isBrowserContext: true,
  })
  assert.equal(slot.primary, "fleet")
})

test("§4.3 P1 L2 Safety beats Fleet", () => {
  const slot = resolveFocusBandSlot({
    ...idle,
    hasL2Task: true,
    l2AbortRequired: true,
    hasFleetActivity: true,
  })
  assert.equal(slot.primary, "l2_safety")
  assert.equal(slot.secondaryAbort, false)
})

test("§4.3 P0 Confirm beats everything", () => {
  const slot = resolveFocusBandSlot({
    ...idle,
    hasPendingConfirm: true,
    hasL2Task: true,
    l2AbortRequired: true,
    hasFleetActivity: true,
    isBrowserContext: true,
  })
  assert.equal(slot.primary, "confirm")
  // Hard rule 1: 急停 secondary when L2 + confirm
  assert.equal(slot.secondaryAbort, true)
  // secondaryContext yields when abort secondary takes the line
  assert.equal(slot.secondaryContext, false)
})

test("§4.3 Confirm + L1 (no L2) → context secondary", () => {
  const slot = resolveFocusBandSlot({
    ...idle,
    hasPendingConfirm: true,
    isBrowserContext: true,
  })
  assert.equal(slot.primary, "confirm")
  assert.equal(slot.secondaryAbort, false)
  assert.equal(slot.secondaryContext, true)
})

test("§4.3 Confirm alone (L0) — no secondary", () => {
  const slot = resolveFocusBandSlot({
    ...idle,
    hasPendingConfirm: true,
  })
  assert.equal(slot.primary, "confirm")
  assert.equal(slot.secondaryAbort, false)
  assert.equal(slot.secondaryContext, false)
})

test("§4.3 L2 task without abort required still l2_safety", () => {
  // finished / abortAcked: has task chrome but no secondary abort under confirm
  const slot = resolveFocusBandSlot({
    ...idle,
    hasL2Task: true,
    l2AbortRequired: false,
  })
  assert.equal(slot.primary, "l2_safety")
})

test("§4.3 rule 2: fleetStripShouldShow ignores pending (no pending arg)", () => {
  assert.equal(
    fleetStripShouldShow({ workerCount: 0, lockCount: 0, openIntents: 0 }),
    false,
  )
  // Workers without worstStatus → active (fail-open visibility)
  assert.equal(
    fleetStripShouldShow({ workerCount: 1, lockCount: 0, openIntents: 0 }),
    true,
  )
  assert.equal(
    fleetStripShouldShow({ workerCount: 0, lockCount: 2, openIntents: 0 }),
    true,
  )
  assert.equal(
    fleetStripShouldShow({ workerCount: 0, lockCount: 0, openIntents: 1 }),
    true,
  )
  assert.equal(
    fleetStripShouldShow({ workerCount: 0, lockCount: 0, openIntents: 0, expanded: true }),
    true,
  )
  // Signature has no pending — pending-only must not force fleet
  assert.equal(
    fleetStripShouldShow({ workerCount: 0, lockCount: 0, openIntents: 0, expanded: false }),
    false,
  )
})

test("paused-only zombies: no 运行中 label; strip hidden unless showPausedOnly/expanded", () => {
  const paused = {
    workerCount: 1,
    lockCount: 0,
    openIntents: 0,
    worstStatus: "paused" as const,
  }
  assert.equal(classifyFleetActivity(paused), "paused_only")
  assert.equal(fleetProcessingLabel(paused), null)
  assert.equal(fleetStripShouldShow(paused), false)
  assert.equal(fleetStripShouldShow({ ...paused, expanded: true }), true)
  assert.equal(fleetStripShouldShow({ ...paused, showPausedOnly: true }), true)
  assert.equal(fleetPausedOnlyLabel(1), "舰队已暂停 · 1 worker")
})

test("active fleet: idle workers / holding_tabs / locks still show 运行中 or strip", () => {
  assert.equal(
    classifyFleetActivity({
      workerCount: 1,
      lockCount: 0,
      openIntents: 0,
      worstStatus: "idle",
    }),
    "active",
  )
  assert.equal(
    fleetProcessingLabel({
      workerCount: 2,
      lockCount: 0,
      openIntents: 0,
      worstStatus: "holding_tabs",
    }),
    "舰队运行中 · 2 worker",
  )
  assert.equal(
    fleetStripShouldShow({
      workerCount: 0,
      lockCount: 1,
      openIntents: 0,
      worstStatus: "none",
    }),
    true,
  )
  assert.match(
    fleetProcessingLabel({
      workerCount: 0,
      lockCount: 3,
      openIntents: 0,
      worstStatus: "none",
    }) || "",
    /持锁/,
  )
})
