import test from "node:test"
import assert from "node:assert/strict"
import { canonicalRequest, criterionIdentity, evidenceDigest, evidenceScopeHash, exactExcerpt, excerptSupportsValue, normalizeEvidenceText } from "../src/business-evidence/content"

test("evidence normalization preserves case and internal whitespace, using code-point offsets", () => {
  const raw = "😀\r\nCafe\u0301  PROD\rEnd"
  assert.equal(normalizeEvidenceText(raw), "😀\nCafé  PROD\nEnd")
  assert.equal(evidenceDigest(raw), evidenceDigest("😀\nCafé  PROD\nEnd"))
  assert.notEqual(evidenceDigest(raw), evidenceDigest("😀\nCafé PROD\nEnd"))
  assert.ok(exactExcerpt(raw, { start: 2, end: 6, excerpt: "Cafe\u0301" }))
  assert.equal(exactExcerpt(raw, { start: 3, end: 7, excerpt: "Café" }), false)
  for (const [start, end] of [[-1, 2], [0, 0], [0, 100], [0.5, 2], [0, NaN]]) {
    assert.equal(exactExcerpt(raw, { start, end, excerpt: "Café" }), false)
  }
})

test("token support cannot be fabricated by clipping the citation boundary", () => {
  for (const adjacent of ["non-", "x", "9", "_", ".", ":", "@", "中"]) {
    const source = adjacent + "prod"
    const start = Array.from(adjacent).length
    assert.equal(excerptSupportsValue(source, { start, end: start + 4, excerpt: "prod" }, "prod", true), false)
  }
  assert.equal(excerptSupportsValue("prodX", { start: 0, end: 4, excerpt: "prod" }, "prod", true), false)
  assert.ok(excerptSupportsValue("😀/prod/", { start: 2, end: 6, excerpt: "prod" }, "prod", true))
  const text = "non-prod / prod"
  assert.ok(excerptSupportsValue(text, { start: 0, end: Array.from(text).length, excerpt: text }, "prod", true))
  assert.equal(excerptSupportsValue("prod", { start: 0, end: 4, excerpt: "prod" }, "", true), false)
})

test("scope keys distinguish channels, grants and server sessions without paths", () => {
  const chat = evidenceScopeHash({ kind: "chat", threadId: "../same" })
  const first = evidenceScopeHash({ kind: "mcp", grantId: "../same", sessionId: "one" })
  const next = evidenceScopeHash({ kind: "mcp", grantId: "../same", sessionId: "two" })
  assert.match(chat, /^[a-f0-9]{64}$/)
  assert.notEqual(chat, first)
  assert.notEqual(first, next)
  assert.throws(() => evidenceScopeHash({ kind: "chat", threadId: "" }), /INVALID_EVIDENCE_SCOPE/)
})

test("canonical requests retain array order, explicit null and revisions", () => {
  assert.equal(canonicalRequest({ z: 1, a: "e\u0301" }), canonicalRequest({ a: "é", z: 1 }))
  assert.notEqual(canonicalRequest({ a: null }), canonicalRequest({}))
  assert.notEqual(canonicalRequest([1, 2]), canonicalRequest([2, 1]))
  assert.notEqual(canonicalRequest({ expected_revision: 1 }), canonicalRequest({ expected_revision: 2 }))
  for (const invalid of [undefined, NaN, Infinity, 0.5, new Date(), { a: undefined }]) {
    assert.throws(() => canonicalRequest(invalid), /INVALID_CANONICAL_REQUEST/)
  }
  assert.match(criterionIdentity("REQ-1", "Café"), /^REQ-1#[a-f0-9]{64}$/)
  assert.equal(criterionIdentity("REQ-1", "Café"), criterionIdentity("REQ-1", "Cafe\u0301"))
})
