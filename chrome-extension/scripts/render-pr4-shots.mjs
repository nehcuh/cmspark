// #321 PR-4 acceptance screenshots.
//   empty-l0   — mark 48 + 22px greeting (L0 copy SoT: no chips)
//   empty-l1   — 3 page invites above the ~52px composer
//   bubble-a   — shipped user bubble: paper + hairline
//   bubble-b   — alternative: left indigo bar (not live)
// Reproduce (from chrome-extension/):
//   npx tsc -p tsconfig.shots.json && node scripts/render-pr4-shots.mjs

import { createRequire } from "node:module"
import { mkdirSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { execFileSync } from "node:child_process"

const require = createRequire(import.meta.url)
const OUT = join(process.cwd(), ".shot-out")
const ASSETS = join(process.cwd(), "..", "docs", "assets", "321-pr4")
mkdirSync(OUT, { recursive: true })
mkdirSync(ASSETS, { recursive: true })

globalThis.chrome = {
  runtime: { sendMessage: () => {}, lastError: null, getURL: (p) => p },
  tabs: { query: (_q, cb) => cb && cb([]), onActivated: { addListener() {}, removeListener() {} }, onUpdated: { addListener() {}, removeListener() {} } },
}

const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const { CompanionMark } = require("../.shot-dist/src/sidepanel/ui/icons.js")
const { emptyStateCopy } = require("../.shot-dist/src/sidepanel/empty-state-copy.js")
const { tokens } = require("../.shot-dist/src/sidepanel/ui/tokens.js")

const css = `
  html,body { margin:0; background:#f4f4f5; font-family: ${tokens.font}; }
  .panel { width:320px; height:500px; margin:12px auto; background:#fff; border:1px solid rgba(23,23,23,.10);
    display:flex; flex-direction:column; overflow:hidden; }
  .rail { height:48px; border-bottom:1px solid rgba(23,23,23,.10); display:flex; align-items:center;
    padding:0 12px; font-size:13px; color:#171717; flex-shrink:0; }
  .body { flex:1; min-height:0; padding:16px 8px 8px; display:flex; flex-direction:column; align-items:center; }
  .title { font-size:22px; font-weight:600; letter-spacing:-0.035em; margin:12px 0 10px; text-align:center; color:#171717; }
  .invites { display:flex; flex-direction:column; gap:8px; width:100%; max-width:260px; }
  .invite { text-align:left; font-size:14px; color:#171717; line-height:1.4; }
  .pagechip { margin-top:12px; font-size:12px; color:#737373; border:1px solid rgba(23,23,23,.10);
    border-radius:999px; padding:6px 12px; width:100%; max-width:260px; box-sizing:border-box; }
  .composer { margin:8px 14px 12px; min-height:52px; border:1px solid rgba(23,23,23,.10); border-radius:16px;
    display:flex; align-items:flex-end; gap:8px; padding:6px 10px 6px 12px; flex-shrink:0; color:#a3a3a3; font-size:14px; }
  .send { width:32px; height:32px; border-radius:999px; background:${tokens.sendDisabledBg}; margin-left:auto; flex-shrink:0; }
  .msg { max-width:78%; margin:10px 16px; padding:9px 13px; font-size:13px; line-height:1.5; }
  .label { font-size:11px; color:#737373; margin:16px 16px 0; }
`

function EmptyShot(level, pageTitle) {
  const copy = emptyStateCopy(level, pageTitle ?? null)
  return React.createElement(
    "div",
    { className: "panel" },
    React.createElement("div", { className: "rail" }, "CMspark"),
    React.createElement(
      "div",
      { className: "body" },
      React.createElement(CompanionMark, { size: 48 }),
      React.createElement("div", { className: "title" }, copy.title),
      copy.items.length
        ? React.createElement(
            "div",
            { className: "invites" },
            copy.items.map((it) =>
              React.createElement("div", { className: "invite", key: it.label }, it.label),
            ),
          )
        : null,
      copy.pageChip ? React.createElement("div", { className: "pagechip" }, copy.pageChip) : null,
    ),
    React.createElement(
      "div",
      { className: "composer" },
      React.createElement("span", { style: { flex: 1 } }, "描述任务，或粘贴截图…"),
      React.createElement("div", { className: "send" }),
    ),
  )
}

function BubbleShot(variant) {
  const a = {
    background: tokens.userBubbleBg,
    color: tokens.userBubbleInk,
    border: `1px solid ${tokens.userBubbleBorder}`,
    borderRadius: "14px 14px 4px 14px",
    boxShadow: tokens.shadowSm,
  }
  const b = {
    background: tokens.assistantBubbleBg,
    color: tokens.assistantBubbleText,
    border: `1px solid ${tokens.border}`,
    borderLeft: `3px solid ${tokens.accent}`,
    borderRadius: "14px 14px 4px 14px",
    boxShadow: tokens.shadowSm,
  }
  const style = variant === "a" ? a : b
  const caption = variant === "a" ? "方案 A（交付）：浅底 + 细边" : "方案 B（备选）：左细 indigo 条"
  return React.createElement(
    "div",
    { className: "panel", style: { height: 280 } },
    React.createElement("div", { className: "rail" }, caption),
    React.createElement("div", { className: "label" }, "用户"),
    React.createElement("div", { className: "msg", style: { marginLeft: "auto", ...style } }, "把这篇总结成三段。"),
    React.createElement("div", { className: "label" }, "助手"),
    React.createElement(
      "div",
      {
        className: "msg",
        style: {
          background: tokens.assistantBubbleBg,
          border: `1px solid ${tokens.border}`,
          borderRadius: "14px 14px 14px 4px",
        },
      },
      "好。先列要点，再压缩成三段。",
    ),
  )
}

const pages = {
  "empty-l0": () => EmptyShot("chat"),
  "empty-l1": () => EmptyShot("browser", "某页"),
  "bubble-a": () => BubbleShot("a"),
  "bubble-b": () => BubbleShot("b"),
}

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for (const [name, render] of Object.entries(pages)) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${renderToStaticMarkup(render())}</body></html>`
  writeFileSync(join(OUT, `pr4-${name}.html`), html)
  console.log("html", name)
  if (!existsSync(CHROME)) {
    console.warn("chrome skip", name)
    continue
  }
  try {
    execFileSync(
      CHROME,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--window-size=360,520",
        `--screenshot=${join(ASSETS, `pr4-${name}.png`)}`,
        `file://${join(OUT, `pr4-${name}.html`)}`,
      ],
      { stdio: "pipe" },
    )
    console.log("png", name)
  } catch (e) {
    console.warn("chrome skip", name, e.message || e)
  }
}
