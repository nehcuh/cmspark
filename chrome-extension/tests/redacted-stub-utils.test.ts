// Redacted persistence-stub detector (pure, node:test)

import test from "node:test"
import assert from "node:assert/strict"
import {
  extractRedactedStub,
  isRedactedStubContent,
} from "../src/sidepanel/utils/redacted-stub-utils"

test("extractRedactedStub: shape A — collapsed data (SENSITIVE_CODE_TOOLS)", () => {
  const stub = extractRedactedStub({
    success: true,
    data: { redacted: true, len: 49891, sha256: "7ac1e1009e9d" },
  })
  assert.deepEqual(stub, { len: 49891, sha256: "7ac1e1009e9d" })
})

test("extractRedactedStub: shape B — collapseResult at result level", () => {
  const stub = extractRedactedStub({
    success: true,
    redacted: true,
    len: 123,
    sha256: "ab12cd34ef56",
  })
  assert.deepEqual(stub, { len: 123, sha256: "ab12cd34ef56" })
})

test("extractRedactedStub: normal result with data payload → null", () => {
  assert.equal(
    extractRedactedStub({
      success: true,
      data: { exit_code: 0, stdout: "hi\n", stderr: "" },
    }),
    null,
  )
  assert.equal(extractRedactedStub({ success: false, error: "boom" }), null)
})

test("extractRedactedStub: redacted:true but missing len → null", () => {
  assert.equal(
    extractRedactedStub({ success: true, redacted: true, sha256: "abc" }),
    null,
  )
  assert.equal(
    extractRedactedStub({
      success: true,
      data: { redacted: true, sha256: "abc" },
    }),
    null,
  )
})

test("extractRedactedStub: len as string → null", () => {
  assert.equal(
    extractRedactedStub({
      success: true,
      redacted: true,
      len: "123",
      sha256: "abc",
    }),
    null,
  )
})

test("extractRedactedStub: null / undefined / non-object → null", () => {
  assert.equal(extractRedactedStub(null), null)
  assert.equal(extractRedactedStub(undefined), null)
  assert.equal(extractRedactedStub("redacted"), null)
  assert.equal(extractRedactedStub([{ redacted: true, len: 1, sha256: "x" }]), null)
})

test("extractRedactedStub: redacted not strictly true / sha256 non-string → null", () => {
  assert.equal(
    extractRedactedStub({ success: true, redacted: "true", len: 5, sha256: "abc" }),
    null,
  )
  assert.equal(
    extractRedactedStub({ success: true, redacted: true, len: 5, sha256: 42 }),
    null,
  )
  assert.equal(
    extractRedactedStub({ success: true, redacted: false, len: 5, sha256: "abc" }),
    null,
  )
})

test("extractRedactedStub: failed stub rows — both shapes still detected", () => {
  // Shape B failure: collapseResult keeps success:false, swallows error.
  assert.deepEqual(
    extractRedactedStub({ success: false, redacted: true, len: 87, sha256: "deadbeefcafe" }),
    { len: 87, sha256: "deadbeefcafe" },
  )
  // Shape A failure: SENSITIVE_CODE_TOOLS keep truncated error + collapsed data.
  assert.deepEqual(
    extractRedactedStub({
      success: false,
      error: "Permission denied",
      data: { redacted: true, len: 12, sha256: "0123456789ab" },
    }),
    { len: 12, sha256: "0123456789ab" },
  )
})

test("extractRedactedStub: len edge values — 0 ok, Infinity/NaN rejected", () => {
  assert.deepEqual(
    extractRedactedStub({ success: true, redacted: true, len: 0, sha256: "e3b0c44298fc" }),
    { len: 0, sha256: "e3b0c44298fc" },
  )
  assert.equal(
    extractRedactedStub({ success: true, redacted: true, len: Infinity, sha256: "abc" }),
    null,
  )
  assert.equal(
    extractRedactedStub({ success: true, redacted: true, len: NaN, sha256: "abc" }),
    null,
  )
})

test("extractRedactedStub: stub with extra keys still accepted", () => {
  assert.deepEqual(
    extractRedactedStub({
      success: true,
      redacted: true,
      len: 10,
      sha256: "abc",
      tool_name: "host_computer",
      v: 2,
    }),
    { len: 10, sha256: "abc" },
  )
  assert.deepEqual(
    extractRedactedStub({
      success: true,
      duration_ms: 5,
      data: { redacted: true, len: 3, sha256: "def", note: "x" },
    }),
    { len: 3, sha256: "def" },
  )
})

test("isRedactedStubContent: stub JSON strings (both shapes) → true", () => {
  assert.equal(
    isRedactedStubContent(
      JSON.stringify({ success: true, data: { redacted: true, len: 49891, sha256: "7ac1e1009e9d" } }),
    ),
    true,
  )
  assert.equal(
    isRedactedStubContent(
      JSON.stringify({ success: false, redacted: true, len: 87, sha256: "deadbeefcafe" }),
    ),
    true,
  )
})

test("isRedactedStubContent: normal tool-row JSON keeps rendering → false", () => {
  assert.equal(
    isRedactedStubContent(JSON.stringify({ success: true, data: { title: "x", url: "y" } })),
    false,
  )
  // INTERRUPTED heal filler: plain error row, not a stub.
  assert.equal(
    isRedactedStubContent(JSON.stringify({ success: false, error: "INTERRUPTED", error_code: "INTERRUPTED" })),
    false,
  )
})

test("isRedactedStubContent: non-JSON / non-string input → false", () => {
  assert.equal(isRedactedStubContent("模型回复正文"), false)
  assert.equal(isRedactedStubContent("{not json"), false)
  assert.equal(isRedactedStubContent('[{"redacted":true,"len":1,"sha256":"x"}]'), false)
  assert.equal(isRedactedStubContent(""), false)
  assert.equal(isRedactedStubContent(null), false)
  assert.equal(isRedactedStubContent(undefined), false)
  assert.equal(isRedactedStubContent(42), false)
})
