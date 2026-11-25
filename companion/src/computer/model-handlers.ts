// Work Center local-model management. Accepting the current license can start
// a download. Download and delete are mutually exclusive for each variant.

import * as path from "node:path"

import { logger } from "../logger"
import { getConfig, setComputerModelFields } from "../config"
import { LICENSE_DOOR_TEXT, LICENSE_DOOR_TEXT_HASH } from "./model-license"
import {
  deleteQwenVlVariant,
  downloadQwenVlVariant,
  probeQwenModelDir,
  QwenDownloadError,
} from "./qwen-vl-download"
import {
  isQwenVlVariant,
  migrateLegacyModelVariant,
  QWEN_VL_VARIANT_META,
  type QwenVlVariant,
} from "./qwen-vl-catalog"
import {
  runQwenVlPreflight,
  resolveDownloadSource,
  type DownloadSource,
} from "./qwen-vl-preflight"
import type { QwenVlSession } from "./qwen-vl-session"
import { DATA_DIR } from "../config"

export interface ComputerModelSessionHolder {
  session: Pick<
    QwenVlSession,
    "resetCircuitBreaker" | "getStatus" | "getFaults" | "dispose"
  > | null
}

export const computerModelSession: ComputerModelSessionHolder = { session: null }

export interface ComputerModelHandlerContext {
  broadcast?: (data: any) => void
}

/** 可注入依赖（测试替身；生产取默认实现）。 */
export interface ComputerModelHandlerDeps {
  downloadImpl?: typeof downloadQwenVlVariant
  deleteImpl?: typeof deleteQwenVlVariant
  /** P3 节流时钟（测试 seam，同 deps 族纪律）；默认 Date.now。 */
  now?: () => number
  /**
   * B1 test seam: override canDownload gate for download / license auto-download.
   * Production uses runQwenVlPreflight().canDownload.
   */
  canDownloadProbe?: () => boolean | Promise<{ ok: boolean; reason?: string }>
}

function modelError(error: string, extra?: Record<string, unknown>) {
  // family "computer.model"（WI-4.4）：扩展按 family 把模型错误路由到设置页
  // 实验区错误位（apps family:"apps" 先例）；旧扩展忽略 family 落 chat 流，
  // 向后兼容。computer 其余 handler 维持 family "computer" 不变。
  return { type: "error", family: "computer.model" as const, error, ...extra }
}

async function resolveCanDownload(
  deps: ComputerModelHandlerDeps,
  variant: string,
  downloadSource?: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (deps.canDownloadProbe) {
    const r = await deps.canDownloadProbe()
    if (typeof r === "boolean") return { ok: r, reason: r ? undefined : "canDownloadProbe=false" }
    return { ok: r.ok === true, reason: r.reason }
  }
  try {
    const { runQwenVlPreflight } = await import("./qwen-vl-preflight")
    const { DATA_DIR: dataDir } = await import("../config")
    const pre = await runQwenVlPreflight({
      variant,
      downloadSource: downloadSource as any,
      dataDir,
    })
    return {
      ok: pre.canDownload === true,
      reason: pre.downloadBlockReason || pre.readinessSummary,
    }
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "环境检测失败",
    }
  }
}

// --- 磁盘观测探针（get_state 轻量复验） --------------------------------------------

/** 许可证当前有效性（P1：时间戳 + 文本版本哈希双要素；漂移 = 未接受）。 */
export function modelLicenseAccepted(cfg: {
  modelLicenseAcceptedAt?: string
  modelLicenseAcceptedTextHash?: string
}): boolean {
  return (
    typeof cfg.modelLicenseAcceptedAt === "string" &&
    cfg.modelLicenseAcceptedAt !== "" &&
    cfg.modelLicenseAcceptedTextHash === LICENSE_DOOR_TEXT_HASH
  )
}

// --- 下载单飞（进程级；P10 幂等防并发不防轮询） --------------------------------------

let activeDownload: { variant: string } | null = null
/** P1：删除进行中标志（download/delete 互斥的另一向；delete×delete 幂等）。 */
let activeDelete: { variant: string } | null = null

function currentVariant(cfg: { modelVariant?: string }): QwenVlVariant {
  return migrateLegacyModelVariant(cfg.modelVariant)
}

/**
 * 当前可观测状态。Qwen3-VL：磁盘 probe 对照发版钉死 sha256；会话熔断 → disabled。
 */
async function statePayload(
  holder: ComputerModelSessionHolder,
  _deps: ComputerModelHandlerDeps = {},
  opts: { downloadError?: string } = {},
) {
  const cfg = getConfig().computer ?? { coordinateEnabled: false }
  const variant = currentVariant(cfg)
  const meta = QWEN_VL_VARIANT_META[variant]
  const session = holder.session
  let modelStatus: string
  let sizeBytes: number | undefined
  let errorReason: string | undefined
  let modelEnabled = cfg.modelEnabled === true
  if (session) {
    modelStatus = session.getStatus() === "disabled" ? "disabled" : "ready"
  } else if (activeDownload) {
    modelStatus = "downloading"
  } else {
    const probe = probeQwenModelDir(variant)
    if (modelEnabled && probe.status === "error") {
      setComputerModelFields({ modelEnabled: false })
      modelEnabled = false
      logger.warn("computer.model.qwen.disarmed_integrity", {
        variant,
        error: probe.error || probe.status,
      })
    }
    modelStatus = probe.status
    sizeBytes = probe.sizeBytes
    errorReason = probe.error
  }
  if (opts.downloadError && !session && !activeDownload && modelStatus !== "ready") {
    modelStatus = "error"
    errorReason = opts.downloadError
  }
  // Preflight is best-effort (may take a few seconds). Skip network-heavy path in unit tests.
  let preflight: Awaited<ReturnType<typeof runQwenVlPreflight>> | null = null
  if (!process.env.CMSPARK_DATA_DIR?.includes("test") && process.env.NODE_ENV !== "test") {
    try {
      preflight = await runQwenVlPreflight({
        variant,
        downloadSource: (cfg as any).modelDownloadSource as DownloadSource | undefined,
        dataDir: DATA_DIR,
      })
    } catch (e) {
      logger.warn("computer.model.preflight.failed", {
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return {
    type: "computer.model.state" as const,
    modelEnabled: false,
    licenseAccepted: modelLicenseAccepted(cfg),
    ...(typeof cfg.modelLicenseAcceptedAt === "string" ? { licenseAcceptedAt: cfg.modelLicenseAcceptedAt } : {}),
    modelLicenseDeclined: cfg.modelLicenseDeclined === true,
    modelStatus,
    variant,
    modelFamily: "qwen3-vl",
    resourceTip: meta.resourceTip,
    downloadGb: meta.downloadGb,
    minRamGb: meta.minRamGb,
    minVramGb: meta.minVramGb,
    availableVariants: ["2b", "4b", "8b"] as const,
    downloadSource: (cfg as any).modelDownloadSource ?? "auto",
    // Product UX: always emit canDownload/canEnable as booleans so the UI never
    // treats "unknown" as "allowed to click download".
    ...(preflight
      ? {
          preflight,
          canDownload: preflight.canDownload === true,
          canEnable:
            preflight.canEnable === true &&
            modelLicenseAccepted(cfg) &&
            !cfg.modelLicenseDeclined,
          readinessSummary: preflight.readinessSummary,
          nextSteps: preflight.nextSteps,
          recommendedVariant: preflight.recommendedVariant,
          downloadSourceResolved: preflight.downloadSourceResolved,
          downloadSourceReason: preflight.downloadSourceReason,
          downloadBlockReason: preflight.downloadBlockReason,
          enableBlockReason: preflight.enableBlockReason,
          modelRootDir: preflight.modelRootDir,
          pythonMode: preflight.pythonMode,
          uvAvailable: preflight.uvAvailable,
          ...(typeof preflight.uvPath === "string" && preflight.uvPath
            ? { uvPath: preflight.uvPath }
            : {}),
          ...(typeof preflight.uvInstallHint === "string" && preflight.uvInstallHint
            ? { uvInstallHint: preflight.uvInstallHint }
            : {}),
          ...(typeof preflight.pythonInstallHint === "string" && preflight.pythonInstallHint
            ? { pythonInstallHint: preflight.pythonInstallHint }
            : {}),
          ...(typeof preflight.basePythonAvailable === "boolean"
            ? { basePythonAvailable: preflight.basePythonAvailable }
            : {}),
          pythonResolution: preflight.pythonResolution,
          isolatedEnvExists: preflight.isolatedEnvExists,
          pythonPath:
            typeof cfg.pythonPath === "string" && cfg.pythonPath
              ? cfg.pythonPath
              : preflight.deps?.pythonPath,
        }
      : {
          canDownload: false,
          canEnable: false,
          readinessSummary: "正在检测本机环境（Python / 磁盘 / 硬件）…",
          nextSteps: [
            "请稍候；若长时间无结果，请重启 CMspark 后再打开本页。",
            "工作中心本机模型依赖 Python 与下载组件，不会在浏览器插件内下载模型。",
          ],
          modelRootDir: (() => {
            try {
              const { resolveModelRootDir } = require("./qwen-vl-download") as typeof import("./qwen-vl-download")
              return resolveModelRootDir()
            } catch {
              return ""
            }
          })(),
          pythonMode: "isolated",
          uvAvailable: false,
          // N5: both state paths surface uv fields when known; pending path has none
        }),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    ...(errorReason !== undefined ? { error: errorReason } : {}),
    faults: session?.getFaults() ?? 0,
  }
}

/** 后台下载 Qwen3-VL（HF snapshot；进度 best-effort）。 */
function startBackgroundDownload(
  variant: QwenVlVariant,
  ctx: ComputerModelHandlerContext,
  deps: ComputerModelHandlerDeps,
  holder: ComputerModelSessionHolder,
): void {
  activeDownload = { variant }
  void statePayload(holder, deps).then((s) => ctx.broadcast?.(s))
  const cfg = getConfig().computer ?? { coordinateEnabled: false }
  const now = deps.now ?? Date.now
  let lastSentAt = 0
  void (async () => {
    let downloadError: string | undefined
    try {
      const preferred = ((cfg as any).modelDownloadSource as DownloadSource | undefined) ?? "auto"
      // Unit tests: avoid network probes; default modelscope for deterministic offline path.
      const resolved =
        process.env.CMSPARK_DATA_DIR?.includes("test") || process.env.NODE_ENV === "test"
          ? { source: "modelscope" as const, reason: "test" }
          : await resolveDownloadSource(preferred)
      await (deps.downloadImpl ?? downloadQwenVlVariant)({
        variant,
        source: resolved.source,
        hfEndpoint:
          resolved.source === "hf-mirror"
            ? cfg.modelMirror || "https://hf-mirror.com"
            : cfg.modelMirror,
        onProgress: (file, receivedBytes, totalBytes) => {
          const t = now()
          if (t - lastSentAt < 200) return
          lastSentAt = t
          ctx.broadcast?.({ type: "computer.model.progress", variant, file, receivedBytes, totalBytes })
        },
      })
      logger.info("computer.model.download.completed", {
        variant,
        family: "qwen3-vl",
        source: resolved.source,
      })
    } catch (err) {
      const reason = err instanceof QwenDownloadError ? err.reason : "network-error"
      downloadError = reason
      logger.warn("computer.model.download.failed", { variant, reason })
    } finally {
      activeDownload = null
      void statePayload(holder, deps, downloadError ? { downloadError } : {}).then((s) => ctx.broadcast?.(s))
    }
  })()
}

export async function handleComputerModelMessage(
  msg: any,
  ctx: ComputerModelHandlerContext = {},
  holder: ComputerModelSessionHolder = computerModelSession,
  deps: ComputerModelHandlerDeps = {},
): Promise<any> {
  const { type, ...rest } = msg

  // P6：四新 case + reset 均 handler 层 belt 复核 settings 来源（防校验面被绕过/
  // 未来直调；validateWsMessage 是第一层）。license_response/set_enabled 形状
  // 字段由 validateWsMessage 强制，此处只复核 source。
  const SETTINGS_SOURCE_TYPES = new Set([
    "computer.model.get_license",
    "computer.model.set_enabled",
    "computer.model.license_response",
    "computer.model.download",
    "computer.model.delete",
    "computer.model.reset_circuit_breaker",
    "computer.model.set_variant",
    "computer.model.set_download_source",
    "computer.model.set_model_root",
    "computer.model.pick_model_root",
    "computer.model.set_python_mode",
    "computer.model.pick_python_path",
    "computer.model.ensure_python_env",
    "computer.model.install_deps",
  ])
  if (SETTINGS_SOURCE_TYPES.has(type) && rest.source !== "settings") {
    logger.warn("computer.model.refused", { type, source: typeof rest.source === "string" ? rest.source : undefined })
    return modelError(`${type} only accepts the settings-page source (source:"settings")`, { code: "INVALID_SOURCE" })
  }

  switch (type) {
    case "computer.model.get_state":
      return statePayload(holder, deps)

    case "computer.model.get_license":
      return { type: "computer.model.license_required", licenseText: LICENSE_DOOR_TEXT, notice: "接受后可下载本机模型，用于工作中心图像处理。" }

    case "computer.model.set_enabled": {
      const enabled = rest.enabled === true
      // 禁用永远免费（fail-closed 方向，computer.set_enabled 先例）：
      // dispose 会话 + holder=null（裁决 4），广播最新状态。
      if (!enabled) {
        setComputerModelFields({ modelEnabled: false })
        if (holder.session) {
          try {
            await holder.session.dispose()
          } catch {
            /* best-effort dispose */
          }
          holder.session = null
        }
        logger.info("computer.model.disabled", {})
        const state = await statePayload(holder, deps)
        ctx.broadcast?.(state)
        return state
      }
      return modelError("桌面点击定位已改用原生控件、OCR 和可选的主模型。", { code: "DESKTOP_LOCATOR_RETIRED" })
    }

    case "computer.model.license_response": {
      // D9 / F2-D: settings may clear a prior decline without accepting the license.
      if (rest.reset_decline === true || rest.resetDecline === true) {
        setComputerModelFields({ modelLicenseDeclined: false })
        logger.info("computer.model.license_decline_reset", { source: rest.source })
        const state = await statePayload(holder, deps)
        ctx.broadcast?.(state)
        return { ...state, declineReset: true }
      }
      if (rest.accepted === true) {
        // 接受：写时间戳 + 文本版本哈希（P1）+ 清拒绝标记，自动触发 download（裁决 2）
        setComputerModelFields({
          modelLicenseAcceptedAt: new Date().toISOString(),
          modelLicenseAcceptedTextHash: LICENSE_DOOR_TEXT_HASH,
          modelLicenseDeclined: false,
        })
        logger.info("computer.model.license_accepted", { textHash: LICENSE_DOOR_TEXT_HASH })
        const cfg = getConfig().computer ?? { coordinateEnabled: false }
        const variant = currentVariant(cfg)
        let downloadNote: string | undefined
        if (activeDownload) {
          downloadNote = "already-running"
        } else if (activeDelete) {
          downloadNote = "delete-in-progress"
          logger.warn("computer.model.download.refused", { reason: "delete-in-progress", variant })
        } else {
          // B2: only auto-download when env is ready (same truth as preflight canDownload)
          const ready = await resolveCanDownload(deps, variant, (cfg as any).modelDownloadSource)
          if (ready.ok) {
            startBackgroundDownload(variant, ctx, deps, holder)
            downloadNote = "started"
          } else {
            downloadNote = "skipped-env-not-ready"
            logger.info("computer.model.download.skipped_after_license", {
              reason: ready.reason || "canDownload=false",
            })
          }
        }
        const state = await statePayload(holder, deps)
        ctx.broadcast?.(state)
        return { ...state, download: downloadNote }
      }
      // 拒绝：跳过；设置页可通过 reset_decline 复位（D9）
      setComputerModelFields({ modelLicenseDeclined: true })
      logger.info("computer.model.license_declined", {})
      const state = await statePayload(holder, deps)
      ctx.broadcast?.(state)
      return state
    }

    case "computer.model.download": {
      const cfg = getConfig().computer ?? { coordinateEnabled: false }
      const variant = currentVariant(cfg)
      if (activeDownload) {
        return { type: "computer.model.download.result" as const, ok: true, status: "already-running", variant }
      }
      if (activeDelete) {
        logger.warn("computer.model.download.refused", { reason: "delete-in-progress", variant })
        return modelError(
          "模型删除进行中——待其完成后重试下载；本次未发起任何网络请求。",
          { code: "DELETE_IN_PROGRESS" },
        )
      }
      // B1: trust-boundary gate — UI button is not sufficient (handler is SoT)
      const ready = await resolveCanDownload(deps, variant, (cfg as any).modelDownloadSource)
      if (!ready.ok) {
        logger.warn("computer.model.download.refused", {
          reason: "env-not-ready",
          detail: ready.reason,
        })
        return modelError(
          ready.reason || "环境未就绪，无法下载。请先完成设置页「环境检查」。",
          { code: "CANNOT_DOWNLOAD" },
        )
      }
      startBackgroundDownload(variant, ctx, deps, holder)
      logger.info("computer.model.download.started", { variant, family: "qwen3-vl" })
      return { type: "computer.model.download.result" as const, ok: true, status: "started", variant }
    }

    case "computer.model.set_variant": {
      const raw = rest.variant
      if (!isQwenVlVariant(raw)) {
        return modelError('computer.model.set_variant requires variant:"2b"|"4b"|"8b"', {
          code: "INVALID_VARIANT",
        })
      }
      if (activeDownload) {
        return modelError("模型下载进行中——请待完成后切换变体。", { code: "DOWNLOAD_IN_PROGRESS" })
      }
      // Dispose session so next admission loads the new size
      if (holder.session) {
        try {
          await holder.session.dispose()
        } catch {
          /* best-effort */
        }
        holder.session = null
      }
      setComputerModelFields({ modelVariant: raw })
      logger.info("computer.model.variant_set", { variant: raw })
      const state = await statePayload(holder, deps)
      ctx.broadcast?.(state)
      return state
    }

    case "computer.model.set_download_source": {
      const raw = rest.downloadSource ?? rest.source_value
      const ok =
        raw === "auto" || raw === "huggingface" || raw === "hf-mirror" || raw === "modelscope"
      if (!ok) {
        return modelError(
          'computer.model.set_download_source requires downloadSource:"auto"|"huggingface"|"hf-mirror"|"modelscope"',
          { code: "INVALID_DOWNLOAD_SOURCE" },
        )
      }
      setComputerModelFields({ modelDownloadSource: raw })
      logger.info("computer.model.download_source_set", { downloadSource: raw })
      const state = await statePayload(holder, deps)
      ctx.broadcast?.(state)
      return state
    }

    case "computer.model.set_model_root": {
      const { validateModelRootDir, resolveModelRootDir } = await import("./qwen-vl-download")
      const { DATA_DIR: dataDir } = await import("../config")
      const raw = typeof rest.path === "string" ? rest.path : typeof rest.modelRootDir === "string" ? rest.modelRootDir : ""
      if (rest.reset === true || raw === "" || raw === "default") {
        const def = path.join(dataDir, "models")
        const v = validateModelRootDir(def)
        if (!v.ok) return modelError(v.error, { code: "INVALID_MODEL_ROOT" })
        setComputerModelFields({ modelRootDir: v.path })
        logger.info("computer.model.model_root_reset", { path: v.path })
      } else {
        const v = validateModelRootDir(raw)
        if (!v.ok) return modelError(v.error, { code: "INVALID_MODEL_ROOT" })
        setComputerModelFields({ modelRootDir: v.path })
        logger.info("computer.model.model_root_set", { path: v.path })
      }
      const state = await statePayload(holder, deps)
      ctx.broadcast?.(state)
      return { ...state, modelRootDir: resolveModelRootDir() }
    }

    case "computer.model.pick_model_root": {
      const { pickFolderNative } = await import("../obsidian/folder-picker")
      const { validateModelRootDir, resolveModelRootDir } = await import("./qwen-vl-download")
      const picked = await pickFolderNative()
      if (picked.error === "cancelled") {
        return { type: "computer.model.pick_model_root.result", ok: false, cancelled: true }
      }
      if (picked.error || !picked.path) {
        return modelError(picked.error || "未选择文件夹", { code: "PICK_FAILED" })
      }
      const v = validateModelRootDir(picked.path)
      if (!v.ok) return modelError(v.error, { code: "INVALID_MODEL_ROOT" })
      setComputerModelFields({ modelRootDir: v.path })
      logger.info("computer.model.model_root_picked", { path: v.path })
      const state = await statePayload(holder, deps)
      ctx.broadcast?.(state)
      return { ...state, ok: true, modelRootDir: resolveModelRootDir() }
    }

    case "computer.model.set_python_mode": {
      const mode = rest.mode === "system" ? "system" : rest.mode === "isolated" ? "isolated" : null
      if (!mode) {
        return modelError('computer.model.set_python_mode requires mode:"isolated"|"system"', {
          code: "INVALID_PYTHON_MODE",
        })
      }
      const patch: Parameters<typeof setComputerModelFields>[0] = { pythonMode: mode }
      if (mode === "system" && typeof rest.pythonPath === "string" && rest.pythonPath.trim()) {
        const p = rest.pythonPath.trim()
        if (path.isAbsolute(p)) {
          const { validatePythonExecutable } = await import("./python-runtime")
          const v = await validatePythonExecutable(p)
          if (!v.ok) return modelError(v.error, { code: "INVALID_PYTHON_PATH" })
          patch.pythonPath = v.path
        }
      }
      if (mode === "isolated") {
        // clear system override so isolated is unambiguous
        patch.pythonPath = undefined as any
      }
      setComputerModelFields(patch)
      logger.info("computer.model.python_mode_set", { mode })
      const state = await statePayload(holder, deps)
      ctx.broadcast?.(state)
      return state
    }

    case "computer.model.pick_python_path": {
      const { pickFileNative } = await import("../obsidian/folder-picker")
      const { validatePythonExecutable } = await import("./python-runtime")
      const picked = await pickFileNative({
        prompt: "选择本机 Python 可执行文件（python3 / python）",
      })
      if (picked.error === "cancelled") {
        return { type: "computer.model.pick_python_path.result", ok: false, cancelled: true }
      }
      if (picked.error || !picked.path) {
        return modelError(picked.error || "未选择文件", { code: "PICK_FAILED" })
      }
      const v = await validatePythonExecutable(picked.path)
      if (!v.ok) return modelError(v.error, { code: "INVALID_PYTHON_PATH" })
      setComputerModelFields({ pythonMode: "system", pythonPath: v.path })
      logger.info("computer.model.python_path_picked", { path: v.path })
      const state = await statePayload(holder, deps)
      ctx.broadcast?.(state)
      return {
        ...state,
        type: "computer.model.pick_python_path.result",
        ok: true,
        pythonPath: v.path,
      }
    }

    case "computer.model.ensure_python_env": {
      const { ensureIsolatedPythonEnv, sanitizePythonPackages } = await import("./python-runtime")
      // S36 P0: only persist pythonMode after env create succeeds (failed ensure
      // must not trap system users on broken isolated mode).
      const pkgs = sanitizePythonPackages(rest.packages)
      const result = await ensureIsolatedPythonEnv(pkgs)
      if (result.ok) {
        setComputerModelFields({ pythonMode: "isolated" })
      }
      logger.info("computer.model.ensure_python_env", {
        ok: result.ok,
        usedUv: result.usedUv,
        error: result.error,
      })
      const state = await statePayload(holder, deps)
      ctx.broadcast?.(state)
      return {
        ...state,
        type: "computer.model.ensure_python_env.result",
        ok: result.ok,
        usedUv: result.usedUv,
        pythonPath: result.pythonPath,
        log: result.log,
        error: result.error,
      }
    }

    case "computer.model.install_deps": {
      // Install into current mode env (isolated preferred via ensure; system uses pip/uv)
      const { ensureIsolatedPythonEnv, buildInstallCommands, resolvePythonRuntime, sanitizePythonPackages } =
        await import("./python-runtime")
      const mode = getConfig().computer?.pythonMode === "system" ? "system" : "isolated"
      const pkgs = sanitizePythonPackages(rest.packages)
      if (mode === "isolated") {
        const result = await ensureIsolatedPythonEnv(pkgs)
        const state = await statePayload(holder, deps)
        ctx.broadcast?.(state)
        return {
          ...state,
          type: "computer.model.install_deps.result",
          ok: result.ok,
          usedUv: result.usedUv,
          log: result.log,
          error: result.error,
        }
      }
      const runtime = await resolvePythonRuntime({ mode: "system", systemPythonPath: getConfig().computer?.pythonPath })
      const cmds = buildInstallCommands({
        mode: "system",
        uvAvailable: runtime.uvAvailable,
        uvPath: runtime.uvPath,
        packages: pkgs,
        pythonPath: runtime.pythonPath,
      })
      // Don't auto-run against system python without user terminal — return commands
      const state = await statePayload(holder, deps)
      return {
        ...state,
        type: "computer.model.install_deps.result",
        ok: false,
        needsManual: true,
        installCommands: cmds,
        error: "全局 Python 模式：请在终端执行返回的命令（避免静默改动系统环境）",
      }
    }

    case "computer.model.delete": {
      const cfg = getConfig().computer ?? { coordinateEnabled: false }
      const variant = currentVariant(cfg)
      // P1 互斥：下载中拒删（否则 Windows rm 撞 .part 占用 → 裸 EPERM 穿透 +
      // 会话已 dispose + 文件复现；类 Unix 下载以误导性 network-error 收尾）。
      // 拒绝先于 dispose——会话与文件零触碰。
      if (activeDownload) {
        logger.warn("computer.model.delete.refused", { reason: "download-in-progress", variant })
        return modelError(
          "模型下载进行中——待下载完成或失败后重试删除；已安装文件、会话与配置均未改动。",
          { code: "DOWNLOAD_IN_PROGRESS" },
        )
      }
      if (activeDelete) {
        return { type: "computer.model.delete.result" as const, ok: true, status: "already-running", variant }
      }
      activeDelete = { variant }
      try {
        // dispose 会话 + holder=null（裁决 4）；删除是 fail-closed 方向免费动作
        if (holder.session) {
          try {
            await holder.session.dispose()
          } catch {
            /* best-effort dispose */
          }
          holder.session = null
        }
        const { removedBytes } = await (deps.deleteImpl ?? deleteQwenVlVariant)(variant)
        logger.info("computer.model.deleted", { variant, removedBytes })
        const state = await statePayload(holder, deps)
        ctx.broadcast?.(state)
        return { type: "computer.model.delete.result" as const, ok: true, variant, removedBytes }
      } catch (err) {
        // P1：删除失败归一为结构化返回（裸 fs 错误不穿透顶层 catch）；会话已
        // dispose 属实——广播最新状态让 UI 如实落位，重试删除语义不受损。
        logger.warn("computer.model.delete.failed", {
          variant,
          error: err instanceof Error ? err.message : String(err),
        })
        const state = await statePayload(holder, deps)
        ctx.broadcast?.(state)
        return modelError(
          `模型删除失败：${err instanceof Error ? err.message : String(err)}——可重试删除；实验层会话已关闭，桌面操作不受影响。`,
          { code: "DELETE_FAILED" },
        )
      } finally {
        activeDelete = null
      }
    }

    case "computer.model.reset_circuit_breaker": {
      const session = holder.session
      if (!session) {
        // 无会话 = 模型从未加载（或已 dispose）——熔断无从谈起。诚实 no-op：
        // 不伪造一次复位、不广播（无状态变化）。
        logger.info("computer.model.circuit_reset.noop", { reason: "no-session" })
        return { ...(await statePayload(holder, deps)), note: "no-session" }
      }
      session.resetCircuitBreaker()
      logger.info("computer.model.circuit_reset", { source: "settings" })
      const state = await statePayload(holder, deps)
      ctx.broadcast?.(state) // 设置页状态行随广播刷新（plan:480 状态变更广播）
      return state
    }

    default:
      return modelError(`Unknown computer model message type: ${type}`)
  }
}
