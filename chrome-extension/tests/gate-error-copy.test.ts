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

test("L3: cage copy says common credential paths (no 凭据目录 overclaim)", () => {
  const out = humanizeSidepanelGateError(
    "Security Block: navigate to local path is not allowed (sensitive/system/unc).",
  )
  assert.match(out, /常见凭据路径/)
  assert.ok(!out.includes("凭据目录"))
})
