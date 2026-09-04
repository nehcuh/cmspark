import test from "node:test"
import assert from "node:assert/strict"
import { POSTPROCESS_BADGE_LABEL, postprocessBadge } from "../src/sidepanel/voice/postprocess-badge"

test("postprocess badge only when companion marked the final", () => {
  assert.equal(POSTPROCESS_BADGE_LABEL, "已后处理")
  assert.equal(postprocessBadge(true), "已后处理")
  assert.equal(postprocessBadge(false), null)
  assert.equal(postprocessBadge(undefined), null)
})
