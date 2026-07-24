// macOS platform adapters for coordinate computer-use (WP3).
//
// "Calm" adapters (read-only, no side effects):
//   MacWindowEnumerator   — CGWindowListCopyWindowInfo via cmspark-host
//   MacAxProber           — AX tree density probe via cmspark-host
//   MacSecurityEnvironment — TCC permission + Secure Input check
//
// "Compute" adapters (side effects — Screen Recording / Accessibility):
//   MacScreenCapturer     — CGWindowListCreateImage via cmspark-host
//   MacLocator            — Apple Vision OCR via cmspark-host
//   MacInputInjector      — CGEventPostToPid via cmspark-host
//   MacAxLocator          — NSAccessibility tree locate via cmspark-host
//   MacPreviewBuilder     — Screenshot annotation (crosshair + credential blur)

import { execFile, type ExecFileException } from "child_process"
import { promisify } from "util"
import * as path from "path"
import * as os from "os"
import * as fs from "fs"
import { createHash, randomUUID } from "crypto"
import { resolveHostBinary } from "../host-use/darwin/host-bin"
import {
  ComputerError,
  ForegroundProbeBrokenError,
  PIXEL_DIFF_THRESHOLD,
  REGION_CROP_SIZE,
  type CaptureMeta,
  type ClickKind,
  type DiffMetrics,
  type InputInjector,
  type LocateAttempt,
  type LocateHit,
  type Locator,
  type OcrResult,
  type OcrWord,
  type RectPx,
  type ScreenCapturer,
  type SecurityEnvironment,
  type UiaLocateHit,
  type UiaLocator,
  type UiaWatcher,
  type UiaWatcherFactory,
  type WindowEnumerator,
  type WindowInfo,
} from "./types"
import type { UiaProber, UiaVerdict } from "./uia"
import type { PreviewBuilder } from "./preview"

const execFileAsync = promisify(execFile)

const DARWIN_QUERY_TIMEOUT_MS = 15000
const DARWIN_CAPTURE_TIMEOUT_MS = 15000
const DARWIN_OCR_TIMEOUT_MS = 30000
const DARWIN_INJECT_TIMEOUT_MS = 10000

// ---------------------------------------------------------------------------
// Helper: parse JSON from stdout, throw typed ComputerError on failure
// ---------------------------------------------------------------------------

function parseComputerJson(stdout: string, label: string): Record<string, any> {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch (err) {
    throw new ComputerError("INVALID_ACTION", `${label}: invalid JSON from cmspark-host (${(err as Error).message})`)
  }
  if (!parsed || typeof parsed !== "object") {
    throw new ComputerError("INVALID_ACTION", `${label}: malformed payload from cmspark-host`)
  }
  return parsed as Record<string, any>
}

function checkOk(parsed: Record<string, any>, label: string): void {
  if (parsed.ok !== true) {
    throw new ComputerError(
      parsed.error_code ?? "INVALID_ACTION",
      `${label}: ${parsed.error ?? "unknown error"}`,
    )
  }
}

function rethrowDarwinExecError(err: ExecFileException | Error, label: string): never {
  if (err && typeof err === "object" && "stderr" in err && (err as any).stderr) {
    throw new ComputerError("INVALID_ACTION", `${label}: ${(err as any).stderr}`)
  }
  throw new ComputerError("INVALID_ACTION", `${label}: ${err.message}`)
}

// Pick the frontmost windowId from a CGWindowListCopyWindowInfo(--foreground)
// result array (z-order, topmost first). Pure function — extracted so tests
// can drive it with real-binary captured fixtures without mocking execFile.
//
// Filter rationale (review 2026-07-23):
//   1. layer ∈ [-1000, 20): normal(0)/floating(3)/modal(8) in-band;
//      menu bar (24/26) and dock backdrop (-2147483622) out.
//   2. name !== "": kills Chrome's unnamed off-screen aux windows.
//   3. bounds.y >= 0: double-kills off-screen even if name were populated.
export function pickFrontmostWindowId(windows: unknown[]): number {
  for (const w of windows) {
    if (!w || typeof w !== "object") continue
    const layer = (w as { layer?: number }).layer
    const name = (w as { name?: string }).name ?? ""
    const bounds = (w as { bounds?: { y?: number } }).bounds ?? {}
    if (typeof layer !== "number" || layer < -1000 || layer >= 20) continue
    if (name === "") continue
    if (typeof bounds.y !== "number" || bounds.y < 0) continue
    const wid = (w as { windowId?: number }).windowId
    if (typeof wid === "number" && wid > 0) return wid
  }
  return 0
}

// ---------------------------------------------------------------------------
// B2 — MacWindowEnumerator: CGWindowListCopyWindowInfo
// ---------------------------------------------------------------------------

export class MacWindowEnumerator implements WindowEnumerator {
  async enumerateByExe(exePath: string): Promise<WindowInfo[]> {
    const bin = resolveHostBinary()
    let result: { stdout: string }
    try {
      result = await execFileAsync(bin, ["window-list", "--bundle-id", exePath], {
        encoding: "utf-8",
        timeout: DARWIN_QUERY_TIMEOUT_MS,
      })
    } catch (err) {
      rethrowDarwinExecError(err as ExecFileException | Error, "window-list")
    }
    const parsed = parseComputerJson(result.stdout, "window-list")
    checkOk(parsed, "window-list")
    const windows: any[] = Array.isArray(parsed.windows) ? parsed.windows : []
    return windows.map((w: any) => ({
      hwnd: w.windowId ?? 0,
      pid: w.pid ?? 0,
      exePath: w.bundleId ?? exePath,    // macOS ownership anchor = bundle ID (ownerName is a display name)
      title: w.name ?? "",
      rect: {
        x: w.bounds?.x ?? 0,
        y: w.bounds?.y ?? 0,
        width: w.bounds?.width ?? 0,
        height: w.bounds?.height ?? 0,
      },
      alive: true,
    }))
  }

  async infoForHwnd(hwnd: number): Promise<WindowInfo> {
    const bin = resolveHostBinary()
    let result: { stdout: string }
    try {
      result = await execFileAsync(bin, ["window-list", "--window-id", String(hwnd)], {
        encoding: "utf-8",
        timeout: DARWIN_QUERY_TIMEOUT_MS,
      })
    } catch (err) {
      rethrowDarwinExecError(err as ExecFileException | Error, "window-list")
    }
    const parsed = parseComputerJson(result.stdout, "window-list")
    checkOk(parsed, "window-list")
    const windows: any[] = Array.isArray(parsed.windows) ? parsed.windows : []
    if (windows.length === 0) {
      return { hwnd, pid: 0, exePath: null, title: "", rect: { x: 0, y: 0, width: 0, height: 0 }, alive: false }
    }
    const w = windows[0]
    return {
      hwnd: w.windowId ?? hwnd,
      pid: w.pid ?? 0,
      exePath: w.bundleId ?? null,
      title: w.name ?? "",
      rect: { x: w.bounds?.x ?? 0, y: w.bounds?.y ?? 0, width: w.bounds?.width ?? 0, height: w.bounds?.height ?? 0 },
      alive: true,
    }
  }
}

// ---------------------------------------------------------------------------
// B2 — MacAxProber: AX tree density probe
// ---------------------------------------------------------------------------

export class MacAxProber implements UiaProber {
  async probe(hwnd: number): Promise<UiaVerdict> {
    const bin = resolveHostBinary()
    let result: { stdout: string }
    try {
      result = await execFileAsync(bin, ["ax-probe", "--window-id", String(hwnd)], {
        encoding: "utf-8",
        timeout: DARWIN_QUERY_TIMEOUT_MS,
      })
    } catch (err) {
      // Probe failure = honest unknown, never fail the task
      return { uiaCapable: false, confidence: 0, stats: { nodes: 0, maxDepth: 0, named: 0, namedOnscreen: 0, interactive: 0, edits: 0, documents: 0, capped: true, hydrationRechecked: false, passANodes: 0, durationMs: 0 } }
    }
    const parsed = parseComputerJson(result.stdout, "ax-probe")
    const stats = parsed.stats ?? parsed
    // Reuse Windows UIA verdict logic (min 40 nodes threshold)
    const { uiaVerdictFromStats } = require("./uia")
    return uiaVerdictFromStats(stats)
  }
}

// ---------------------------------------------------------------------------
// B2 — MacSecurityEnvironment: TCC permission + Secure Input
// ---------------------------------------------------------------------------

export class MacSecurityEnvironment implements SecurityEnvironment {
  async assertInjectable(_hwnd: number): Promise<void> {
    const bin = resolveHostBinary()
    let result: { stdout: string }
    try {
      result = await execFileAsync(bin, ["security-check"], {
        encoding: "utf-8",
        timeout: 5000,
      })
    } catch (err) {
      rethrowDarwinExecError(err as ExecFileException | Error, "security-check")
    }
    const parsed = parseComputerJson(result.stdout, "security-check")
    if (parsed.axTrusted !== true) {
      throw new ComputerError(
        "INTEGRITY_LEVEL_DENIED",
        "computer: Accessibility permission not granted — enable in System Settings → Privacy & Security → Accessibility",
      )
    }
    if (parsed.secureInput === true) {
      throw new ComputerError(
        "DESKTOP_DENIED",
        "computer: Secure Input mode active — a password field has focus; refusing injection",
      )
    }
  }
}

// ---------------------------------------------------------------------------
// B3 — MacScreenCapturer: CGWindowListCreateImage
// ---------------------------------------------------------------------------

export class MacScreenCapturer implements ScreenCapturer {
  async captureWindow(hwnd: number): Promise<CaptureMeta> {
    const bin = resolveHostBinary()
    const tmpPath = path.join(os.tmpdir(), `cmspark-cap-${randomUUID()}.png`)
    let result: { stdout: string }
    try {
      result = await execFileAsync(bin, [
        "screenshot",
        "--window-id", String(hwnd),
        "--output", tmpPath,
      ], { encoding: "utf-8", timeout: DARWIN_CAPTURE_TIMEOUT_MS })
    } catch (err) {
      rethrowDarwinExecError(err as ExecFileException | Error, "screenshot")
    }
    const parsed = parseComputerJson(result.stdout, "screenshot")
    checkOk(parsed, "screenshot")

    let sha256 = ""
    try {
      sha256 = createHash("sha256").update(fs.readFileSync(tmpPath)).digest("hex")
    } catch { /* file not found — error surfaced below */ }

    return {
      hwnd,
      rect: parsed.rect ?? { x: 0, y: 0, width: 0, height: 0 },
      client: parsed.client ?? { x: 0, y: 0, width: parsed.rect?.width ?? 0, height: parsed.rect?.height ?? 0 },
      dpi: parsed.dpi ?? 72,
      path: tmpPath,
      sha256,
      black: false,
      fallbackUsed: false,
      osrBlackSuspected: false,
    }
  }

  async crop(srcPath: string, rect: RectPx, outPath: string): Promise<string> {
    const bin = resolveHostBinary()
    try {
      await execFileAsync(bin, [
        "crop",
        "--source", srcPath,
        "--output", outPath,
        "--x", String(Math.round(rect.x)),
        "--y", String(Math.round(rect.y)),
        "--width", String(Math.round(rect.width)),
        "--height", String(Math.round(rect.height)),
      ], { timeout: 5000 })
    } catch (err) {
      rethrowDarwinExecError(err as ExecFileException | Error, "crop")
    }
    return outPath
  }

  async diff(aPath: string, bPath: string, crop?: RectPx): Promise<DiffMetrics> {
    const bin = resolveHostBinary()
    const args: string[] = ["imgdiff", "--a", aPath, "--b", bPath]
    if (crop) {
      args.push("--x", String(Math.round(crop.x)))
      args.push("--y", String(Math.round(crop.y)))
      args.push("--width", String(Math.round(crop.width)))
      args.push("--height", String(Math.round(crop.height)))
    }
    let result: { stdout: string }
    try {
      result = await execFileAsync(bin, args, { timeout: 10000 })
    } catch (err) {
      rethrowDarwinExecError(err as ExecFileException | Error, "imgdiff")
    }
    const parsed = parseComputerJson(result.stdout, "imgdiff")
    checkOk(parsed, "imgdiff")
    return {
      diffRatio: parsed.diffRatio ?? 0,
      maxZoneRatio: parsed.maxZoneRatio,
      maxBlobRatio: parsed.maxBlobRatio,
    }
  }

  async diffRegion(aPath: string, bPath: string, region: RectPx): Promise<{ diffRatio: number }> {
    const metrics = await this.diff(aPath, bPath, region)
    return { diffRatio: metrics.diffRatio }
  }
}

// ---------------------------------------------------------------------------
// B3 — MacLocator: Apple Vision OCR + shared OC locate logic
// ---------------------------------------------------------------------------

function locateInOcrWords(words: OcrWord[], text: string): LocateHit | null {
  if (words.length === 0) return null

  // Group words by vertical center, join each line x-sorted
  const sorted = [...words].sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2))
  const lines: OcrWord[][] = []
  for (const w of sorted) {
    const cy = w.y + w.h / 2
    const tol = Math.max(4, w.h * 0.6)
    const line = lines.find((l) => {
      const lcy = l[0].y + l[0].h / 2
      const ltol = Math.max(4, l[0].h * 0.6)
      return Math.abs(lcy - cy) <= Math.max(ltol, tol)
    })
    if (line) {
      line.push(w)
    } else {
      lines.push([w])
    }
  }

  // For each line, try sliding window of concatenated text
  for (const line of lines) {
    const sortedLine = [...line].sort((a, b) => a.x - b.x)
    const joined = sortedLine.map((w) => w.text).join("")
    let idx = 0
    while ((idx = joined.indexOf(text, idx)) >= 0) {
      // Find start and end words within the match
      let charCount = 0
      let startWord = 0
      let endWord = 0
      for (let wi = 0; wi < sortedLine.length; wi++) {
        const end = charCount + sortedLine[wi].text.length
        if (charCount <= idx && end > idx) startWord = wi
        if (charCount <= idx + text.length - 1 && end > idx + text.length - 1) endWord = wi
        charCount = end
      }
      const sw = sortedLine[startWord]
      const ew = sortedLine[endWord]
      const bbox: RectPx = {
        x: sw.x,
        y: sw.y,
        width: ew.x + ew.w - sw.x,
        height: Math.max(...sortedLine.slice(startWord, endWord + 1).map((w) => w.y + w.h)) - Math.min(...sortedLine.slice(startWord, endWord + 1).map((w) => w.y)),
      }
      return {
        x: bbox.x + bbox.width / 2,
        y: bbox.y + bbox.height / 2,
        bbox,
        layer: "ocr",
        matchedText: text,
      }
    }
  }
  return null
}

export class MacLocator implements Locator {
  private language: string[]

  constructor(language?: string[]) {
    this.language = language ?? ["zh-Hans", "en-US"]
  }

  async ensureLanguage(): Promise<void> {
    // Apple Vision has built-in multilingual support — no language pack needed
  }

  async ocr(imagePath: string): Promise<OcrResult> {
    const bin = resolveHostBinary()
    let result: { stdout: string }
    try {
      result = await execFileAsync(bin, [
        "ocr",
        "--image", imagePath,
        "--languages", this.language.join(","),
      ], { encoding: "utf-8", timeout: DARWIN_OCR_TIMEOUT_MS })
    } catch (err) {
      rethrowDarwinExecError(err as ExecFileException | Error, "ocr")
    }
    const parsed = parseComputerJson(result.stdout, "ocr")
    checkOk(parsed, "ocr")
    return {
      language: parsed.language ?? "zh-Hans",
      words: Array.isArray(parsed.words) ? parsed.words : [],
    }
  }

  locate(result: OcrResult, text: string): LocateHit | null {
    return locateInOcrWords(result.words, text)
  }
}

// ---------------------------------------------------------------------------
// B3 — MacInputInjector: CGEventPostToPid
// ---------------------------------------------------------------------------

export class MacInputInjector implements InputInjector {
  private estopFlagPath: string | undefined
  private segmenter = new Intl.Segmenter("zh-Hans", { granularity: "grapheme" })
  // LRU-ish hwnd → bundleId cache so the forceForeground path doesn't pay
  // the cmspark-host windows-query cost every time the sidepanel snatches
  // focus and the FOREGROUND-YIELD detector re-raises the target.
  private hwndBidCache = new Map<number, string>()

  constructor(estopFlagPath?: string) {
    this.estopFlagPath = estopFlagPath
  }

  // Resolve hwnd → bundleId via cmspark-host windows query. Cached.
  private async resolveBundleIdForHwnd(hwnd: number): Promise<string | undefined> {
    const cached = this.hwndBidCache.get(hwnd)
    if (cached) return cached
    const bin = resolveHostBinary()
    try {
      const r = await execFileAsync(bin, ["window-list", "--window-id", String(hwnd)],
                                    { encoding: "utf-8", timeout: 3000 })
      const parsed = parseComputerJson(r.stdout, "window-list")
      const windows: any[] = Array.isArray(parsed.windows) ? parsed.windows : []
      const bid = windows[0]?.bundleId
      if (typeof bid === "string" && bid.length > 0) {
        this.hwndBidCache.set(hwnd, bid)
        return bid
      }
    } catch { /* best-effort */ }
    return undefined
  }

  /**
   * Pre-inject guard: raise target to frontmost if it isn't. Without this,
   * CGEvent.post(.cghidEventTap) in host.swift routes by coordinate+frontmost
   * window — when Chrome holds frontmost (user just clicked Allow in the
   * sidepanel), the click lands on Chrome at the target's coordinates. Same
   * root cause as the b0faek/psl8ci bugs documented in host.swift:915 and the
   * forceForeground comment below; this guard prevents the misrouted event
   * instead of recovering after it (post-yield recovery can't undo a click
   * that already landed on Chrome).
   *
   * Fail-closed: throws on raise failure. Letting inject proceed when target
   * isn't frontmost would reproduce the exact bug this guard exists to prevent
   * — and unlike click(), typeText/keyChord/scroll/drag do NOT pass
   * --check-occlusion, so a silent fall-through is unguarded misroute for
   * 4 of 5 call sites. click()'s --check-occlusion stays as defense-in-depth
   * for occlusion arising between raise-verify and inject, not as the primary
   * safety net. foregroundHwnd()=0 (host binary broken) also throws — silent
   * fail-open on probe failure would disable the guard without a trace.
   */
  private async ensureForeground(hwnd: number): Promise<void> {
    const fg = await this.foregroundHwnd()
    if (fg === 0) {
      // ForegroundProbeBrokenError (not generic Error) so executor's diagnostic
      // probe can branch cleanly. Architect Q4: fail-closed must be observable.
      throw new ForegroundProbeBrokenError(
        `ensureForeground: foregroundHwnd=0 after checkOk passed ` +
        `(no app window onscreen with non-empty name + bounds.y>=0, or binary ok-but-empty-list)`,
      )
    }
    if (fg !== hwnd) {
      const raised = await this.forceForeground(hwnd)
      if (!raised) {
        // ComputerError(FOREGROUND_RAISE_FAILED) — precondition failure, fail-closed.
        // Distinct from ForegroundProbeBrokenError above (which is binary-side
        // probe broken). Architect Q1 (2026-07-23): raise-failed path previously
        // threw generic Error, losing type info + ComputerError code.
        throw new ComputerError(
          "FOREGROUND_RAISE_FAILED",
          `ensureForeground: failed to raise hwnd=${hwnd} (current fg=${fg}; ` +
          `likely osascript Automation TCC denial, dead window, or bundleId unresolvable)`,
        )
      }
    }
  }

  async click(hwnd: number, x: number, y: number, kind: ClickKind): Promise<void> {
    await this.ensureForeground(hwnd)
    const bin = resolveHostBinary()
    const args = ["inject", "--action", kind, "--window-id", String(hwnd),
                  "--x", String(Math.round(x)), "--y", String(Math.round(y)),
                  "--check-occlusion"]
    if (this.estopFlagPath) args.push("--estop-flag", this.estopFlagPath)
    try {
      await execFileAsync(bin, args, { timeout: DARWIN_INJECT_TIMEOUT_MS })
    } catch (err) {
      rethrowDarwinExecError(err as ExecFileException | Error, "inject")
    }
  }

  async typeText(hwnd: number, text: string): Promise<void> {
    await this.ensureForeground(hwnd)
    const normalized = text.normalize("NFKC")
    const graphemes = [...this.segmenter.segment(normalized)].map((s) => s.segment)

    const bin = resolveHostBinary()
    for (let i = 0; i < graphemes.length; i += 16) {
      const chunk = graphemes.slice(i, i + 16).join("")
      const args = ["inject", "--action", "type", "--window-id", String(hwnd),
                    "--text", chunk,
                    "--check-secure-input",
                    "--check-onscreen"]
      if (this.estopFlagPath) args.push("--estop-flag", this.estopFlagPath)
      try {
        await execFileAsync(bin, args, { timeout: 5000 })
      } catch (err) {
        rethrowDarwinExecError(err as ExecFileException | Error, "inject")
      }
      await new Promise((r) => setTimeout(r, Math.max(chunk.length * 80, 1)))
    }
  }

  async keyChord(hwnd: number, keys: string[]): Promise<void> {
    await this.ensureForeground(hwnd)
    const bin = resolveHostBinary()
    const args = ["inject", "--action", "key", "--window-id", String(hwnd), "--chord", ...keys]
    if (this.estopFlagPath) args.push("--estop-flag", this.estopFlagPath)
    try {
      await execFileAsync(bin, args, { timeout: 5000 })
    } catch (err) {
      rethrowDarwinExecError(err as ExecFileException | Error, "inject")
    }
  }

  async scroll(hwnd: number, x: number, y: number, delta: number): Promise<void> {
    await this.ensureForeground(hwnd)
    const bin = resolveHostBinary()
    try {
      await execFileAsync(bin, [
        "inject", "--action", "scroll",
        "--window-id", String(hwnd),
        "--x", String(Math.round(x)),
        "--y", String(Math.round(y)),
        "--delta", String(delta),
      ], { timeout: 5000 })
    } catch (err) {
      rethrowDarwinExecError(err as ExecFileException | Error, "inject")
    }
  }

  async drag(hwnd: number, x: number, y: number, x2: number, y2: number): Promise<void> {
    await this.ensureForeground(hwnd)
    const bin = resolveHostBinary()
    try {
      await execFileAsync(bin, [
        "inject", "--action", "drag",
        "--window-id", String(hwnd),
        "--x", String(Math.round(x)), "--y", String(Math.round(y)),
        "--x2", String(Math.round(x2)), "--y2", String(Math.round(y2)),
      ], { timeout: 10000 })
    } catch (err) {
      rethrowDarwinExecError(err as ExecFileException | Error, "inject")
    }
  }

  async probeWindow(hwnd: number): Promise<WindowInfo> {
    const en = new MacWindowEnumerator()
    return en.infoForHwnd(hwnd)
  }

  async foregroundHwnd(): Promise<number> {
    // Contract: returns the window CGEvent will route the next event to
    // (event-tap target), NOT "what the user perceives as frontmost." These
    // converge only when the frontmost app has exactly one visible window.
    //
    // Filter (Architect + Adversary review 2026-07-23):
    //   1. layer ∈ [-1000, 20) — covers normal(0)/floating(3)/modal(8),
    //      excludes menu bar (24+) and dock desktop (-1000+)
    //   2. name !== "" — kills Chrome's unnamed off-screen aux windows
    //      (windowId=51/50/1235 in the 2026-07-23 fixture: all layer=0 but
    //      empty name). name filter beats size heuristic (Adversary: size>=100
    //      excludes NetEase Music mini-player / lyric / tray-icon windows)
    //   3. bounds.y >= 0 — double-kills off-screen aux (windowId=51 had
    //      y=-73 even if name were populated)
    //
    // Pi root cause (2026-07-23): old `layer === 0` first-match returned
    // windowId=51 (off-screen Chrome aux) instead of windowId=47 (visible
    // main). Fixed via the three predicates above.
    const bin = resolveHostBinary()
    let result: { stdout: string }
    try {
      result = await execFileAsync(bin, ["window-list", "--foreground"], {
        timeout: 5000,
        encoding: "utf-8",
      })
    } catch (err) {
      // Binary spawn failed (cmspark-host ENOENT, timeout, killed). Throw
      // typed error so executor's diagnostic probe can branch; ensureForeground
      // precondition converts to INJECT_FAILED via the click() catch chain.
      throw new ForegroundProbeBrokenError(
        `foregroundHwnd: cmspark-host window-list spawn failed (${(err as Error).message})`,
      )
    }
    // Kimi round-3 residual (2026-07-23): parseComputerJson throws
    // ComputerError(INVALID_ACTION) on invalid JSON / non-object payload —
    // a 4th binary-hiccup path (truncated stdout from crashed binary) that
    // is the SAME severity class as the spawn/checkOk paths above but was
    // previously NOT wrapped → bubbled to fail(INJECT_FAILED). Wrap it.
    let parsed: Record<string, any>
    try {
      parsed = parseComputerJson(result.stdout, "window-list")
    } catch (err) {
      throw new ForegroundProbeBrokenError(
        `foregroundHwnd: window-list stdout unparseable (${(err as Error).message})`,
      )
    }
    // Adversary C3 / Architect Q2-B (2026-07-23): checkOk normally throws
    // ComputerError("INVALID_ACTION"). Wrap as ForegroundProbeBrokenError so
    // the executor's *diagnostic* probe at executor.ts:1147 softens it to
    // fg=0 instead of bubbling to fail(INJECT_FAILED) on every binary hiccup.
    // ({ok:false} from cmspark-host = transient binary failure, not a fatal
    // inject error — same severity bucket as spawn-fail above.)
    if (parsed.ok !== true) {
      throw new ForegroundProbeBrokenError(
        `foregroundHwnd: window-list reported ok=false ` +
        `(error_code=${parsed.error_code ?? "?"}, error=${parsed.error ?? "unknown"})`,
      )
    }
    // Adversary C1: guard against schema regression — binary returns {ok:true}
    // without a windows field (or windows is not an array). Without this guard,
    // pickFrontmostWindowId throws TypeError → bubbles to fail(INJECT_FAILED).
    const windows = Array.isArray(parsed.windows) ? parsed.windows : []
    return pickFrontmostWindowId(windows)
  }

  async forceForeground(hwnd: number): Promise<boolean> {
    // FOREGROUND-YIELD self-UI recovery (UX-spike 2026-07-23). The original
    // spike shipped this as a placeholder that only returned `fg === hwnd`
    // because the author didn't want to ship an unverified AXRaise. Fused
    // 2026-07-23 with the activateTarget helper that previously lived here:
    // shell out to osascript + Apple Events (`tell application id "X" to
    // activate`). NSRunningApplication.activate() inside cmspark-host fails
    // silently because cmspark-host is spawned by node daemon (not a
    // foreground app); macOS 26 ignores the request. osascript + Apple
    // Events goes through launchd, which foregrounds the target regardless
    // of caller's activation policy. Apple Events "activate" only needs
    // Automation TCC (per-target-app one-time grant), NOT Accessibility.
    //
    // Without this, when the Chrome side panel's security-confirm popup
    // keeps Chrome frontmost, CGEvent.post lands on Chrome at the target's
    // coordinates instead of the target app (psl8ci false-positive bug:
    // click reported ok:true but user observed the click landing on Chrome).
    //
    // Adversary C2 / Architect Q2-C (2026-07-23): the entire body is wrapped
    // so ANY throw (foregroundHwnd probe broken, osascript spawn fail,
    // setTimeout cancelled) returns false → executor falls back to re-L2
    // pause. Previously the `!bid` branch called foregroundHwnd outside the
    // try/catch, letting binary hiccups bubble to fail(INJECT_FAILED).
    try {
      const bid = await this.resolveBundleIdForHwnd(hwnd)
      if (!bid) {
        // Can't resolve bundleId — fall back to "is it already foreground?"
        // so the executor still has a chance to continue without a pause.
        const fg = await this.foregroundHwnd()
        return fg !== 0 && fg === hwnd
      }
      // bundleId is reverse-DNS (e.g. "com.netease.163music"); we pass it via
      // execFile argv (no shell), so injection-safe.
      await execFileAsync("/usr/bin/osascript", [
        "-e",
        `tell application id "${bid}" to activate`,
      ], { timeout: 2000 })
      // Apple Events activate is async; give WindowServer time to actually
      // raise the target's window before we promise the caller it's frontmost.
      await new Promise((r) => setTimeout(r, 300))
      const fg = await this.foregroundHwnd()
      return fg !== 0 && fg === hwnd
    } catch {
      // osascript spawn failed (Automation TCC not granted, target dead,
      // timeout), OR foregroundHwnd probe broken (binary hiccup) — return
      // false so the executor falls back to the re-L2 pause and a human decides.
      return false
    }
  }
}

// ---------------------------------------------------------------------------
// B3 — MacAxLocator: NSAccessibility live-tree locate (L0 layer)
// ---------------------------------------------------------------------------

export class MacAxLocator implements UiaLocator {
  async locate(hwnd: number, target: string): Promise<UiaLocateHit | null> {
    const bin = resolveHostBinary()
    let result: { stdout: string }
    try {
      result = await execFileAsync(bin, [
        "ax-locate",
        "--window-id", String(hwnd),
        "--target", target,
      ], { encoding: "utf-8", timeout: DARWIN_QUERY_TIMEOUT_MS })
    } catch (err) {
      rethrowDarwinExecError(err as ExecFileException | Error, "ax-locate")
    }
    const parsed = parseComputerJson(result.stdout, "ax-locate")
    if (!parsed.found) return null

    return {
      x: parsed.x as number,
      y: parsed.y as number,
      bbox: (parsed.bbox as RectPx) ?? { x: 0, y: 0, width: 0, height: 0 },
      name: parsed.name as string ?? "",
      controlType: parsed.role as string ?? "unknown",
      automationId: parsed.identifier as string | undefined,
      confidence: parsed.confidence as number ?? 0,
      candidates: parsed.candidates as number ?? 0,
    }
  }
}

// ---------------------------------------------------------------------------
// B3 — MacAxWindowWatcher: AXObserverCreate live subscription
// ---------------------------------------------------------------------------

export function startMacAxWindowWatcher(
  target: { hwnd: number; pid: number },
  opts?: { maxSeconds?: number },
): Promise<UiaWatcher> {
  return new Promise((resolve, reject) => {
    const bin = resolveHostBinary()
    const args = ["ax-watch", "--pid", String(target.pid)]
    if (opts?.maxSeconds) args.push("--max-seconds", String(opts.maxSeconds))
    const child = require("child_process").spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
    })
    const events: any[] = []
    let ready = false
    let dead = false
    let exitCode: number | null = null

    child.stdout.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter(Boolean)
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line)
          if (parsed.ready === true) {
            ready = true
            resolve({
              drain: () => { const e = [...events]; events.length = 0; return e },
              get dead() { return dead },
              get exitCode() { return exitCode },
              dispose: () => { try { child.kill() } catch { /* ignore */ } },
            })
          } else {
            events.push(parsed)
          }
        } catch { /* skip unparseable lines */ }
      }
    })

    child.on("exit", (code: number | null) => {
      dead = true
      exitCode = code
      if (!ready) {
        reject(new Error(`ax-watch exited with code ${code} before ready`))
      }
    })

    child.on("error", (err: Error) => {
      dead = true
      if (!ready) reject(err)
    })
  })
}

// ---------------------------------------------------------------------------
// B3 — MacPreviewBuilder: screenshot annotation (crosshair + credential blur)
// ---------------------------------------------------------------------------

export class MacPreviewBuilder implements PreviewBuilder {
  async build(
    imagePath: string,
    point?: { x: number; y: number },
    blurRects?: RectPx[],
  ): Promise<string | null> {
    const bin = resolveHostBinary()
    const args = ["preview", "--image", imagePath]
    if (point) {
      args.push("--x", String(Math.round(point.x)), "--y", String(Math.round(point.y)))
    }
    if (blurRects && blurRects.length > 0) {
      args.push("--blur-rects", JSON.stringify(blurRects))
    }
    let result: { stdout: string }
    try {
      result = await execFileAsync(bin, args, { timeout: 10000 })
    } catch {
      return null // best-effort, never fail the task
    }
    const parsed = parseComputerJson(result.stdout, "preview")
    return (parsed.base64 as string) ?? null
  }
}
