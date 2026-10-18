import test from "node:test"
import assert from "node:assert/strict"
import { acceptanceReceipt, acceptanceDiagnostic, requireInheritanceIdentity } from "./fixtures/desktop-480/native-acceptance-controller"

test("inheritance diagnostics retain the four independent checks and finite checker results", () => {
  for (const bits of Array.from({ length: 16 }, (_, i) => i.toString(2).padStart(4, "0"))) {
    const receipt = acceptanceReceipt("D480A_INHERITANCE_" + bits + "_7_4_5")
    assert.deepEqual(receipt, { kind: "inheritance", checks: bits, stage: 7, control: 4, descendant: 5 })
    const out = acceptanceDiagnostic("cleanup", "waiting-auth-metadata", "inheritance", { auths: 1, issues: 1, launches: 1, exits: 0, listReads: 0 }, [receipt!])
    assert.deepEqual(out.inheritance, [receipt])
    assert.deepEqual(out.fixed, [])
  }
  // 256 means an unexpected checker status; no raw OS error, path or HANDLE is transported.
  assert.ok(acceptanceReceipt("D480A_INHERITANCE_1100_4_255_256"))
  assert.ok(acceptanceReceipt("D480A_INHERITANCE_1100_2_257_257"))
})

test("inheritance diagnostic parser rejects arbitrary data and diagnostics never satisfy success", () => {
  for (const value of ["D480A_INHERITANCE_11111_7_4_4", "D480A_INHERITANCE_1111_8_4_4", "D480A_INHERITANCE_1111_7_258_4", "D480A_INHERITANCE_1111_7_8_4", "D480A_INHERITANCE_1111_7_239_4", "D480A_INHERITANCE_1111_7_-1_4", "D480A_INHERITANCE_1111_7_04_4", "D480A_INHERITANCE_1111_7_4_4\n", "D480A_INHERITANCE_1111_7_private_path_4"]) assert.equal(acceptanceReceipt(value), null)
  const receipt = acceptanceReceipt("D480A_INHERITANCE_1111_7_4_4")!
  const failure = acceptanceReceipt("D480A_FAIL_DESCENDANT_NOT_OBSERVED")!
  const out = acceptanceDiagnostic("cleanup", "waiting-auth-metadata", "inheritance", { auths: 1, issues: 1, launches: 1, exits: 0, listReads: 0 }, [receipt, failure])
  assert.deepEqual(out.fixed, ["FAIL_DESCENDANT_NOT_OBSERVED"])
  assert.equal(out.fixed.includes("CONSUMED_HANDLES_DENIED"), false)
  assert.equal(out.inheritance.length, 1)
})


test("object identity masks remain distinct from raw numeric masks and accept only the exact protected-object absence", () => {
  const raw = acceptanceReceipt("D480A_INHERITANCE_1111_7_4_5")!
  const identity = acceptanceReceipt("D480A_IDENTITY_4_4")!
  assert.deepEqual(identity, { kind: "identity", control: 4, descendant: 4 })
  requireInheritanceIdentity([raw, identity])
  assert.deepEqual(acceptanceDiagnostic("cleanup", "complete", "inheritance", { auths: 1, issues: 1, launches: 1, exits: 0, listReads: 1 }, [raw, identity]).identity, [identity])
  for (const mask of [0, 1, 2, 3, 5, 6, 7, 256, 257]) {
    assert.throws(() => requireInheritanceIdentity([raw, acceptanceReceipt(`D480A_IDENTITY_4_${mask}`)!]))
  }
  for (const value of ["D480A_IDENTITY_8_4", "D480A_IDENTITY_4_255", "D480A_IDENTITY_04_4", "D480A_IDENTITY_4_4\n", "D480A_IDENTITY_private_4"]) assert.equal(acceptanceReceipt(value), null)
  for (const rawValue of ["D480A_INHERITANCE_1110_7_4_5", "D480A_INHERITANCE_1111_6_4_5", "D480A_INHERITANCE_1111_7_0_5", "D480A_INHERITANCE_1111_7_4_240"]) assert.throws(() => requireInheritanceIdentity([acceptanceReceipt(rawValue)!, identity]))
  for (const receipts of [[raw], [identity], [raw, identity, identity], [raw, raw, identity]]) assert.throws(() => requireInheritanceIdentity(receipts))
})
