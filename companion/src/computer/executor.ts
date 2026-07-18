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

import { randomUUID } from "crypto"
import * as fs from "fs"
import type { CompanionConfig } from "../config"
import type { SecurityConfirmationDecision, SecurityConfirmationDetails } from "../security-confirmation"
import { scanDanger, type DangerScan } from "./danger"
import type { EvidenceFactory, EvidenceSink } from "./evidence"
import { assertCoordinateAllowed, assertHwndOwnedByEntry } from "./policy"
import {
  ComputerError,
  corpusHashOf,
  corpusOf,
  DIALOG_DIFF_THRESHOLD,
  DEFAULT_TASK_BUDGET,
  INJECTIVE_ACTIONS,
  MAX_TASK_BUDGET,
  MAX_WAIT_MS,
  PIXEL_DIFF_THRESHOLD,
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
      } else {
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
      return new ComputerError("INVALID_ACTION", `computer: unsupported action "${kind}" in WP1`)
    }
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
  const taskId = randomUUID()
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

    // ---- non-injective actions -------------------------------------------------
    if (action.action === "wait") {
      await sleep(Math.min(action.ms, MAX_WAIT_MS))
      steps.push({ seq, action: "wait", ok: true })
      await evidence.appendAction({ seq, action: "wait", crossverified: true, uncrossverified: false, durationMs: now() - startedAt })
      continue
    }
    if (action.action === "screenshot" || action.action === "describe") {
      try {
        const shot = await trackCapture(hwnd)
        const blur: RectPx[] = []
        let untrustedText: string | undefined
        if (action.action === "describe") {
          const ocrRes = await deps.locator.ocr(shot.path)
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
      let ocrRes: OcrResult | null = null
      let hit: LocateHit | null = null
      let pointClient: { x: number; y: number } | null = null
      let crossverified = false
      let uncrossverified = false
      let crossverifyChannel: "pixel-region" | undefined

      if (action.action !== "type" && action.target) {
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
          ocrRes = ocr2
          hit = hit2
          pointClient = { x: hit.x - shot.client.x, y: hit.y - shot.client.y }
          uncrossverified = true // pixel channel disagreed — honest bookkeeping (R4)
        } else {
          shot = fresh
          crossverified = true
          crossverifyChannel = "pixel-region"
        }
        // The locate frame is superseded in BOTH branches — its raw would
        // otherwise linger in %TEMP% unsealed (review R1 leak path 1).
        await releaseRaw(locateFrame.path)
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
        }
      }

      // Bounds (reject, never clamp — §D.3).
      if (pointClient) {
        const cw = shot.client.width
        const ch = shot.client.height
        if (pointClient.x < 0 || pointClient.y < 0 || pointClient.x >= cw || pointClient.y >= ch) {
          throw new ComputerError("OUT_OF_BOUNDS", `computer: (${pointClient.x},${pointClient.y}) outside client rect ${cw}x${ch}`)
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
      const scan: DangerScan = scanDanger(ocrRes.words, regionImg, REGION_CROP_SIZE)

      if (action.action === "type" && scan.credentialRects.length > 0) {
        // A4.3: credential context for a type action — no-path deny (the OSR
        // fallback for the UIA IsPassword check).
        throw new ComputerError(
          "DANGER_HARD_DENY",
          "computer: credential context detected in the target window — type is hard-denied (no re-confirm path)",
          { hits: scan.windowHits },
        )
      }
      if (scan.regionLevel === "hard" && action.action !== "type") {
        // A4 no-path deny — scoped to the final-confirm CLICK (review R5).
        // For a type action the "region" IS the whole window (above), so a
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
      }

      // Inject (ps1 re-checks IL/desktop/bounds; type re-checks foreground).
      if (action.action === "type") {
        await deps.injector.typeText(hwnd, action.text)
      } else {
        await deps.injector.click(hwnd, pointClient!.x, pointClient!.y, action.action)
      }
      budget -= 1

      // A2.1 — task-induced dialog invariant (post-action): a new foreground
      // window OR a large whole-window change => pause + re-L2. Conservative
      // direction: false positives pause the task, never the reverse.
      // NOTE: the diff must run BEFORE any sealing — the sealer deletes raws.
      const afterShot = await trackCapture(hwnd)
      const fg = await deps.injector.foregroundHwnd()
      const { diffRatio } = await deps.capturer.diff(afterShot.path, shot.path)
      const dialogSuspected = (fg !== 0 && fg !== hwnd) || diffRatio > DIALOG_DIFF_THRESHOLD

      // Seal both frames into the evidence chain (credential neighborhoods
      // pixelated BEFORE the bytes are encrypted; raws deleted by the sealer).
      const beforeSeal = await evidence.sealScreenshot(shot.path, seq, "before", scan.credentialRects)
      sealConsumed(shot.path)
      const afterSeal = await evidence.sealScreenshot(afterShot.path, seq, "after", scan.credentialRects)
      sealConsumed(afterShot.path)

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
        afterSha256: afterSeal.sha256,
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
        log("computer.task.dialog_suspected", { taskId, seq, fgChanged: fg !== hwnd, diffRatio })
        const ok = await reL2(
          "本任务的操作引发了新对话框或大面积界面变化（确认型对话框的按钮不会由 agent 点击）。请检查目标窗口后决定是否继续。",
          ["computer.task_induced_dialog"],
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
