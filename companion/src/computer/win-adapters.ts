// WP1 — PowerShell-backed implementations of the capturer / locator / injector
// / window-enumerator interfaces (E10 ps1 discipline: argv-only, single-line
// JSON stdout, stderr-prefix typed errors, 15s default timeout).
//
// Unit tests never touch these — they inject fakes (plan G.3). The real
// SendInput path runs only in the win32 fixture integration test.

import * as os from "os"
import * as path from "path"
import * as fs from "fs"
import * as crypto from "crypto"
import { parsePsJson, runPs, type PsRunner } from "../host-use/win/powershell"
import { resolveWinScript } from "../host-use/win/powershell"
import {
  ComputerError,
  type CaptureMeta,
  type DiffMetrics,
  type InputInjector,
  type LocateHit,
  type Locator,
  type OcrResult,
  type OcrWord,
  type RectPx,
  type ScreenCapturer,
  type WindowEnumerator,
  type WindowInfo,
} from "./types"

/** stderr prefix → typed error code (ps1 contract). */
const PS_ERROR_CODES: Record<string, import("./types").ComputerErrorCode> = {
  HWNDDEAD: "HWND_DEAD",
  ILDENIED: "INTEGRITY_LEVEL_DENIED",
  DESKTOPDENIED: "DESKTOP_DENIED",
  OUTOFBOUNDS: "OUT_OF_BOUNDS",
  OCCLUDED: "CLICK_OCCLUDED",
  FOCUSLOST: "FOCUS_LOST",
  STOPPED: "TASK_ABORTED", // WP2 (§E.6): -StopFile flag seen mid-injection
  OCRLANGMISSING: "OCR_LANGUAGE_MISSING",
  SENDFAILED: "INJECT_FAILED",
  CAPTUREFAILED: "CAPTURE_FAILED",
  DIFFFAILED: "CAPTURE_FAILED",
  SEALFAILED: "EVIDENCE_ERROR",
  BADARGS: "INVALID_ACTION",
}

/** Map a rejected PsRunner call to a typed ComputerError. */
export function rethrowComputerPsError(err: any, label: string): never {
  const stderr = err && typeof err === "object" && "stderr" in err && err.stderr ? String(err.stderr) : ""
  const line = stderr.split(/\r?\n/).find((l) => /^[A-Z]{4,16}:/.test(l))
  if (line) {
    const sep = line.indexOf(":")
    const prefix = line.slice(0, sep)
    const detail = line.slice(sep + 1).trim()
    const code = PS_ERROR_CODES[prefix]
    if (code) throw new ComputerError(code, `computer.${label}: ${detail}`, { psPrefix: prefix })
  }
  if (stderr.trim()) throw new ComputerError("INJECT_FAILED", `computer.${label}: ${stderr.trim()}`)
  throw err
}

export const COMPUTER_TEMP_DIR_NAME = "cmspark-computer"

export function computerTempDir(): string {
  return path.join(os.tmpdir(), COMPUTER_TEMP_DIR_NAME)
}

function tmpPng(prefix: string): string {
  const dir = computerTempDir()
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* best-effort */ }
  return path.join(dir, `${prefix}-${process.pid}-${crypto.randomBytes(6).toString("hex")}.png`)
}

// ---------------------------------------------------------------------------
// X6 — temp-capture janitor. Raw frames carry a pid + random suffix; a crash
// can strand them in %TEMP% unblurred. Sweep at daemon startup: a capture is
// removed when its owning process is DEAD, or it is older than the TTL even
// if alive (a wedged task must not pin plaintext forever). Files we cannot
// attribute (foreign names, our own pid) are kept.
// ---------------------------------------------------------------------------

/** fs surface the janitor needs (injectable for tests). */
export interface SweepFsLike {
  readdirSync(dir: string): string[]
  statSync(p: string): { mtimeMs: number }
  rmSync(p: string, opts?: { force?: boolean }): unknown
}

export interface SweepComputerTempOptions {
  dir?: string
  now?: number
  ttlMs?: number // default 1h
  selfPid?: number // default process.pid
  isPidAlive?: (pid: number) => boolean // default process.kill(pid, 0)
  fsLike?: SweepFsLike
}

export function sweepComputerTempCaptures(opts: SweepComputerTempOptions = {}): { removed: string[]; kept: string[] } {
  const dir = opts.dir ?? computerTempDir()
  const nowMs = opts.now ?? Date.now()
  const ttl = opts.ttlMs ?? 3_600_000
  const selfPid = opts.selfPid ?? process.pid
  const fsx: SweepFsLike = opts.fsLike ?? (fs as unknown as SweepFsLike)
  const alive =
    opts.isPidAlive ??
    ((pid: number) => {
      try { process.kill(pid, 0); return true } catch { return false }
    })
  const removed: string[] = []
  const kept: string[] = []
  let names: string[]
  try {
    names = fsx.readdirSync(dir)
  } catch {
    return { removed, kept } // no temp dir — nothing to sweep
  }
  for (const name of names) {
    // prefix itself may contain '-' (e.g. "diffregion-a") — anchor on the
    // LAST '-<pid>-<12hex>.png' tail.
    const m = /^.+-(\d+)-[0-9a-f]{12}\.png$/.exec(name)
    if (!m) { kept.push(name); continue }
    const pid = Number(m[1])
    if (pid === selfPid) { kept.push(name); continue }
    const p = path.join(dir, name)
    let mtimeMs: number
    try {
      mtimeMs = fsx.statSync(p).mtimeMs
    } catch {
      continue // vanished mid-sweep / unreadable — leave it
    }
    if (!alive(pid) || nowMs - mtimeMs > ttl) {
      try {
        fsx.rmSync(p, { force: true })
        removed.push(name)
      } catch {
        kept.push(name)
      }
    } else {
      kept.push(name)
    }
  }
  return { removed, kept }
}

// ---------------------------------------------------------------------------

export class PsScreenCapturer implements ScreenCapturer {
  constructor(private runner: PsRunner = runPs) {}

  async captureWindow(hwnd: number): Promise<CaptureMeta> {
    const out = tmpPng("cap")
    let stdout: string
    try {
      stdout = await this.runner(resolveWinScript("computer-capture.ps1"), [
        "-Hwnd", String(hwnd),
        "-OutPath", out,
        "-AllowFallback",
      ])
    } catch (err) {
      rethrowComputerPsError(err, "capture")
    }
    const meta = parsePsJson<any>(stdout!, "computer.capture")
    return {
      hwnd: Number(meta.hwnd),
      rect: meta.rect,
      dpi: Number(meta.dpi ?? 96),
      path: String(meta.path ?? out),
      sha256: String(meta.sha256 ?? ""),
      black: meta.black === true,
      fallbackUsed: meta.fallbackUsed === true,
      osrBlackSuspected: meta.osrBlackSuspected === true,
      // client offset within the full-window image (title bar etc.)
      client: meta.client ?? { x: 0, y: 0, width: meta.rect?.width ?? 0, height: meta.rect?.height ?? 0 },
    }
  }

  async crop(srcPath: string, rect: RectPx, outPath: string): Promise<string> {
    try {
      await this.runner(resolveWinScript("computer-capture.ps1"), [
        "-Hwnd", "0",
        "-OutPath", outPath,
        "-CropOf", srcPath,
        "-CropX", String(Math.round(rect.x)),
        "-CropY", String(Math.round(rect.y)),
        "-CropW", String(Math.round(rect.width)),
        "-CropH", String(Math.round(rect.height)),
      ])
    } catch (err) {
      rethrowComputerPsError(err, "crop")
    }
    return outPath
  }

  async diff(aPath: string, bPath: string, crop?: RectPx): Promise<DiffMetrics> {
    const args = ["-A", aPath, "-B", bPath]
    if (crop) {
      args.push(
        "-CropX", String(Math.round(crop.x)),
        "-CropY", String(Math.round(crop.y)),
        "-CropW", String(Math.round(crop.width)),
        "-CropH", String(Math.round(crop.height)),
      )
    }
    let stdout: string
    try {
      stdout = await this.runner(resolveWinScript("computer-imgdiff.ps1"), args)
    } catch (err) {
      rethrowComputerPsError(err, "diff")
    }
    const r = parsePsJson<any>(stdout!, "computer.diff")
    // X1: zoned channels are optional — absent (older script / fake) simply
    // means they do not participate in the dialog OR.
    return {
      diffRatio: Number(r.diffRatio ?? 1),
      maxZoneRatio: r.maxZoneRatio === undefined || r.maxZoneRatio === null ? undefined : Number(r.maxZoneRatio),
      maxBlobRatio: r.maxBlobRatio === undefined || r.maxBlobRatio === null ? undefined : Number(r.maxBlobRatio),
    }
  }

  async diffRegion(aPath: string, bPath: string, region: RectPx): Promise<{ diffRatio: number }> {
    // R4 pixel channel: crop BOTH frames to the same rect, diff the crops.
    // The temp crops live and die inside this call — the executor's raw
    // tracking (R1) never sees them.
    const ca = tmpPng("diffregion-a")
    const cb = tmpPng("diffregion-b")
    try {
      await this.crop(aPath, region, ca)
      await this.crop(bPath, region, cb)
      return await this.diff(ca, cb)
    } finally {
      for (const p of [ca, cb]) {
        try { fs.rmSync(p, { force: true }) } catch { /* best-effort */ }
      }
    }
  }
}

// ---------------------------------------------------------------------------

export class PsLocator implements Locator {
  constructor(private runner: PsRunner = runPs, private language = "zh-Hans") {}

  async ensureLanguage(): Promise<void> {
    let stdout: string
    try {
      stdout = await this.runner(resolveWinScript("computer-ocr.ps1"), ["-ListLanguages"])
    } catch (err) {
      rethrowComputerPsError(err, "ocr.languages")
    }
    const r = parsePsJson<any>(stdout!, "computer.ocr.languages")
    const langs: string[] = Array.isArray(r.languages) ? r.languages : []
    const want = this.language.toLowerCase()
    // Installed tags look like "zh-Hans-CN"; accept exact or prefix match.
    const ok = langs.some((l) => {
      const tag = String(l).toLowerCase()
      return tag === want || tag.startsWith(want + "-")
    })
    if (!ok) {
      throw new ComputerError(
        "OCR_LANGUAGE_MISSING",
        `computer.ocr: language pack "${this.language}" not installed — skipping the OCR layer honestly`,
        { installed: langs },
      )
    }
  }

  async ocr(imagePath: string): Promise<OcrResult> {
    let stdout: string
    try {
      stdout = await this.runner(resolveWinScript("computer-ocr.ps1"), [
        "-ImagePath", imagePath,
        "-Language", this.language,
      ])
    } catch (err) {
      rethrowComputerPsError(err, "ocr")
    }
    const r = parsePsJson<any>(stdout!, "computer.ocr")
    const words: OcrWord[] = Array.isArray(r.words)
      ? r.words.map((w: any) => ({
          text: String(w.text ?? ""),
          x: Number(w.x ?? 0),
          y: Number(w.y ?? 0),
          w: Number(w.w ?? 0),
          h: Number(w.h ?? 0),
        }))
      : []
    return { language: String(r.language ?? this.language), words }
  }

  /**
   * Locate a text anchor. OCR may split a label into per-character words
   * (observed: "确","定") — group words into lines, then slide a concatenation
   * window so multi-char anchors match across word boxes. Exact substring
   * match = confidence 0.9 (plan B.2); no fuzzy matching in WP1.
   */
  locate(result: OcrResult, text: string): LocateHit | null {
    if (!text) return null
    const lines: OcrWord[][] = []
    const sorted = [...result.words].sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2))
    for (const w of sorted) {
      const cy = w.y + w.h / 2
      const line = lines.find((l) => {
        const ref = l[0]
        return Math.abs(ref.y + ref.h / 2 - cy) <= Math.max(ref.h, w.h) * 0.6
      })
      if (line) line.push(w)
      else lines.push([w])
    }
    for (const line of lines) {
      line.sort((a, b) => a.x - b.x)
      for (let i = 0; i < line.length; i++) {
        let acc = ""
        for (let j = i; j < line.length; j++) {
          acc += line[j].text
          if (acc.includes(text)) {
            const first = line[i]
            const last = line[j]
            const x = first.x
            const y = Math.min(first.y, last.y)
            const x2 = last.x + last.w
            const y2 = Math.max(first.y + first.h, last.y + last.h)
            return {
              x: Math.round(x + (x2 - x) / 2),
              y: Math.round(y + (y2 - y) / 2),
              bbox: { x, y, width: x2 - x, height: y2 - y },
              layer: "ocr",
              confidence: 0.9,
              matchedText: acc,
            }
          }
          // Stop growing the window once it clearly overshoots the anchor.
          if (acc.length > text.length * 3 + 8) break
        }
      }
    }
    return null
  }
}

// ---------------------------------------------------------------------------

export class PsInputInjector implements InputInjector {
  /**
   * @param runner ps1 runner (tests inject a fake).
   * @param stopFile WP2 (§E.6): emergency-stop flag path — forwarded as
   *   -StopFile so the ps1 aborts mid-injection (STOPPED, exit 11) when the
   *   hotkey fires during a long type batch. Undefined = no flag forwarding.
   */
  constructor(
    private runner: PsRunner = runPs,
    private stopFile?: string,
  ) {}

  private withStop(args: string[]): string[] {
    return this.stopFile ? [...args, "-StopFile", this.stopFile] : args
  }

  async click(hwnd: number, x: number, y: number, kind: "click" | "double_click" | "right_click"): Promise<void> {
    try {
      await this.runner(resolveWinScript("computer-input.ps1"), this.withStop([
        "-Hwnd", String(hwnd),
        "-Action", kind,
        "-X", String(Math.round(x)),
        "-Y", String(Math.round(y)),
      ]))
    } catch (err) {
      rethrowComputerPsError(err, "inject.click")
    }
  }

  async typeText(hwnd: number, text: string): Promise<void> {
    try {
      // argv-only: the text travels as an argv element, never interpolated.
      await this.runner(resolveWinScript("computer-input.ps1"), this.withStop([
        "-Hwnd", String(hwnd),
        "-Action", "type",
        "-Text", text,
      ]), { timeoutMs: 15000 + text.length * 120 }) // throttle headroom, still bounded
    } catch (err) {
      rethrowComputerPsError(err, "inject.type")
    }
  }

  async keyChord(hwnd: number, keys: string[]): Promise<void> {
    try {
      await this.runner(resolveWinScript("computer-input.ps1"), this.withStop([
        "-Hwnd", String(hwnd),
        "-Action", "key",
        "-Keys", keys.join(","),
      ]))
    } catch (err) {
      rethrowComputerPsError(err, "inject.key")
    }
  }

  async scroll(hwnd: number, x: number, y: number, delta: number): Promise<void> {
    try {
      await this.runner(resolveWinScript("computer-input.ps1"), this.withStop([
        "-Hwnd", String(hwnd),
        "-Action", "scroll",
        "-X", String(Math.round(x)),
        "-Y", String(Math.round(y)),
        "-Delta", String(Math.round(delta)),
      ]))
    } catch (err) {
      rethrowComputerPsError(err, "inject.scroll")
    }
  }

  async drag(hwnd: number, x: number, y: number, x2: number, y2: number): Promise<void> {
    try {
      await this.runner(resolveWinScript("computer-input.ps1"), this.withStop([
        "-Hwnd", String(hwnd),
        "-Action", "drag",
        "-X", String(Math.round(x)),
        "-Y", String(Math.round(y)),
        "-X2", String(Math.round(x2)),
        "-Y2", String(Math.round(y2)),
      ]))
    } catch (err) {
      rethrowComputerPsError(err, "inject.drag")
    }
  }

  async probeWindow(hwnd: number): Promise<WindowInfo> {
    return psWindowInfo(this.runner, hwnd)
  }

  async foregroundHwnd(): Promise<number> {
    let stdout: string
    try {
      stdout = await this.runner(resolveWinScript("computer-windows.ps1"), [])
    } catch (err) {
      rethrowComputerPsError(err, "foreground")
    }
    const r = parsePsJson<any>(stdout!, "computer.foreground")
    return Number(r.foreground ?? 0)
  }
}

async function psWindowInfo(runner: PsRunner, hwnd: number): Promise<WindowInfo> {
  let stdout: string
  try {
    stdout = await runner(resolveWinScript("computer-windows.ps1"), ["-Hwnd", String(hwnd)])
  } catch (err) {
    rethrowComputerPsError(err, "window.info")
  }
  const r = parsePsJson<any>(stdout!, "computer.window.info")
  const w = r.window ?? {}
  return {
    hwnd: Number(w.hwnd ?? hwnd),
    pid: Number(w.pid ?? 0),
    exePath: w.exePath ? String(w.exePath) : null,
    title: String(w.title ?? ""),
    rect: w.rect ?? { x: 0, y: 0, width: 0, height: 0 },
    alive: w.alive === true,
  }
}

// ---------------------------------------------------------------------------

export class PsWindowEnumerator implements WindowEnumerator {
  constructor(private runner: PsRunner = runPs) {}

  async enumerateByExe(exePath: string): Promise<WindowInfo[]> {
    let stdout: string
    try {
      stdout = await this.runner(resolveWinScript("computer-windows.ps1"), ["-ExePath", exePath])
    } catch (err) {
      rethrowComputerPsError(err, "window.enum")
    }
    const r = parsePsJson<any>(stdout!, "computer.window.enum")
    const list: any[] = Array.isArray(r.windows) ? r.windows : []
    return list.map((w) => ({
      hwnd: Number(w.hwnd ?? 0),
      pid: Number(w.pid ?? 0),
      exePath: w.exePath ? String(w.exePath) : null,
      title: String(w.title ?? ""),
      rect: w.rect ?? { x: 0, y: 0, width: 0, height: 0 },
      alive: true,
    }))
  }

  async infoForHwnd(hwnd: number): Promise<WindowInfo> {
    return psWindowInfo(this.runner, hwnd)
  }
}

// ---------------------------------------------------------------------------

/** A7 evidence sealer (DPAPI + pre-seal pixelation), ps1-backed. */
export class PsEvidenceSealer {
  constructor(private runner: PsRunner = runPs) {}

  async protect(inPath: string, outPath: string, blurRects: RectPx[]): Promise<{ sha256: string }> {
    const blur = blurRects
      .map((r) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`)
      .join(";")
    let stdout: string
    try {
      stdout = await this.runner(resolveWinScript("computer-evidence-seal.ps1"), [
        "-Mode", "protect",
        "-InPath", inPath,
        "-OutPath", outPath,
        "-BlurRects", blur,
      ])
    } catch (err) {
      rethrowComputerPsError(err, "seal")
    }
    const r = parsePsJson<any>(stdout!, "computer.seal")
    return { sha256: String(r.sha256 ?? "") }
  }

  async unprotect(inPath: string, outPath: string): Promise<void> {
    try {
      await this.runner(resolveWinScript("computer-evidence-seal.ps1"), [
        "-Mode", "unprotect",
        "-InPath", inPath,
        "-OutPath", outPath,
      ])
    } catch (err) {
      rethrowComputerPsError(err, "unseal")
    }
  }
}
