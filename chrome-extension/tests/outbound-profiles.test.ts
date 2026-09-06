// #419 — Settings UI outbound grant profile options stay in lock-step with
// companion/src/outbound-mcp/outbound-grants.ts OUTBOUND_GRANT_PROFILES.

import test from "node:test"
import assert from "node:assert/strict"
import {
  OUTBOUND_GRANT_PROFILE_OPTIONS,
  OUTBOUND_DEFAULT_PROFILE_FOR_UI,
  OUTBOUND_L1_DEFAULT_PROFILE,
  OUTBOUND_L1_INTERACT_PROFILE,
  isOutboundGrantProfileForUi,
} from "../src/sidepanel/utils/outbound-profiles"

test("#419 profile option values match companion OUTBOUND_GRANT_PROFILES", () => {
  assert.deepEqual(
    OUTBOUND_GRANT_PROFILE_OPTIONS.map((o) => o.value),
    [OUTBOUND_L1_DEFAULT_PROFILE, OUTBOUND_L1_INTERACT_PROFILE],
  )
  assert.equal(OUTBOUND_DEFAULT_PROFILE_FOR_UI, OUTBOUND_L1_DEFAULT_PROFILE)
  assert.ok(OUTBOUND_GRANT_PROFILE_OPTIONS.every((o) => o.label && o.hint))
})

test("#419 isOutboundGrantProfileForUi rejects unknown values (UI cannot send bad profile)", () => {
  assert.equal(isOutboundGrantProfileForUi("outbound_l1_default"), true)
  assert.equal(isOutboundGrantProfileForUi("outbound_l1_interact"), true)
  assert.equal(isOutboundGrantProfileForUi("outbound_l1_super"), false)
  assert.equal(isOutboundGrantProfileForUi(undefined), false)
  assert.equal(isOutboundGrantProfileForUi(""), false)
})
