import test from "node:test"
import assert from "node:assert/strict"
import {
  buildFindByTextExpression,
  classifyTextMatchCount,
  selectTextMatchPool,
  type TextCandidate,
} from "../src/background/find-element-by-text"

test("classifyTextMatchCount", () => {
  assert.equal(classifyTextMatchCount(0), "ELEMENT_NOT_FOUND")
  assert.equal(classifyTextMatchCount(1), "ok")
  assert.equal(classifyTextMatchCount(2), "ELEMENT_AMBIGUOUS")
})

test("buildFindByTextExpression embeds text safely via JSON", () => {
  const expr = buildFindByTextExpression('下载";alert(1)//', false)
  assert.ok(expr.includes(JSON.stringify('下载";alert(1)//')))
  assert.ok(expr.includes("data-cmspark-dl-hit"))
  // exact flag false
  assert.match(expr, /const exact=false/)
})

test("buildFindByTextExpression exact=true", () => {
  const expr = buildFindByTextExpression("下载", true)
  assert.match(expr, /const exact=true/)
})

test("buildFindByTextExpression is an IIFE", () => {
  const expr = buildFindByTextExpression("dl")
  assert.ok(expr.startsWith("(()=>{"))
  assert.ok(expr.endsWith("})()"))
})

// Pure pool selection mirrors IIFE semantics (no jsdom). In-page expression
// remains CDP contract; multi-match / interactive-prefer covered here.

test("selectTextMatchPool: 0 matches → empty", () => {
  const pool = selectTextMatchPool(
    [{ id: 1, tag: "a", text: "other", interactive: true, visible: true }],
    "下载",
  )
  assert.equal(pool.length, 0)
  assert.equal(classifyTextMatchCount(pool.length), "ELEMENT_NOT_FOUND")
})

test("selectTextMatchPool: single interactive match", () => {
  const candidates: TextCandidate[] = [
    { id: 1, tag: "a", text: "下载 PDF", interactive: true, visible: true },
    { id: 2, tag: "div", text: "下载 PDF", interactive: false, visible: true },
  ]
  const pool = selectTextMatchPool(candidates, "下载")
  assert.equal(pool.length, 1)
  assert.equal(pool[0].id, 1)
  assert.equal(classifyTextMatchCount(pool.length), "ok")
})

test("selectTextMatchPool: multi interactive → ambiguous", () => {
  const candidates: TextCandidate[] = [
    { id: 1, tag: "a", text: "下载", interactive: true, visible: true },
    { id: 2, tag: "button", text: "下载", interactive: true, visible: true },
  ]
  const pool = selectTextMatchPool(candidates, "下载")
  assert.equal(pool.length, 2)
  assert.equal(classifyTextMatchCount(pool.length), "ELEMENT_AMBIGUOUS")
})

test("selectTextMatchPool: prefers interactive over non-interactive", () => {
  const candidates: TextCandidate[] = [
    { id: 1, tag: "span", text: "下载", interactive: false, visible: true },
    { id: 2, tag: "a", text: "下载", interactive: true, visible: true },
  ]
  const pool = selectTextMatchPool(candidates, "下载")
  assert.equal(pool.length, 1)
  assert.equal(pool[0].tag, "a")
})

test("selectTextMatchPool: leaf filter drops ancestor when no interactive", () => {
  const candidates: TextCandidate[] = [
    {
      id: 1,
      tag: "div",
      text: "下载 now",
      interactive: false,
      visible: true,
      descendantIds: [2],
    },
    { id: 2, tag: "span", text: "下载", interactive: false, visible: true },
  ]
  const pool = selectTextMatchPool(candidates, "下载")
  assert.equal(pool.length, 1)
  assert.equal(pool[0].id, 2)
})

test("selectTextMatchPool: exact match", () => {
  const candidates: TextCandidate[] = [
    { id: 1, tag: "a", text: "下载", interactive: true, visible: true },
    { id: 2, tag: "a", text: "下载 PDF", interactive: true, visible: true },
  ]
  const pool = selectTextMatchPool(candidates, "下载", true)
  assert.equal(pool.length, 1)
  assert.equal(pool[0].id, 1)
})

test("selectTextMatchPool: invisible skipped", () => {
  const pool = selectTextMatchPool(
    [{ id: 1, tag: "a", text: "下载", interactive: true, visible: false }],
    "下载",
  )
  assert.equal(pool.length, 0)
})
