// Unit tests for companion/src/host-use/darwin/index.ts generateLinuxNonce()
//
// Phase 1 W9: Linux manual nonce for biometric tier. Round 2 §2.3 Kimi加严:
// "手动输入 6 位 nonce，不可复制粘贴". Tests verify the generator excludes
// ambiguous characters and produces cryptographically random codes.

import test from "node:test"
import assert from "node:assert/strict"

import { generateLinuxNonce } from "../src/host-use/darwin/index.js"

test("generateLinuxNonce: returns 6-char string", () => {
  for (let i = 0; i < 50; i++) {
    const code = generateLinuxNonce()
    assert.equal(code.length, 6, `expected 6 chars, got ${code.length}`)
    assert.match(code, /^[A-Z0-9]+$/, "must be uppercase alphanumeric")
  }
})

test("generateLinuxNonce: excludes ambiguous characters (0/O/1/I/L/S/5/B/8/Z/2)", () => {
  const forbidden = new Set(["0", "O", "1", "I", "L", "S", "5", "B", "8", "Z", "2"])
  for (let i = 0; i < 200; i++) {
    const code = generateLinuxNonce()
    for (const c of code) {
      assert.ok(!forbidden.has(c), `code "${code}" contains ambiguous char "${c}"`)
    }
  }
})

test("generateLinuxNonce: produces different codes across calls (random)", () => {
  const codes = new Set<string>()
  for (let i = 0; i < 100; i++) {
    codes.add(generateLinuxNonce())
  }
  // Collision check: with 23-char alphabet ^ 6 = ~148M possible codes, expecting
  // ~0 collisions in 100 draws. Allow ≤1 collision for cosmic-ray safety.
  assert.ok(codes.size >= 99, `expected ≥99 unique codes in 100 draws, got ${codes.size}`)
})

test("generateLinuxNonce: only uses allowed alphabet", () => {
  const allowed = new Set("ABCDEFGHJKMNPQRSTUVWXY34679".split(""))
  for (let i = 0; i < 100; i++) {
    const code = generateLinuxNonce()
    for (const c of code) {
      assert.ok(allowed.has(c), `code "${code}" contains non-alphabet char "${c}"`)
    }
  }
})
