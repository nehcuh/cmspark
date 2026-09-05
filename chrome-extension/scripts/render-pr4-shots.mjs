// #321 PR-4 acceptance screenshots.
// empty-l0 / empty-l1: REAL EmptyState (esbuild bundle + client mount, PR-3 pipeline).
// bubble-a / bubble-b: token-styled comparison (A = live paper+hairline; B = left bar).
// Reproduce (from chrome-extension/):
//   node scripts/render-pr4-shots.mjs
// Chrome --virtual-time-budget lets EmptyState's tabs.query effect paint L1 chips.

import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const EXT = join(HERE, "..")
const OUT = join(EXT, ".shot-out")
const ASSETS = join(EXT, "..", "docs", "assets", "321-pr4")
const DRIVER = join(OUT, "pr4-driver.tsx")
const SHIM = join(OUT, "pr4-chrome-shim.ts")
mkdirSync(OUT, { recursive: true })
mkdirSync(ASSETS, { recursive: true })

writeFileSync(
  SHIM,
  `export const chrome = {
  runtime: { sendMessage() {}, lastError: null, getURL: (p: string) => p },
  tabs: {
    query(_q: unknown, cb: (tabs: { title?: string }[]) => void) {
      const title = (globalThis as { __SHOT_PAGE_TITLE?: string }).__SHOT_PAGE_TITLE || ""
      cb(title ? [{ title }] : [])
    },
    onActivated: { addListener() {}, removeListener() {} },
    onUpdated: { addListener() {}, removeListener() {} },
  },
}
`,
)

const driver = `
import React from "react"
import { createRoot } from "react-dom/client"
import { EmptyState } from "../src/sidepanel/components/ChatView"
import { tokens } from "../src/sidepanel/ui/tokens"

const pages: Record<string, () => void> = {
  "empty-l0"() {
    ;(globalThis as { __SHOT_PAGE_TITLE?: string }).__SHOT_PAGE_TITLE = ""
    createRoot(document.getElementById("host")!).render(
      React.createElement("div", { className: "panel" },
        React.createElement("div", { className: "rail" }, "CMspark"),
        React.createElement(EmptyState, { level: "chat" }),
        React.createElement("div", { className: "composer" },
          React.createElement("span", { style: { flex: 1 } }, "描述任务，或粘贴截图…"),
          React.createElement("div", { className: "send" }))),
    )
  },
  "empty-l1"() {
    ;(globalThis as { __SHOT_PAGE_TITLE?: string }).__SHOT_PAGE_TITLE = "某页"
    createRoot(document.getElementById("host")!).render(
      React.createElement("div", { className: "panel" },
        React.createElement("div", { className: "rail" }, "CMspark"),
        React.createElement(EmptyState, { level: "browser" }),
        React.createElement("div", { className: "composer" },
          React.createElement("span", { style: { flex: 1 } }, "问这页，或描述操作…"),
          React.createElement("div", { className: "send" }))),
    )
  },
  "bubble-a"() {
    const style = {
      background: tokens.userBubbleBg,
      color: tokens.userBubbleInk,
      border: "1px solid " + tokens.userBubbleBorder,
      borderRadius: "14px 14px 4px 14px",
      boxShadow: tokens.shadowSm,
    }
    mountBubbles("方案 A（交付）：浅底 + 细边", style)
  },
  "bubble-b"() {
    const style = {
      background: tokens.userBubbleBg,
      color: tokens.userBubbleInk,
      border: "1px solid " + tokens.userBubbleBorder,
      borderLeft: "3px solid " + tokens.accent,
      borderRadius: "14px 14px 4px 14px",
      boxShadow: tokens.shadowSm,
    }
    mountBubbles("方案 B（备选）：左细 indigo 条", style)
  },
}

function mountBubbles(caption: string, userStyle: React.CSSProperties) {
  createRoot(document.getElementById("host")!).render(
    React.createElement("div", { className: "panel short" },
      React.createElement("div", { className: "rail" }, caption),
      React.createElement("div", { className: "label" }, "用户"),
      React.createElement("div", { className: "msg user", style: userStyle }, "把这篇总结成三段。"),
      React.createElement("div", { className: "label" }, "助手"),
      React.createElement("div", { className: "msg" }, "好。先列要点，再压缩成三段。")),
  )
}

pages[document.body.dataset.page as string]()
`

writeFileSync(DRIVER, driver)

const pageHtml = (s) => `<!doctype html><html><head><meta charset="utf-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#f4f4f5;font-family:-apple-system,"SF Pro Text","PingFang SC",system-ui,sans-serif}
.panel{width:320px;height:500px;margin:12px auto;background:#fff;border:1px solid rgba(23,23,23,.10);display:flex;flex-direction:column;overflow:hidden}
.panel.short{height:280px}
.rail{height:48px;border-bottom:1px solid rgba(23,23,23,.10);display:flex;align-items:center;padding:0 12px;font-size:13px;color:#171717;flex-shrink:0}
.composer{margin:8px 14px 12px;min-height:52px;border:1px solid rgba(23,23,23,.10);border-radius:16px;display:flex;align-items:flex-end;gap:8px;padding:6px 10px 6px 12px;flex-shrink:0;color:#a3a3a3;font-size:14px}
.send{width:32px;height:32px;border-radius:999px;background:#e4e4e7;margin-left:auto;flex-shrink:0}
.label{font-size:11px;color:#737373;margin:16px 16px 0}
.msg{max-width:78%;margin:10px 16px;padding:9px 13px;font-size:13px;line-height:1.5}
.msg.user{margin-left:auto}
.msg:not(.user){background:#fff;border:1px solid rgba(23,23,23,.10);border-radius:14px 14px 14px 4px}
</style></head><body data-page="${s}"><div id="host"></div>
<script src="./pr4-bundle.js"></script>
</body></html>`

const scenarios = ["empty-l0", "empty-l1", "bubble-a", "bubble-b"]
for (const s of scenarios) writeFileSync(join(OUT, `pr4-${s}.html`), pageHtml(s))

execFileSync(
  join(EXT, "node_modules", ".bin", "esbuild"),
  [
    DRIVER,
    "--bundle",
    `--outfile=${join(OUT, "pr4-bundle.js")}`,
    "--format=iife",
    "--loader:.tsx=tsx",
    "--loader:.ts=ts",
    "--loader:.css=empty",
    "--loader:.woff=empty",
    "--loader:.woff2=empty",
    "--loader:.ttf=empty",
    "--jsx=automatic",
    `--inject:${SHIM}`,
    "--define:process.env.NODE_ENV='development'",
    "--log-level=warning",
  ],
  { stdio: "inherit", cwd: EXT },
)

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if (!existsSync(CHROME)) {
  console.warn("chrome skip — html+bundle written to", OUT)
  process.exit(0)
}
for (const s of scenarios) {
  execFileSync(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--virtual-time-budget=1500",
      "--window-size=360,520",
      `--screenshot=${join(ASSETS, `pr4-${s}.png`)}`,
      `file://${join(OUT, `pr4-${s}.html`)}`,
    ],
    { stdio: "pipe" },
  )
  console.log("png", s)
}
console.log("ok: real EmptyState empty-l0/l1 + bubble A/B in", ASSETS)
