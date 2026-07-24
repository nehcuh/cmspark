// Danger lexicon property tests (review R3):
//  - bare "Pay" (A2.2 enumeration) closes the region hard-deny hole
//  - Latin tokens match on word boundaries — "pin" ⊄ "shopping",
//    "format" ⊄ "information" (N2 over-fire regression)
//  - CJK tokens stay substring-matched
// Assertions target CLASSIFICATION PROPERTIES (levels, hit sets, blur rects),
// never message shapes.

import test from "node:test"
import assert from "node:assert/strict"

import {
  CAUTION_WORDS,
  CREDENTIAL_WORDS,
  HARD_DENY_WORDS,
  matchWords,
  scanDanger,
} from "../src/computer/danger"
import type { OcrWord, RectPx } from "../src/computer/types"

function word(text: string, x: number, y: number, w = 60, h = 20): OcrWord {
  return { text, x, y, w, h }
}

const REGION: RectPx = { x: 0, y: 0, width: 200, height: 200 }
const CROP = 200

// --- bare "Pay" (A2.2) --------------------------------------------------------

test("danger: bare 'Pay' hits HARD (A2.2 enumeration — region hard-deny hole closed)", () => {
  const hits = matchWords("Pay", HARD_DENY_WORDS)
  assert.ok(hits.includes("pay"), `expected bare "pay" to hit, got ${JSON.stringify(hits)}`)
})

test("danger: a button labelled exactly 'Pay' in the click region -> regionLevel hard", () => {
  const scan = scanDanger([word("Pay", 50, 50)], REGION, CROP)
  assert.equal(scan.regionLevel, "hard")
  assert.ok(scan.regionHits.includes("pay"))
})

test("danger: 'PAY NOW' uppercase still hits (case-insensitive)", () => {
  const hits = matchWords("PAY NOW", HARD_DENY_WORDS)
  assert.ok(hits.includes("pay now"))
})

test("danger: 'payment' hits the payment entry, not via bare 'pay'", () => {
  const hits = matchWords("payment", HARD_DENY_WORDS)
  assert.ok(hits.includes("payment"))
  assert.ok(!hits.includes("pay"), "word-boundary: 'payment' must not match bare 'pay'")
})

test("danger: 'repay' does not hit bare 'pay' (no left boundary)", () => {
  assert.ok(!matchWords("repay", HARD_DENY_WORDS).includes("pay"))
})

// --- Latin word boundaries (N2 over-fire regression) -----------------------------

test("danger: 'shopping' does NOT hit credential 'pin'", () => {
  assert.deepEqual(matchWords("shopping", CREDENTIAL_WORDS), [])
})

test("danger: 'information' does NOT hit caution 'format'", () => {
  assert.deepEqual(matchWords("information", CAUTION_WORDS), [])
})

test("danger: window full of 'shopping information' stays level none (end-to-end)", () => {
  const scan = scanDanger([word("shopping", 50, 50), word("information", 50, 90)], REGION, CROP)
  assert.equal(scan.regionLevel, "none")
  assert.equal(scan.windowLevel, "none")
  assert.deepEqual(scan.credentialRects, [])
})

test("danger: standalone 'pin' DOES hit credential (boundary at string edges)", () => {
  assert.ok(matchWords("enter your pin", CREDENTIAL_WORDS).includes("pin"))
})

test("danger: 'delete my files' hits caution 'delete'", () => {
  assert.ok(matchWords("delete my files", CAUTION_WORDS).includes("delete"))
})

// --- CJK stays substring ----------------------------------------------------------

test("danger: CJK tokens remain substring-matched (确认支付 inside longer text)", () => {
  const hits = matchWords("请点确认支付继续", HARD_DENY_WORDS)
  assert.ok(hits.includes("确认支付"))
  assert.ok(hits.includes("支付"))
})

test("danger: 'pin码' (mixed) hits credential via the CJK entry", () => {
  const hits = matchWords("pin码", CREDENTIAL_WORDS)
  assert.ok(hits.includes("pin码"))
})

// --- dual-channel classification ----------------------------------------------------

test("danger: hard word OUTSIDE the click region -> windowLevel hard, regionLevel none", () => {
  const words = [word("确定", 50, 50), word("立即支付", 500, 500)]
  const scan = scanDanger(words, REGION, CROP)
  assert.equal(scan.regionLevel, "none")
  assert.equal(scan.windowLevel, "hard")
  assert.ok(scan.windowHits.includes("立即支付"))
})

test("danger: caution word in region -> regionLevel caution", () => {
  const scan = scanDanger([word("确认删除", 50, 50, 80, 20)], REGION, CROP)
  assert.equal(scan.regionLevel, "caution")
})

test("danger: credential word yields a blur rect centered on the word", () => {
  const w = word("密码", 300, 300, 40, 20) // center (320, 310)
  const scan = scanDanger([w], REGION, CROP)
  assert.equal(scan.credentialRects.length, 1)
  const r = scan.credentialRects[0]
  assert.equal(r.width, CROP)
  assert.equal(r.height, CROP)
  assert.equal(r.x + r.width / 2, 320)
  assert.equal(r.y + r.height / 2, 310)
})

test("danger: credential rect clamps at the top-left image edge", () => {
  const w = word("密码", 0, 0, 40, 20) // center (20, 10) — half-crop would go negative
  const scan = scanDanger([w], REGION, CROP)
  assert.equal(scan.credentialRects[0].x, 0)
  assert.equal(scan.credentialRects[0].y, 0)
})


// --- WP2 Y2: NFKC + zero-width evasion resistance ------------------------------

test("danger Y2: full-width Latin lookalikes fold via NFKC (Ｐａｙ -> pay)", () => {
  // Ｐａｙ in full-width Latin — previously invisible to the Latin matcher.
  const scan = scanDanger([word("Ｐａｙ", 50, 50, 60, 20)], REGION, CROP)
  assert.equal(scan.regionLevel, "hard")
  assert.ok(scan.regionHits.includes("pay"))
})

test("danger Y2: zero-width characters inside a token are stripped (支​付 -> 支付)", () => {
  const scan = scanDanger([word("支\u200B付", 50, 50, 60, 20)], REGION, CROP)
  assert.equal(scan.regionLevel, "hard")
  assert.ok(scan.regionHits.includes("支付"))
})

test("danger Y2: full-width credential token still blurs (ｐａｓｓｗｏｒｄ)", () => {
  const scan = scanDanger([word("ｐａｓｓｗｏｒｄ", 300, 300, 40, 20)], REGION, CROP)
  assert.equal(scan.credentialRects.length, 1)
})
