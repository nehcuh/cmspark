import test from "node:test"
import assert from "node:assert/strict"
import {
  decideSameToolFailure,
  isLocatorMiss,
  LOCATOR_PIVOT_INSTRUCTION,
} from "../src/llm/same-tool-guard"

const threshold = 3

test("two click misses stay inside the retry budget", () => {
  const d = decideSameToolFailure({
    failCount: 2,
    threshold,
    errorCode: "ELEMENT_NOT_FOUND",
    errorText: 'ELEMENT_NOT_FOUND: no visible element matching text "标题"',
    alreadyPivoted: false,
  })
  assert.equal(d.action, "count")
})

test("the third missed click switches strategy instead of stopping", () => {
  const d = decideSameToolFailure({
    failCount: 3,
    threshold,
    errorCode: "ELEMENT_NOT_FOUND",
    errorText: 'ELEMENT_NOT_FOUND: no visible element matching text "DeepSeek融资500亿，梁文锋难逃资本局"',
    alreadyPivoted: false,
  })
  assert.equal(d.action, "pivot")
  if (d.action === "pivot") {
    assert.match(d.instruction, /get_page_text/)
    assert.equal(d.instruction, LOCATOR_PIVOT_INSTRUCTION)
  }
})

test("a missed click is recognized from the error text alone", () => {
  assert.equal(
    isLocatorMiss(undefined, 'ELEMENT_NOT_FOUND: no visible element matching text "x"'),
    true,
  )
  const d = decideSameToolFailure({
    failCount: 3,
    threshold,
    errorText: 'no visible element matching text "x"',
    alreadyPivoted: false,
  })
  assert.equal(d.action, "pivot")
})

test("after a strategy switch, another three misses still stop", () => {
  const d = decideSameToolFailure({
    failCount: 3,
    threshold,
    errorCode: "ELEMENT_NOT_FOUND",
    errorText: "ELEMENT_NOT_FOUND: no visible element matching text \"x\"",
    alreadyPivoted: true,
  })
  assert.equal(d.action, "stop")
})

test("three non-locator failures still stop", () => {
  const d = decideSameToolFailure({
    failCount: 3,
    threshold,
    errorCode: "WAIT_TIMEOUT",
    errorText: "timed out waiting for selector",
    alreadyPivoted: false,
  })
  assert.equal(d.action, "stop")
})
