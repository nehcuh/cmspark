import test from "node:test"
import assert from "node:assert/strict"
import { resolveFocusBandSlot } from "../src/sidepanel/components/focus-band-priority"

test("coding_session is below confirm and l2_safety, above fleet", () => {
  const withCoding = resolveFocusBandSlot({
    hasPendingConfirm: false,
    hasL2Task: false,
    l2AbortRequired: false,
    hasFleetActivity: true,
    hasCodingSession: true,
    isBrowserContext: true,
  })
  assert.equal(withCoding.primary, "coding_session")

  const confirmWins = resolveFocusBandSlot({
    hasPendingConfirm: true,
    hasL2Task: false,
    l2AbortRequired: false,
    hasFleetActivity: false,
    hasCodingSession: true,
    isBrowserContext: false,
  })
  assert.equal(confirmWins.primary, "confirm")

  const cuWins = resolveFocusBandSlot({
    hasPendingConfirm: false,
    hasL2Task: true,
    l2AbortRequired: true,
    hasFleetActivity: false,
    hasCodingSession: true,
    isBrowserContext: false,
  })
  assert.equal(cuWins.primary, "l2_safety")
  assert.equal(cuWins.secondaryTools, true)
})
