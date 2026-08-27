/**
 * C-thin P3: open the loopback HTML shell in a dedicated Chromium/Edge
 * `--app` window when a browser binary exists. Otherwise honest degrade to
 * the system URL handler (tab). Not Electron. Not a new Swift overlay.
 *
 * Native WKWebView / WebView2 / GTK remains a later host for the same HTML.
 */
import * as fs from "fs"
import * as path from "path"

export type SummonerShellKind = "app-window" | "browser-tab"

export type SummonerShellPlan = {
  kind: SummonerShellKind
  command: string
  args: string[]
  shell?: boolean
}

export type SummonerShellOpenOpts = {
  platform: NodeJS.Platform
  browserPath?: string | null
}

const TOKEN_HEX = /^[0-9a-f]{64}$/i

export function isSummonerLoopbackUrl(url: string): boolean {
  if (typeof url !== "string" || !url) return false
  try {
    const u = new URL(url)
    if (u.protocol !== "http:") return false
    const host = u.hostname.toLowerCase()
    if (host !== "127.0.0.1" && host !== "localhost") return false
    const keys = [...u.searchParams.keys()]
    const unique = [...new Set(keys)]
    if (keys.length !== unique.length) return false
    const token = u.searchParams.get("token") || ""
    if (!TOKEN_HEX.test(token)) return false
    if (unique.length === 1 && unique[0] === "token") return true
    if (unique.length === 2 && unique.includes("token") && unique.includes("thread")) {
      const thread = u.searchParams.get("thread") || ""
      return thread.length > 0
    }
    return false
  } catch {
    return false
  }
}

export function planSummonerShellOpen(
  url: string,
  opts: SummonerShellOpenOpts,
): SummonerShellPlan | { error: string } {
  if (!isSummonerLoopbackUrl(url)) {
    return { error: "summoner shell only opens loopback token URLs" }
  }
  const browserPath = typeof opts.browserPath === "string" ? opts.browserPath.trim() : ""
  if (browserPath) {
    return {
      kind: "app-window",
      command: browserPath,
      args: [`--app=${url}`, "--window-size=720,120"],
    }
  }
  if (opts.platform === "darwin") {
    return { kind: "browser-tab", command: "open", args: [url] }
  }
  if (opts.platform === "linux") {
    return { kind: "browser-tab", command: "xdg-open", args: [url] }
  }
  if (opts.platform === "win32") {
    return { kind: "browser-tab", command: "cmd.exe", args: ["/c", "start", "", url] }
  }
  return { error: `unsupported platform: ${opts.platform}` }
}

const DARWIN_BINS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
]

const WIN_BINS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
]

const POSIX_NAMES = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "microsoft-edge",
  "microsoft-edge-stable",
  "brave-browser",
]

function whichFromPath(name: string, pathEnv: string, exists: (p: string) => boolean): string | null {
  const sep = process.platform === "win32" ? ";" : ":"
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue
    const candidate = path.join(dir, name)
    if (exists(candidate)) return candidate
    if (process.platform === "win32" && exists(candidate + ".exe")) return candidate + ".exe"
  }
  return null
}

export function resolveSummonerBrowserPath(
  platform: NodeJS.Platform,
  exists: (p: string) => boolean = (p) => {
    try {
      return fs.existsSync(p)
    } catch {
      return false
    }
  },
  pathEnv: string = process.env.PATH || "",
): string | null {
  const fixed = platform === "darwin" ? DARWIN_BINS : platform === "win32" ? WIN_BINS : []
  for (const p of fixed) {
    if (exists(p)) return p
  }
  for (const name of POSIX_NAMES) {
    const hit = whichFromPath(name, pathEnv, exists)
    if (hit) return hit
  }
  if (platform === "win32") {
    for (const name of ["chrome", "msedge", "chrome.exe", "msedge.exe"]) {
      const hit = whichFromPath(name, pathEnv, exists)
      if (hit) return hit
    }
  }
  return null
}
