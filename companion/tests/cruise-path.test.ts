import test from "node:test"
import assert from "node:assert/strict"
import {
  isCruiseHardDangerPath,
  isCruisePathRiskAccepted,
} from "../src/security/cruise-path"

test("isCruiseHardDangerPath: volume and system trees", () => {
  assert.equal(isCruiseHardDangerPath("/"), true)
  assert.equal(isCruiseHardDangerPath("/Users"), true)
  assert.equal(isCruiseHardDangerPath("/etc/passwd"), true)
  assert.equal(isCruiseHardDangerPath("/Users/alice/Projects/foo"), false)
  assert.equal(isCruiseHardDangerPath("/Users/alice/CMspark-projects/x"), false)
})

test("isCruisePathRiskAccepted: three flags", () => {
  assert.equal(
    isCruisePathRiskAccepted({
      auto_approve_dangerous: true,
      auto_approve_enterprise_tools: true,
      allow_all_schemes: true,
    }),
    true,
  )
  assert.equal(
    isCruisePathRiskAccepted({
      auto_approve_dangerous: true,
      auto_approve_enterprise_tools: true,
      allow_all_schemes: false,
    }),
    false,
  )
})
