import { test } from "node:test"
import * as assert from "node:assert/strict"

import { stripLoneSurrogates, safeSlice } from "../src/llm/text-sanitize"

/** Count unpaired surrogates in a string (the thing that breaks strict JSON parsers). */
function countLoneSurrogates(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const nx = i + 1 < s.length ? s.charCodeAt(i + 1) : 0
      if (!(nx >= 0xdc00 && nx <= 0xdfff)) n++
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      const pv = i > 0 ? s.charCodeAt(i - 1) : 0
      if (!(pv >= 0xd800 && pv <= 0xdbff)) n++
    }
  }
  return n
}

test("stripLoneSurrogates: replaces lone surrogates, preserves valid pairs (emoji)", () => {
  const emoji = "😀" // U+1F600 = a valid surrogate pair
  const loneHigh = String.fromCharCode(0xd800)
  const loneLow = String.fromCharCode(0xdc00)
  const input = "a" + emoji + "b" + loneHigh + "c" + loneLow + "d"
  const out = stripLoneSurrogates(input)
  assert.ok(out.includes(emoji), "valid emoji pair preserved")
  assert.ok(!out.includes(loneHigh), "lone high surrogate removed")
  assert.ok(!out.includes(loneLow), "lone low surrogate removed")
  assert.equal(countLoneSurrogates(out), 0, "no lone surrogates remain")
})

test("stripLoneSurrogates: output is JSON-safe (no unpaired \\u escape after stringify)", () => {
  // A lone high surrogate (half of an emoji) — exactly what a split slice produces.
  const input = "x" + String.fromCharCode(0xd83d) + "y"
  assert.ok(countLoneSurrogates(input) > 0, "sanity: input has a lone surrogate")
  const out = stripLoneSurrogates(input)
  assert.equal(countLoneSurrogates(out), 0)
  // JSON.stringify must not emit an unpaired surrogate escape the server would reject.
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(out)))
})

test("safeSlice: does not split a surrogate pair at the boundary", () => {
  const s = "ab" + "😀" + "cd" // emoji occupies indices 2-3
  const sliced = safeSlice(s, 3) // naive slice(0,3) would land mid-emoji (dangling high)
  assert.ok(sliced.startsWith("ab"))
  assert.equal(countLoneSurrogates(sliced), 0, "no dangling surrogate after slice")
})

test("safeSlice: plain text slices normally", () => {
  assert.equal(safeSlice("hello world", 5), "hello")
  assert.equal(safeSlice("abc", 10), "abc")
  assert.equal(safeSlice("", 5), "")
})
