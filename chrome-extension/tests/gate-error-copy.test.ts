// L3/L4 (post-merge-198-201 adversary): sidepanel gate copy must not mislabel
// a files.example.com WS drop as a local-file error, and must not overclaim
// credential cages. Lock-step with companion/src/capability/user-gate-copy.ts.

import test from "node:test"
import assert from "node:assert/strict"
import { humanizeSidepanelGateError } from "../src/sidepanel/utils/gate-error-copy"

test("L4: files.example.com WS disconnect is NOT the local-file copy", () => {
  const out = humanizeSidepanelGateError(
    'Security Block: navigate to untrusted domain "files.example.com" requires user confirmation, but the WebSocket is not connected.',
  )
  assert.ok(!out.includes("无法打开该本地文件地址"), `got: ${out}`)
})

test("L4: local-file disconnect and invalid file: URL keep the local-file copy", () => {
  const disconnect = humanizeSidepanelGateError(
    "Security Block: create_tab to local file requires user confirmation, but the WebSocket is not connected. This is not a denied popup.",
  )
  assert.match(disconnect, /无法打开该本地文件地址/)

  const invalid = humanizeSidepanelGateError(
    "Security Block: create_tab to file: URL is invalid. This is not a confirmation dialog.",
  )
  assert.match(invalid, /无法打开该本地文件地址/)
})

test("high-risk leftover after approve is not 拒绝弹窗", () => {
  const leftover = humanizeSidepanelGateError(
    "操作未通过安全确认：Security Block: osascript_eval contains high-risk APIs (fetch). Execution requires user confirmation.\n若你已拒绝弹窗，可重新发起并选择批准；企业 shell/netsec 可能仍需单独确认。",
  )
  assert.match(leftover, /误拦|这不是确认弹窗/)
  assert.ok(!leftover.includes("若你已拒绝弹窗"))

  const denied = humanizeSidepanelGateError(
    "Security Block: osascript_eval contains high-risk APIs (fetch). User denied execution.",
  )
  assert.match(denied, /拒绝/)

  const unavailable = humanizeSidepanelGateError(
    "页面脚本（fetch）需要确认，但确认通道不可用。\n这不是确认弹窗：侧栏未连上或确认台不可用，不是你拒绝了。",
  )
  assert.ok(!unavailable.includes("🛑"), `got: ${unavailable}`)
  assert.ok(!unavailable.includes("若你已拒绝弹窗"))
})

test("L3: cage copy says common credential paths (no 凭据目录 overclaim)", () => {
  const out = humanizeSidepanelGateError(
    "Security Block: navigate to local path is not allowed (sensitive/system/unc).",
  )
  assert.match(out, /常见凭据路径/)
  assert.ok(!out.includes("凭据目录"))
})
