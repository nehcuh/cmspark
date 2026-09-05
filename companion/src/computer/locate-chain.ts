// WP3 — four-layer locate orchestrator (plan §B.1/§B.2).
//
//   L0 UIA (admission via the task-start probe verdict) → L1 OCR (WP1)
//   → L2 Qwen3-VL (WP5 experimental — experimental layer: hits are re-L2 gated,
//   never auto-injected) → L3 cloud (WP6 — honest stub).
//
// Degradation is ONE-WAY down the chain; every attempt is recorded with a
// structured reason and surfaces per action in the evidence chain
// (actions.json locateAttempts) and the computeruse.locate audit log.
//
// Cross-verification semantics (WP3 decision, aligned with A1.2/R4):
//   - UIA coordinates are authoritative (confidence 1.0). OCR is a WITNESS
//     layer, never a coordinate source while L0 stands: the anchor text
//     appearing inside the UIA bbox (+tolerance) on the locate frame yields
//     crossverifyChannel "uia+ocr". Disagreement degrades to L1 (OCR becomes
//     the coordinate source via the WP1 pixel-region channel).
//   - When OCR is unavailable (language pack missing), L0 coordinates are
//     guarded by the SAME pixel-stability channel A1 mandates for OCR
//     (crossverifyChannel "pixel-region").
//   - The pixel-region recapture (A1: never inject at stale coordinates)
//     runs for BOTH layers. Region instability triggers ONE re-probe on the
//     producing layer (UIA live re-read / OCR re-locate on the fresh frame);
//     success is honestly uncrossverified, failure is STALE_SCREENSHOT.
//
// Frame discipline (R1): the chain releases superseded LOCATE frames on
// success paths only. On any throw the executor's exit sweep owns every
// tracked frame — the chain must never release-then-throw.
//
// NOT in scope (documented): L3 stays an honest stub (WP6); the post-injection
// danger scan (executor, Y1) always re-OCRs the current frame, so a missing
// language pack fails any injection honestly even when L0 located (UIA
// provides no danger-scan bypass in WP3). The WP5 experimental layer adds
// no bypass either — its hits are re-L2 gated and consume the A1.3
// uncrossverified sub-budget.

import {
  ComputerError,
  PIXEL_DIFF_THRESHOLD,
  REGION_CROP_SIZE,
  type CaptureMeta,
  type LocateAttempt,
  type LocateHit,
  type Locator,
  type OcrResult,
  type RectPx,
  type ScreenCapturer,
  type UiaLocator,
} from "./types"
/** L2 experimental locator surface (Qwen3-VL; Qwen3-VL experimental locator). */
export type ExperimentalLocateOutcome =
  | { kind: "hit"; point: { x: number; y: number }; ms?: number; raw?: string }
  | { kind: "skipped"; reason: string }
  | { kind: "error"; reason: string }

export type ExperimentalLocator = {
  locate(args: { command: string; shot: CaptureMeta }): Promise<ExperimentalLocateOutcome>
}
import { rectDriftPx, imageToClient, type CoordScales } from "./coords"
import { VAULT_BROWSER_NO_VLM_REASON } from "./vault-browser-oneshot"

export interface LocateChainDeps {
  /** L0 provider. The EXECUTOR decides admission (uiaCapable) — it passes
   *  null when the app is UIA-incapable/unprobed, so a non-null uia here
   *  means L0 participates. */
  uia: UiaLocator | null
  /** L1 provider (existing WP1 Locator). */
  locator: Locator
  capturer: ScreenCapturer
  /**
   * Y6: L1 availability probe (PsLocator.ensureLanguage, cached per task by
   * the caller — this is what gives the former "dead interface" its
   * caller). Absent = assume available (unit fakes).
   */
  ocrAvailable?: () => Promise<boolean>
  /**
   * WP5 I3：L2 实验层。EXECUTOR 决定 admission——开关开 + 模型 ready + 无熔断
   * 才传非 null（ready 语义：modelStatus:"ready" = 文件在盘且校验过，session
   * 懒建，P3-c/M7）。null/缺省 = 层未启用 → skipped（reason 见 experimentalSkipReason）。
   * Pick 结构型以便测试注入 fake。
   */
  /** Experimental L2 locator (Qwen3-VL). Name kept for historical deps wiring. */
  experimental?: ExperimentalLocator | null
  /**
   * When experimental is null, surface the real admission/skip reason in the
   * attempt log (e.g. model-switch-off, model-build-failed, worker-missing).
   * Default "model-not-admitted" — do not mislabel as model-disabled.
   */
  experimentalSkipReason?: string
  /**
   * #360 (CU-B): vault-browser one-shot tasks never feed browser pixels to
   * VLM layers. When true, L2 is skipped WITHOUT calling deps.experimental
   * (even when admitted) and L3 stays skipped — both recorded with the
   * honest reason "vault-browser-no-vlm" in the evidence chain. The chain
   * runs L0 UIA → L1 OCR → honest ELEMENT_NOT_FOUND only.
   */
  vaultBrowserNoVlm?: boolean
  log?: (event: string, data: Record<string, unknown>) => void
  now?: () => number
}

export interface ChainLocateResult {
  /** Image-space hit (same convention as the WP1 OCR hit). */
  hit: LocateHit
  pointClient: { x: number; y: number }
  /** OCR output when OCR ran (witness or L1 locate); null otherwise. */
  ocrRes: OcrResult | null
  /** The frame to inject against (tracked by the caller's pendingRaws). */
  shot: CaptureMeta
  crossverified: boolean
  crossverifyChannel?: "uia+ocr" | "pixel-region"
  uncrossverified: boolean
  attempts: LocateAttempt[]
  /** X1: quantified witness strength (present when the L0 witness OCR ran). */
  witness?: WitnessVerdict
  /**
   * WP5 I3（G4）：L2 实验层命中标记。命中不直接进注入流——executor 见此
   * 标记走 re-L2 人审（caption「实验层建议，可能完全错误」），批准后经
   * A1 像素新鲜度检查注入；实验层建议永不自动进入接受链。
   */
  experimental?: true
  /**
   * Path C (UI-TARS absorption): raw VLM text when experimental hit, for
   * Thought extraction in the re-L2 caption. Never used as inject authority.
   */
  experimentalRaw?: string
}

/** UIA↔OCR witness tolerance (px) around the UIA bbox. */
const WITNESS_TOLERANCE_PX = 8

/**
 * D4.2 (Grok v4.1 §4.2 / Pi v4.1 RESOLVED): per-action hwnd drift threshold.
 * If live window bounds (infoForHwnd) vs the cached `shot.rect` differ by more
 * than this many pixels on any of {x, y, width, height}, the capture is stale
 * — re-capture before the bounds check instead of blessing an OOB click.
 *
 * Matches WITNESS_TOLERANCE_PX (8) on purpose: sub-8 px drift is below the
 * locate witness tolerance anyway, so the classifier's noise floor already
 * absorbs it; above 8 px we want a fresh frame. Exported so executor.ts can
 * import it without re-declaring.
 */
export const DRIFT_THRESHOLD_PX = 8

/**
 * P4 (D4.3 follow-up): extract CoordScales from CaptureMeta, falling back to
 * scale=1 when the v4 retina metadata fields are absent (pre-v4 binaries,
 * non-macOS paths). Matches executor.ts's `?? 1` shape — single behavior
 * across the codebase for missing scale metadata.
 */
const scalesOf = (s: CaptureMeta): CoordScales => ({
  imageWidth: s.imageWidth ?? s.rect.width,
  imageHeight: s.imageHeight ?? s.rect.height,
  scaleX: s.scaleX ?? 1,
  scaleY: s.scaleY ?? 1,
})

/**
 * X1 (WP3 adversary): witness bbox size caps. The old witness had NO size
 * limit, so a forged UIA node defeated it by construction: inflate the
 * BoundingRectangle until the REAL anchor text falls inside it (the bbox
 * CENTER is the injection point, so the attacker parks the center on any
 * button of their choice while the giant bbox still "contains" the anchor).
 * Dual cap — absolute area AND window-area ratio; an oversized bbox can
 * NEVER corroborate (fail-closed to disagree). computer-uia-locate.ps1
 * enforces the same caps at the source and drops oversized hits outright.
 */
export const WITNESS_BBOX_MAX_AREA_PX2 = 150_000
export const WITNESS_BBOX_MAX_WINDOW_RATIO = 0.3

/** X1: witness strength verdict — recorded in the evidence chain (§B.1). */
export interface WitnessVerdict {
  agree: boolean
  /** bbox exceeded the size caps — corroboration refused regardless of content. */
  oversized: boolean
  matchedChars: number
  anchorChars: number
  /** matchedChars / anchorChars (1 = full coverage). */
  coverage: number
  /** anchor reconstructed contiguously from in-bbox words (reading order). */
  reconstructed: boolean
  /** bbox area / window area. */
  bboxAreaRatio: number
}

/** Reading-order line reconstruction: group words by vertical center, join each line x-sorted. */
function reconstructLines(words: Array<{ x: number; y: number; w: number; h: number; text: string }>): string[] {
  const sorted = [...words].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))
  const lines: Array<{ cy: number; tol: number; words: typeof sorted }> = []
  for (const w of sorted) {
    const cy = w.y + w.h / 2
    const tol = Math.max(4, w.h * 0.6)
    const line = lines.find((l) => Math.abs(l.cy - cy) <= Math.max(l.tol, tol))
    if (line) {
      line.words.push(w)
    } else {
      lines.push({ cy, tol, words: [w] })
    }
  }
  return lines.map((l) => [...l.words].sort((a, b) => a.x - b.x).map((w) => w.text).join(""))
}

/**
 * X1 quantified witness: does the anchor text appear inside bbox+tolerance
 * STRONGLY enough to corroborate? Three rules, all required to say "agree":
 *   ① size: bbox within the dual caps (a giant bbox proves nothing);
 *   ② strength: the anchor is CONTINUOUSLY RECONSTRUCTED from the in-bbox
 *      words (reading order) OR every distinct anchor char is covered by
 *      them — a single overlapping char of a multi-char anchor no longer
 *      counts (the old `[...w.text].some(...)` flaw);
 *   ③ single-char anchors (N1): char presence has zero discriminatory power
 *      (CJK overlap) — only a FULL-WORD hit (an in-bbox word that IS exactly
 *      the anchor) corroborates.
 */
function ocrWitnessCheck(ocrRes: OcrResult, target: string, bbox: RectPx, windowRect: { width: number; height: number }): WitnessVerdict {
  const bboxArea = bbox.width * bbox.height
  const winArea = Math.max(1, windowRect.width * windowRect.height)
  const bboxAreaRatio = bboxArea / winArea
  const oversized = bboxArea > WITNESS_BBOX_MAX_AREA_PX2 || bboxAreaRatio > WITNESS_BBOX_MAX_WINDOW_RATIO
  const within = (w: { x: number; y: number; w: number; h: number }) => {
    const cx = w.x + w.w / 2
    const cy = w.y + w.h / 2
    return (
      cx >= bbox.x - WITNESS_TOLERANCE_PX &&
      cx <= bbox.x + bbox.width + WITNESS_TOLERANCE_PX &&
      cy >= bbox.y - WITNESS_TOLERANCE_PX &&
      cy <= bbox.y + bbox.height + WITNESS_TOLERANCE_PX
    )
  }
  const inside = ocrRes.words.filter((w) => w.text.length > 0 && within(w))
  const anchorChars = new Set([...target])
  const covered = new Set<string>()
  for (const w of inside) for (const ch of [...w.text]) if (anchorChars.has(ch)) covered.add(ch)
  const coverage = anchorChars.size === 0 ? 0 : covered.size / anchorChars.size
  const reconstructed = target.length > 0 && reconstructLines(inside).some((line) => line.includes(target))
  let agree = false
  if (!oversized) {
    if ([...target].length < 2) {
      agree = inside.some((w) => w.text === target)
    } else {
      agree = reconstructed || coverage >= 1
    }
  }
  return { agree, oversized, matchedChars: covered.size, anchorChars: anchorChars.size, coverage, reconstructed, bboxAreaRatio }
}

/**
 * Locate `target` for a click-family action through the layer chain.
 * `shot` is the base frame (already tracked by the caller). Throws
 * ELEMENT_NOT_FOUND (all layers missed, reasons in the message and the
 * locateAttempts log) or STALE_SCREENSHOT / propagates ComputerErrors.
 */
export async function locateTargetWithChain(args: {
  target: string
  hwnd: number
  shot: CaptureMeta
  deps: LocateChainDeps
  trackCapture: (hwnd: number) => Promise<CaptureMeta>
  releaseRaw: (path?: string) => Promise<void>
  /** Refresh context (post-approval): a not-found re-probe means the target
   *  moved after a human decision — STALE_SCREENSHOT, not ELEMENT_NOT_FOUND. */
  staleOnNotFound?: boolean
  /** D4.3 (Grok blocker 2 fix / Pi v4.1 RESOLVED): set to true by the
   *  in-function restart path so the recursive call knows it has already
   *  used its one restart. Default false. Without this arg, every fresh
   *  frame that still drifts would trigger another restart → infinite loop
   *  on animated windows. */
  driftRestarted?: boolean
}): Promise<ChainLocateResult> {
  const { target, hwnd, deps, trackCapture, releaseRaw } = args
  const now = deps.now ?? (() => Date.now())
  const log = deps.log ?? (() => {})
  const attempts: LocateAttempt[] = []
  let shot = args.shot
  let ocrRes: OcrResult | null = null
  // X1: witness verdict is function-scoped — a REFUSED witness (disagree /
  // oversized bbox) degrades to L1, and the evidence record on that L1 path
  // must still carry WHY the L0 cross-check was not granted.
  let witnessVerdict: WitnessVerdict | undefined

  // D4.3 (Grok v4.1 §4.3 / Pi APPROVED 2026-07-25): snapshot the chain-entry
  // rect. Before each layer's hit return, re-validate against the CURRENT
  // shot.rect — if the window moved mid-chain (A1 freshness re-capture inside
  // L0/L1, or restarted entry from a prior drift), abort the hit and restart
  // ONCE on a fresh frame. Returning a UIA→image mapping computed against a
  // stale rect is the (722, 872) OOB class in slow motion.
  //
  // Restart loop bound: `restarted` is read from args.driftRestarted so the
  // recursive call inherits the true state. Closure-scoped reset would
  // infinite-loop on animated windows (Grok blocker 2).
  const restarted = args.driftRestarted === true
  const rect0: RectPx = { ...args.shot.rect }

  const rect0DriftExceeded = (): boolean =>
    rectDriftPx(shot.rect, rect0) > DRIFT_THRESHOLD_PX

  const restartChainOnce = async (): Promise<CaptureMeta> => {
    if (restarted) {
      throw new ComputerError(
        "STALE_SCREENSHOT",
        `computer: target "${target}" — window drift exceeded ${DRIFT_THRESHOLD_PX}px twice in one locate call; refusing to inject at unstable coordinates`,
      )
    }
    const fresh = await trackCapture(hwnd)
    await releaseRaw(shot.path)
    return fresh
  }

  const notFoundError = (): ComputerError => {
    const why = attempts.map((a) => `${a.layer}:${a.outcome}${a.reason ? `(${a.reason})` : ""}`).join(" → ")
    if (args.staleOnNotFound) {
      return new ComputerError(
        "STALE_SCREENSHOT",
        `computer: target "${target}" not found on any layer after the re-confirm approval — refusing to inject at pre-approval coordinates [${why}]`,
      )
    }
    return new ComputerError("ELEMENT_NOT_FOUND", `computer: anchor "${target}" not found on any locate layer [${why}]`)
  }

  /** A1: located, then the pixel region went unstable, then the re-probe
   *  missed — the target MOVED between locate and inject (always STALE,
   *  regardless of which layer produced the coordinates). */
  const staleError = (layer: string): ComputerError =>
    new ComputerError(
      "STALE_SCREENSHOT",
      `computer: target "${target}" moved between locate and inject; ${layer} re-locate failed — refusing to inject at stale coordinates`,
    )

  // ---- L0: UIA (live tree) ---------------------------------------------------
  if (deps.uia) {
    const t0 = now()
    let uiaHit = null
    try {
      uiaHit = await deps.uia.locate(hwnd, target)
    } catch (err) {
      // UIA infrastructure failure (window died mid-walk etc.) — degrade
      // honestly; HWND-dead conditions surface via the per-action ownership
      // revalidation and the pixel channels regardless.
      attempts.push({ layer: "uia", outcome: "error", reason: String((err as Error)?.message ?? err).slice(0, 120), ms: now() - t0 })
      log("computeruse.locate", { layer: "uia", hit: false, error: true, ms: now() - t0 })
    }
    if (uiaHit) {
      attempts.push({ layer: "uia", outcome: "hit", confidence: uiaHit.confidence, ms: now() - t0 })
      if (uiaHit.candidates > 1) {
        log("computeruse.locate", { layer: "uia", hit: true, ambiguous: uiaHit.candidates, confidence: uiaHit.confidence, ms: now() - t0 })
      } else {
        log("computeruse.locate", { layer: "uia", hit: true, confidence: uiaHit.confidence, ms: now() - t0 })
      }
      // v4 Defect 3 (Grok v4 §4.4 M5): SCREEN-LOGICAL → IMAGE-PIXEL conversion
      // must apply the per-axis backing scale. UIA returns logical points;
      // OCR word boxes from the captured PNG are in image-pixel space. The
      // legacy `* - shot.rect.x` math was 1:1, which silently broke witness
      // comparisons on Retina (2x). When scale metadata is missing, default
      // to 1.0 to preserve legacy behavior on non-macOS or pre-v4 binaries.
      const sxL = shot.scaleX ?? 1
      const syL = shot.scaleY ?? 1
      const img = {
        x: (uiaHit.x - shot.rect.x) * sxL,
        y: (uiaHit.y - shot.rect.y) * syL,
      }
      const imgBbox: RectPx = {
        x: (uiaHit.bbox.x - shot.rect.x) * sxL,
        y: (uiaHit.bbox.y - shot.rect.y) * syL,
        width: uiaHit.bbox.width * sxL,
        height: uiaHit.bbox.height * syL,
      }
      // Witness OCR on the locate frame (skipped when the pack is missing).
      // X1: quantified verdict — dual bbox size caps + reconstruction /
      // full-coverage strength + single-char full-word rule (ocrWitnessCheck).
      let witness: "agree" | "disagree" | "unavailable" = "unavailable"
      const available = deps.ocrAvailable ? await deps.ocrAvailable() : true
      if (available) {
        ocrRes = await deps.locator.ocr(shot.path)
        witnessVerdict = ocrWitnessCheck(ocrRes, target, imgBbox, shot.rect)
        witness = witnessVerdict.agree ? "agree" : "disagree"
        if (witnessVerdict.oversized) {
          log("computeruse.locate", {
            layer: "uia",
            witness: "oversized-bbox",
            bboxAreaRatio: Number(witnessVerdict.bboxAreaRatio.toFixed(3)),
          })
        }
      }
      if (witness === "disagree") {
        // UIA and OCR name DIFFERENT realities — do not inject UIA coords
        // blindly; OCR takes over as the coordinate source below (L1).
        attempts.push({ layer: "uia", outcome: "error", reason: "uia-ocr-disagree", ms: 0 })
        log("computeruse.locate", {
          layer: "uia",
          hit: false,
          reason: "uia-ocr-disagree",
          ...(witnessVerdict
            ? { matchedChars: witnessVerdict.matchedChars, anchorChars: witnessVerdict.anchorChars, oversized: witnessVerdict.oversized }
            : {}),
        })
      } else {
        // A1 parity: pixel-region freshness between locate and pre-inject.
        const region: RectPx = {
          x: Math.max(0, img.x - REGION_CROP_SIZE / 2),
          y: Math.max(0, img.y - REGION_CROP_SIZE / 2),
          width: REGION_CROP_SIZE,
          height: REGION_CROP_SIZE,
        }
        const locateFrame = shot
        const fresh = await trackCapture(hwnd)
        const { diffRatio } = await deps.capturer.diffRegion(fresh.path, locateFrame.path, region)
        if (diffRatio <= PIXEL_DIFF_THRESHOLD) {
          shot = fresh
          await releaseRaw(locateFrame.path)
          const hit: LocateHit = {
            x: img.x,
            y: img.y,
            bbox: imgBbox,
            layer: "uia",
            confidence: uiaHit.confidence,
            matchedText: uiaHit.name,
          }
          // X1 ③: an ambiguous tree-order first pick (candidates>1) is NEVER
          // a full-strength badge — forced uncrossverified so it consumes the
          // A1.3 sub-budget instead of silently carrying "uia+ocr".
          const ambiguous = uiaHit.candidates > 1
          if (ambiguous) {
            log("computeruse.locate", { layer: "uia", ambiguous: uiaHit.candidates, downgraded: "uncrossverified" })
          }
          // D4.3: drift re-validate before L0 success return. Pi reminder (a):
          // on restart, propagate the inner recursive call's witness verdict,
          // NOT this scope's witnessVerdict — the recursive call computed a
          // fresh one against the new frame.
          if (rect0DriftExceeded()) {
            log("computer.locate.drift_restart", {
              layer: "uia",
              rect0,
              currentRect: shot.rect,
              driftPx: rectDriftPx(shot.rect, rect0),
            })
            const fresh = await restartChainOnce()
            return locateTargetWithChain({
              ...args,
              shot: fresh,
              staleOnNotFound: true,
              driftRestarted: true,
            })
          }
          return {
            hit,
            pointClient: imageToClient(img, scalesOf(shot), shot.client),
            ocrRes,
            shot,
            crossverified: !ambiguous,
            crossverifyChannel: ambiguous ? undefined : witness === "agree" ? "uia+ocr" : "pixel-region",
            uncrossverified: ambiguous,
            attempts,
            ...(witnessVerdict ? { witness: witnessVerdict } : {}),
          }
        }
        // Unstable region: ONE live re-probe (UIA re-read on the fresh frame).
        const t1 = now()
        const uiaHit2 = await deps.uia.locate(hwnd, target)
        if (!uiaHit2) {
          attempts.push({ layer: "uia", outcome: "not-found", reason: "uia-reprobe-moved", ms: now() - t1 })
          throw staleError("UIA") // frames stay tracked — the exit sweep owns them
        }
        attempts.push({ layer: "uia", outcome: "hit", confidence: uiaHit2.confidence, reason: "re-probe after pixel instability", ms: now() - t1 })
        shot = fresh
        await releaseRaw(locateFrame.path)
        // v4 Defect 3 (M5): apply backing scale on UIA → image-pixel conversion.
        const sxL2 = shot.scaleX ?? 1
        const syL2 = shot.scaleY ?? 1
        const img2 = {
          x: (uiaHit2.x - shot.rect.x) * sxL2,
          y: (uiaHit2.y - shot.rect.y) * syL2,
        }
        const hit: LocateHit = {
          x: img2.x,
          y: img2.y,
          bbox: {
            x: (uiaHit2.bbox.x - shot.rect.x) * sxL2,
            y: (uiaHit2.bbox.y - shot.rect.y) * syL2,
            width: uiaHit2.bbox.width * sxL2,
            height: uiaHit2.bbox.height * syL2,
          },
          layer: "uia",
          confidence: uiaHit2.confidence,
          matchedText: uiaHit2.name,
        }
        // D4.3: drift re-validate AFTER shot = fresh (Pi reminder b: must be
        // placed after A1 re-capture, else trips spuriously on every A1 path).
        if (rect0DriftExceeded()) {
          log("computer.locate.drift_restart", {
            layer: "uia-reprobe",
            rect0,
            currentRect: shot.rect,
            driftPx: rectDriftPx(shot.rect, rect0),
          })
          const fresh2 = await restartChainOnce()
          return locateTargetWithChain({
            ...args,
            shot: fresh2,
            staleOnNotFound: true,
            driftRestarted: true,
          })
        }
        return {
          hit,
          pointClient: imageToClient(img2, scalesOf(shot), shot.client),
          ocrRes,
          shot,
          crossverified: false,
          uncrossverified: true, // pixel channel disagreed — honest bookkeeping (R4)
          attempts,
          ...(witnessVerdict ? { witness: witnessVerdict } : {}),
        }
      }
    } else if (!attempts.some((a) => a.layer === "uia" && a.outcome === "error")) {
      attempts.push({ layer: "uia", outcome: "not-found", ms: now() - t0 })
      log("computeruse.locate", { layer: "uia", hit: false, reason: "uia-not-found", ms: now() - t0 })
    }
  } else {
    attempts.push({ layer: "uia", outcome: "skipped", reason: "uia-incapable-or-unprobed", ms: 0 })
  }

  // ---- L1: OCR (WP1 pixel-region channel) ------------------------------------
  const available = deps.ocrAvailable ? await deps.ocrAvailable() : true
  if (!available) {
    attempts.push({ layer: "ocr", outcome: "skipped", reason: "ocr-language-missing", ms: 0 })
    log("computeruse.locate", { layer: "ocr", hit: false, reason: "ocr-language-missing" })
  } else {
    const t0 = now()
    // An ocr() THROW propagates (today's executor semantics — the danger
    // scan would fail the same way); only an honest NotFound degrades.
    if (ocrRes === null) ocrRes = await deps.locator.ocr(shot.path)
    const ocrHit = deps.locator.locate(ocrRes, target)
    if (ocrHit) {
      attempts.push({ layer: "ocr", outcome: "hit", confidence: ocrHit.confidence, ms: now() - t0 })
      log("computeruse.locate", { layer: "ocr", hit: true, confidence: ocrHit.confidence, ms: now() - t0 })
      // Region crop stays in image-pixel space — capturer.diffRegion operates
      // on PNGs. Use ocrHit directly (image-pixel) rather than re-deriving
      // from the logical pointClient.
      const region: RectPx = {
        x: Math.max(0, ocrHit.x - REGION_CROP_SIZE / 2),
        y: Math.max(0, ocrHit.y - REGION_CROP_SIZE / 2),
        width: REGION_CROP_SIZE,
        height: REGION_CROP_SIZE,
      }
      const locateFrame = shot
      const fresh = await trackCapture(hwnd)
      const { diffRatio } = await deps.capturer.diffRegion(fresh.path, locateFrame.path, region)
      if (diffRatio <= PIXEL_DIFF_THRESHOLD) {
        shot = fresh
        await releaseRaw(locateFrame.path)
        // D4.3: drift re-validate AFTER shot = fresh (Pi reminder b).
        if (rect0DriftExceeded()) {
          log("computer.locate.drift_restart", {
            layer: "ocr",
            rect0,
            currentRect: shot.rect,
            driftPx: rectDriftPx(shot.rect, rect0),
          })
          const fresh2 = await restartChainOnce()
          return locateTargetWithChain({
            ...args,
            shot: fresh2,
            staleOnNotFound: true,
            driftRestarted: true,
          })
        }
        return {
          hit: ocrHit,
          pointClient: imageToClient({ x: ocrHit.x, y: ocrHit.y }, scalesOf(shot), shot.client),
          ocrRes,
          shot,
          crossverified: true,
          crossverifyChannel: "pixel-region",
          uncrossverified: false,
          attempts,
          // X1: on the L0→L1 degrade path this records WHY the witness
          // refused (oversized bbox / weak corroboration) — spec ④.
          ...(witnessVerdict ? { witness: witnessVerdict } : {}),
        }
      }
      // Unstable: re-locate on the fresh frame (WP1 semantics unchanged).
      const ocr2 = await deps.locator.ocr(fresh.path)
      const hit2 = deps.locator.locate(ocr2, target)
      if (!hit2) {
        attempts.push({ layer: "ocr", outcome: "not-found", reason: "ocr-relocate-moved", ms: now() - t0 })
        throw staleError("OCR")
      }
      shot = fresh
      ocrRes = ocr2
      await releaseRaw(locateFrame.path)
      // D4.3: drift re-validate AFTER shot = fresh (Pi reminder b).
      if (rect0DriftExceeded()) {
        log("computer.locate.drift_restart", {
          layer: "ocr-reprobe",
          rect0,
          currentRect: shot.rect,
          driftPx: rectDriftPx(shot.rect, rect0),
        })
        const fresh3 = await restartChainOnce()
        return locateTargetWithChain({
          ...args,
          shot: fresh3,
          staleOnNotFound: true,
          driftRestarted: true,
        })
      }
      return {
        hit: hit2,
        pointClient: imageToClient({ x: hit2.x, y: hit2.y }, scalesOf(shot), shot.client),
        ocrRes,
        shot,
        crossverified: false,
        uncrossverified: true, // pixel channel disagreed — honest bookkeeping (R4)
        attempts,
        ...(witnessVerdict ? { witness: witnessVerdict } : {}),
      }
    }
    attempts.push({ layer: "ocr", outcome: "not-found", ms: now() - t0 })
    log("computeruse.locate", { layer: "ocr", hit: false, reason: "ocr-not-found", ms: now() - t0 })
  }

  // ---- L2: Qwen3-VL 实验层（deps.experimental 槽位名历史保留） -----------------
  // admission 由 executor 决定（deps.experimental 非 null = 开关开 + 模型 ready）。
  if (deps.vaultBrowserNoVlm === true) {
    // #360 (CU-B) — 浏览器 vault 面 one-shot：网页像素永不喂 VLM。即使实验层
    // 已 admitted 也不调用（不可信 HTML 渲染帧不进模型），证据链记诚实 skipped。
    attempts.push({ layer: "qwen-vl", outcome: "skipped", reason: VAULT_BROWSER_NO_VLM_REASON, ms: 0 })
    log("computeruse.locate", { layer: "qwen-vl", hit: false, reason: VAULT_BROWSER_NO_VLM_REASON })
  } else if (deps.experimental) {
    const t0 = now()
    const outcome = await deps.experimental.locate({ command: target, shot })
    if (outcome.kind === "hit") {
      attempts.push({ layer: "qwen-vl", outcome: "hit", ms: now() - t0 })
      log("computeruse.locate", { layer: "qwen-vl", hit: true, ms: now() - t0 })
      const hit: LocateHit = {
        x: outcome.point.x,
        y: outcome.point.y,
        bbox: { x: outcome.point.x, y: outcome.point.y, width: 0, height: 0 },
        layer: "qwen-vl",
        matchedText: "",
      }
      return {
        hit,
        pointClient: imageToClient(outcome.point, scalesOf(shot), shot.client),
        ocrRes,
        shot,
        crossverified: false,
        uncrossverified: true,
        attempts,
        experimental: true,
        // Path C: surface raw only for human caption / audit — not inject authority.
        ...(typeof outcome.raw === "string" && outcome.raw.trim()
          ? { experimentalRaw: outcome.raw.slice(0, 500) }
          : {}),
      }
    }
    attempts.push({ layer: "qwen-vl", outcome: outcome.kind, reason: outcome.reason, ms: now() - t0 })
    log("computeruse.locate", { layer: "qwen-vl", hit: false, reason: outcome.reason, ms: now() - t0 })
  } else {
    const skipReason = deps.experimentalSkipReason || "model-not-admitted"
    attempts.push({ layer: "qwen-vl", outcome: "skipped", reason: skipReason, ms: 0 })
    log("computeruse.locate", { layer: "qwen-vl", hit: false, reason: skipReason })
  }

  // ---- L3: cloud（WP6 honest stub，不动） ---------------------------------------
  // #360: 浏览器 one-shot 路径连 stub 也标成 vault-browser-no-vlm —— 将来 WP6
  // 落地时本分支绝不静默变成真云端调用（NEVER: vault-browser one-shot 不上云）。
  const cloudSkipReason = deps.vaultBrowserNoVlm === true ? VAULT_BROWSER_NO_VLM_REASON : "wp6-not-implemented"
  attempts.push({ layer: "cloud", outcome: "skipped", reason: cloudSkipReason, ms: 0 })
  log("computeruse.locate", { layer: "cloud", hit: false, reason: cloudSkipReason })
  throw notFoundError()
}
