import test from "node:test"
import assert from "node:assert/strict"
import {
  findArmingSecurityFlags,
  findDisarmingSecurityFlags,
  isValidSecurityArmPhrase,
  SECURITY_ARM_CONFIRM_PHRASE,
} from "../src/security-arm"

test("findArmingSecurityFlags is false→true only for keys present on proposed", () => {
  assert.deepEqual(
    findArmingSecurityFlags({ auto_approve_dangerous: true }, {}),
    ["auto_approve_dangerous"],
  )
  assert.deepEqual(
    findArmingSecurityFlags({ auto_approve_dangerous: true }, { auto_approve_dangerous: true }),
    [],
  )
  assert.deepEqual(
    findArmingSecurityFlags({ allow_all_schemes: false }, { allow_all_schemes: false }),
    [],
  )
})

test("findDisarmingSecurityFlags is true→false only for keys present on proposed", () => {
  assert.deepEqual(
    findDisarmingSecurityFlags(
      { auto_approve_dangerous: false },
      { auto_approve_dangerous: true },
    ),
    ["auto_approve_dangerous"],
  )
  assert.deepEqual(
    findDisarmingSecurityFlags(
      { auto_approve_dangerous: false, allow_all_schemes: false },
      { auto_approve_dangerous: true, allow_all_schemes: true },
    ),
    ["allow_all_schemes", "auto_approve_dangerous"],
  )
  assert.deepEqual(
    findDisarmingSecurityFlags({ auto_approve_dangerous: true }, { auto_approve_dangerous: true }),
    [],
  )
  assert.deepEqual(
    findDisarmingSecurityFlags({}, { auto_approve_dangerous: true }),
    [],
    "omitted keys are not a disarm",
  )
})

test("phrase gate: only the Settings literal is valid", () => {
  assert.equal(isValidSecurityArmPhrase(SECURITY_ARM_CONFIRM_PHRASE), true)
  assert.equal(isValidSecurityArmPhrase("我了解风险"), true)
  assert.equal(isValidSecurityArmPhrase(""), false)
  assert.equal(isValidSecurityArmPhrase("I UNDERSTAND"), false)
})
