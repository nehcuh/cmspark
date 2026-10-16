import test from "node:test"
import assert from "node:assert/strict"
import { acceptanceReceipt, acceptanceDiagnostic } from "./fixtures/desktop-480/native-acceptance-controller"

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
