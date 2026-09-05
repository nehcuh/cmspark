// #321 PR-3 acceptance screenshots — renders the REAL StatusRail + ToastHost
// (TSX bundled by esbuild, React client mount) for four states:
//   1. empty idle (connected)     — brand point resident, rail chrome clean
//   2. disconnected               — rail passive role=status (single CTA bottom banner)
//   3. ⋯ menu expanded            — grouped 会话/能力/诊断 + renamed 离线导出当前页
//   4. toast burst                — single queue column (info/warning/error), no pile-up
// Output: .shot-out/pr3-{empty,disconnected,menu,toast}.html (+ PNG via Chrome).
// Reproduce (from chrome-extension/):
//   node scripts/render-pr3-shots.mjs
//   for s in empty disconnected menu toast; do
//     "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//       --headless=new --disable-gpu --hide-scrollbars --window-size=360,300 \
//       --screenshot="../docs/assets/321-pr3/pr3-${s}.png" \
//       "file://$PWD/.shot-out/pr3-${s}.html"
//   done

import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const EXT = join(HERE, "..")
const OUT = join(EXT, ".shot-out")
const DRIVER = join(OUT, "pr3-driver.tsx")
mkdirSync(OUT, { recursive: true })

const scenarios = ["empty", "disconnected", "menu", "toast"]

const driver = `
import React, { useState, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { AgentStoreProvider, initialState } from "../src/sidepanel/store/agentStore"
import { StatusRail } from "../src/sidepanel/components/StatusRail"
import { ToastHost } from "../src/sidepanel/components/ToastHost"
import { makeToast, pushToast } from "../src/sidepanel/ui/toastQueue"

const seed = (over: Record<string, unknown>) => ({ ...initialState, ...over }) as never
const railProps = (connectionState: "connected" | "disconnected" | "connecting") => ({
  connectionState,
  capabilityLevel: "chat" as const,
  badgeLabel: "对话",
  onCraft: () => {},
  onToggleLogs: () => {},
  onOpenNotebooklmImporter: () => {},
  onToast: () => {},
})

const pages: Record<string, () => void> = {
  empty() {
    const host = document.getElementById("host")!
    createRoot(host).render(
      React.createElement(AgentStoreProvider, { initialState: seed({}) },
        React.createElement("div", { className: "panel" },
          React.createElement(StatusRail, railProps("connected")),
          React.createElement("div", { className: "mock-chat" }, "对话区（示意）"))),
    )
  },
  disconnected() {
    const host = document.getElementById("host")!
    createRoot(host).render(
      React.createElement(AgentStoreProvider, { initialState: seed({}) },
        React.createElement("div", { className: "panel" },
          React.createElement(StatusRail, railProps("disconnected")),
          React.createElement("div", { className: "banner" },
            React.createElement("div", { className: "banner-title" }, "Companion 未连接"),
            React.createElement("div", { className: "banner-actions" },
              React.createElement("button", { className: "banner-btn" }, "重新连接"),
              React.createElement("button", { className: "banner-btn ghost" }, "查看日志"))),
          React.createElement("div", { className: "mock-chat" }, "对话区（示意）"))),
    )
  },
  menu() {
    const host = document.getElementById("host")!
    const st = seed({
      activeThreadId: "t1",
      messages: [{ id: "m1", role: "user", content: "hi", ts: 1 }],
      threads: [{ ...initialState.threads[0], id: "t1", title: "对话 A" }],
    })
    function RailDemo() {
      return React.createElement(AgentStoreProvider, { initialState: st },
        React.createElement("div", { className: "panel tall" },
          React.createElement(StatusRail, railProps("connected")),
          React.createElement("div", { className: "mock-chat" }, "对话区（示意）")),
      )
    }
    createRoot(host).render(React.createElement(RailDemo))
    // open the ⋯ menu by clicking its trigger after mount
    setTimeout(() => {
      const btn = document.querySelector('button[aria-label="更多工具与设置"]') as HTMLButtonElement | null
      if (btn) btn.click()
    }, 60)
  },
  toast() {
    const host = document.getElementById("host")!
    function ToastDemo() {
      const [items, setItems] = useState<ReturnType<typeof makeToast>[]>([])
      useEffect(() => {
        setItems((prev) => {
          let l = pushToast(prev, makeToast("已导出：thread-a → Markdown（成功）"))
          l = pushToast(l, makeToast("Companion 正在尝试重新连接…", "warning"))
          l = pushToast(l, makeToast("无法联系扩展后台，请刷新后重试", "error"))
          return l
        })
      }, [])
      return React.createElement(AgentStoreProvider, { initialState: seed({}) },
        React.createElement("div", { className: "panel" },
          React.createElement(StatusRail, railProps("connected")),
          React.createElement("div", { style: { position: "relative", height: 0 } },
            React.createElement(ToastHost, { toasts: items, onClose: () => {} })),
          React.createElement("div", { className: "mock-chat" }, "对话区（示意）")),
      )
    }
    createRoot(host).render(React.createElement(ToastDemo))
  },
}

pages[document.body.dataset.page as string]()
`

writeFileSync(DRIVER, driver)

const pageHtml = (s) => `<!doctype html><html><head><meta charset="utf-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}html,body{background:#fff}
body{width:360px;font-family:-apple-system,"SF Pro Text","PingFang SC",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.panel{width:360px;min-height:260px}
.mock-chat{margin:12px;padding:24px 16px;border-radius:12px;background:#fff;border:1px solid #e5e5e5;color:#a3a3a3;font-size:13px;text-align:center}
.banner{margin:10px;padding:12px 14px;border:1px solid #fde68a;background:#fffbeb;border-radius:10px}
.banner-title{font-size:13px;font-weight:600;color:#171717;margin-bottom:8px}
.banner-btn{border:none;background:#d97706;color:#fff;border-radius:8px;padding:5px 12px;font-size:12px;margin-right:6px;cursor:pointer;font-family:inherit}
.banner-btn.ghost{background:#fff;color:#92400e;border:1px solid #fde68a}
</style></head><body data-page="${s}"><div id="host"></div>
<script type="module" src="./pr3-bundle.js"></script>
</body></html>`

for (const s of scenarios) writeFileSync(join(OUT, `pr3-${s}.html`), pageHtml(s))

// Bundle driver with esbuild (resolve from EXT). React + our modules bundled in.
// chrome shim injected first so module-scope chrome.* reads (if any) are safe.
execFileSync(
  join(EXT, "node_modules", ".bin", "esbuild"),
  [
    DRIVER,
    "--bundle",
    `--outfile=${join(OUT, "pr3-bundle.js")}`,
    "--format=iife",
    "--loader:.tsx=tsx",
    "--loader:.ts=ts",
    "--jsx=automatic",
    `--inject:${join(OUT, "chrome-shim.ts")}`,
    "--define:process.env.NODE_ENV='development'",
    "--log-level=warning",
  ],
  { stdio: "inherit", cwd: EXT },
)
console.log("ok: pr3-{empty,disconnected,menu,toast}.html + pr3-bundle.js in", OUT)
