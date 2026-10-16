// #686 real React SSR, no browser window/extension runtime or network.
import test from "node:test"
import assert from "node:assert/strict"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { AppsPanel } from "../src/sidepanel/components/AppsPanel"
import { MinimalConfirm } from "../src/sidepanel/components/MinimalConfirm"
import * as storeModule from "../src/sidepanel/store/agentStore"
const store = storeModule as any
function withState(state: any, render: () => string) {
  const previous = store.useAgentStore
  store.useAgentStore = () => ({ state: { ...store.initialState, ...state }, dispatch: () => { throw new Error("SSR must be readonly") } })
  try { return render() } finally { store.useAgentStore = previous }
}
test("#686 real AppsPanel renders escaped readonly template/risk; master App toggle stays disabled", () => {
  const e: any = { token: "win.app.owned686", kind: "gui", display_name: "Owned inert editor", policy: "ai", source: "user", enabled: true,
    added_at: "2026-10-16", exe: { path: "C:\\Owned686\\notepad++.exe", user_writable_dir: true },
    templates: [{ id: "open_text", name: "<img src=x onerror=owned686>", profile: "npp-8.9.8.1-x64-local-text-v1", risk: "dangerous" }] }
  const html = withState({ appEntries: [e], appPresets: [], appsPlatform: "win32", appsEnabled: true }, () => renderToStaticMarkup(React.createElement(AppsPanel)))
  assert.ok(html.includes("文件模板：")); assert.ok(html.includes("&lt;img")); assert.ok(!html.includes("<img src=x"))
  assert.ok(html.includes("每次确认 + 第二因素")); assert.ok(html.includes("配置只读"))
  assert.match(html, /<input[^>]*disabled=""[^>]*checked=""/)
})
test("#686 real compact and expanded no-preview confirmation cannot approve file template", () => {
  for (const compact of [false, true]) {
    const html = withState({ pendingSecurityConfirmations: [{ confirmation_id: "owned686", tool_name: "host_app",
      full_preview: "Owned full file parameters", relevant_apps: [], risk_level: "high" }] },
      () => renderToStaticMarkup(React.createElement<{ compact?: boolean }>(MinimalConfirm, { compact })))
    assert.match(html, /<button[^>]*disabled=""[^>]*title="请在确认台查看完整文件参数后批准"/)
    assert.ok(html.includes("确认台"))
  }
})
test("#686 malformed old-server template view does not crash App card", () => {
  const html = withState({ appEntries: [{ token: "win.app.owned686", kind: "gui", display_name: "Owned", source: "user", enabled: false,
    policy: "manual", added_at: "2026", templates: "unsupported-old-config", template_unavailable: "模板不支持" }], appPresets: [], appsPlatform: "win32" },
    () => renderToStaticMarkup(React.createElement(AppsPanel)))
  assert.ok(html.includes("模板不支持"))
})
