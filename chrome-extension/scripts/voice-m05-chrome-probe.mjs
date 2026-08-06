#!/usr/bin/env node
/**
 * M0.5 semi-automated Chrome probe (no mic required for API presence).
 *
 * Opens a temporary HTML page in Google Chrome with remote debugging and
 * evaluates SpeechRecognition availability + UA tier-1 heuristic.
 *
 * Usage:
 *   node chrome-extension/scripts/voice-m05-chrome-probe.mjs
 *
 * Exit 0 if ctor present on Chrome desktop page; 2 if missing; 3 infra.
 */
import { spawn } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as http from "node:http"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "../..")
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const PORT = 9222 + Math.floor(Math.random() * 200)

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.json()
}

async function cdp(wsUrl, method, params = {}) {
  const { default: WebSocket } = await import("ws").catch(() => ({ default: null }))
  if (!WebSocket) {
    // Minimal raw WS via undici not available — use chrome-remote-interface style with fetch HTTP only
    throw new Error("ws package required for CDP; falling back to list-only")
  }
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let id = 1
    const pending = new Map()
    ws.on("open", () => {
      const msg = { id: id++, method, params }
      pending.set(msg.id, { resolve, reject })
      ws.send(JSON.stringify(msg))
    })
    ws.on("message", (data) => {
      const m = JSON.parse(String(data))
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id)
        pending.delete(m.id)
        if (m.error) p.reject(new Error(JSON.stringify(m.error)))
        else p.resolve(m.result)
        ws.close()
      }
    })
    ws.on("error", reject)
    setTimeout(() => reject(new Error("CDP timeout")), 15000)
  })
}

async function main() {
  if (!fs.existsSync(CHROME)) {
    console.error("Chrome not found at", CHROME)
    process.exit(3)
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-voice-m05-"))
  const htmlPath = path.join(tmp, "probe.html")
  fs.writeFileSync(
    htmlPath,
    `<!doctype html><meta charset="utf-8"><title>voice-m05-probe</title>
<body><pre id="o">loading</pre>
<script>
const o = document.getElementById('o');
const hasStd = typeof SpeechRecognition === 'function';
const hasWebkit = typeof webkitSpeechRecognition === 'function';
const report = {
  hasStd, hasWebkit,
  ua: navigator.userAgent,
  online: navigator.onLine,
  lang: navigator.language,
};
o.textContent = JSON.stringify(report, null, 2);
window.__VOICE_M05__ = report;
</script>`,
    "utf8",
  )
  const fileUrl = "file://" + htmlPath

  const userData = path.join(tmp, "chrome-profile")
  fs.mkdirSync(userData)

  const chrome = spawn(
    CHROME,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userData}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      fileUrl,
    ],
    { stdio: "ignore", detached: true },
  )
  chrome.unref()

  let version
  for (let i = 0; i < 40; i++) {
    try {
      version = await fetchJson(`http://127.0.0.1:${PORT}/json/version`)
      break
    } catch {
      await sleep(250)
    }
  }
  if (!version) {
    console.error("Chrome remote debugging did not come up")
    process.exit(3)
  }

  const targets = await fetchJson(`http://127.0.0.1:${PORT}/json/list`)
  const page = targets.find((t) => t.type === "page" && t.url?.includes("probe.html")) || targets.find((t) => t.type === "page")
  if (!page?.webSocketDebuggerUrl) {
    console.error("No page target", targets)
    process.exit(3)
  }

  // Prefer `ws` from companion or extension node_modules
  let WebSocket
  try {
    WebSocket = (await import(path.join(ROOT, "companion/node_modules/ws/wrapper.mjs"))).default
  } catch {
    try {
      WebSocket = (await import("ws")).default
    } catch {
      console.error("Cannot import ws — printing version only", version)
      process.exit(3)
    }
  }

  const result = await new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    let id = 0
    const waiters = new Map()
    const send = (method, params) =>
      new Promise((res, rej) => {
        const mid = ++id
        waiters.set(mid, { res, rej })
        ws.send(JSON.stringify({ id: mid, method, params }))
      })
    ws.on("message", (buf) => {
      const m = JSON.parse(String(buf))
      if (m.id && waiters.has(m.id)) {
        const w = waiters.get(m.id)
        waiters.delete(m.id)
        if (m.error) w.rej(new Error(JSON.stringify(m.error)))
        else w.res(m.result)
      }
    })
    ws.on("error", reject)
    ws.on("open", async () => {
      try {
        await send("Runtime.enable")
        // wait for script
        await sleep(500)
        const ev = await send("Runtime.evaluate", {
          expression: "JSON.stringify(window.__VOICE_M05__ || null)",
          returnByValue: true,
        })
        const raw = ev?.result?.value
        resolve(raw ? JSON.parse(raw) : null)
        ws.close()
      } catch (e) {
        reject(e)
      }
    })
    setTimeout(() => reject(new Error("CDP evaluate timeout")), 20000)
  })

  // Kill chrome
  try {
    process.kill(chrome.pid, "SIGTERM")
  } catch {
    /* */
  }

  const out = {
    probe: "voice-m05-chrome-file-page",
    chromeVersion: version?.Browser || version,
    result,
    speechCtorPresent: !!(result?.hasStd || result?.hasWebkit),
    note: "file:// page proves Chrome desktop has Web Speech ctor; extension origin still needs voice-spike tab + human mic grant",
  }
  const reportPath = path.join(
    ROOT,
    "docs/audit/reviews",
    `voice-m05-chrome-probe-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}.json`,
  )
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
  console.log("wrote", reportPath)

  if (!out.speechCtorPresent) process.exit(2)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(3)
})
