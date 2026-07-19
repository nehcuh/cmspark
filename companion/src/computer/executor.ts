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
  type LocateHit,
  type Locator,
  type OcrResult,
  type RectPx,
  type ScreenCapturer,
  type SecurityEnvironment,
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
   * ("hotkey" = PS helper flag file, "panel" = WS abort) or null. Checked
   * before EVERY action, inside waits, and once more immediately before the
   * SendInput call — an abort mid-task fails TASK_ABORTED through the normal
   * zero-residue exit path.
   */
  abortCheck?: () => "hotkey" | "panel" | null
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
  /** Which channel verified: "pixel-region" (WP1). Absent when not verified. */
  crossverifyChannel?: string
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
  const steps: ComputerStepResult[] = []
  let evidence: EvidenceSink | null = null

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
  try {
    const wins = await deps.windows.enumerateByExe(entry.exe!.path)
    if (wins.length === 0) {
      throw new ComputerError("APP_WINDOW_NOT_FOUND", `computer: no visible window for "${entry.display_name}" — is it running?`)
    }
    wins.sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)
    hwnd = wins[0].hwnd
    assertHwndOwnedByEntry(wins[0], entry)
  } catch (err) {
    return fail(err instanceof ComputerError ? err : new ComputerError("APP_WINDOW_NOT_FOUND", String((err as Error)?.message ?? err)))
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
    startedAt: new Date(now()).toISOString(),
  })
  log("computer.task.started", { taskId, app: entry.token, hwnd, budget })

  /** Re-L2 with an explicit reason; returns true when approved. */
  const reL2 = async (reason: string, dangerous: string[]): Promise<boolean> => {
    log("computer.task.reconfirm", { taskId, reason })
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
      return fail(new ComputerError("TASK_ABORTED", `computer: task aborted by emergency stop (${abortedAtTop})`))
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
          return fail(new ComputerError("TASK_ABORTED", `computer: task aborted by emergency stop (${abortedMidWait}) during wait`))
        }
      }
      steps.push({ seq, action: "wait", ok: true })
      await evidence.appendAction({ seq, action: "wait", crossverified: true, uncrossverified: false, durationMs: now() - startedAt })
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
        await evidence.sealScreenshot(shot.path, seq, "before", blur)
        sealConsumed(shot.path)
        steps.push({ seq, action: action.action, ok: true, ...(untrustedText !== undefined ? { untrustedText } : {}) })
        await evidence.appendAction({ seq, action: action.action, crossverified: true, uncrossverified: false, durationMs: now() - startedAt })
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
        const ok = await reL2(`动作预算已耗尽（默认 ${DEFAULT_TASK_BUDGET}）。批准以续作，拒绝以终止任务。`, ["computer.budget_exhausted"])
        if (!ok) throw new ComputerError("BUDGET_DENIED", "computer: action budget exhausted and renewal was denied")
        budget = Math.min(params.budget ?? DEFAULT_TASK_BUDGET, MAX_TASK_BUDGET)
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
      let crossverifyChannel: "pixel-region" | undefined

      if ((action.action === "click" || action.action === "double_click" || action.action === "right_click") && action.target) {
        ocrRes = await deps.locator.ocr(shot.path)
        hit = deps.locator.locate(ocrRes, action.target)
        if (!hit) {
          throw new ComputerError("ELEMENT_NOT_FOUND", `computer: OCR anchor "${action.target}" not found in the target window`)
        }
        // OCR words are image-space; injection is client-space (capture meta).
        pointClient = { x: hit.x - shot.client.x, y: hit.y - shot.client.y }

        // A1.1 freshness + A1.2 cross-check, WP1 honest form (review R4):
        // ALWAYS recapture immediately before injection and diff the
        // ~200×200 target REGION between the locate frame and the pre-inject
        // frame — a channel independent of the OCR layer that produced the
        // coordinates. WP1 has no second SEMANTIC layer (UIA arrives in WP3),
        // so this is a pixel-STABILITY cross-check, recorded as such
        // (crossverifyChannel="pixel-region"), never claimed to be more.
        //   region stable   -> crossverified, inject the located coords
        //   region unstable -> re-locate on the fresh frame; the re-located
        //                      click is honestly uncrossverified (sub-budget)
        //   re-locate fails -> STALE_SCREENSHOT, never inject stale coords
        const locateRegion: RectPx = {
          x: Math.max(0, pointClient.x + shot.client.x - REGION_CROP_SIZE / 2),
          y: Math.max(0, pointClient.y + shot.client.y - REGION_CROP_SIZE / 2),
          width: REGION_CROP_SIZE,
          height: REGION_CROP_SIZE,
        }
        const locateFrame = shot
        const fresh = await trackCapture(hwnd)
        const { diffRatio } = await deps.capturer.diffRegion(fresh.path, locateFrame.path, locateRegion)
        if (diffRatio > PIXEL_DIFF_THRESHOLD) {
          const ocr2 = await deps.locator.ocr(fresh.path)
          const hit2 = deps.locator.locate(ocr2, action.target)
          if (!hit2) {
            throw new ComputerError("STALE_SCREENSHOT", "computer: target moved between locate and inject; re-locate failed — refusing to inject at stale coordinates")
          }
          shot = fresh
          shotAt = now()
          ocrRes = ocr2
          hit = hit2
          pointClient = { x: hit.x - shot.client.x, y: hit.y - shot.client.y }
          uncrossverified = true // pixel channel disagreed — honest bookkeeping (R4)
        } else {
          shot = fresh
          shotAt = now()
          crossverified = true
          crossverifyChannel = "pixel-region"
        }
        // The locate frame is superseded in BOTH branches — its raw would
        // otherwise linger in %TEMP% unsealed (review R1 leak path 1).
        await releaseRaw(locateFrame.path)
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

      // Danger scan (A2 dual-channel; A4 no-path deny). Needs OCR text — reuse
      // the locate OCR when present, otherwise OCR the fresh frame once.
      if (!ocrRes) ocrRes = await deps.locator.ocr(shot.path)
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
      let scan: DangerScan = scanDanger(ocrRes.words, regionImg, REGION_CROP_SIZE)

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
          const f1 = await trackCapture(hwnd)
          const ocrF1 = await deps.locator.ocr(f1.path)
          const hitF1 = deps.locator.locate(ocrF1, action.target)
          if (!hitF1) {
            await releaseRaw(f1.path)
            throw new ComputerError("STALE_SCREENSHOT", "computer: target moved after the re-confirm approval; re-locate failed — refusing to inject at pre-approval coordinates")
          }
          const ptF1 = { x: hitF1.x - f1.client.x, y: hitF1.y - f1.client.y }
          const regionF1: RectPx = {
            x: Math.max(0, hitF1.x - REGION_CROP_SIZE / 2),
            y: Math.max(0, hitF1.y - REGION_CROP_SIZE / 2),
            width: REGION_CROP_SIZE,
            height: REGION_CROP_SIZE,
          }
          const f2 = await trackCapture(hwnd)
          const { diffRatio: refreshDiff } = await deps.capturer.diffRegion(f2.path, f1.path, regionF1)
          if (refreshDiff > PIXEL_DIFF_THRESHOLD) {
            const ocrF2 = await deps.locator.ocr(f2.path)
            const hitF2 = deps.locator.locate(ocrF2, action.target)
            if (!hitF2) {
              await releaseRaw(f1.path)
              await releaseRaw(f2.path)
              throw new ComputerError("STALE_SCREENSHOT", "computer: target unstable after the re-confirm approval; re-locate failed — refusing to inject")
            }
            shot = f2
            ocrRes = ocrF2
            hit = hitF2
            pointClient = { x: hitF2.x - f2.client.x, y: hitF2.y - f2.client.y }
            crossverified = false
            crossverifyChannel = undefined
            uncrossverified = true // pixel channel disagreed post-approval (R4)
            await releaseRaw(f1.path)
          } else {
            shot = f2
            ocrRes = ocrF1
            hit = hitF1
            pointClient = ptF1
            crossverified = true
            crossverifyChannel = "pixel-region"
            uncrossverified = false
            await releaseRaw(f1.path)
          }
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
        throw new ComputerError("TASK_ABORTED", `computer: task aborted by emergency stop (${abortedPreInject}) before injection`)
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
      const dialogSuspected =
        (fg !== 0 && fg !== hwnd) ||
        newTopLevel ||
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
  await evidence.finalize({ ok: true, completed: result.completedActions, total: result.totalActions })
  log("computer.task.completed", { taskId, completed: result.completedActions, total: result.totalActions })
  return result
}
