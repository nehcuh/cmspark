import test from "node:test"
import assert from "node:assert/strict"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ConfirmElevated } from "../src/cockpit/CockpitApp"
import type { SecurityConfirmationRequest } from "../src/sidepanel/types"
function html(extra: object = {}) {
  return renderToStaticMarkup(createElement(ConfirmElevated, { request: { confirmation_id: "controlled-confirm", tool_name: "host_computer", dangerous_apis: [], relevant_apps: [], relevant_domains: [], code_preview: "controlled task", timeout_ms: 45000, ...extra } as SecurityConfirmationRequest, threadId: "controlled-thread", onResolved() {} }))
}
test("#532 actual Cockpit confirmation visibly explains preview failure", () => {
  const result = html({ preview_unavailable_reason: "capture_failed" })
  assert.match(result, /预览不可用（降级确认）/)
  assert.match(result, /无法获取目标窗口截图/)
  assert.match(result, /role="status"/)
  assert.match(result, /允许/)
  assert.match(result, /拒绝/)
})
test("#532 actual Cockpit distinguishes timeout and missing target", () => {
  assert.match(html({ preview_unavailable_reason: "timeout" }), /预览生成超时/)
  assert.match(html({ preview_unavailable_reason: "target_unavailable" }), /未找到可预览的目标窗口/)
})
test("#532 success, unattempted, old protocol and hostile reason controls", () => {
  assert.doesNotMatch(html(), /降级确认/)
  assert.doesNotMatch(html({ preview_unavailable_reason: "<script>secret</script>" }), /secret|降级确认/)
  const result = html({ preview_image: "ZmFrZQ==", preview_caption: "controlled caption" })
  assert.match(result, /alt="标注截图"/)
  assert.doesNotMatch(result, /降级确认/)
})

test("#532 recorded real producer frames survive production WS whitelist and reducer", async () => {
  const fs = await import("node:fs"), path = await import("node:path")
  const { confirmationPreviewFromMessage } = await import("../src/sidepanel/utils/confirmation-preview")
  const { agentReducer, initialState } = await import("../src/sidepanel/store/agentStore")
  const recorded = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/confirmation-preview-532.json"), "utf8"))
  for (const [mode, frame] of Object.entries(recorded) as Array<[string, any]>) {
    const request = { ...frame, ...confirmationPreviewFromMessage(frame) }
    const state = agentReducer(initialState, { type: "ADD_SECURITY_CONFIRMATION", request })
    const adopted = state.pendingSecurityConfirmations[0]
    assert.equal(adopted.preview_unavailable_reason, frame.preview_unavailable_reason)
    assert.equal(adopted.preview_image, frame.preview_image)
    const markup = html(adopted)
    assert.equal(markup.includes("降级确认"), ["capture", "no_window", "timeout"].includes(mode))
    assert.equal(confirmationPreviewFromMessage({ preview_unavailable_reason: { toString: () => "capture_failed" } }).preview_unavailable_reason, undefined)
    const closed = agentReducer(state, { type: "REMOVE_SECURITY_CONFIRMATION", confirmationId: request.confirmation_id })
    assert.equal(closed.pendingSecurityConfirmations.length, 0)
  }
})

test("#532 actual preview image error handler renders fixed explanation", async () => {
  const { ConfirmationPreview } = await import("../src/cockpit/ConfirmationPreview")
  let failed = false
  const props = { image: "ZmFrZQ==", imageFailed: false, onImageError: () => { failed = true } }
  const view = ConfirmationPreview(props) as any
  assert.equal(view.type, "img")
  view.props.onError({ message: "secret /private/path" })
  assert.equal(failed, true)
  const markup = renderToStaticMarkup(createElement(ConfirmationPreview, { ...props, imageFailed: failed }))
  assert.match(markup, /预览图片加载失败/)
  assert.doesNotMatch(markup, /secret|private\/path|<img/)
})
