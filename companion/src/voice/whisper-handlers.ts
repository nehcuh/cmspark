// Path B M0 — voice.model.* WS handlers (ADR-023 L7 dual fence).
//
// Discipline mirrors computer/model-handlers.ts:
//   - validateWsMessage (server.ts) is layer 1 shape + source fence
//   - this module re-checks source:"settings" on all mutators (belt / P6)
//   - download/delete mutex (DOWNLOAD_IN_PROGRESS / DELETE_IN_PROGRESS)
//   - set_engine local refuses with ZERO config write if no ready model
//   - set_active only when probe status === ready
//   - delete of active model while engine=local → force sttEngine browser
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
  probeWhisperModelDir,
  resolveWhisperRoot,
  WhisperDownloadError,
} from "./whisper-download"
import {
  buildVoiceModelState,
  listReadyWhisperModels,
  type BuildVoiceModelStateOpts,
  type VoiceModelStatePayload,
} from "./whisper-state"

// --- types --------------------------------------------------------------------

export interface VoiceModelHandlerContext {
  broadcast?: (data: any) => void
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

let activeDownload: ActiveDownload | null = null
let activeDelete: ActiveDelete | null = null

/** Test seam: clear download/delete mutex + abort any in-flight controller. */
export function _resetVoiceModelHandlersForTests(): void {
  if (activeDownload) {
    try {
      activeDownload.controller.abort()
    } catch {
      /* ignore */
    }
  }
  activeDownload = null
  activeDelete = null
}

// --- errors -------------------------------------------------------------------

function modelError(error: string, extra?: Record<string, unknown>) {
  return { type: "error" as const, family: "voice.model" as const, error, ...extra }
}

const SETTINGS_SOURCE_TYPES = new Set([
  "voice.model.download",
  "voice.model.cancel",
  "voice.model.delete",
  "voice.model.set_active",
  "voice.model.set_engine",
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
        // Push machine error into family:"voice.model" so Side Panel shows it
        // (not only probe residue like unexpected-files).
        ctx.broadcast?.(
          modelError(downloadError, {
            code: "DOWNLOAD_FAILED",
            modelId,
          }),
        )
        ctx.broadcast?.({
          ...state,
          lastDownloadError: downloadError,
          lastDownloadModelId: modelId,
        })
      } else {
        ctx.broadcast?.(state)
      }
    }
  })()
}

// --- handler ------------------------------------------------------------------

export async function handleVoiceModelMessage(
  msg: any,
  ctx: VoiceModelHandlerContext = {},
  deps: VoiceModelHandlerDeps = {},
): Promise<any> {
  const { type, ...rest } = msg ?? {}

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
      const state = await statePayload(deps)
      return state
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

    default:
      return modelError(`unknown voice.model message type: ${String(type)}`, {
        code: "UNKNOWN_TYPE",
      })
  }
}
