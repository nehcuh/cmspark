// WP1 task executor — the minimal coordinate computer-use loop with the
// adversary-mandated invariants baked in:
//
//   A1  pre-injection pixel check: OCR-target clicks ALWAYS recapture right
//       before injection and diff the ~200×200 target region between the
//       locate frame and the pre-inject frame (never inject at stale
//       coordinates — re-locate on the fresh frame or fail STALE_SCREENSHOT).
//       A1.2 honest WP1 form (review R4): that region pixel-diff IS the
//       cross-check — a pixel-STABILITY verification via a channel
//       independent of the OCR layer, NOT a semantic OCR↔UIA verification
//       (no second semantic layer exists in WP1). Stable region ->
//       crossverified=true with crossverifyChannel="pixel-region"; re-located
//       clicks and explicit-coordinate (icon) clicks are uncrossverified and
//       consume the <=3 sub-budget (A1.3), then a mandatory new L2;
//       type: per-batch foreground re-check lives in the ps1 (FOCUSLOST).
//   A2  task-induced dialog invariant: post-action foreground change OR
//       large whole-window diff -> pause + re-L2 (conservative direction);
//       danger detection input = pre-click region crop + whole window (dual).
//   A3  every type.text must belong to the L2-confirmed corpus (hash-bound);
//       anything else is hard-rejected.
//   A4  hard-deny words in the pre-click REGION = payment/transfer/captcha
//       final-confirm click -> NO re-L2 path exists; credential context for a
//       type action is likewise a no-path deny.
//
//   A7  every raw capture path is tracked in pendingRaws (review R1): sealed
//       frames are consumed by the sealer, superseded locate frames are
//       released immediately, and ALL exits (success / fail / throw) sweep
//       whatever remains — plaintext pixels never linger in %TEMP%.
//
// The initial task L2 (critical-class, god-mode included) happens in the
// server gate BEFORE this executor runs; re-L2s raised here go through the
// injected origin-bound confirmation channel.

import { createHash, randomUUID } from "crypto"
import * as fs from "fs"
import type { CompanionConfig } from "../config"
import type { SecurityConfirmationDecision, SecurityConfirmationDetails } from "../security-confirmation"
import { scanDanger, type DangerScan } from "./danger"
import type { EvidenceFactory, EvidenceSink } from "./evidence"
import { locateTargetWithChain } from "./locate-chain"
import type { ComputerTaskEvent, PreviewBuilder } from "./preview"
import { assertCoordinateAllowed, assertExeNotDrifted, assertHwndOwnedByEntry, normalizeExePath } from "./policy"
import {
  ALLOWED_KEY_SET,
  ComputerError,
  corpusHashOf,
  corpusOf,
  DIALOG_DIFF_THRESHOLD,
  DIALOG_BLOB_THRESHOLD,
  DIALOG_ZONE_THRESHOLD,
  DEFAULT_TASK_BUDGET,
  INJECTIVE_ACTIONS,
  MAX_KEY_CHORD,
  MAX_SCROLL_DELTA,
  MAX_TASK_BUDGET,
  MAX_TYPE_TEXT_CHARS,
  MAX_WAIT_MS,
  PIXEL_DIFF_THRESHOLD,
  PIXEL_STALE_MS,
  REGION_CROP_SIZE,
  UNCROSS_VERIFIED_SUB_BUDGET,
  type CaptureMeta,
  type ComputerAction,
  type ComputerTaskParams,
  type InputInjector,
  type LocateAttempt,
  type LocateHit,
  type Locator,
  type OcrResult,
  type RectPx,
  type ScreenCapturer,
  type SecurityEnvironment,
  type UiaLocator,
  type UiaWatcher,
  type UiaWatcherFactory,
  type WindowEnumerator,
} from "./types"

/** Re-L2 channel (budget / dialog / danger pauses). Origin-bound by construction. */
export type ComputerConfirmationChannel = (
  details: SecurityConfirmationDetails,
) => Promise<SecurityConfirmationDecision>

export interface ComputerExecutorDeps {
  capturer: ScreenCapturer
  locator: Locator
  injector: InputInjector
  windows: WindowEnumerator
  /**
   * WP2 (§T5-8): per-action IL + input-desktop re-probe. REQUIRED — a dep
   * that cannot answer is not a safe default; tests inject an allow-all
   * fake explicitly, production injects PsSecurityEnvironment.
   */
  securityEnv: SecurityEnvironment
  evidenceFactory: EvidenceFactory
  confirm: ComputerConfirmationChannel
  config: CompanionConfig
  log?: (event: string, data: Record<string, unknown>) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /**
   * R1 raw sweeper — deletes an abandoned plaintext capture. Injectable for
   * the no-residue property tests; production default is fs.rm force.
   */
  removeFile?: (path: string) => Promise<void>
  /**
   * WP2: exe hasher for the add-time sha256 drift check (§E.2.1). Computed
   * once per task. Injectable for tests; production default reads the file.
   */
  hashFile?: (path: string) => string
  /**
   * WP2 (§E.6): emergency-stop probe. Returns the channel that fired
   * ("hotkey" = PS helper flag file, "panel" = WS abort, "estop-lost" =
   * adversary X1: the helper's heartbeat went stale MID-task — the kill
   * switch itself died) or null. Checked before EVERY action, inside waits,
   * and once more immediately before the SendInput call — an abort mid-task
   * fails through the normal zero-residue exit path.
   */
  abortCheck?: () => "hotkey" | "panel" | "estop-lost" | null
  /**
   * WP2 (§E.4): task progress events (started/step/paused/finished) for the
   * panel live view. Fire-and-forget — listener errors are swallowed.
   */
  onEvent?: (ev: ComputerTaskEvent) => void
  /**
   * WP2 (§E.4): per-step annotated preview image. ANY failure degrades to
   * "no image" — the task never blocks on a preview.
   */
  previewBuilder?: PreviewBuilder
  /**
   * WP2 (Y7): called once after EVERY successful SendInput dispatch — the
   * server's session rate limiter counts these. Only successful injections
   * are reported; a failed action must not consume the rate window.
   */
  onActionInjected?: () => void
  /**
   * WP3 (§K.5): lazy UIA admission probe. When the entry's uiaCapable hint is
   * unprobed (undefined), the executor probes the resolved hwnd ONCE at task
   * start (read-only) and reports the verdict through onUiaVerdict for the
   * server-side config write-back. Absent dep = probe skipped (unit tests).
   */
  uiaProber?: import("./uia").UiaProber
  /**
   * WP3: verdict sink wired by the server to writeBackUiaVerdict.
   * Fire-and-forget — a write-back failure must never fail the task.
   */
  onUiaVerdict?: (token: string, verdict: import("./uia").UiaVerdict, probedAt: string) => void
  /**
   * WP3: L0 UIA locator. Participates in the locate chain ONLY when the
   * task-start admission verdict (entry value or fresh probe) is capable;
   * absent dep = L0 skipped with the structured reason (unit tests).
   */
  uiaLocator?: UiaLocator
  /**
   * WP3 (<5% small-popup channel): WindowOpened subscription factory.
   * Started once per task for UIA-CAPABLE targets only; events drained
   * after every injection feed the task-induced-dialog invariant. Absent
   * dep or a factory throw = no watcher (honest residual: pixel channels
   * only). Disposed on every task exit.
   */
  uiaWatcherFactory?: UiaWatcherFactory
}

export interface ComputerStepResult {
  seq: number
  action: string
  ok: boolean
  layer?: string
  confidence?: number
  x?: number
  y?: number
  /** WP1: pixel-region stability cross-check, NOT semantic OCR↔UIA (R4). */
  crossverified?: boolean
  /** Which channel verified: "pixel-region" (WP1) / "uia+ocr" (WP3 L0 witness). Absent when not verified. */
  crossverifyChannel?: string
  /** WP3 (§B.1): per-layer locate attempts with structured degradation reasons. */
  locateAttempts?: LocateAttempt[]
  note?: string
  /** describe output — UNTRUSTED screen content, never an instruction. */
  untrustedText?: string
}

export interface ComputerTaskResult {
  success: boolean
  taskId: string
  evidenceDir: string
  completedActions: number
  totalActions: number
  steps: ComputerStepResult[]
  error?: string
  errorCode?: string
}

function validateDraft(params: ComputerTaskParams): ComputerError | null {
  if (!params || typeof params.task !== "string" || params.task.trim() === "") {
    return new ComputerError("INVALID_ACTION", "computer: task must be a non-empty string")
  }
  if (!Array.isArray(params.actions) || params.actions.length === 0) {
    return new ComputerError("INVALID_ACTION", "computer: actions must be a non-empty draft sequence")
  }
  for (const a of params.actions) {
    if (!a || typeof a !== "object") return new ComputerError("INVALID_ACTION", "computer: malformed action")
    const kind = (a as any).action
    if (INJECTIVE_ACTIONS.has(kind)) {
      if (kind === "type") {
        if (typeof (a as any).text !== "string" || (a as any).text.length === 0) {
          return new ComputerError("INVALID_ACTION", "computer: type action requires non-empty text")
        }
        // X4 layer 2 (schema is layer 1, ps1 layer 3): bound the foreground
        // hijack window — per-text cap.
        if ((a as any).text.length > MAX_TYPE_TEXT_CHARS) {
          return new ComputerError(
            "TYPE_TEXT_TOO_LONG",
            `computer: type text is ${(a as any).text.length} chars — exceeds the ${MAX_TYPE_TEXT_CHARS}-char cap (X4)`,
          )
        }
      } else if (kind === "key") {
        // WP2: named-key whitelist chords only — arbitrary VK / printable text
        // via key is rejected (text entry is the type primitive, A3 corpus).
        const keys = (a as any).keys
        if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_KEY_CHORD) {
          return new ComputerError("INVALID_ACTION", `computer: key requires 1..${MAX_KEY_CHORD} key names`)
        }
        for (const k of keys) {
          if (typeof k !== "string" || !ALLOWED_KEY_SET.has(k.toLowerCase())) {
            return new ComputerError("INVALID_ACTION", `computer: key name "${String(k)}" is not in the whitelist (plan §D.3)`)
          }
        }
      } else if (kind === "scroll") {
        if (!Number.isInteger((a as any).x) || !Number.isInteger((a as any).y)) {
          return new ComputerError("INVALID_ACTION", "computer: scroll requires integer x/y")
        }
        const d = (a as any).delta
        if (!Number.isInteger(d) || d === 0 || Math.abs(d) > MAX_SCROLL_DELTA) {
          return new ComputerError("INVALID_ACTION", `computer: scroll delta must be a non-zero integer within ±${MAX_SCROLL_DELTA}`)
        }
      } else if (kind === "drag") {
        for (const f of ["x", "y", "x2", "y2"]) {
          if (!Number.isInteger((a as any)[f])) {
            return new ComputerError("INVALID_ACTION", `computer: drag requires integer ${f}`)
          }
        }
      } else {
        // click family: explicit x/y or an OCR target anchor
        const hasCoords = Number.isInteger((a as any).x) && Number.isInteger((a as any).y)
        const hasTarget = typeof (a as any).target === "string" && (a as any).target.length > 0
        if (!hasCoords && !hasTarget) {
          return new ComputerError("INVALID_ACTION", `computer: ${kind} requires explicit x/y or a target text anchor`)
        }
      }
    } else if (kind === "wait") {
      if (!Number.isInteger((a as any).ms) || (a as any).ms < 0) {
        return new ComputerError("INVALID_ACTION", "computer: wait requires integer ms >= 0")
      }
    } else if (kind !== "screenshot" && kind !== "describe") {
      return new ComputerError("INVALID_ACTION", `computer: unsupported action "${kind}"`)
    }
  }
  // X4: corpus TOTAL cap — task-splitting must not multiply the injection window.
  const corpusChars = params.actions.reduce(
    (n, a) => n + ((a as any)?.action === "type" && typeof (a as any).text === "string" ? (a as any).text.length : 0),
    0,
  )
  if (corpusChars > MAX_TYPE_TEXT_CHARS) {
    return new ComputerError(
      "TYPE_TEXT_TOO_LONG",
      `computer: task type corpus totals ${corpusChars} chars — exceeds the ${MAX_TYPE_TEXT_CHARS}-char cap (X4)`,
    )
  }
  return null
}

/**
 * Adversary WP2 X1: map an abortCheck channel to its typed error. A
 * user-initiated stop (hotkey flag / panel abort) is TASK_ABORTED; an
 * "estop-lost" — the helper's heartbeat died MID-task — is the distinct
 * EMERGENCY_STOP_LOST: the kill switch itself failed, so the refusal must be
 * distinguishable from a deliberate user stop in audit + evidence.
 */
function abortChannelError(channel: string, message: string): ComputerError {
  return new ComputerError(channel === "estop-lost" ? "EMERGENCY_STOP_LOST" : "TASK_ABORTED", message)
}

export async function runComputerTask(
  params: ComputerTaskParams,
  deps: ComputerExecutorDeps,
): Promise<ComputerTaskResult> {
  const now = deps.now ?? (() => Date.now())
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const log = deps.log ?? (() => {})
  // WP2: the server passes its registry task id so the panel abort channel
  // can target THIS run; standalone callers get a fresh id.
  const taskId = params.taskId ?? randomUUID()
  // WP2 (§E.4): fire-and-forget panel events — a listener failure never
  // reaches the task.
  const emit = (ev: ComputerTaskEvent) => {
    try {
      deps.onEvent?.(ev)
    } catch {
      /* best-effort */
    }
  }
  const steps: ComputerStepResult[] = []
  let evidence: EvidenceSink | null = null
  // WP3: WindowOpened watcher (UIA-capable targets only) — disposed on
  // EVERY exit (fail() and the success tail).
  let uiaWatcher: UiaWatcher | null = null

  // R1 — plaintext raw capture tracking. captureWindow writes UNENCRYPTED
  // window bitmaps under %TEMP%; only frames that reach the sealer are
  // consumed there. Every other frame must be deleted by us: superseded
  // locate frames immediately, everything else at the exit sweep.
  const removeRaw =
    deps.removeFile ??
    (async (p: string) => {
      try {
        await fs.promises.rm(p, { force: true })
      } catch {
        /* best-effort */
      }
    })
  const pendingRaws = new Set<string>()
  const trackCapture = async (h: number): Promise<CaptureMeta> => {
    const meta = await deps.capturer.captureWindow(h)
    if (meta.path) pendingRaws.add(meta.path)
    return meta
  }
  /** Sealer consumed the bytes — stop tracking (no removeFile call). */
  const sealConsumed = (p: string | undefined) => {
    if (p) pendingRaws.delete(p)
  }
  /** Abandoned frame — stop tracking AND delete the plaintext bytes. */
  const releaseRaw = async (p: string | undefined) => {
    if (p && pendingRaws.delete(p)) await removeRaw(p)
  }
  const sweepRaws = async () => {
    for (const p of [...pendingRaws]) {
      pendingRaws.delete(p)
      await removeRaw(p)
    }
  }

  const fail = async (err: ComputerError): Promise<ComputerTaskResult> => {
    log("computer.task.failed", { taskId, code: err.code, error: err.message })
    try {
      uiaWatcher?.dispose()
      uiaWatcher = null
    } catch {
      /* best-effort */
    }
    emit({
      event: "finished",
      taskId,
      ok: false,
      completed: steps.filter((s) => s.ok).length,
      total: params.actions?.length ?? 0,
      errorCode: err.code,
    })
    await sweepRaws() // R1: no plaintext capture survives ANY exit
    if (evidence) {
      try {
        await evidence.finalize({ ok: false, code: err.code, error: err.message })
      } catch {
        /* best-effort */
      }
    }
    return {
      success: false,
      taskId,
      evidenceDir: evidence?.dir ?? "",
      completedActions: steps.filter((s) => s.ok).length,
      totalActions: params.actions?.length ?? 0,
      steps,
      error: err.message,
      errorCode: err.code,
    }
  }

  const draftErr = validateDraft(params)
  if (draftErr) return fail(draftErr)

  // A10 + §E.2 gate (executor-side belt; the server gate already checked).
  let entry
  try {
    entry = assertCoordinateAllowed(deps.config, params.app)
    // WP2: exe sha256 drift vs the add-time record (§E.2.1) — computed once,
    // fail-closed; the per-action path + vault/LOLBIN rechecks stay fresh.
    const hashFile =
      deps.hashFile ?? ((p: string) => createHash("sha256").update(fs.readFileSync(p)).digest("hex"))
    assertExeNotDrifted(entry, hashFile)
  } catch (err) {
    return fail(err as ComputerError)
  }

  // A3 — the L2-confirmed corpus (the gate enumerated these verbatim; the
  // security token binds app+task+corpus hash). Rebuild the set here and
  // hard-reject any type text that is not in it.
  const corpus = new Set(corpusOf(params.actions))
  const corpusHash = corpusHashOf([...corpus])

  // Resolve the target window (largest visible window of the whitelisted exe).
  let hwnd = 0
  let targetPid = 0
  try {
    const wins = await deps.windows.enumerateByExe(entry.exe!.path)
    if (wins.length === 0) {
      throw new ComputerError("APP_WINDOW_NOT_FOUND", `computer: no visible window for "${entry.display_name}" — is it running?`)
    }
    wins.sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)
    hwnd = wins[0].hwnd
    targetPid = wins[0].pid
    assertHwndOwnedByEntry(wins[0], entry)
  } catch (err) {
    return fail(err instanceof ComputerError ? err : new ComputerError("APP_WINDOW_NOT_FOUND", String((err as Error)?.message ?? err)))
  }

  // WP3 (§K.5): task-start lazy UIA admission probe. Timing decision: probe
  // HERE (hwnd resolved, the app is confirmed running) — not at app-add time
  // (app may not be running; the panel add-flow must stay fast) and not in
  // the launch path (host_computer never starts apps). A probe FAILURE is an
  // honest "unknown": the task treats the app as UIA-incapable (OCR layer
  // order) and NOTHING is written back (unknown is not a verdict).
  // Hand-set entries (uiaCapable present, uiaProbedAt absent — enforced by
  // applyUiaProbedVerdict) and previously probed entries skip this entirely.
  let uiaCapable = entry.uiaCapable === true
  let uiaFreshProbe = false
  if (entry.uiaCapable === undefined && deps.uiaProber) {
    try {
      const verdict = await deps.uiaProber.probe(hwnd)
      uiaCapable = verdict.uiaCapable
      uiaFreshProbe = true
      const probedAt = new Date(now()).toISOString()
      log("computer.uia.probed", {
        taskId,
        app: entry.token,
        uiaCapable: verdict.uiaCapable,
        confidence: verdict.confidence,
        nodes: verdict.stats.nodes,
        maxDepth: verdict.stats.maxDepth,
        edits: verdict.stats.edits,
        documents: verdict.stats.documents,
        interactive: verdict.stats.interactive,
        named: verdict.stats.named,
        namedOnscreen: verdict.stats.namedOnscreen,
        hydrationRechecked: verdict.stats.hydrationRechecked,
        ms: verdict.stats.durationMs,
      })
      try {
        deps.onUiaVerdict?.(entry.token, verdict, probedAt)
      } catch {
        /* best-effort — a write-back failure never fails the task */
      }
    } catch (err) {
      log("computer.uia.probe_failed", { taskId, app: entry.token, error: String((err as Error)?.message ?? err) })
      uiaCapable = false
    }
  }

  // WP3 (<5% small-popup channel): WindowOpened subscription for UIA-CAPABLE
  // targets — it catches task-induced dialogs that the pixel/foreground/
  // top-level-hwnd channels miss (small owned/child popups under the diff
  // thresholds that never take foreground). RESIDUAL, documented: for
  // UIA-BLIND apps this channel does not exist — detection stays on the
  // pixel channels and a small in-window popup under the diff/zone/blob
  // thresholds remains the known <5% blind spot. A factory failure degrades
  // honestly to "no watcher"; it never fails the task.
  if (uiaCapable && deps.uiaWatcherFactory) {
    try {
      uiaWatcher = deps.uiaWatcherFactory({ hwnd, pid: targetPid })
      log("computer.uia.watch_started", { taskId, pid: targetPid })
    } catch (err) {
      uiaWatcher = null
      log("computer.uia.watch_failed", { taskId, error: String((err as Error)?.message ?? err) })
    }
  }

  // Y6 (WP3): L1 availability probe for the locate chain — the former
  // "dead" Locator.ensureLanguage interface now has its caller. Cached per
  // task (the pack cannot appear/disappear mid-task); a missing pack marks
  // L1 skipped (honest reason "ocr-language-missing") instead of throwing
  // at first use. NOTE: the danger scan still OCRs the current frame on
  // every injection (Y1) and fails honestly without the pack — UIA provides
  // no danger-scan bypass in WP3.
  let ocrAvailableCached: boolean | null = null
  const ocrAvailable = async (): Promise<boolean> => {
    if (ocrAvailableCached !== null) return ocrAvailableCached
    try {
      await deps.locator.ensureLanguage()
      ocrAvailableCached = true
    } catch (err) {
      ocrAvailableCached = false
      log("computer.ocr.unavailable", { taskId, error: String((err as Error)?.message ?? err) })
    }
    return ocrAvailableCached
  }

  let budget = Math.min(Math.max(1, params.budget ?? deps.config.computer?.budget ?? DEFAULT_TASK_BUDGET), MAX_TASK_BUDGET)
  let uncrossLeft = UNCROSS_VERIFIED_SUB_BUDGET

  evidence = deps.evidenceFactory(taskId)
  await evidence.init({
    taskId,
    app: entry.token,
    displayName: entry.display_name,
    hwnd,
    corpusHash,
    budget,
    // WP2: hwnd binding evidence — the entry carried an add-time exe hash
    // and it verified (assertExeNotDrifted passed by the time we are here).
    exeSha256Verified: entry.exe?.sha256 ? true : false,
    // WP3 (§K.5): UIA admission verdict effective for THIS task and its
    // provenance ("entry" = preset/hand-set, "probe" = fresh lazy probe,
    // "unknown" = probe unavailable/failed — nothing was written back).
    uiaCapable,
    uiaVerdictSource: entry.uiaCapable !== undefined ? "entry" : uiaFreshProbe ? "probe" : "unknown",
    startedAt: new Date(now()).toISOString(),
  })
  log("computer.task.started", { taskId, app: entry.token, hwnd, budget })
  emit({ event: "started", taskId, app: entry.display_name, task: params.task, total: params.actions.length })

  /** Short human label for the panel live view (never the type text itself). */
  const captionOf = (a: ComputerAction): string => {
    switch (a.action) {
      case "click":
      case "double_click":
      case "right_click": {
        const verb = a.action === "click" ? "点击" : a.action === "double_click" ? "双击" : "右键点击"
        return (a as any).target ? `${verb}「${(a as any).target}」` : `${verb} (${(a as any).x}, ${(a as any).y})`
      }
      case "type":
        return `输入文本（${(a as any).text.length} 字符）`
      case "key":
        return `按键 ${((a as any).keys as string[]).join("+")}`
      case "scroll":
        return `滚动 (${(a as any).x}, ${(a as any).y}) delta=${(a as any).delta}`
      case "drag":
        return `拖拽 (${(a as any).x}, ${(a as any).y}) → (${(a as any).x2}, ${(a as any).y2})`
      default:
        return a.action
    }
  }

  /** Re-L2 with an explicit reason; returns true when approved. */
  const reL2 = async (reason: string, dangerous: string[], seqNum?: number): Promise<boolean> => {
    log("computer.task.reconfirm", { taskId, reason })
    emit({ event: "paused", taskId, ...(seqNum !== undefined ? { seq: seqNum } : {}), reason })
    const decision = await deps.confirm({
      toolName: "host_computer",
      dangerousApis: dangerous,
      criticalApis: ["computer.coordinate_injection"],
      code: `任务「${params.task}」需要再次确认：\n${reason}`,
      riskLevel: "high",
      autoConfirmEligible: false,
    })
    return decision.approved === true
  }

  let seq = 0
  for (const action of params.actions) {
    seq += 1
    const startedAt = now()

    // WP2 (§E.6): emergency stop — polled before EVERY action of any kind.
    const abortedAtTop = deps.abortCheck?.() ?? null
    if (abortedAtTop) {
      log("computer.task.aborted", { taskId, seq, channel: abortedAtTop })
      return fail(abortChannelError(abortedAtTop, `computer: task aborted by emergency stop (${abortedAtTop})`))
    }

    // ---- non-injective actions -------------------------------------------------
    if (action.action === "wait") {
      // Chunked sleep — the abort channel is polled during long waits too.
      let remaining = Math.min(action.ms, MAX_WAIT_MS)
      while (remaining > 0) {
        const chunk = Math.min(remaining, 50)
        await sleep(chunk)
        remaining -= chunk
        const abortedMidWait = deps.abortCheck?.() ?? null
        if (abortedMidWait) {
          log("computer.task.aborted", { taskId, seq, channel: abortedMidWait, during: "wait" })
          return fail(abortChannelError(abortedMidWait, `computer: task aborted by emergency stop (${abortedMidWait}) during wait`))
        }
      }
      steps.push({ seq, action: "wait", ok: true })
      await evidence.appendAction({ seq, action: "wait", crossverified: true, uncrossverified: false, durationMs: now() - startedAt })
      emit({ event: "step", taskId, seq, action: "wait", budgetLeft: budget, caption: `等待 ${Math.min(action.ms, MAX_WAIT_MS)}ms` })
      continue
    }
    if (action.action === "screenshot" || action.action === "describe") {
      try {
        const shot = await trackCapture(hwnd)
        // R2: read-only frames go through the same credential-neighborhood
        // scan as injection frames — the evidence chain must never persist an
        // unblurred credential region, regardless of action kind. OCR runs
        // for BOTH actions (screenshot too); a missing language pack fails
        // closed, same as the injection paths.
        const ocrRes = await deps.locator.ocr(shot.path)
        const wholeImg: RectPx = { x: 0, y: 0, width: shot.rect.width, height: shot.rect.height }
        const blur = scanDanger(ocrRes.words, wholeImg, REGION_CROP_SIZE).credentialRects
        let untrustedText: string | undefined
        if (action.action === "describe") {
          untrustedText = ocrRes.words.map((w) => w.text).join(" ")
        }
        // WP2 (§E.4): panel preview with the SAME credential blackout as the
        // evidence seal — built before sealing (the sealer deletes the raw).
        let previewImage: string | undefined
        if (deps.previewBuilder) {
          try {
            previewImage = (await deps.previewBuilder.build(shot.path, undefined, blur)) ?? undefined
          } catch {
            /* degrade to no image */
          }
        }
        await evidence.sealScreenshot(shot.path, seq, "before", blur)
        sealConsumed(shot.path)
        steps.push({ seq, action: action.action, ok: true, ...(untrustedText !== undefined ? { untrustedText } : {}) })
        await evidence.appendAction({ seq, action: action.action, crossverified: true, uncrossverified: false, durationMs: now() - startedAt })
        emit({
          event: "step",
          taskId,
          seq,
          action: action.action,
          budgetLeft: budget,
          caption: action.action === "screenshot" ? "截图" : "读取屏幕内容",
          ...(previewImage ? { previewImage } : {}),
        })
      } catch (err) {
        return fail(err instanceof ComputerError ? err : new ComputerError("CAPTURE_FAILED", String((err as Error)?.message ?? err)))
      }
      continue
    }

    // ---- injective actions (click family / type) -------------------------------
    try {
      // Per-action revalidation (§E.2.4/B5): hwnd still owned by the whitelisted exe.
      const info = await deps.windows.infoForHwnd(hwnd)
      assertHwndOwnedByEntry(info, entry)

      // WP2 (§T5-8): IL + input desktop re-probe — the app may have been
      // relaunched elevated (hwnd ownership still matches, but SendInput
      // would cross UIPI) or the session switched to a secure desktop
      // between actions. Fail-closed before ANY further work this action.
      await deps.securityEnv.assertInjectable(hwnd)

      // Budget: exhausted -> mandatory new L2 (default 15 per task).
      if (budget <= 0) {
        const ok = await reL2(`动作预算已耗尽（默认 ${DEFAULT_TASK_BUDGET}）。批准以续作，拒绝以终止任务。`, ["computer.budget_exhausted"], seq)
        if (!ok) throw new ComputerError("BUDGET_DENIED", "computer: action budget exhausted and renewal was denied")
        // Y6 (WP3): renewal uses the SAME formula as the task-start budget
        // (params → config.computer.budget → default, clamped) — previously
        // it ignored the config-level default.
        budget = Math.min(Math.max(1, params.budget ?? deps.config.computer?.budget ?? DEFAULT_TASK_BUDGET), MAX_TASK_BUDGET)
      }

      // A3 — corpus membership for type actions (defense in depth; the token
      // binding at the gate is the primary enforcement).
      if (action.action === "type" && !corpus.has(action.text)) {
        throw new ComputerError(
          "TYPE_TEXT_NOT_CONFIRMED",
          "computer: type text is not in the L2-confirmed corpus — requires a new task confirmation",
        )
      }

      // Locate + base capture.
      let shot: CaptureMeta = await trackCapture(hwnd)
      let shotAt = now() // X3: age of the CURRENT shot frame (updated on every reassignment)
      // X3: set ONLY by mid-action re-L2 approvals (danger / uncross sub-budget)
      // — a human decision necessarily stales the frame. The budget re-L2 runs
      // before capture and the dialog re-L2 after injection; neither sets this.
      let reL2ApprovedMidAction = false
      let ocrRes: OcrResult | null = null
      let hit: LocateHit | null = null
      let pointClient: { x: number; y: number } | null = null
      let crossverified = false
      let uncrossverified = false
      let crossverifyChannel: "pixel-region" | "uia+ocr" | undefined
      // WP3 (§B.1): per-layer degradation log — sealed into the evidence
      // chain for this action (and the computeruse.locate audit lines).
      let locateAttempts: LocateAttempt[] | undefined

      if ((action.action === "click" || action.action === "double_click" || action.action === "right_click") && action.target) {
        // WP3: four-layer locate chain (locate-chain.ts owns the semantics).
        // L0 participates only when the task-start admission verdict said
        // UIA-capable AND a locator is wired; otherwise the chain degrades
        // L0 -> L1 with a structured reason. The A1 pixel-region recapture
        // runs inside the chain for BOTH layers; the WP1 honest semantics
        // (R4 pixel-stability cross-check, uncrossverified on re-locate,
        // STALE_SCREENSHOT on failure) are preserved verbatim on the L1 path.
        const chain = await locateTargetWithChain({
          target: action.target,
          hwnd,
          shot,
          deps: {
            uia: uiaCapable ? deps.uiaLocator ?? null : null,
            locator: deps.locator,
            capturer: deps.capturer,
            ocrAvailable,
            log: (event, data) => log(event, { taskId, seq, ...data }),
          },
          trackCapture,
          releaseRaw,
        })
        hit = chain.hit
        ocrRes = chain.ocrRes
        shot = chain.shot
        shotAt = now()
        pointClient = chain.pointClient
        crossverified = chain.crossverified
        crossverifyChannel = chain.crossverifyChannel
        uncrossverified = chain.uncrossverified
        locateAttempts = chain.attempts
      } else if (action.action === "scroll" || action.action === "drag") {
        pointClient = { x: action.x, y: action.y }
        // WP2: no anchor exists for explicit scroll/drag coordinates — same
        // honest bookkeeping as explicit-coordinate clicks (A1.3 sub-budget).
        uncrossverified = true
      } else if (action.action === "key") {
        // WP2: a key chord has no coordinates — nothing to cross-check; it
        // consumes the same uncrossverified sub-budget (A1.3 conservative).
        uncrossverified = true
      } else if (action.action !== "type") {
        pointClient = { x: action.x!, y: action.y! }
        // Explicit-coordinate (icon-type) click: no cross-check exists.
        uncrossverified = true
      }

      // A1.3 — uncrossverified clicks consume the <=3 sub-budget, then a
      // mandatory new L2.
      if (uncrossverified) {
        uncrossLeft -= 1
        if (uncrossLeft < 0) {
          const ok = await reL2(
            `本任务无法交叉验证的点击已超过 ${UNCROSS_VERIFIED_SUB_BUDGET} 次上限。批准以继续，拒绝以终止任务。`,
            ["computer.uncrossverified_exceeded"],
            seq,
          )
          if (!ok) throw new ComputerError("UNCROSS_DENIED", "computer: uncrossverified click sub-budget exceeded and renewal was denied")
          uncrossLeft = UNCROSS_VERIFIED_SUB_BUDGET
          reL2ApprovedMidAction = true // X3: approved coordinates are now stale
        }
      }

      // Bounds (reject, never clamp — §D.3).
      if (pointClient) {
        const cw = shot.client.width
        const ch = shot.client.height
        if (pointClient.x < 0 || pointClient.y < 0 || pointClient.x >= cw || pointClient.y >= ch) {
          throw new ComputerError("OUT_OF_BOUNDS", `computer: (${pointClient.x},${pointClient.y}) outside client rect ${cw}x${ch}`)
        }
        // WP2: the drag ENDPOINT is bounds-checked the same way.
        if (action.action === "drag") {
          if (action.x2 < 0 || action.y2 < 0 || action.x2 >= cw || action.y2 >= ch) {
            throw new ComputerError("OUT_OF_BOUNDS", `computer: drag endpoint (${action.x2},${action.y2}) outside client rect ${cw}x${ch}`)
          }
        }
      }

      // Danger scan (A2 dual-channel; A4 no-path deny).
      // Y1 (WP2): ALWAYS OCR the CURRENT pre-injection frame for the danger
      // verdict — the locate OCR (when it exists) describes the older LOCATE
      // frame, and only the 200×200 region is pixel-cross-checked; a
      // credential field or payment button appearing OUTSIDE that region
      // between locate and inject is invisible unless the whole frame is
      // re-read. The locate OCR still owns the coordinates; this fresh OCR
      // owns the danger verdict.
      const scanOcr = await deps.locator.ocr(shot.path)
      const regionImg: RectPx = pointClient
        ? {
            x: Math.max(0, pointClient.x + shot.client.x - REGION_CROP_SIZE / 2),
            y: Math.max(0, pointClient.y + shot.client.y - REGION_CROP_SIZE / 2),
            width: REGION_CROP_SIZE,
            height: REGION_CROP_SIZE,
          }
        : { x: 0, y: 0, width: shot.rect.width, height: shot.rect.height } // type: whole window
      // X3: `let` — the post-approval refresh re-scans on the refreshed frame
      // and replaces this (the sealed blur must match the frame actually sealed).
      let scan: DangerScan = scanDanger(scanOcr.words, regionImg, REGION_CROP_SIZE)

      if ((action.action === "type" || action.action === "key") && scan.credentialRects.length > 0) {
        // A4.3: credential context for a type action — no-path deny (the OSR
        // fallback for the UIA IsPassword check). WP2: key chords (enter/tab
        // SUBMIT forms) are denied in credential context on the same grounds.
        throw new ComputerError(
          "DANGER_HARD_DENY",
          `computer: credential context detected in the target window — ${action.action} is hard-denied (no re-confirm path)`,
          { hits: scan.windowHits },
        )
      }
      if (scan.regionLevel === "hard" && action.action !== "type" && action.action !== "key") {
        // A4 no-path deny — scoped to the final-confirm CLICK (review R5).
        // For a type/key action the "region" IS the whole window (above), so a
        // region-hard verdict there is really window-level financial context
        // and keeps a path: it falls through to the re-L2 branch below.
        throw new ComputerError(
          "DANGER_HARD_DENY",
          `computer: click target matches a payment/transfer/captcha final-confirm (${scan.regionHits.join(", ")}) — hard-denied, no re-confirm path (A4)`,
          { hits: scan.regionHits },
        )
      }
      if (scan.regionLevel === "caution" || scan.windowLevel === "hard") {
        const hits = scan.regionLevel === "caution" ? scan.regionHits : scan.windowHits
        const ok = await reL2(
          `检测到高风险内容（${hits.join(", ")}）。目标区域或窗口涉及敏感操作，确认后继续。`,
          ["computer.danger_detected"],
          seq,
        )
        if (!ok) throw new ComputerError("DANGER_DENIED_BY_USER", "computer: dangerous action denied at re-confirm")
        reL2ApprovedMidAction = true // X3: approved frame/coords are now stale
      }

      // X3 — post-approval freshness refresh. A mid-action re-L2 approval
      // means a human just spent SECONDS deciding while the screen kept
      // changing; injecting the pre-approval coordinates would be the exact
      // pixel-TOCTOU A1 forbids. PIXEL_STALE_MS is wired HERE (the approval
      // path necessarily exceeds it): re-capture and re-run the R4 chain.
      //   target click: F1 force re-locate (gone -> STALE_SCREENSHOT), then
      //     F2 + region diff re-decides crossverified/uncrossverified
      //   explicit-coords / type: no anchor exists — only the frame is
      //     replaced so the sealed "before" is the frame we actually act on
      // Every superseded frame is releaseRaw'd (R1). After the refresh the
      // danger scan re-runs on the new OCR — but only UPGRADES are
      // actionable: the user JUST approved this same level (re-asking would
      // be a prompt loop), while a NEW hard verdict fails closed.
      if (reL2ApprovedMidAction && now() - shotAt > PIXEL_STALE_MS) {
        const staleFrame = shot
        if ((action.action === "click" || action.action === "double_click" || action.action === "right_click") && action.target) {
          // WP3: re-run the FULL locate chain on a fresh base frame (L0 UIA
          // re-probe when admitted, else the WP1 OCR re-locate — the old
          // F1/F2 dance is the chain's internal recapture). staleOnNotFound:
          // a target that vanished while the human decided is STALE, never
          // an excuse to inject elsewhere.
          const refresh = await locateTargetWithChain({
            target: action.target,
            hwnd,
            shot: await trackCapture(hwnd),
            deps: {
              uia: uiaCapable ? deps.uiaLocator ?? null : null,
              locator: deps.locator,
              capturer: deps.capturer,
              ocrAvailable,
              log: (event, data) => log(event, { taskId, seq, refresh: true, ...data }),
            },
            trackCapture,
            releaseRaw,
            staleOnNotFound: true,
          })
          hit = refresh.hit
          // ocrRes is always set in this context (the pre-refresh danger
          // scan already OCR'd successfully); the fallback is belt-and-braces.
          ocrRes = refresh.ocrRes ?? (await deps.locator.ocr(refresh.shot.path))
          shot = refresh.shot
          pointClient = refresh.pointClient
          crossverified = refresh.crossverified
          crossverifyChannel = refresh.crossverifyChannel
          uncrossverified = refresh.uncrossverified
          locateAttempts = [
            ...(locateAttempts ?? []),
            ...refresh.attempts.map((a) => ({
              ...a,
              reason: a.reason ? `post-approval-refresh:${a.reason}` : "post-approval-refresh",
            })),
          ]
        } else {
          const f1 = await trackCapture(hwnd)
          ocrRes = await deps.locator.ocr(f1.path)
          shot = f1
        }
        await releaseRaw(staleFrame.path)
        shotAt = now()
        // Re-check bounds on the (possibly moved) point.
        if (pointClient) {
          const cw = shot.client.width
          const ch = shot.client.height
          if (pointClient.x < 0 || pointClient.y < 0 || pointClient.x >= cw || pointClient.y >= ch) {
            throw new ComputerError("OUT_OF_BOUNDS", `computer: (${pointClient.x},${pointClient.y}) outside client rect ${cw}x${ch} after post-approval refresh`)
          }
        }
        const refreshRegion: RectPx = pointClient
          ? {
              x: Math.max(0, pointClient.x + shot.client.x - REGION_CROP_SIZE / 2),
              y: Math.max(0, pointClient.y + shot.client.y - REGION_CROP_SIZE / 2),
              width: REGION_CROP_SIZE,
              height: REGION_CROP_SIZE,
            }
          : { x: 0, y: 0, width: shot.rect.width, height: shot.rect.height }
        scan = scanDanger(ocrRes!.words, refreshRegion, REGION_CROP_SIZE)
        if ((action.action === "type" || action.action === "key") && scan.credentialRects.length > 0) {
          throw new ComputerError(
            "DANGER_HARD_DENY",
            `computer: credential context appeared after the re-confirm approval — ${action.action} is hard-denied (no re-confirm path)`,
            { hits: scan.windowHits },
          )
        }
        if (scan.regionLevel === "hard" && action.action !== "type" && action.action !== "key") {
          throw new ComputerError(
            "DANGER_HARD_DENY",
            `computer: click target escalated to a payment/transfer/captcha final-confirm after the re-confirm approval (${scan.regionHits.join(", ")}) — hard-denied`,
            { hits: scan.regionHits },
          )
        }
      }

      // X1: snapshot the exe's top-level hwnds BEFORE injection — a new
      // top-level window afterwards is dialog evidence independent of pixels.
      const beforeWinHwnds = new Set(
        (await deps.windows.enumerateByExe(entry.exe!.path).catch(() => [])).map((w) => w.hwnd),
      )

      // WP2 (§E.6): final abort gate immediately BEFORE the irreversible
      // SendInput — a stop requested during locate/danger/re-L2 phases must
      // still prevent injection. The ps1 side additionally polls the stop
      // flag mid-type (-StopFile).
      const abortedPreInject = deps.abortCheck?.() ?? null
      if (abortedPreInject) {
        log("computer.task.aborted", { taskId, seq, channel: abortedPreInject, during: "pre-inject" })
        throw abortChannelError(abortedPreInject, `computer: task aborted by emergency stop (${abortedPreInject}) before injection`)
      }

      // Inject (ps1 re-checks IL/desktop/bounds; type re-checks foreground).
      if (action.action === "type") {
        await deps.injector.typeText(hwnd, action.text)
      } else if (action.action === "key") {
        await deps.injector.keyChord(hwnd, action.keys.map((k) => k.toLowerCase()))
      } else if (action.action === "scroll") {
        await deps.injector.scroll(hwnd, pointClient!.x, pointClient!.y, action.delta)
      } else if (action.action === "drag") {
        await deps.injector.drag(hwnd, pointClient!.x, pointClient!.y, action.x2, action.y2)
      } else {
        await deps.injector.click(hwnd, pointClient!.x, pointClient!.y, action.action)
      }
      budget -= 1
      // Y7: only a SUCCESSFUL dispatch consumes the session rate window.
      try {
        deps.onActionInjected?.()
      } catch {
        /* best-effort */
      }

      // A2.1 — task-induced dialog invariant (post-action): a new foreground
      // window OR a large whole-window change => pause + re-L2. Conservative
      // direction: false positives pause the task, never the reverse.
      // X1: a whole-window ratio quantitatively misses LOCAL popups (a 500x350
      // dialog in a 1054x736 window measures ~0.12 — far under 0.3), so the
      // detector is an OR over FOUR independent channels: foreground change,
      // new top-level window of the same exe, whole-window diff, and the two
      // zoned metrics (8x8 macro-zone coverage; largest 4-connected blob).
      // Absent zoned channels (old script, fakes) simply do not participate.
      // NOTE: the diff must run BEFORE any sealing — the sealer deletes raws.
      const afterShot = await trackCapture(hwnd)
      const fg = await deps.injector.foregroundHwnd()
      const { diffRatio, maxZoneRatio, maxBlobRatio } = await deps.capturer.diff(afterShot.path, shot.path)
      const afterWinHwnds = await deps.windows.enumerateByExe(entry.exe!.path).catch(() => [])
      const newTopLevel = afterWinHwnds.some((w) => !beforeWinHwnds.has(w.hwnd))
      // WP3 (<5% small-popup channel): drain the WindowOpened subscription —
      // a task-induced window (owned/child popup of the target pid) that the
      // pixel channels and the top-level-hwnd channel both missed. Draining
      // AFTER the injection means each event is attributed to the action that
      // caused it and consumed exactly once (an approved pause never
      // re-triggers on the next action).
      const uiaOpened = uiaWatcher?.drain() ?? []
      const dialogSuspected =
        (fg !== 0 && fg !== hwnd) ||
        newTopLevel ||
        uiaOpened.length > 0 ||
        diffRatio > DIALOG_DIFF_THRESHOLD ||
        (maxZoneRatio !== undefined && maxZoneRatio >= DIALOG_ZONE_THRESHOLD) ||
        (maxBlobRatio !== undefined && maxBlobRatio >= DIALOG_BLOB_THRESHOLD)

      // Seal both frames into the evidence chain (credential neighborhoods
      // pixelated BEFORE the bytes are encrypted; raws deleted by the sealer).
      const beforeSeal = await evidence.sealScreenshot(shot.path, seq, "before", scan.credentialRects)
      sealConsumed(shot.path)
      // X5: the AFTER frame needs its OWN credential scan — the action may
      // have surfaced a credential field that was not present in the before
      // frame (e.g. a password prompt the click triggered). Sealing it with
      // the before frame's blur rects would persist those credentials in
      // cleartext inside the evidence bundle. A7.4 fail-closed: if the after
      // OCR is unavailable the frame is DROPPED (raw swept, hash omitted,
      // note recorded) — an unblurred frame is never persisted.
      let afterSha256: string | undefined
      let afterNote: string | undefined
      let afterOcr: OcrResult | null = null
      let previewImage: string | undefined
      try {
        afterOcr = await deps.locator.ocr(afterShot.path)
      } catch {
        afterOcr = null // any OCR failure → fail-closed drop below
      }
      if (afterOcr === null) {
        await releaseRaw(afterShot.path)
        afterNote = "after frame dropped (OCR unavailable)"
      } else {
        // Seal failures (evidence integrity) propagate — they are NOT
        // misclassified as OCR-unavailable.
        const afterWhole: RectPx = { x: 0, y: 0, width: afterShot.rect.width, height: afterShot.rect.height }
        const afterBlur = scanDanger(afterOcr.words, afterWhole, REGION_CROP_SIZE).credentialRects
        // WP2 (§E.4): panel preview of the AFTER frame — same credential
        // blackout as the evidence seal, crosshair at the actuation point
        // (image coordinates). Built BEFORE sealing (the sealer deletes the
        // raw); when the after OCR was unavailable the frame is dropped, so
        // no unblurred preview can leak either. Best-effort: builder failure
        // degrades to "no image".
        if (deps.previewBuilder) {
          try {
            const imgPoint = pointClient
              ? { x: afterShot.client.x + pointClient.x, y: afterShot.client.y + pointClient.y }
              : undefined
            previewImage = (await deps.previewBuilder.build(afterShot.path, imgPoint, afterBlur)) ?? undefined
          } catch {
            /* degrade to no image */
          }
        }
        const afterSeal = await evidence.sealScreenshot(afterShot.path, seq, "after", afterBlur)
        sealConsumed(afterShot.path)
        afterSha256 = afterSeal.sha256
      }

      await evidence.appendAction({
        seq,
        action: action.action,
        x: pointClient?.x,
        y: pointClient?.y,
        layer: hit?.layer,
        confidence: hit?.confidence,
        crossverified,
        ...(crossverifyChannel ? { crossverifyChannel } : {}),
        uncrossverified,
        ...(locateAttempts ? { locateAttempts } : {}),
        dangerScan: {
          regionLevel: scan.regionLevel,
          windowLevel: scan.windowLevel,
          regionHits: scan.regionHits,
          windowHits: scan.windowHits,
        },
        beforeSha256: beforeSeal.sha256,
        ...(afterSha256 !== undefined ? { afterSha256 } : {}),
        ...(afterNote !== undefined ? { note: afterNote } : {}),
        durationMs: now() - startedAt,
      })
      steps.push({
        seq,
        action: action.action,
        ok: true,
        layer: hit?.layer,
        confidence: hit?.confidence,
        x: pointClient?.x,
        y: pointClient?.y,
        crossverified,
        ...(crossverifyChannel ? { crossverifyChannel } : {}),
        ...(locateAttempts ? { locateAttempts } : {}),
      })
      emit({
        event: "step",
        taskId,
        seq,
        action: action.action,
        ...(pointClient ? { x: pointClient.x, y: pointClient.y } : {}),
        budgetLeft: budget,
        caption: captionOf(action),
        ...(previewImage ? { previewImage } : {}),
      })

      if (dialogSuspected) {
        // WP2 (§E.2.4) — classify the foreground change: when the foreground
        // window now belongs to a DIFFERENT process than the whitelisted exe,
        // this is a FOREGROUND YIELD (借尸还魂 — a foreign window covered the
        // target), not a task-induced dialog. Same conservative pause + re-L2,
        // but the reason names the foreign process and the audit event
        // distinguishes the channels. Probe failure = treated as foreign
        // (fail-closed direction).
        let fgYielded = false
        let fgOwnerExe: string | null = null
        if (fg !== 0 && fg !== hwnd) {
          try {
            fgOwnerExe = (await deps.windows.infoForHwnd(fg)).exePath
          } catch {
            fgOwnerExe = null
          }
          fgYielded = fgOwnerExe === null || normalizeExePath(fgOwnerExe) !== normalizeExePath(entry.exe!.path)
        }
        log(fgYielded ? "computer.task.foreground_yielded" : "computer.task.dialog_suspected", {
          taskId,
          seq,
          fgChanged: fg !== hwnd,
          fgOwnerExe,
          newTopLevel,
          uiaWindowOpened: uiaOpened.length,
          // UI class only (e.g. "WindowsForms10.Window.8...") — never the
          // window title, which is user content (same privacy rule as the
          // watcher ps1, which omits Name from its event lines).
          uiaWindowClass: uiaOpened[0]?.className,
          diffRatio,
          maxZoneRatio,
          maxBlobRatio,
        })
        const fgName = fgOwnerExe ? fgOwnerExe.split(/[\\/]/).pop() : "unknown"
        const ok = await reL2(
          fgYielded
            ? `前台窗口被其他进程（${fgName}）接管——目标窗口已让位，继续注入可能落在非白名单窗口上。请检查屏幕后决定是否继续。`
            : "本任务的操作引发了新对话框或大面积界面变化（确认型对话框的按钮不会由 agent 点击）。请检查目标窗口后决定是否继续。",
          [fgYielded ? "computer.foreground_yielded" : "computer.task_induced_dialog"],
          seq,
        )
        if (!ok) {
          throw new ComputerError("DIALOG_PAUSED_DENIED", "computer: task paused on a suspected task-induced dialog; continuation denied")
        }
      }
    } catch (err) {
      return fail(err instanceof ComputerError ? err : new ComputerError("INJECT_FAILED", String((err as Error)?.message ?? err)))
    }
  }

  const result: ComputerTaskResult = {
    success: true,
    taskId,
    evidenceDir: evidence.dir,
    completedActions: steps.filter((s) => s.ok).length,
    totalActions: params.actions.length,
    steps,
  }
  await sweepRaws() // normally a no-op — every frame was sealed or released
  try {
    uiaWatcher?.dispose()
    uiaWatcher = null
  } catch {
    /* best-effort — the ps1 self-destructs at -MaxSeconds regardless */
  }
  await evidence.finalize({ ok: true, completed: result.completedActions, total: result.totalActions })
  log("computer.task.completed", { taskId, completed: result.completedActions, total: result.totalActions })
  emit({ event: "finished", taskId, ok: true, completed: result.completedActions, total: result.totalActions })
  return result
}
