import test from "node:test"
import assert from "node:assert/strict"
import {
  presentLocator,
  classifyTabUrl,
  classifyAttachFailure,
  codedToolError,
  planLocator,
  isInvalidSelectorMessage,
  isAttachFailureMessage,
  classifyInteractiveFailure,
} from "../src/background/locator-classify"
import {
  buildFindByTextExpression,
  CLICK_HIT_ATTR,
  DOWNLOAD_HIT_ATTR,
} from "../src/background/find-element-by-text"

test("presentLocator trims empty to absent", () => {
  assert.equal(presentLocator("  "), undefined)
  assert.equal(presentLocator(""), undefined)
  assert.equal(presentLocator(null), undefined)
  assert.equal(presentLocator("  发布  "), "发布")
})

test("classifyTabUrl privileged vs web vs file", () => {
  assert.equal(classifyTabUrl("chrome-extension://abcd/pdf.html"), "privileged")
  assert.equal(classifyTabUrl("chrome://settings"), "privileged")
  assert.equal(classifyTabUrl("https://www.zhihu.com/write"), "web")
  assert.equal(classifyTabUrl("http://localhost:3000"), "web")
  assert.equal(classifyTabUrl("file:///tmp/x.html"), "file")
  assert.equal(classifyTabUrl("about:blank"), "empty")
})

test("https attach failure is CDP_ATTACH_FAILED not WRONG_ORIGIN", () => {
  const r = classifyAttachFailure("https://www.zhihu.com/write")
  assert.equal(r.error_code, "CDP_ATTACH_FAILED")
  assert.equal(r.suggested_action, "list_tabs")
})

test("chrome-extension url is WRONG_ORIGIN from tabs.get not error substring", () => {
  const r = classifyAttachFailure("chrome-extension://gfbliohnn/pdf.html")
  assert.equal(r.error_code, "WRONG_ORIGIN")
})

test("codedToolError prefixes CODE:", () => {
  const e = codedToolError("ELEMENT_AMBIGUOUS", "2 matches", {
    suggested_action: "disambiguate_selector_or_exact_text",
    user_hint_zh: "有 2 处匹配",
  })
  assert.equal(e.success, false)
  assert.match(e.error, /^ELEMENT_AMBIGUOUS:/)
  assert.equal(e.data.error_code, "ELEMENT_AMBIGUOUS")
  assert.equal(e.data.suggested_action, "disambiguate_selector_or_exact_text")
})

test("click finder IIFE uses click hit attr not download attr", () => {
  const expr = buildFindByTextExpression("发布", false, CLICK_HIT_ATTR)
  assert.ok(expr.includes(JSON.stringify(CLICK_HIT_ATTR)))
  assert.ok(!expr.includes("data-cmspark-dl-hit"))
})

test("default finder IIFE still uses download hit attr", () => {
  const expr = buildFindByTextExpression("下载")
  assert.ok(expr.includes("data-cmspark-dl-hit"))
  assert.equal(DOWNLOAD_HIT_ATTR, "data-cmspark-dl-hit")
})

test("combination C: text exclusive when both present", () => {
  const both = planLocator({ text: "发布", selector: "#wrong" })
  assert.equal(both.kind, "text")
  if (both.kind === "text") assert.equal(both.text, "发布")
  assert.equal(planLocator({ text: "  ", selector: "#ok" }).kind, "css")
  assert.equal(planLocator({ text: "", selector: "" }).kind, "none")
})

test("INVALID_SELECTOR regex does not flag Chrome i attribute", () => {
  assert.equal(isInvalidSelectorMessage('a[href*="blog" i]'), false)
  assert.equal(isInvalidSelectorMessage("Failed to execute 'querySelector' on 'Document': 'a[' is not a valid selector"), true)
})

test("file: attach is not WRONG_ORIGIN", () => {
  assert.equal(classifyAttachFailure("file:///tmp/x.html").error_code, "CDP_ATTACH_FAILED")
})

test("Debugger is not attached on https is CDP_ATTACH_FAILED not ELEMENT_NOT_FOUND", () => {
  assert.equal(isAttachFailureMessage("Debugger is not attached"), true)
  const r = classifyInteractiveFailure(
    "https://zhihu.com/write",
    "Debugger is not attached",
    "ELEMENT_NOT_FOUND",
  )
  assert.equal(r.error_code, "CDP_ATTACH_FAILED")
  assert.equal(r.suggested_action, "list_tabs")
  assert.equal(r.suggested_action.includes("evaluate"), false)
  assert.equal(r.suggested_action.includes("host_computer"), false)
})

test("privileged URL is WRONG_ORIGIN even if message says element not found", () => {
  const r = classifyInteractiveFailure(
    "chrome-extension://abcd/pdf.html",
    "Element not found: #x",
    "ELEMENT_NOT_FOUND",
  )
  assert.equal(r.error_code, "WRONG_ORIGIN")
})

test("locator miss on https stays ELEMENT_NOT_FOUND", () => {
  const r = classifyInteractiveFailure(
    "https://zhihu.com/write",
    "Element not found: #missing",
    "ELEMENT_NOT_FOUND",
  )
  assert.equal(r.error_code, "ELEMENT_NOT_FOUND")
})
