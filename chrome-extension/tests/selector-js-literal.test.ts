// SEC-1 regression: CSS selectors must be JSON.stringify'd when embedded into
// Runtime.evaluate expressions. The old replace(/'/g, "\\'") pattern is
// breakable with quote+backslash payloads.

import test from "node:test"
import assert from "node:assert/strict"
import { selectorJsLiteral } from "../src/background/selector-js-literal"

/** Reproduce the pre-fix weak escape used in waitForSelector / getElementCenter. */
function weakEscape(selector: string): string {
  return selector.replace(/'/g, "\\'")
}

function oldWaitExpr(selector: string): string {
  return `!!document.querySelector('${weakEscape(selector)}')`
}

function newWaitExpr(selector: string): string {
  return `!!document.querySelector(${selectorJsLiteral(selector)})`
}

function newGetPageHtmlExpr(selector: string | undefined): string {
  const suffix = selector ? `.querySelector(${selectorJsLiteral(selector)})` : ""
  return `document.querySelector('html')${suffix}?.outerHTML?.substring(0, 500000) || ''`
}

function newGetElementCenterExpr(selector: string): string {
  return `(()=>{const el=document.querySelector(${selectorJsLiteral(selector)});if(!el)return null;let r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`
}

test("selectorJsLiteral produces a valid JSON string literal", () => {
  assert.equal(selectorJsLiteral("#app"), '"#app"')
  assert.equal(selectorJsLiteral("div.class"), '"div.class"')
  assert.equal(JSON.parse(selectorJsLiteral("a[href='/x']")), "a[href='/x']")
})

test("getPageHTML expression keeps document.querySelector('html') prefix", () => {
  const withSel = newGetPageHtmlExpr("body > main")
  assert.ok(withSel.startsWith("document.querySelector('html')"))
  assert.ok(withSel.includes(`.querySelector(${selectorJsLiteral("body > main")})`))

  const noSel = newGetPageHtmlExpr(undefined)
  assert.equal(
    noSel,
    "document.querySelector('html')?.outerHTML?.substring(0, 500000) || ''",
  )
})

// Classic breakout against replace(/'/g,"\\'"): a selector containing
// `'); <payload> //` or backslash-quote sequences changes the surrounding JS
// structure when weakly escaped, but remains a single string arg with JSON.stringify.
test("quote breakout payload is a single string arg (not statement breakout)", () => {
  const payload = "'); alert(1); //"
  const oldExpr = oldWaitExpr(payload)
  const newExpr = newWaitExpr(payload)

  // Old pattern: the weak escape still closes the surrounding single-quoted
  // string early because `\'` inside single quotes is just a quote, and the
  // trailing `); alert...` becomes sibling statements.
  // Demonstrate the structural difference: new expr must round-trip via JSON.
  const lit = selectorJsLiteral(payload)
  assert.equal(JSON.parse(lit), payload)
  assert.equal(newExpr, `!!document.querySelector(${lit})`)

  // Old expression is NOT equal to a safe JSON form — it still uses single quotes.
  assert.ok(oldExpr.includes("querySelector('"))
  assert.ok(oldExpr !== newExpr)
})

test("backslash + quote breakout is neutralized by JSON.stringify", () => {
  // Payload: ends the weak-escaped single-quoted string and injects code.
  // weakEscape: \ → stays \, ' → \', so `\');evil//` can still break out
  // depending on JS single-quote rules. JSON.stringify turns \ into \\ and
  // ' into \u0027 or keeps it inside double quotes safely.
  const payload = "\\');evil();//"
  const lit = selectorJsLiteral(payload)
  assert.equal(JSON.parse(lit), payload)

  // Assembled expressions only contain the literal as a function argument.
  const waitExpr = newWaitExpr(payload)
  const centerExpr = newGetElementCenterExpr(payload)
  const htmlExpr = newGetPageHtmlExpr(payload)

  assert.equal(waitExpr, `!!document.querySelector(${lit})`)
  assert.ok(centerExpr.includes(`document.querySelector(${lit})`))
  assert.ok(htmlExpr.includes(`.querySelector(${lit})`))

  // No raw unescaped single-quoted embedding of the payload.
  assert.equal(waitExpr.includes(`'${payload}'`), false)
  assert.equal(centerExpr.includes(`'${payload}'`), false)
})

test("newlines in selectors are escaped inside the literal", () => {
  const payload = "div\n.class\r\n#x"
  const lit = selectorJsLiteral(payload)
  assert.equal(JSON.parse(lit), payload)
  // JSON.stringify escapes CR/LF so they cannot break a surrounding string/statement.
  assert.ok(!lit.includes("\n"))
  assert.ok(!lit.includes("\r"))
  assert.ok(lit.includes("\\n") || lit.includes("\\r"))
})

test("assembled waitForSelector / getElementCenter expressions reject weak-escape form", () => {
  const evil = "x');void 0;//"
  // Document the old vulnerable assembly for regression clarity.
  const vulnerable = `!!document.querySelector('${evil.replace(/'/g, "\\'")}')`
  const safe = newWaitExpr(evil)
  assert.ok(safe !== vulnerable)
  assert.equal(JSON.parse(selectorJsLiteral(evil)), evil)
})
