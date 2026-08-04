import test from "node:test"
import assert from "node:assert/strict"
import { buildSpaScrollExpression } from "../src/background/spa-scroll-expr"

test("buildSpaScrollExpression embeds numeric deltas and X/Twitter selectors", () => {
  const expr = buildSpaScrollExpression(0, 1200, 400, 400)
  assert.match(expr, /var dx = 0, dy = 1200/)
  assert.match(expr, /primaryColumn/)
  assert.match(expr, /role="main"/)
  assert.match(expr, /scrollBy/)
  assert.match(expr, /mode: "element"/)
  assert.match(expr, /mode: "window"/)
  assert.equal(expr.includes("${"), false)
})

test("buildSpaScrollExpression coerces NaN to 0", () => {
  const expr = buildSpaScrollExpression(Number.NaN, Number.NaN, Number.NaN, Number.NaN)
  assert.match(expr, /var dx = 0, dy = 0, wheelX = 0, wheelY = 0/)
})

test("buildSpaScrollExpression embeds negative dy for scroll-up", () => {
  const expr = buildSpaScrollExpression(0, -800, 400, 400)
  assert.match(expr, /var dx = 0, dy = -800/)
})
