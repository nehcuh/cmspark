// Coordinate computer-use (WP1 minimal loop) — shared types.
// Plan: docs/decisions/coordinate-computer-use-plan.md (Amendments A1–A10 govern).
//
// Scope (WP1, plan §H): screenshot (PrintWindow + black-detect + BitBlt
// fallback) → OCR locate layer → SendInput click/type → self-drawn fixture →
// task-level L2 (critical-class, originWs, budget skeleton) → evidence chain
// v1. NO UIA layer, NO local model, NO cloud VLM, NO sidepanel UI here.

import * as crypto from "crypto"

// ---------------------------------------------------------------------------
// Action schema (plan §D.3 closed discriminated union).
// click family / type / key / scroll / drag are injective; wait/screenshot/
// describe are non-injective. WP2 added key/scroll/drag with their own
// boundary rules: key = named-key WHITELIST chords only (text entry is the
// type primitive's job, never arbitrary VK), scroll delta capped, drag
// endpoints bounds-checked like clicks.
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

/** WP2: named-key chord (e.g. ["ctrl","enter"]). Whitelist below — no arbitrary VK. */
export type ComputerKeyAction = { action: "key"; keys: string[] }
/** WP2: wheel scroll at a client point; delta in wheel units (±, capped). */
export type ComputerScrollAction = { action: "scroll"; x: number; y: number; delta: number }
/** WP2: left-button drag from (x,y) to (x2,y2), client px. */
export type ComputerDragAction = { action: "drag"; x: number; y: number; x2: number; y2: number }

export type ComputerWaitAction = { action: "wait"; ms: number }
export type ComputerReadAction = { action: "screenshot" } | { action: "describe" }

export type ComputerAction =
  | ComputerClickAction
  | ComputerTypeAction
  | ComputerKeyAction
  | ComputerScrollAction
  | ComputerDragAction
  | ComputerWaitAction
  | ComputerReadAction

export const INJECTIVE_ACTIONS: ReadonlySet<string> = new Set([
  "click",
  "double_click",
  "right_click",
  "type",
  "key",
  "scroll",
  "drag",
])

/**
 * WP2 key whitelist (plan §D.3 "白名单键名 + 组合"). Modifiers + named keys
 * ONLY — printable text goes through `type` (A3 corpus). Lowercase names.
 */
export const ALLOWED_KEY_NAMES: readonly string[] = [
  "ctrl", "alt", "shift", "win",
  "enter", "escape", "tab", "space", "backspace", "delete",
  "up", "down", "left", "right", "home", "end", "pageup", "pagedown",
  "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
]
export const ALLOWED_KEY_SET: ReadonlySet<string> = new Set(ALLOWED_KEY_NAMES)
/** Max keys in one chord (e.g. ctrl+shift+enter = 3). */
export const MAX_KEY_CHORD = 4
/** Scroll delta bounds (wheel units; 120 = one notch). */
export const MAX_SCROLL_DELTA = 1200

export interface ComputerTaskParams {
  /** User task description — the ONLY instruction source (plan §E.1). */
  task: string
  /** App-tab whitelist token, e.g. "win.app.cloudmusic". */
  app: string
  /** Draft action sequence (validated as a closed union; extra fields rejected). */
  actions: ComputerAction[]
  /** Per-task action budget (default DEFAULT_TASK_BUDGET). */
  budget?: number
  /**
   * WP2: caller-supplied task id (the server generates one so the panel
   * abort channel can target THIS run before it starts). Defaults to a
   * fresh randomUUID inside the executor.
   */
  taskId?: string
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
/**
 * X1: a whole-window ratio quantitatively MISSES local popups — a 500x350
 * dialog in a 1054x736 window is ~22% of pixels in theory, and a realistically
 * rendered one (white interior on light-gray background) measures only ~0.12
 * whole-window (measured on the imgdiff smoke fixture), far under 0.3. The
 * zoned metrics below catch what the whole-window channel cannot:
 *   - maxZoneRatio: the 64x64 sampled grid split into 8x8-cell macro-zones
 *     (~132x92 px at 1054x736); a dialog saturates the zones it falls in
 *     (measured 0.75-1.0) → threshold 0.5.
 *   - maxBlobRatio: largest 4-connected changed cluster / cells; a dialog is
 *     one coherent blob (measured 0.058-0.22), a blinking cursor ~0.001 →
 *     threshold 0.05.
 * Known residual blind spot: popups smaller than ~5% of the frame escape all
 * three channels (documented in the plan's WP1 section).
 */
export const DIALOG_ZONE_THRESHOLD = 0.5
export const DIALOG_BLOB_THRESHOLD = 0.05
/** A1.3: per-task sub-budget for clicks that could not be cross-verified. */
export const UNCROSS_VERIFIED_SUB_BUDGET = 3
/** A1.2: side length of the cross-check / danger-scan crop around the target point. */
export const REGION_CROP_SIZE = 200
/** wait clamp (plan §D.3). */
export const MAX_WAIT_MS = 5000
/**
 * X4: per-text AND per-task-corpus character cap for type actions. Bound the
 * worst-case foreground hijack time (WP1 has no emergency stop — A9 is WP2):
 * 2000 chars × ≤80ms/char throttle ≈ 110s, under the ps1 120s hard cap.
 * Enforced at THREE layers: zod schema (tool boundary), executor
 * validateDraft (belt), ps1 (hand-rolled caller guard).
 */
export const MAX_TYPE_TEXT_CHARS = 2000

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
  | "APP_EXE_DRIFT" // WP2: exe sha256 differs from the add-time record — fail-closed
  | "HWND_NOT_OWNED" // hwnd drifted to a non-whitelisted process (§E.2.4)
  | "HWND_DEAD"
  | "INTEGRITY_LEVEL_DENIED" // cross-IL target — fail-closed (§D.2)
  | "DESKTOP_DENIED" // OpenInputDesktop name != "Default" (UAC/secure desktop)
  | "OUT_OF_BOUNDS" // coordinates outside target window rect — reject, never clamp
  | "CLICK_OCCLUDED" // X2: landing point owned by another (overlay) window — fail-closed
  | "FOCUS_LOST" // foreground hwnd changed mid-type batch (A1.4)
  | "OCR_LANGUAGE_MISSING" // honest layer skip (plan §B.2 L1)
  | "OCR_FAILED" // WP3 (Y6): OCR decode/recognize failure (ps1 OCRFAILED) — was mislabeled INJECT_FAILED
  | "ELEMENT_NOT_FOUND"
  | "STALE_SCREENSHOT" // A1 pixel check failed after re-locate
  | "DANGER_HARD_DENY" // A4: payment/transfer/captcha final-confirm — NO re-L2 path
  | "DANGER_DENIED_BY_USER"
  | "DIALOG_PAUSED_DENIED" // A2 dialog-invariant pause was denied at re-L2
  | "BUDGET_DENIED" // budget-exhaustion re-L2 denied
  | "UNCROSS_DENIED" // uncrossverified sub-budget re-L2 denied
  | "TYPE_TEXT_NOT_CONFIRMED" // A3: text outside the confirmed corpus
  | "TYPE_TEXT_TOO_LONG" // X4: type text / task corpus beyond MAX_TYPE_TEXT_CHARS
  | "CAPTURE_FAILED"
  | "INJECT_FAILED"
  | "EVIDENCE_ERROR"
  | "INVALID_ACTION"
  | "CONFIRMATION_UNAVAILABLE"
  | "TASK_ABORTED" // WP2: emergency stop fired (hotkey flag / panel abort) mid-task
  | "EMERGENCY_STOP_UNAVAILABLE" // WP2: estop hotkey helper missing/stale at task start
  | "EMERGENCY_STOP_LOST" // WP2 (adversary X1): estop helper heartbeat went stale MID-task — the kill switch died; fail-closed abort
  | "RATE_LIMITED" // WP2 (Y7): session injection rate window saturated (30/60s)

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
  /** Client area in IMAGE coordinates (bitmap covers full window incl. title bar). */
  client: RectPx
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
  layer: LocateLayer
  confidence: number
  matchedText: string
}

/**
 * WP3 (plan §B.1): the four locator layers. "uia" = L0 (WP3), "ocr" = L1
 * (WP1), "tinyclick" = L2 (WP5 stub — honest skip), "cloud" = L3 (WP6
 * stub — honest skip). Degradation is one-way down the chain.
 */
export type LocateLayer = "uia" | "ocr" | "tinyclick" | "cloud"

/**
 * WP3: one layer attempt in the locate chain (structured degradation log —
 * recorded per action into the evidence chain + computeruse.locate audit).
 */
export interface LocateAttempt {
  layer: LocateLayer
  outcome: "hit" | "not-found" | "skipped" | "error"
  /** Degradation reason when outcome != "hit" (e.g. "uia-not-found",
   *  "uia-ocr-disagree", "ocr-language-missing", "wp5-not-implemented"). */
  reason?: string
  confidence?: number
  ms: number
}

/**
 * WP3: L0 live-tree locate hit. Coordinates are SCREEN physical pixels
 * (UIA BoundingRectangle is screen-space); the chain maps them into the
 * capture's image space via CaptureMeta.rect.
 */
export interface UiaLocateHit {
  x: number
  y: number
  bbox: RectPx
  name: string
  controlType: string
  automationId?: string
  confidence: number
  /** Total equal-score candidates (>1 = ambiguous — logged, first taken). */
  candidates: number
}

/** WP3: L0 provider (production: PsUiaLocator; tests: fakes). */
export interface UiaLocator {
  /** Live-tree locate by accessible-Name anchor; null = honest NotFound. */
  locate(hwnd: number, target: string): Promise<UiaLocateHit | null>
}

export interface ScreenCapturer {
  captureWindow(hwnd: number): Promise<CaptureMeta>
  /** Crop srcPath to rect (clamped to image), write outPath, return outPath. */
  crop(srcPath: string, rect: RectPx, outPath: string): Promise<string>
  /** diffRatio in [0,1] between two same-subject captures (optional crop on A). */
  diff(aPath: string, bPath: string, crop?: RectPx): Promise<DiffMetrics>
  /**
   * The R4 pixel channel: diffRatio in [0,1] between the SAME `region` rect
   * of two captures — crops BOTH frames to the rect internally and diffs the
   * crops (diff()'s optional crop only applies to A; see N4). Temp crops are
   * created and deleted inside the adapter; the caller tracks no extra raws.
   */
  diffRegion(aPath: string, bPath: string, region: RectPx): Promise<{ diffRatio: number }>
}

/**
 * X1 zoned diff metrics. `diffRatio` is always present; the zoned channels are
 * optional so that fakes and region diffs (where zoning is meaningless) can
 * omit them — an absent channel simply does not participate in the dialog OR.
 */
export interface DiffMetrics {
  diffRatio: number
  maxZoneRatio?: number
  maxBlobRatio?: number
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
  /** WP2: named-key chord, whitelist-validated upstream (executor + ps1). */
  keyChord(hwnd: number, keys: string[]): Promise<void>
  /** WP2: wheel scroll at a client point (delta in wheel units, ± capped). */
  scroll(hwnd: number, x: number, y: number, delta: number): Promise<void>
  /** WP2: left-button drag (x,y) -> (x2,y2), client px. */
  drag(hwnd: number, x: number, y: number, x2: number, y2: number): Promise<void>
  probeWindow(hwnd: number): Promise<WindowInfo>
  foregroundHwnd(): Promise<number>
}

export interface WindowEnumerator {
  /** Visible top-level windows whose process exe path equals exePath (normalized). */
  enumerateByExe(exePath: string): Promise<WindowInfo[]>
  infoForHwnd(hwnd: number): Promise<WindowInfo>
}

/**
 * WP2 (§T5-8): per-action security-environment probe — the target process
 * integrity level and the input desktop, RE-CHECKED between actions. A
 * whitelisted app can be relaunched elevated mid-task (hwnd ownership still
 * matches, but SendInput would cross UIPI), and the session can switch to a
 * secure desktop (UAC/lock); both must stop the task BEFORE the next
 * injection attempt. The ps1-side IL/desktop checks stay as defense in
 * depth; this is the mockable TS gate. Fail-closed on any probe error.
 */
export interface SecurityEnvironment {
  /** Throws ComputerError(INTEGRITY_LEVEL_DENIED | DESKTOP_DENIED) when not injectable. */
  assertInjectable(hwnd: number): Promise<void>
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
