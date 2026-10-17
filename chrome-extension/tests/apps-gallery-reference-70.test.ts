// Fixture recorded from actual handleAppsMessage(apps.list) with no detected files.
// Certificate evidence remains unknown; no fabricated positive signature receipt.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { AppsPanel } from "../src/sidepanel/components/AppsPanel"
import * as storeModule from "../src/sidepanel/store/agentStore"
const store = storeModule as any
const fixture = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/app-gallery-list-70.json"), "utf8"))
function render(presets = fixture.presets) {
  const old = store.useAgentStore
  store.useAgentStore = () => ({ state: { ...store.initialState, appEntries: fixture.entries, appPresets: presets, appsPlatform: fixture.platform }, dispatch: () => { throw Error("SSR is readonly") } })
  try { return renderToStaticMarkup(React.createElement(AppsPanel)) } finally { store.useAgentStore = old }
}
test("#70 actual apps.list payload renders finite release references and honest unknown state", () => {
  const html = render()
  for (const name of ["网易云音乐", "Notepad++", "Visual Studio Code Stable"]) assert.ok(html.includes(name))
  assert.equal((html.match(/指定发行版证书参考/g) || []).length, 2)
  assert.equal((html.match(/本机当前文件未核对/g) || []).length, 2)
  assert.ok(html.includes("发行版叶证书 SHA-256（DER）：尚未采集"))
  assert.ok(html.includes("%ProgramFiles%")); assert.ok(html.includes("手动策略"))
  assert.equal(html.includes("签名匹配"), false); assert.equal(html.includes("已验证本机"), false)
})
test("#70 legacy companion has no reference claim; malformed metadata remains bounded escaped plain text", () => {
  assert.equal(render([fixture.presets[0]]).includes("指定发行版证书参考"), false)
  const p = structuredClone(fixture.presets[1])
  p.reference.observedSubject = '<img src=x onerror=owned70>'
  p.reference.advice = 'X'.repeat(10_000)
  p.reference.typicalPaths = [null, '<script>owned70</script>']
  p.reference.expectedCertificateSHA256DER = p.reference.packageSHA256 + 'not-a-digest'
  const html = render([p])
  assert.ok(html.includes('&lt;img')); assert.ok(!html.includes('<img src=x'))
  assert.ok(!html.includes('<script>owned70'))
  assert.ok(!html.includes('X'.repeat(401))); assert.ok(html.includes('发行版叶证书 SHA-256（DER）：尚未采集'))
  assert.ok(render([{ ...p, reference: "old-server-unsupported" }]).includes("Notepad++"))
})
