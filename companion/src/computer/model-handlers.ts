// WP5 I3 登记项③ + WP5-I4 WI-4.2 — computer.model.* WS handlers。
//
// ③ 围栏（父指令 + plan:480 M3）：reset_circuit_breaker 仅接受设置页声明来源
// （source:"settings"）——validateWsMessage 形状校验（server.ts）+ 本 handler
// 二次核查（belt：防校验面被绕过 / 未来调用方直调）+ 审计日志。
// 诚实边界：source 是声明式来源（同一 WS 连接内的页面标识），非密码学校验——
// 真正的安全性质来自动作本身无副作用（只复位熔断计数，不注入、不授权、不改
// 配置）；围栏防的是自动化循环调用把崩溃模型维持在「崩溃→复位→再崩溃」DoS
// 循环里（plan 攻击面 3 / A8）。
//
// WI-4.2 四路由（I4 详案 plan:536-542 + 设计裁决 1/2/4/5 + P1/P3/P5/P6）：
//   - set_enabled(true)：license 未接受/条款漂移 → license_required（config 零
//     写入）；已拒绝 → LICENSE_DECLINED（跳过，无 UI 复位）；已接受 →
//     D2 生物识别门（裁决 1：持久能力授权与 apps coordinateAllowed 同级；
//     clear 免费）。license_response/download/delete 不过门，但均 settings
//     双层围栏（validateWsMessage + 本 handler belt 复核，P6）。
//   - license_response accepted:true → 写时间戳 + LICENSE_DOOR_TEXT_HASH（P1
//     文本版本绑定；漂移重门在 set_enabled/admission 侧比对）+ 自动触发 download；
//     accepted:false → modelLicenseDeclined=true（跳过）。
//   - download：按当前配置变体下载文件组（P3）；占位主机 .invalid 且未配镜像
//     → fail-fast download-host-unset（零网络请求，裁决 5）；进程级单飞幂等
//     （P10：防并发不防轮询——轮询 DoS 残余声明入 i4-implementation-notes）。
//   - delete：dispose 会话 + holder=null + 删除当前变体目录（fail-closed 方向
//     免费，仅 settings 双层围栏）。
//   - disable/delete → dispose + holder=null（裁决 4）；熔断保活不 dispose
//     （reset_circuit_breaker 真复位语义维持 I2 终审）。
//
// I4 对抗修复 P1（2026-07-21，LOW-MED 必修）：download/delete handler 级状态
// 互斥——handler 是信任边界，围栏不设于 UI 按钮态假设之上：
//   - 下载中 delete → 拒（DOWNLOAD_IN_PROGRESS）：否则 Windows 上 rm 撞 .part
//     写流占用 → EPERM 裸错误穿透、会话已 dispose、下载完成后文件复现；
//     类 Unix 上 rm 胜 → 下载终段 stat 失败、以误导性 network-error 收尾。
//   - delete 中 download（含 license_response 自动触发）→ 拒（DELETE_IN_PROGRESS
//     / note=delete-in-progress）：否则 mkdir recursive 与 rm recursive 竞态
//     （ENOTEMPTY 或「删除成功但文件随即重建」）。
//   - delete×delete → already-running 幂等（与 download 单飞同型）。
//   - deleteImpl 错误归一为结构化返回（DELETE_FAILED + 状态广播），不穿透裸
//     fs 错误。互斥只防并发不防轮询（P10 同型，损害有界声明在案）。

import * as fs from "node:fs"
import * as path from "node:path"

import { logger } from "../logger"
import { getConfig, setComputerModelFields } from "../config"
import { LICENSE_DOOR_TEXT, LICENSE_DOOR_TEXT_HASH } from "./model-license"
import { loadModelManifest, type ModelManifest } from "./model-manifest"
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
import { requireAppsBiometric } from "../apps/biometric-gate"
import { DATA_DIR } from "../config"

/**
 * 进程级模型会话持有器——写入点仅三处（P8 符号级注释契约，WI-4.5 grep 在案化）：
 *   ① admission 全通过懒建（model-admission.ts，WI-4.3）
 *   ② disable/delete dispose 后置 null（本文件）
 *   ③ 测试注入自有实例
 * 单例即进程级真相（模型会话全局至多一个，与 host_computer 全局单任务不变量同型）。
 */
export interface ComputerModelSessionHolder {
  session: Pick<
    QwenVlSession,
    "resetCircuitBreaker" | "getStatus" | "getFaults" | "dispose"
  > | null
}

/** 生产默认持有器（server.ts 与 admission 接线共享同一实例；测试注入自有实例）。 */
export const computerModelSession: ComputerModelSessionHolder = { session: null }

export interface ComputerModelHandlerContext {
  broadcast?: (data: any) => void
  /** P5：生物识别门依赖的确认通道（apps/computer set_enabled 先例）；缺则 NO_CONFIRMATION_CHANNEL。 */
  requestConfirmation?: (...args: any[]) => Promise<any>
}

/** 可注入依赖（测试替身；生产取默认实现）。 */
export interface ComputerModelHandlerDeps {
  gate?: typeof requireAppsBiometric
  /** @deprecated TinyClick path; ignored for Qwen3-VL downloads */
  manifestLoader?: () => Promise<ModelManifest>
  downloadImpl?: typeof downloadQwenVlVariant
  deleteImpl?: typeof deleteQwenVlVariant
  /** P3 节流时钟（测试 seam，同 deps 族纪律）；默认 Date.now。 */
  now?: () => number
  /**
   * L-QW-1: probe whether experimental layer may be enabled (model ready + deps).
   * Tests inject; production uses preflight + probeQwenModelDir.
   * Return false → set_enabled(true) hard-refuses with zero config write.
   */
  canEnableProbe?: () => boolean | Promise<boolean>
}

function modelError(error: string, extra?: Record<string, unknown>) {
  // family "computer.model"（WI-4.4）：扩展按 family 把模型错误路由到设置页
  // 实验区错误位（apps family:"apps" 先例）；旧扩展忽略 family 落 chat 流，
  // 向后兼容。computer 其余 handler 维持 family "computer" 不变。
  return { type: "error", family: "computer.model" as const, error, ...extra }
}

/** manifest 随发版路径解析：src 布局（companion/src/computer → 上两级）/
 * .test-dist 布局（companion/.test-dist/src/computer → 上三级）/ bundle 同级，
 * 首个存在者胜。 */
export function defaultManifestPath(): string {
  const candidates = [
    path.join(__dirname, "..", "..", "models.manifest.json"), // companion/src/computer → companion/
    path.join(__dirname, "..", "..", "..", "models.manifest.json"), // companion/.test-dist/src/computer → companion/
    path.join(__dirname, "models.manifest.json"), // esbuild bundle 同级
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]!
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
 * 当前可观测状态。Qwen3-VL：磁盘 probe 看 config.json；会话熔断 → disabled。
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
  if (session) {
    modelStatus = session.getStatus() === "disabled" ? "disabled" : "ready"
  } else if (activeDownload) {
    modelStatus = "downloading"
  } else {
    const probe = probeQwenModelDir(variant)
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
    modelEnabled: cfg.modelEnabled === true,
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
        }
      : {
          canDownload: false,
          canEnable: false,
          readinessSummary: "正在检测本机环境（Python / 磁盘 / 硬件）…",
          nextSteps: [
            "请稍候；若长时间无结果，请重启 CMspark 后再打开本页。",
            "实验层依赖本机 Python 与下载组件，不会在浏览器插件内下载模型。",
          ],
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
    "computer.model.set_enabled",
    "computer.model.license_response",
    "computer.model.download",
    "computer.model.delete",
    "computer.model.reset_circuit_breaker",
    "computer.model.set_variant",
    "computer.model.set_download_source",
  ])
  if (SETTINGS_SOURCE_TYPES.has(type) && rest.source !== "settings") {
    logger.warn("computer.model.refused", { type, source: typeof rest.source === "string" ? rest.source : undefined })
    return modelError(`${type} only accepts the settings-page source (source:"settings")`, { code: "INVALID_SOURCE" })
  }

  switch (type) {
    case "computer.model.get_state":
      return statePayload(holder, deps)

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
      const cfg = getConfig().computer ?? { coordinateEnabled: false }
      // 许可证状态机（裁决 2）：已拒绝 → 跳过；未接受/条款漂移（P1 哈希
      // 不符）→ license_required（config 零写入）。
      if (cfg.modelLicenseDeclined === true) {
        return modelError(
          "实验层许可证已被拒绝。可在设置页实验层点击「复位许可拒绝」后重新阅读并接受条款（无需手改 config.json）",
          { code: "LICENSE_DECLINED" },
        )
      }
      if (!modelLicenseAccepted(cfg)) {
        return {
          type: "computer.model.license_required" as const,
          licenseText: LICENSE_DOOR_TEXT,
          notice: "阅读并接受许可证与免责声明后可开启实验层；拒绝则本层跳过，其余定位层不受影响。之后可在设置页「复位许可拒绝」重新打开流程。",
        }
      }
      // L-QW-1 / SoT D1: hard-disable enable unless canEnable (model + infer deps).
      // Zero config write on fail — UI may show canEnable:false but API must not arm.
      {
        let can = true
        if (deps.canEnableProbe) {
          can = await deps.canEnableProbe()
        } else {
          try {
            const probe = probeQwenModelDir(currentVariant(cfg))
            if (probe.status !== "ready") {
              can = false
            } else {
              const pre = await runQwenVlPreflight({
                variant: currentVariant(cfg),
                downloadSource: (cfg as any).modelDownloadSource as DownloadSource | undefined,
                dataDir: DATA_DIR,
              })
              can = pre.canEnable === true
            }
          } catch {
            can = false
          }
        }
        if (!can) {
          return modelError(
            "实验层尚未就绪（模型未下载、推理依赖未齐或 worker 不可用），无法开启",
            { code: "CANNOT_ENABLE" },
          )
        }
      }
      // 已接受 → D2 生物识别门（裁决 1：持久能力授权，apps coordinateAllowed 先例）
      if (!ctx.requestConfirmation) {
        return modelError("computer.model.set_enabled(true) requires an interactive confirmation channel", {
          code: "NO_CONFIRMATION_CHANNEL",
        })
      }
      const gate = deps.gate ?? requireAppsBiometric
      const outcome = await gate({
        action: "computer.model.set_enabled",
        reason:
          "Enable Qwen3-VL experimental locate layer (uncalibrated local-model suggestions; every hit still requires per-action human confirmation)",
        requestConfirmation: ctx.requestConfirmation,
      })
      if (!outcome.approved) {
        logger.warn("computer.model.enable_denied", { reason: outcome.reason })
        return modelError(
          `enabling experimental layer ${outcome.reason === "cancelled" ? "cancelled by user" : `denied (${outcome.reason})`} — stays OFF`,
          { code: "BIOMETRIC_DENIED", reason: outcome.reason },
        )
      }
      setComputerModelFields({ modelEnabled: true })
      logger.info("computer.model.enabled", { method: outcome.method })
      const state = await statePayload(holder, deps)
      ctx.broadcast?.(state)
      return state
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
          startBackgroundDownload(variant, ctx, deps, holder)
          downloadNote = "started"
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
          `模型删除失败：${err instanceof Error ? err.message : String(err)}——可重试删除；实验层会话已关闭，UIA / OCR / 用户框选定位不受影响。`,
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
