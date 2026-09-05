// #321 PR-2 acceptance screenshots — renders the REAL StatusRail + FocusBand
// (compiled from src via tsconfig.shots.json) with three seeded store states:
//   1. empty idle        (band hidden — chat level, no scene, nothing running)
//   2. scene idle        (mission pack + workspace + tool surface attached)
//   3. confirm + 急停     (pending confirmation with L2 task running)
// Output: .shot-out/now-band-{empty,scene,confirm}.html + a markdown index.
// Reproduce the committed PNGs:
//   npx tsc -p tsconfig.shots.json && node scripts/render-now-band-shots.mjs
//   for s in empty scene confirm; do
//     "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//       --headless=new --disable-gpu --hide-scrollbars --window-size=380,320 \
//       --screenshot="../docs/assets/321-pr2/now-band-${s}.png" \
//       "file://$PWD/.shot-out/now-band-${s}.html"
//   done
// Then assert the real rendered band height (≤80px) + scene-name visibility:
//   node scripts/measure-now-band-heights.mjs

import { createRequire } from "node:module"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const require = createRequire(import.meta.url)
const OUT = join(process.cwd(), ".shot-out")
mkdirSync(OUT, { recursive: true })

// Minimal chrome shim — components only touch chrome.* inside event handlers,
// but module-load paths may reference the global.
globalThis.chrome = {
  runtime: {
    sendMessage: (_msg, _cb) => {},
    lastError: null,
    getURL: (p) => p,
  },
}

const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const { AgentStoreProvider, initialState } = require("../.shot-dist/src/sidepanel/store/agentStore.js")
const { StatusRail } = require("../.shot-dist/src/sidepanel/components/StatusRail.js")
const { FocusBand } = require("../.shot-dist/src/sidepanel/components/FocusBand.js")
const {
  ContextPanelHostProvider,
} = require("../.shot-dist/src/sidepanel/components/ContextPanelHost.js")

const seed = (over) => ({ ...initialState, ...over })

const scenarios = {
  empty: {
    level: "chat",
    state: seed({}),
    note: "空 idle — FocusBand 判 empty（无 Confirm/急停/run-busy/worker/场景），对话上方只剩 rail",
  },
  scene: {
    level: "chat",
    state: seed({
      activeThreadId: "t-scene",
      threads: [
        {
          ...initialState.threads[0],
          id: "t-scene",
          title: "场景对话",
          // Realistic long pack id (unmapped → raw id shown): the §1.1-3 stress case.
          mission_pack_id: "appsec-prd-review-weekly-audit",
          workspace_root: "/Users/dev/work/api-server-payment-gateway",
          tool_whitelist: ["shell_exec", "workspace_read"],
        },
      ],
    }),
    note: "挂场景 idle（长 pack 名）— 场景名 chip flexShrink:0 绝不被挤成「…」；工具面/工作区 chip 先让位省略",
  },
  confirm: {
    level: "chat",
    state: seed({
      activeThreadId: "t-cu",
      threads: [
        { ...initialState.threads[0], id: "t-cu", title: "CU 对话" },
      ],
      pendingSecurityConfirmations: [
        {
          confirmation_id: "c-1",
          tool_name: "osascript_eval",
          dangerous_apis: ["System Events"],
          code_preview: 'tell application "Finder" to activate',
          risk_level: "high",
          risk_category: "host-exec",
          risk_score: 0.9,
          relevant_domains: ["example.com"],
        },
      ],
      computerTask: {
        taskId: "task-42",
        app: "Finder",
        task: "整理下载文件夹",
        status: "running",
        resyncing: false,
        steps: [],
        abortAcked: false,
      },
    }),
    note: "Confirm + 急停同屏 — MinimalConfirm 主行 + 24px 急停次行（Confirm 不埋急停），深色专属",
  },
}

const pageCSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fafaf9; }
body {
  width: 360px;
  font-family: -apple-system, "SF Pro Text", "PingFang SC", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.panel { width: 360px; }
.mock-chat {
  margin: 12px; padding: 24px 16px; border-radius: 12px;
  background: #ffffff; border: 1px solid #e7e5e4; color: #a8a29e;
  font-size: 13px; text-align: center;
}
`

// Inline measure script (NIT-① round-2): after layout, record the rendered band
// height and — when a scene row exists — the scene-name button's effective width,
// into <meta name="focus-band-measure">. Read by measure-now-band-heights.mjs via
// headless Chrome --dump-dom. Old-bug signature: linkish crushed to min-content
// (~20-40px,「场景：…」); fixed behavior: name keeps (or tail-ellipsizes at) its own cap.
const MEASURE_SNIPPET = `<script>
(function () {
  function measure() {
    var fb = document.querySelector("[data-focus-band]");
    var row = document.querySelector('[data-testid="scene-status-bar"]');
    var btn = row ? row.querySelector("span button") : null;
    var h = fb ? Math.round(fb.getBoundingClientRect().height) : null;
    var w = btn ? Math.round(btn.getBoundingClientRect().width) : null;
    var ell = btn && btn.scrollWidth > btn.clientWidth ? 1 : 0;
    var meta = document.createElement("meta");
    meta.name = "focus-band-measure";
    meta.content = "height=" + h + ";scene-name-width=" + w + ";scene-ellipsis=" + ell;
    document.head.appendChild(meta);
  }
  if (document.readyState === "complete") measure();
  else window.addEventListener("load", measure);
})();
</script>`

for (const [name, sc] of Object.entries(scenarios)) {
  const markup = renderToStaticMarkup(
    React.createElement(
      AgentStoreProvider,
      { initialState: sc.state },
      React.createElement(
        ContextPanelHostProvider,
        { capabilityLevel: sc.level },
        React.createElement(
          "div",
          { className: "panel" },
          React.createElement(StatusRail, {
            connectionState: "connected",
            capabilityLevel: sc.level,
            badgeLabel: sc.level === "chat" ? "对话" : "浏览器",
            onCraft: () => {},
            onToggleLogs: () => {},
            onOpenNotebooklmImporter: () => {},
            onToast: () => {},
            onPopout: () => {},
            canPopout: !!sc.state.activeThreadId,
          }),
          React.createElement(FocusBand, { capabilityLevel: sc.level }),
          React.createElement("div", { className: "mock-chat" }, "对话区（示意）"),
        ),
      ),
    ),
  )
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${pageCSS}</style></head><body>${markup}${MEASURE_SNIPPET}</body></html>`
  writeFileSync(join(OUT, `now-band-${name}.html`), html)
  console.log(`ok now-band-${name}.html — ${sc.note}`)
}
