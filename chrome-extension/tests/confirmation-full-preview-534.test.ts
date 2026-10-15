// Recorded actual admission/manager output, checked against producer by Companion test.
// SSR of the real component; no human Allow, native input, CSS geometry or effects.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ConfirmElevated } from "../src/cockpit/CockpitApp"
import { confirmationPreviewFromMessage } from "../src/sidepanel/utils/confirmation-preview"
import { agentReducer, initialState } from "../src/sidepanel/store/agentStore"
import type { SecurityConfirmationRequest } from "../src/sidepanel/types"

const recorded = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/confirmation-full-preview-534.json"), "utf8"))
function escape(text: string) { return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;") }
function render(frame: any) {
  const request = { ...frame, ...confirmationPreviewFromMessage(frame) } as SecurityConfirmationRequest
  const state = agentReducer(initialState, { type: "ADD_SECURITY_CONFIRMATION", request })
  let callbacks = 0
  const html = renderToStaticMarkup(createElement(ConfirmElevated, { request: state.pendingSecurityConfirmations[0], threadId: null, onResolved() { callbacks++ } }))
  assert.equal(callbacks, 0)
  const pre = html.match(/<pre([^>]*)>([\s\S]*?)<\/pre>/)
  if (!pre) throw Error("actual production confirmation surface missing")
  assert.match(pre[1], /max-height:100px/)
  assert.match(pre[1], /overflow:auto/)
  assert.match(pre[1], /white-space:pre-wrap/)
  assert.match(html, />允许<\/button>/)
  return { html, pre: pre[2] }
}
for (const row of recorded.cases) {
  test("#534 real Cockpit shows entire recorded task/budget/draft: " + row.case, () => {
    const { html, pre } = render(row.frame)
    assert.equal(pre, escape(row.frame.full_preview))
    assert.ok(pre.includes("动作预算: " + row.params.budget))
    for (const action of row.params.actions) assert.ok(pre.includes(action.target || "坐标 (" + action.x + ", " + action.y + ")"))
    assert.doesNotMatch(html, /<script|<img src="x"|onerror=owned>/)
    if (row.case === "escaped-hostile-task") assert.match(pre, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  })
}
for (const full of [undefined, ""]) {
  test("#534 controlled old-frame fallback retains 1200 limit: " + String(full), () => {
    // Declared transport mutation of a recorded frame; no invented producer fields.
    const code = "C".repeat(1600) + "<script>legacy</script>"
    const frame = { ...recorded.cases[0].frame, full_preview: full, code_preview: code }
    const { pre } = render(frame)
    assert.equal(pre, escape(code.slice(0, 1200)))
  })
}
test("#534 controlled missing previews stay empty", () => {
  const { pre } = render({ ...recorded.cases[0].frame, full_preview: undefined, code_preview: undefined })
  assert.equal(pre, "")
})
