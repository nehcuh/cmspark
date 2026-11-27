/**
 * C-thin P3: open the loopback HTML shell in a dedicated Chromium/Edge
 * `--app` window when a browser binary exists. Otherwise honest degrade to
 * the system URL handler (tab). Not Electron. Not a new Swift overlay.
 *
 * Native WKWebView / WebView2 / GTK remains a later host for the same HTML.
 */
import * as child_process from "child_process"
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
  userDataDir?: string | null
}

export const OVERLAY_WINDOW_SIZE = { w: 520, h: 620 } as const

export function parseOverlayChromePids(psOutput: string, userDataDir: string): number[] {
  if (!userDataDir) return []
  const needle = `--user-data-dir=${userDataDir}`
  const pids: number[] = []
  for (const line of psOutput.split("\n")) {
    if (!line.includes(needle)) continue
    const pid = parseInt(line.trim(), 10)
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) pids.push(pid)
  }
  return pids
}

export function readOverlayChromePids(userDataDir: string): number[] {
  try {
    const out = child_process.execFileSync("ps", ["-axo", "pid=,command="], {
      encoding: "utf8",
      timeout: 2000,
    })
    return parseOverlayChromePids(out, userDataDir)
  } catch {
    return []
  }
}

export function closeOverlayChrome(userDataDir: string): number {
  const pids = readOverlayChromePids(userDataDir)
  let n = 0
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM")
      n += 1
    } catch {
      /* already gone */
    }
  }
  return n
}

export function isSummonerLoopbackUrl(url: string): boolean {
  if (typeof url !== "string" || !url) return false
  try {
    const u = new URL(url)
    if (u.protocol !== "http:") return false
    const host = u.hostname.toLowerCase()
    if (host !== "127.0.0.1" && host !== "localhost") return false
    if (u.pathname !== "/" && u.pathname !== "/summoner") return false
    const keys = [...u.searchParams.keys()]
    const unique = [...new Set(keys)]
    if (keys.length !== unique.length) return false
    // Batch D D3: token must not appear in --app argv / query.
    if (unique.includes("token")) return false
    if (unique.length === 0) return true
    if (unique.length === 1 && unique[0] === "thread") {
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
    const { w, h } = OVERLAY_WINDOW_SIZE
    const args = [`--app=${url}`, `--window-size=${w},${h}`, "--no-first-run", "--no-default-browser-check"]
    const dir = typeof opts.userDataDir === "string" ? opts.userDataDir.trim() : ""
    if (dir) args.push(`--user-data-dir=${dir}`)
    return {
      kind: "app-window",
      command: browserPath,
      args,
    }
  }
  if (opts.platform === "darwin") {
    return { kind: "browser-tab", command: "open", args: [url] }
  }
  if (opts.platform === "linux") {
    return { kind: "browser-tab", command: "xdg-open", args: [url] }
  }
  if (opts.platform === "win32") {
    return { kind: "browser-tab", command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] }
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
  if (platform === "win32" && process.env.LOCALAPPDATA) {
    for (const relative of ["Google/Chrome/Application/chrome.exe", "Microsoft/Edge/Application/msedge.exe"]) {
      const candidate = path.win32.join(process.env.LOCALAPPDATA, relative)
      if (exists(candidate)) return candidate
    }
  }
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
