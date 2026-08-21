import test from "node:test"
import assert from "node:assert/strict"
import {
  isDomInjectShellCommand,
  isDomScriptTool,
  recordDomScriptSuccess,
  peekDomScriptCap,
  resetDomScriptBudgetsForTests,
  DOM_SCRIPT_LOOP_MAX,
  DOM_SCRIPT_VOLUME_MAX,
  exprHashForDomScript,
  tabKeyForDomScript,
  originKeyFromUrl,
  resolveDomScriptBudgetMeta,
  cappedDomScriptResult,
} from "../src/tool/dom-script-budget.js"

test("shell inject heuristic: Start-Process chrome is NOT inject", () => {
  assert.equal(isDomInjectShellCommand('powershell -c "Start-Process chrome"'), false)
  assert.equal(isDomInjectShellCommand("tasklist | findstr chrome"), false)
  assert.equal(isDomInjectShellCommand("Get-Process chrome"), false)
})

test("shell inject heuristic: payload fingerprints", () => {
  assert.equal(isDomInjectShellCommand("osascript -e 'tell application \"Google Chrome\"'"), true)
  assert.equal(
    isDomInjectShellCommand('cmd /c cscript inject.js && echo document.querySelector'),
    true,
  )
  assert.equal(isDomInjectShellCommand("echo hello"), false)
  assert.equal(isDomInjectShellCommand("cscript //nologo inject.js"), false)
})

test("isDomScriptTool evaluate always, shell only if payload", () => {
  assert.equal(isDomScriptTool("evaluate", { code: "1+1" }), true)
  assert.equal(isDomScriptTool("click", {}), false)
  assert.equal(isDomScriptTool("shell_exec", { command: "ls" }), false)
  assert.equal(isDomScriptTool("shell_exec", { command: "osascript -e 1" }), true)
})

test("identical-key cap: 3 successes then 4th peek LOOP_CAPPED", () => {
  resetDomScriptBudgetsForTests()
  const key = "h:aaaa"
  const origin = "https://zhihu.com"
  recordDomScriptSuccess("t1", key, origin)
  recordDomScriptSuccess("t1", key, origin)
  recordDomScriptSuccess("t1", key, origin)
  assert.equal(peekDomScriptCap("t1", key, origin).capped, true)
  const cap = peekDomScriptCap("t1", key, origin)
  if (cap.capped) assert.equal(cap.error_code, "DOM_SCRIPT_LOOP_CAPPED")
  assert.equal(peekDomScriptCap("t1", "h:bbbb", origin).capped, false)
  assert.equal(DOM_SCRIPT_LOOP_MAX, 3)
})

test("volume cap: 24 unique keys then 25th peek VOLUME_CAPPED", () => {
  resetDomScriptBudgetsForTests()
  const origin = "https://zhihu.com"
  for (let i = 0; i < DOM_SCRIPT_VOLUME_MAX; i++) {
    recordDomScriptSuccess("vol", `h:${i}`, origin)
  }
  assert.equal(peekDomScriptCap("vol", "h:next", origin).capped, true)
  const cap = peekDomScriptCap("vol", "h:next", origin)
  if (cap.capped) assert.equal(cap.error_code, "DOM_SCRIPT_VOLUME_CAPPED")
  assert.equal(peekDomScriptCap("vol", "h:other", "https://x.com").capped, false)
})

test("exprHash stable and whitespace-normalized", () => {
  const a = exprHashForDomScript("evaluate", { code: "1+1" })
  const b = exprHashForDomScript("evaluate", { code: "1+1" })
  assert.equal(a, b)
  assert.equal(a.length, 12)
  assert.equal(a, exprHashForDomScript("evaluate", { code: "  1+1\n" }))
  assert.notEqual(a, exprHashForDomScript("evaluate", { code: "2+2" }))
})

test("tabKey prefers tabId then osascript url", () => {
  assert.equal(tabKeyForDomScript("evaluate", { tabId: 42 }), "tab:42")
  assert.equal(
    tabKeyForDomScript("osascript_eval", { url: "https://zhihu.com/write" }),
    "url:https://zhihu.com/write",
  )
})

test("originKeyFromUrl: host origin; missing → origin:unknown", () => {
  assert.equal(originKeyFromUrl("https://zhihu.com/write"), "https://zhihu.com")
  assert.equal(originKeyFromUrl(""), "origin:unknown")
  assert.equal(originKeyFromUrl(undefined), "origin:unknown")
  const shell = resolveDomScriptBudgetMeta("shell_exec", { command: "osascript -e 1" })
  assert.equal(shell.origin, "origin:unknown")
})

test("capped result never suggests host_computer or evaluate", () => {
  const r = cappedDomScriptResult("DOM_SCRIPT_VOLUME_CAPPED")
  assert.equal(r.success, false)
  assert.equal(r.data.suggested_action, "stop_or_change_task")
  assert.equal(r.data.suggested_action.includes("evaluate"), false)
  assert.doesNotMatch(JSON.stringify(r), /host_computer/)
})
