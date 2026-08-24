/**
 * C-thin P3: dedicated Chromium --app window for the HTML shell.
 * Not Electron. Not a new Swift overlay. Non-loopback URLs must not open.
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import {
  isSummonerLoopbackUrl,
  planSummonerShellOpen,
  resolveSummonerBrowserPath,
} from "../src/summoner/shell-open"
import { openLoopbackPage } from "../src/summoner-web"

const ROOT = path.resolve(__dirname, "..", "..")
function srcFile(...parts: string[]): string {
  const candidates = [
    path.join(ROOT, "src", ...parts),
    path.join(__dirname, "..", "src", ...parts),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]
}

const LOOP = "http://127.0.0.1:23403/?token=" + "ab".repeat(32)

test("isSummonerLoopbackUrl accepts only http loopback with token", () => {
  assert.equal(isSummonerLoopbackUrl(LOOP), true)
  assert.equal(isSummonerLoopbackUrl("http://localhost:23403/?token=" + "cd".repeat(32)), true)
  assert.equal(isSummonerLoopbackUrl("http://evil.example/?token=" + "ab".repeat(32)), false)
  assert.equal(isSummonerLoopbackUrl("https://127.0.0.1:23403/?token=" + "ab".repeat(32)), false)
  assert.equal(isSummonerLoopbackUrl("http://127.0.0.1:23403/"), false)
  assert.equal(isSummonerLoopbackUrl("file:///tmp/x.html"), false)
  assert.equal(isSummonerLoopbackUrl("http://127.0.0.1:23403/?token=" + "aa".repeat(8)), false)
  assert.equal(
    isSummonerLoopbackUrl("http://127.0.0.1:23403/?token=" + "aa".repeat(32) + "&x"),
    false,
  )
  assert.equal(
    isSummonerLoopbackUrl("http://127.0.0.1:23403/?token=" + "gg".repeat(32)),
    false,
  )
})

test("planSummonerShellOpen rejects non-loopback even if chrome exists", () => {
  const r = planSummonerShellOpen("http://evil.example/?token=" + "ab".repeat(32), {
    platform: "darwin",
    browserPath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  })
  assert.equal("error" in r, true)
  const https = planSummonerShellOpen("https://127.0.0.1:23403/?token=" + "ab".repeat(32), {
    platform: "linux",
    browserPath: "/usr/bin/google-chrome",
  })
  assert.equal("error" in https, true)
})

test("planSummonerShellOpen uses --app window when browser path is known", () => {
  const r = planSummonerShellOpen(LOOP, {
    platform: "linux",
    browserPath: "/usr/bin/google-chrome",
  })
  assert.equal("error" in r, false)
  if ("error" in r) return
  assert.equal(r.kind, "app-window")
  assert.equal(r.command, "/usr/bin/google-chrome")
  assert.ok(r.args.some((a) => a === `--app=${LOOP}`))
  assert.ok(r.args.some((a) => a.startsWith("--window-size=640")))
})

test("planSummonerShellOpen falls back to system browser without chrome", () => {
  const mac = planSummonerShellOpen(LOOP, { platform: "darwin", browserPath: null })
  assert.equal("error" in mac, false)
  if ("error" in mac) return
  assert.equal(mac.kind, "browser-tab")
  assert.equal(mac.command, "open")
  assert.deepEqual(mac.args, [LOOP])

  const lin = planSummonerShellOpen(LOOP, { platform: "linux", browserPath: null })
  assert.equal("error" in lin, false)
  if ("error" in lin) return
  assert.equal(lin.kind, "browser-tab")
  assert.equal(lin.command, "xdg-open")

  const win = planSummonerShellOpen(LOOP, { platform: "win32", browserPath: null })
  assert.equal("error" in win, false)
  if ("error" in win) return
  assert.equal(win.kind, "browser-tab")
  assert.equal(win.command, "cmd.exe")
  assert.deepEqual(win.args, ["/c", "start", "", LOOP])
  assert.equal(win.shell, undefined)
})

test("resolveSummonerBrowserPath picks first existing candidate", () => {
  const exists = (p: string) => p === "/usr/bin/google-chrome"
  assert.equal(
    resolveSummonerBrowserPath("linux", exists, "/usr/bin"),
    "/usr/bin/google-chrome",
  )
  assert.equal(resolveSummonerBrowserPath("linux", () => false, ""), null)
})

test("openLoopbackPage uses the planner (not raw open only)", () => {
  const src = fs.readFileSync(srcFile("summoner-web.ts"), "utf8")
  assert.match(src, /planSummonerShellOpen/)
  assert.match(src, /resolveSummonerBrowserPath/)
})

test("openLoopbackPage spawns --app for loopback and skips evil URLs", () => {
  const calls: Array<{ command: string; args: string[]; shell?: boolean }> = []
  const spawn = (command: string, args: string[], opts: { shell?: boolean }) => {
    calls.push({ command, args, shell: opts.shell })
    return { unref() {} }
  }
  assert.equal(
    openLoopbackPage("http://evil.example/?token=" + "ab".repeat(32), {
      platform: "linux",
      browserPath: "/usr/bin/google-chrome",
      spawn,
    }),
    false,
  )
  assert.equal(calls.length, 0)
  assert.equal(
    openLoopbackPage(LOOP, {
      platform: "linux",
      browserPath: "/usr/bin/google-chrome",
      spawn,
    }),
    true,
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, "/usr/bin/google-chrome")
  assert.ok(calls[0].args.includes(`--app=${LOOP}`))
  assert.equal(calls[0].shell, undefined)
})

test("P3 does not grow Swift SummonerOverlay", () => {
  const overlay = fs.readFileSync(srcFile("tray", "SummonerOverlay.swift"), "utf8")
  assert.doesNotMatch(overlay, /WKWebView/)
  const menu = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  assert.match(menu, /openLoopbackPage/)
})
