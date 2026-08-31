// Path B M0 — voice.model.* WS handlers (ADR-023 L7 dual fence).
//
// Discipline mirrors computer/model-handlers.ts:
//   - validateWsMessage (server.ts) is layer 1 shape + source fence
//   - this module re-checks source:"settings" on all mutators (belt / P6)
//   - download/delete mutex (DOWNLOAD_IN_PROGRESS / DELETE_IN_PROGRESS)
//   - set_engine local refuses with ZERO config write if no ready model
//   - set_active only when probe status === ready
//   - delete of active model while engine=local → force sttEngine browser
//   - download completion auto-activates localModelId when configured active
//     model is not ready (never touches sttEngine)
//   - get_state auto-corrects a stale localModelId when engine=local and other
//     ready models exist (priority: medium → small → large-v3-turbo)
//   - set_prefs persists autoFallbackToBrowser / modelDownloadEndpoint
//     (endpoint fail-closed: valid https origin only)
//
// No voice.stt.* here (M1+). No extension UI.

import { logger } from "../logger"
import { getConfig, setVoiceFields } from "../config"
import {
  isWhisperModelId,
  RECOMMENDED_WHISPER_MODEL,
  type WhisperModelId,
} from "./whisper-catalog"
import {
  deleteWhisperModel,
  downloadWhisperModel,
  normalizeModelDownloadEndpoint,
  probeWhisperModelDir,
  resolveWhisperRoot,
  WhisperDownloadError,
} from "./whisper-download"
import {
  downloadWhisperBinary,
  WhisperBinaryDownloadError,
} from "./whisper-binary-download"
import {
  buildVoiceModelState,
  listReadyWhisperModels,
  type BuildVoiceModelStateOpts,
  type VoiceModelStatePayload,
} from "./whisper-state"

// --- types --------------------------------------------------------------------

export interface VoiceModelHandlerContext {
  broadcast?: (data: any) => void
  /** WS Origin header (chrome-extension://… required for all voice.model.*). */
  origin?: string
}

/** Injectable deps for unit tests (download/delete/state seams). */
export interface VoiceModelHandlerDeps {
  downloadImpl?: typeof downloadWhisperModel
  deleteImpl?: typeof deleteWhisperModel
  buildState?: (opts?: BuildVoiceModelStateOpts) => Promise<VoiceModelStatePayload>
  listReady?: (rootDir?: string) => WhisperModelId[]
  probe?: typeof probeWhisperModelDir
  now?: () => number
  /** Whisper root override (tests). */
  rootDir?: string
}

// --- process-level mutex + abort ----------------------------------------------

type ActiveDownload = { modelId: WhisperModelId; controller: AbortController }
type ActiveDelete = { modelId: WhisperModelId }
type ActiveBinaryDownload = { controller: AbortController }

let activeDownload: ActiveDownload | null = null
let activeDelete: ActiveDelete | null = null
let activeBinaryDownload: ActiveBinaryDownload | null = null
/** Process-level; not config.json. Hydrates get_state after a failed download. */
let lastDownloadErrorMem: { error: string; modelId: WhisperModelId } | null = null

/** Test seam: clear download/delete mutex + abort any in-flight controller. */
export function _resetVoiceModelHandlersForTests(): void {
  if (activeDownload) {
    try {
      activeDownload.controller.abort()
    } catch {
      /* ignore */
    }
  }
  if (activeBinaryDownload) {
    try {
      activeBinaryDownload.controller.abort()
    } catch {
      /* ignore */
    }
  }
  activeDownload = null
  activeDelete = null
  activeBinaryDownload = null
  lastDownloadErrorMem = null
}

// --- errors -------------------------------------------------------------------

function modelError(error: string, extra?: Record<string, unknown>) {
  return { type: "error" as const, family: "voice.model" as const, error, ...extra }
}

function attachLastDownloadError(state: VoiceModelStatePayload): VoiceModelStatePayload & {
  lastDownloadError: string | null
  lastDownloadModelId?: WhisperModelId
} {
  return {
    ...state,
    lastDownloadError: lastDownloadErrorMem?.error ?? null,
    ...(lastDownloadErrorMem ? { lastDownloadModelId: lastDownloadErrorMem.modelId } : {}),
  }
}

const SETTINGS_SOURCE_TYPES = new Set([
  "voice.model.download",
  "voice.model.cancel",
  "voice.model.delete",
  "voice.model.set_active",
  "voice.model.set_engine",
  "voice.model.set_prefs",
  "voice.binary.download",
  "voice.binary.cancel",
])

// --- state helper -------------------------------------------------------------

async function statePayload(
  deps: VoiceModelHandlerDeps = {},
): Promise<VoiceModelStatePayload> {
  const downloading = activeDownload ? [activeDownload.modelId] : []
  const opts: BuildVoiceModelStateOpts = {
    downloadingModelIds: downloading,
    ...(deps.rootDir ? { rootDir: deps.rootDir } : {}),
  }
  if (deps.buildState) return deps.buildState(opts)
  return buildVoiceModelState(opts)
}

function resolveRoot(deps: VoiceModelHandlerDeps): string {
  return deps.rootDir ?? resolveWhisperRoot()
}

function readyList(deps: VoiceModelHandlerDeps): WhisperModelId[] {
  if (deps.listReady) return deps.listReady(deps.rootDir)
  return listReadyWhisperModels(deps.rootDir)
}

function probeModel(
  deps: VoiceModelHandlerDeps,
  modelId: WhisperModelId,
): { status: "ready" | "absent" | "incomplete"; error?: string } {
  const probe = deps.probe ?? probeWhisperModelDir
  return probe(modelId, deps.rootDir)
}

/** Active-model auto-selection priority (mirrors resolveSummonerSttModelId). */
const AUTO_ACTIVE_PRIORITY: WhisperModelId[] = ["medium", "small", "large-v3-turbo"]

/**
 * A1: after a model reaches ready, point localModelId at it when the configured
 * active model is not ready (or unset). Never touches sttEngine — engine stays
 * whatever the user committed (browser users keep browser until explicit enable).
 */
function maybeAutoActivateModel(modelId: WhisperModelId, deps: VoiceModelHandlerDeps): void {
  try {
    const cfg = getConfig().voice
    const activeId = cfg?.localModelId
    const activeReady =
      activeId != null &&
      isWhisperModelId(activeId) &&
      probeModel(deps, activeId).status === "ready"
    if (activeReady) return
    setVoiceFields({ localModelId: modelId })
    logger.info("voice.model.auto_activated", { modelId, previous: activeId ?? null })
  } catch (err) {
    logger.warn("voice.model.auto_activate_failed", {
      modelId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * A2: engine=local but the configured active model is not ready while other
 * ready models exist → persist the correction (AUTO_ACTIVE_PRIORITY order).
 * Never touches sttEngine; no ready model → leave config untouched (gates/UI
 * surface model_missing).
 */
function autoCorrectActiveLocalModel(deps: VoiceModelHandlerDeps): void {
  try {
    const cfg = getConfig().voice
    if (cfg?.sttEngine !== "local") return
    const activeId = (cfg.localModelId ?? RECOMMENDED_WHISPER_MODEL) as WhisperModelId
    if (probeModel(deps, activeId).status === "ready") return
    const ready = readyList(deps)
    if (ready.length === 0) return
    const next = AUTO_ACTIVE_PRIORITY.find((id) => ready.includes(id)) ?? ready[0]!
    setVoiceFields({ localModelId: next })
    logger.info("voice.model.get_state.auto_corrected_active", { from: activeId, to: next })
  } catch (err) {
    logger.warn("voice.model.get_state.auto_correct_failed", {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// --- background download ------------------------------------------------------

function startBackgroundDownload(
  modelId: WhisperModelId,
  ctx: VoiceModelHandlerContext,
  deps: VoiceModelHandlerDeps,
): void {
  const controller = new AbortController()
  activeDownload = { modelId, controller }
  void statePayload(deps).then((s) => ctx.broadcast?.(s))

  const now = deps.now ?? Date.now
  let lastSentAt = 0
  const download = deps.downloadImpl ?? downloadWhisperModel

  void (async () => {
    let downloadError: string | undefined
    try {
      await download(modelId, {
        signal: controller.signal,
        ...(deps.rootDir ? { rootDir: deps.rootDir } : {}),
        onProgress: (p) => {
          const t = now()
          if (t - lastSentAt < 200) return
          lastSentAt = t
          ctx.broadcast?.({
            type: "voice.model.progress",
            modelId: p.modelId,
            file: p.file,
            receivedBytes: p.receivedBytes,
            totalBytes: p.totalBytes,
          })
        },
      })
      logger.info("voice.model.download.completed", { modelId })
      lastDownloadErrorMem = null
      // A1: auto-activate the just-downloaded model when the configured active
      // model is not ready (does not touch sttEngine).
      maybeAutoActivateModel(modelId, deps)
    } catch (err) {
      if (err instanceof WhisperDownloadError) {
        // Prefer human message (includes HTTP status); reason alone is opaque in UI
        downloadError = err.message || err.reason
        if (err.reason === "aborted") {
          logger.info("voice.model.download.cancelled", { modelId })
        } else {
          logger.warn("voice.model.download.failed", {
            modelId,
            reason: err.reason,
            message: err.message,
          })
        }
      } else {
        downloadError = err instanceof Error ? err.message : "network-error"
        logger.warn("voice.model.download.failed", { modelId, reason: downloadError })
      }
    } finally {
      if (activeDownload?.modelId === modelId) {
        activeDownload = null
      }
      const state = await statePayload(deps)
      if (downloadError && !downloadError.includes("aborted")) {
        lastDownloadErrorMem = { error: downloadError, modelId }
        // Push machine error into family:"voice.model" so Side Panel shows it
        // (not only probe residue like unexpected-files).
        ctx.broadcast?.(
          modelError(downloadError, {
            code: "DOWNLOAD_FAILED",
            modelId,
          }),
        )
        ctx.broadcast?.(attachLastDownloadError(state))
      } else {
        if (downloadError?.includes("aborted")) {
          lastDownloadErrorMem = null
        }
        ctx.broadcast?.(attachLastDownloadError(state))
      }
    }
  })()
}

// --- handler ------------------------------------------------------------------

/** ADR-023 / P1: voice.model.* only from chrome-extension:// peers (not tray). */
export function isChromeExtensionOrigin(origin: string | undefined | null): boolean {
  if (typeof origin !== "string") return false
  return /^chrome-extension:\/\/[A-Za-z0-9_-]+$/i.test(origin)
}

export async function handleVoiceModelMessage(
  msg: any,
  ctx: VoiceModelHandlerContext = {},
  deps: VoiceModelHandlerDeps = {},
): Promise<any> {
  const { type, ...rest } = msg ?? {}

  // P1 origin fence (settings dual fence still required for mutators below)
  if (!isChromeExtensionOrigin(ctx.origin)) {
    logger.warn("voice.model.refused", {
      type: typeof type === "string" ? type : undefined,
      reason: "origin_not_extension",
    })
    return modelError("voice.model.* requires chrome-extension:// origin", {
      code: "ORIGIN_DENIED",
    })
  }

  // Belt: mutators require source:"settings" even if validateWsMessage was bypassed.
  if (SETTINGS_SOURCE_TYPES.has(type) && rest.source !== "settings") {
    logger.warn("voice.model.refused", {
      type,
      source: typeof rest.source === "string" ? rest.source : undefined,
    })
    return modelError(`${type} only accepts the settings-page source (source:"settings")`, {
      code: "INVALID_SOURCE",
    })
  }

  switch (type) {
    case "voice.model.get_state": {
      // A2: engine=local + active model not ready + other ready models →
      // persist localModelId correction before assembling the payload.
      autoCorrectActiveLocalModel(deps)
      const state = await statePayload(deps)
      return attachLastDownloadError(state)
    }

    case "voice.model.download": {
      const rawId = rest.modelId
      if (!isWhisperModelId(rawId)) {
        return modelError('voice.model.download requires modelId:"small"|"medium"|"large-v3-turbo"', {
          code: "INVALID_MODEL_ID",
        })
      }
      const modelId = rawId as WhisperModelId

      if (activeDownload) {
        if (activeDownload.modelId === modelId) {
          return {
            type: "voice.model.download.result" as const,
            ok: true,
            status: "already-running",
            modelId,
          }
        }
        return modelError("另一模型下载进行中——请待完成后重试或先取消。", {
          code: "DOWNLOAD_IN_PROGRESS",
          modelId: activeDownload.modelId,
        })
      }
      if (activeDelete) {
        logger.warn("voice.model.download.refused", {
          reason: "delete-in-progress",
          modelId,
        })
        return modelError("模型删除进行中——待其完成后重试下载；本次未发起任何网络请求。", {
          code: "DELETE_IN_PROGRESS",
        })
      }

      // Already ready → no-op success (idempotent)
      const probe = probeModel(deps, modelId)
      if (probe.status === "ready") {
        // Same A1 rule as a fresh completion: this model is ready now.
        maybeAutoActivateModel(modelId, deps)
        const state = await statePayload(deps)
        ctx.broadcast?.(state)
        return {
          ...state,
          download: "already-ready" as const,
          modelId,
        }
      }

      startBackgroundDownload(modelId, ctx, deps)
      logger.info("voice.model.download.started", { modelId })
      return {
        type: "voice.model.download.result" as const,
        ok: true,
        status: "started",
        modelId,
      }
    }

    case "voice.model.cancel": {
      const rawId = rest.modelId
      if (!isWhisperModelId(rawId)) {
        return modelError('voice.model.cancel requires modelId:"small"|"medium"|"large-v3-turbo"', {
          code: "INVALID_MODEL_ID",
        })
      }
      const modelId = rawId as WhisperModelId
      if (!activeDownload || activeDownload.modelId !== modelId) {
        return {
          type: "voice.model.cancel.result" as const,
          ok: true,
          status: "not-running",
          modelId,
        }
      }
      activeDownload.controller.abort()
      logger.info("voice.model.download.cancel_requested", { modelId })
      // activeDownload cleared in download finally; broadcast follows there
      return {
        type: "voice.model.cancel.result" as const,
        ok: true,
        status: "cancelling",
        modelId,
      }
    }

    case "voice.model.delete": {
      const rawId = rest.modelId
      if (!isWhisperModelId(rawId)) {
        return modelError('voice.model.delete requires modelId:"small"|"medium"|"large-v3-turbo"', {
          code: "INVALID_MODEL_ID",
        })
      }
      const modelId = rawId as WhisperModelId

      if (activeDownload) {
        logger.warn("voice.model.delete.refused", {
          reason: "download-in-progress",
          modelId,
          downloading: activeDownload.modelId,
        })
        return modelError("模型下载进行中——请先取消下载或待其完成后再删除。", {
          code: "DOWNLOAD_IN_PROGRESS",
        })
      }
      if (activeDelete) {
        if (activeDelete.modelId === modelId) {
          return {
            type: "voice.model.delete.result" as const,
            ok: true,
            status: "already-running",
            modelId,
          }
        }
        return modelError("另一模型删除进行中——请稍后重试。", {
          code: "DELETE_IN_PROGRESS",
        })
      }

      activeDelete = { modelId }
      try {
        const del = deps.deleteImpl ?? deleteWhisperModel
        await del(modelId, deps.rootDir)

        // Fail-closed: deleting the active model while engine=local → force browser
        const cfg = getConfig().voice
        const wasActive =
          cfg?.localModelId === modelId ||
          (cfg?.localModelId == null && modelId === "medium")
        if (cfg?.sttEngine === "local" && wasActive) {
          setVoiceFields({ sttEngine: "browser" })
          logger.info("voice.model.delete.forced_browser", {
            modelId,
            reason: "deleted-active-local-model",
          })
        }

        logger.info("voice.model.deleted", { modelId })
        const state = await statePayload(deps)
        ctx.broadcast?.(state)
        return {
          ...state,
          deleted: true as const,
          modelId,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn("voice.model.delete.failed", { modelId, error: message })
        const state = await statePayload(deps)
        ctx.broadcast?.(state)
        return modelError(`删除失败：${message}`, { code: "DELETE_FAILED", modelId })
      } finally {
        if (activeDelete?.modelId === modelId) activeDelete = null
      }
    }

    case "voice.model.set_active": {
      const rawId = rest.modelId
      if (!isWhisperModelId(rawId)) {
        return modelError(
          'voice.model.set_active requires modelId:"small"|"medium"|"large-v3-turbo"',
          { code: "INVALID_MODEL_ID" },
        )
      }
      const modelId = rawId as WhisperModelId
      const probe = probeModel(deps, modelId)
      if (probe.status !== "ready") {
        logger.warn("voice.model.set_active.refused", {
          modelId,
          status: probe.status,
        })
        return modelError(
          `模型 ${modelId} 尚未就绪（status=${probe.status}）——请先下载完成后再设为活动模型。`,
          { code: "MODEL_NOT_READY", modelId, status: probe.status },
        )
      }
      setVoiceFields({ localModelId: modelId })
      logger.info("voice.model.set_active", { modelId })
      const state = await statePayload(deps)
      ctx.broadcast?.(state)
      return state
    }

    case "voice.model.set_engine": {
      const engine = rest.engine
      if (engine !== "browser" && engine !== "local") {
        return modelError('voice.model.set_engine requires engine:"browser"|"local"', {
          code: "INVALID_ENGINE",
        })
      }

      if (engine === "browser") {
        setVoiceFields({ sttEngine: "browser" })
        logger.info("voice.model.set_engine", { engine: "browser" })
        const state = await statePayload(deps)
        ctx.broadcast?.(state)
        return state
      }

      // engine === "local" — require privacy_ack_v2 on the wire (server-side; client storage alone is not enough)
      if (rest.privacy_ack_v2 !== true) {
        logger.warn("voice.model.set_engine.refused", { reason: "need_privacy_ack_v2" })
        return modelError("切换本机转写前须确认隐私说明（privacy_ack_v2）。", {
          code: "NEED_PRIVACY_ACK",
        })
      }

      // engine === "local" — ZERO config write if no ready model
      const ready = readyList(deps)
      if (ready.length === 0) {
        logger.warn("voice.model.set_engine.refused", { reason: "no-ready-model" })
        return modelError("请先下载本机模型后再切换到本机转写。", {
          code: "NO_READY_MODEL",
        })
      }

      const cfg = getConfig().voice
      let activeId = (cfg?.localModelId ?? RECOMMENDED_WHISPER_MODEL) as WhisperModelId
      if (!ready.includes(activeId)) {
        // Prefer recommended if ready; else first ready
        if (ready.includes(RECOMMENDED_WHISPER_MODEL)) {
          activeId = RECOMMENDED_WHISPER_MODEL
        } else {
          activeId = ready[0]!
        }
      }

      // Second belt: active must probe ready (listReady is authoritative but re-check)
      const probe = probeModel(deps, activeId)
      if (probe.status !== "ready") {
        logger.warn("voice.model.set_engine.refused", {
          reason: "active-not-ready",
          activeId,
          status: probe.status,
        })
        return modelError("活动模型未就绪——请先下载完成后再切换到本机转写。", {
          code: "NO_READY_MODEL",
          modelId: activeId,
        })
      }

      setVoiceFields({ sttEngine: "local", localModelId: activeId })
      logger.info("voice.model.set_engine", { engine: "local", localModelId: activeId })
      const state = await statePayload(deps)
      ctx.broadcast?.(state)
      return state
    }

    case "voice.model.set_prefs": {
      // Non-model voice prefs (auto-fallback toggle / download endpoint mirror).
      // Same settings dual fence as other mutators; never touches sttEngine.
      const patch: { autoFallbackToBrowser?: boolean; modelDownloadEndpoint?: string } = {}
      if (typeof rest.autoFallbackToBrowser === "boolean") {
        patch.autoFallbackToBrowser = rest.autoFallbackToBrowser
      }
      if (typeof rest.modelDownloadEndpoint === "string") {
        try {
          patch.modelDownloadEndpoint = normalizeModelDownloadEndpoint(rest.modelDownloadEndpoint)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          logger.warn("voice.model.set_prefs.refused", { reason: "invalid-endpoint" })
          return modelError(message, { code: "INVALID_ENDPOINT" })
        }
      }
      if (patch.autoFallbackToBrowser === undefined && patch.modelDownloadEndpoint === undefined) {
        return modelError(
          "voice.model.set_prefs requires autoFallbackToBrowser or modelDownloadEndpoint",
          { code: "EMPTY_PREFS" },
        )
      }
      setVoiceFields(patch)
      logger.info("voice.model.set_prefs", { fields: Object.keys(patch) })
      const state = await statePayload(deps)
      ctx.broadcast?.(state)
      return state
    }

    case "voice.binary.download": {
      if (activeBinaryDownload) {
        return {
          type: "voice.binary.download.result" as const,
          ok: true,
          status: "already-running",
        }
      }
      if (activeDownload) {
        return modelError("模型下载进行中——请完成或取消后再下载本机组件。", {
          code: "DOWNLOAD_IN_PROGRESS",
        })
      }
      const controller = new AbortController()
      activeBinaryDownload = { controller }
      void statePayload(deps).then((s) => ctx.broadcast?.(s))
      void (async () => {
        try {
          const result = await downloadWhisperBinary({
            signal: controller.signal,
            onProgress: (p) => {
              ctx.broadcast?.({
                type: "voice.binary.progress",
                phase: p.phase,
                receivedBytes: p.receivedBytes,
                totalBytes: p.totalBytes,
                file: p.file,
              })
            },
          })
          logger.info("voice.binary.download.completed", {
            primary: result.primaryPath,
            version: result.version,
          })
        } catch (err) {
          if (err instanceof WhisperBinaryDownloadError && err.reason === "aborted") {
            logger.info("voice.binary.download.cancelled", {})
          } else if (err instanceof WhisperBinaryDownloadError && err.reason === "already-ready") {
            /* n/a */
          } else {
            const msg = err instanceof Error ? err.message : String(err)
            logger.warn("voice.binary.download.failed", { error: msg })
            ctx.broadcast?.(
              modelError(`本机组件下载失败：${msg}`, {
                code: "BINARY_DOWNLOAD_FAILED",
              }),
            )
          }
        } finally {
          activeBinaryDownload = null
          try {
            const state = await statePayload(deps)
            ctx.broadcast?.(state)
          } catch {
            /* ignore */
          }
        }
      })()
      logger.info("voice.binary.download.started", {})
      return {
        type: "voice.binary.download.result" as const,
        ok: true,
        status: "started",
      }
    }

    case "voice.binary.cancel": {
      if (!activeBinaryDownload) {
        return {
          type: "voice.binary.cancel.result" as const,
          ok: true,
          status: "not-running",
        }
      }
      activeBinaryDownload.controller.abort()
      logger.info("voice.binary.download.cancel_requested", {})
      return {
        type: "voice.binary.cancel.result" as const,
        ok: true,
        status: "cancelling",
      }
    }

    default:
      return modelError(`unknown voice.model message type: ${String(type)}`, {
        code: "UNKNOWN_TYPE",
      })
  }
}
