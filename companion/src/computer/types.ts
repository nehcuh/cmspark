// Coordinate computer-use (WP1 minimal loop) — shared types.
// Plan: docs/decisions/coordinate-computer-use-plan.md (Amendments A1–A10 govern).
//
// Scope (WP1, plan §H): screenshot (PrintWindow + black-detect + BitBlt
// fallback) → OCR locate layer → SendInput click/type → self-drawn fixture →
// task-level L2 (critical-class, originWs, budget skeleton) → evidence chain
// v1. NO UIA layer, NO local model, NO cloud VLM, NO sidepanel UI here.

import * as crypto from "crypto"

// ---------------------------------------------------------------------------
// Action schema (plan §D.3 closed discriminated union, WP1 subset).
// click/double_click/right_click/type are injective; wait/screenshot/describe
// are non-injective. key/scroll/drag are WP2 — absent here BY DESIGN (a draft
// containing them must fail schema validation, not be silently ignored).
// ---------------------------------------------------------------------------

export type ComputerClickAction = {
  action: "click" | "double_click" | "right_click"
  /** Client-area physical pixels of the TARGET window. Optional when target text is given. */
  x?: number
  y?: number
  /** OCR text anchor to locate (L1 layer). When present, the executor locates. */
  target?: string
}

export type ComputerTypeAction = {
  action: "type"
  /**
   * Text to inject via KEYEVENTF_UNICODE. A3: every literal MUST come from the
   * user-confirmed corpus (enumerated verbatim in the task L2 dialog and bound
   * by hash into the task context); anything else is hard-rejected.
   */
  text: string
}

export type ComputerWaitAction = { action: "wait"; ms: number }
export type ComputerReadAction = { action: "screenshot" } | { action: "describe" }

export type ComputerAction =
  | ComputerClickAction
  | ComputerTypeAction
  | ComputerWaitAction
  | ComputerReadAction

export const INJECTIVE_ACTIONS: ReadonlySet<string> = new Set([
  "click",
  "double_click",
  "right_click",
  "type",
])

export interface ComputerTaskParams {
  /** User task description — the ONLY instruction source (plan §E.1). */
  task: string
  /** App-tab whitelist token, e.g. "win.app.cloudmusic". */
  app: string
  /** Draft action sequence (validated as a closed union; extra fields rejected). */
  actions: ComputerAction[]
  /** Per-task action budget (default DEFAULT_TASK_BUDGET). */
  budget?: number
}

// ---------------------------------------------------------------------------
// Budgets / thresholds (A1/A2; B9: the 15-action budget is only defensible
// WITH A1+A2 in place — both are implemented in this WP).
// ---------------------------------------------------------------------------

export const DEFAULT_TASK_BUDGET = 15
export const MAX_TASK_BUDGET = 30
/** A1: max age of the locate-time screenshot at injection time. */
export const PIXEL_STALE_MS = 300
/** A1: region diff above this → coordinates are stale, re-locate, never inject. */
export const PIXEL_DIFF_THRESHOLD = 0.08
/** A2: whole-window post-action diff above this → suspected task-induced dialog → pause + re-L2. */
export const DIALOG_DIFF_THRESHOLD = 0.3
/** A1.3: per-task sub-budget for clicks that could not be cross-verified. */
export const UNCROSS_VERIFIED_SUB_BUDGET = 3
/** A1.2: side length of the cross-check / danger-scan crop around the target point. */
export const REGION_CROP_SIZE = 200
/** wait clamp (plan §D.3). */
export const MAX_WAIT_MS = 5000

// ---------------------------------------------------------------------------
// Typed errors — every fail-closed path has a stable code (ps1 stderr prefixes
// map onto these; tests assert codes, never message shape).
// ---------------------------------------------------------------------------

export type ComputerErrorCode =
  | "COMPUTER_DISABLED" // global computer.coordinateEnabled=false (A10)
  | "APP_COORDINATE_DENIED" // AppEntry coordinateAllowed=false (A10)
  | "APP_COORDINATE_STRUCTURAL" // vault/LOLBIN-mapped app can never opt in (A10.3)
  | "APP_NOT_WHITELISTED"
  | "APP_WINDOW_NOT_FOUND"
  | "HWND_NOT_OWNED" // hwnd drifted to a non-whitelisted process (§E.2.4)
  | "HWND_DEAD"
  | "INTEGRITY_LEVEL_DENIED" // cross-IL target — fail-closed (§D.2)
  | "DESKTOP_DENIED" // OpenInputDesktop name != "Default" (UAC/secure desktop)
  | "OUT_OF_BOUNDS" // coordinates outside target window rect — reject, never clamp
  | "FOCUS_LOST" // foreground hwnd changed mid-type batch (A1.4)
  | "OCR_LANGUAGE_MISSING" // honest layer skip (plan §B.2 L1)
  | "ELEMENT_NOT_FOUND"
  | "STALE_SCREENSHOT" // A1 pixel check failed after re-locate
  | "DANGER_HARD_DENY" // A4: payment/transfer/captcha final-confirm — NO re-L2 path
  | "DANGER_DENIED_BY_USER"
  | "DIALOG_PAUSED_DENIED" // A2 dialog-invariant pause was denied at re-L2
  | "BUDGET_DENIED" // budget-exhaustion re-L2 denied
  | "UNCROSS_DENIED" // uncrossverified sub-budget re-L2 denied
  | "TYPE_TEXT_NOT_CONFIRMED" // A3: text outside the confirmed corpus
  | "CAPTURE_FAILED"
  | "INJECT_FAILED"
  | "EVIDENCE_ERROR"
  | "INVALID_ACTION"
  | "CONFIRMATION_UNAVAILABLE"

export class ComputerError extends Error {
  readonly code: ComputerErrorCode
  readonly detail?: Record<string, unknown>
  constructor(code: ComputerErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message)
    this.name = "ComputerError"
    this.code = code
    this.detail = detail
  }
}

// ---------------------------------------------------------------------------
// Locator / capturer / injector interfaces (plan §G.3 mock boundary — unit
// tests inject fakes; real SendInput only runs in the win32 fixture
// integration test).
// ---------------------------------------------------------------------------

export interface RectPx {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowInfo {
  hwnd: number
  pid: number
  exePath: string | null
  title: string
  rect: RectPx
  alive: boolean
}

export interface CaptureMeta {
  hwnd: number
  rect: RectPx
  dpi: number
  /** Raw (unsealed) PNG path — transient; evidence seal consumes and deletes it. */
  path: string
  sha256: string
  /** True when PrintWindow produced a (near-)zero-variance bitmap (S-4 OSR marker). */
  black: boolean
  fallbackUsed: boolean
  osrBlackSuspected: boolean
}

export interface OcrWord {
  text: string
  x: number
  y: number
  w: number
  h: number
}

export interface OcrResult {
  language: string
  words: OcrWord[]
}

export interface LocateHit {
  /** Client-area physical pixel point (bbox center). */
  x: number
  y: number
  bbox: RectPx
  layer: "ocr"
  confidence: number
  matchedText: string
}

export interface ScreenCapturer {
  captureWindow(hwnd: number): Promise<CaptureMeta>
  /** Crop srcPath to rect (clamped to image), write outPath, return outPath. */
  crop(srcPath: string, rect: RectPx, outPath: string): Promise<string>
  /** diffRatio in [0,1] between two same-subject captures (optional crop on A). */
  diff(aPath: string, bPath: string, crop?: RectPx): Promise<{ diffRatio: number }>
}

export interface Locator {
  /** Throws ComputerError OCR_LANGUAGE_MISSING when the zh language pack is absent. */
  ensureLanguage(): Promise<void>
  ocr(imagePath: string): Promise<OcrResult>
  /** Returns null when the anchor text is not present (honest NotFound). */
  locate(result: OcrResult, text: string): LocateHit | null
}

export type ClickKind = "click" | "double_click" | "right_click"

export interface InputInjector {
  click(hwnd: number, x: number, y: number, kind: ClickKind): Promise<void>
  typeText(hwnd: number, text: string): Promise<void>
  probeWindow(hwnd: number): Promise<WindowInfo>
  foregroundHwnd(): Promise<number>
}

export interface WindowEnumerator {
  /** Visible top-level windows whose process exe path equals exePath (normalized). */
  enumerateByExe(exePath: string): Promise<WindowInfo[]>
  infoForHwnd(hwnd: number): Promise<WindowInfo>
}

// ---------------------------------------------------------------------------
// A3 — confirmed corpus. The L2 dialog enumerates every type.text literal;
// the executor binds the corpus HASH into the task context and rejects any
// type action whose text is not in the confirmed set.
// ---------------------------------------------------------------------------

export function corpusOf(actions: ComputerAction[]): string[] {
  const texts: string[] = []
  for (const a of actions) {
    if (a.action === "type") texts.push(a.text)
  }
  return texts
}

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex")
}

/** Canonical JSON for token/corpus binding — key order fixed, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort()
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export function corpusHashOf(texts: string[]): string {
  return sha256Hex(canonicalJson([...texts].sort()))
}

/**
 * security-policy binding payload for host_computer: app + task + corpus hash
 * + full action-draft hash. A replayed/tampered draft fails token validation.
 */
export function computerBindingPayload(params: {
  app?: unknown
  task?: unknown
  actions?: unknown
}): string {
  const app = String(params.app || "")
  const task = String(params.task || "")
  const actions = Array.isArray(params.actions) ? (params.actions as ComputerAction[]) : []
  return `${app}|${task}|${corpusHashOf(corpusOf(actions))}|${sha256Hex(canonicalJson(actions))}`
}
