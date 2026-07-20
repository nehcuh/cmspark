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
//     写入）；已拒绝 → LICENSE_DECLINED（永久跳过，无 UI 复位）；已接受 →
//     D2 生物识别门（裁决 1：持久能力授权与 apps coordinateAllowed 同级；
//     clear 免费）。license_response/download/delete 不过门，但均 settings
//     双层围栏（validateWsMessage + 本 handler belt 复核，P6）。
//   - license_response accepted:true → 写时间戳 + LICENSE_DOOR_TEXT_HASH（P1
//     文本版本绑定；漂移重门在 set_enabled/admission 侧比对）+ 自动触发 download；
//     accepted:false → modelLicenseDeclined=true（永久跳过）。
//   - download：按当前配置变体下载文件组（P3）；占位主机 .invalid 且未配镜像
//     → fail-fast download-host-unset（零网络请求，裁决 5）；进程级单飞幂等
//     （P10：防并发不防轮询——轮询 DoS 残余声明入 i4-implementation-notes）。
//   - delete：dispose 会话 + holder=null + 删除当前变体目录（fail-closed 方向
//     免费，仅 settings 双层围栏）。
//   - disable/delete → dispose + holder=null（裁决 4）；熔断保活不 dispose
//     （reset_circuit_breaker 真复位语义维持 I2 终审）。

import * as fs from "node:fs"
import * as path from "node:path"

import { logger } from "../logger"
import { getConfig, setComputerModelFields } from "../config"
import { LICENSE_DOOR_TEXT, LICENSE_DOOR_TEXT_HASH } from "./model-license"
import { loadModelManifest, modelDirFor, type ModelManifest } from "./model-manifest"
import { downloadModelVariant, deleteModelVariant, ModelDownloadError } from "./model-download"
import type { TinyClickSession } from "./tinyclick-session"
import { requireAppsBiometric } from "../apps/biometric-gate"

/**
 * 进程级模型会话持有器——写入点仅三处（P8 符号级注释契约，WI-4.5 grep 在案化）：
 *   ① admission 全通过懒建（model-admission.ts，WI-4.3）
 *   ② disable/delete dispose 后置 null（本文件）
 *   ③ 测试注入自有实例
 * 单例即进程级真相（模型会话全局至多一个，与 host_computer 全局单任务不变量同型）。
 */
export interface ComputerModelSessionHolder {
  session: Pick<
    TinyClickSession,
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
  manifestLoader?: () => Promise<ModelManifest>
  downloadImpl?: typeof downloadModelVariant
  deleteImpl?: typeof deleteModelVariant
}

function modelError(error: string, extra?: Record<string, unknown>) {
  return { type: "error", family: "computer" as const, error, ...extra }
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

interface ModelDirProbe {
  /** absent=目录/文件全无；error=部分缺失或大小不符；ready=全文件在盘且大小相符 */
  status: "absent" | "error" | "ready"
  sizeBytes?: number
  error?: string
}

/**
 * 状态行轻量复验：存在性 + 大小（stat 级，不读字节——705MB 全量 sha256 复验在
 * admission 懒建会话时强制执行（I1 校验即加载），get_state 不做重活）。
 * 哈希损坏 → admission 拒绝并广播 error（fail-closed 方向，UI 观测面诚实边界在案）。
 */
function probeModelDir(variant: string, manifest: ModelManifest): ModelDirProbe {
  const files = manifest.models.tinyclick?.variants[variant]?.files ?? []
  if (files.length === 0) return { status: "error", error: "variant-unknown" }
  const dir = modelDirFor(variant)
  let sizeBytes = 0
  let sawAny = false
  for (const f of files) {
    try {
      const s = fs.statSync(path.join(dir, f.name))
      sawAny = true
      if (s.size !== f.size) return { status: "error", error: "model-size-mismatch" }
      sizeBytes += s.size
    } catch {
      // 单个文件缺失：全缺 = absent，部分缺 = error（半成品态）
      if (sawAny) return { status: "error", error: "model-file-missing" }
      return files.indexOf(f) === 0 ? { status: "absent" } : { status: "error", error: "model-file-missing" }
    }
  }
  return { status: "ready", sizeBytes }
}

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

/** 占位主机判定（裁决 5）：manifest url 主机为 .invalid TLD（RFC 2606）且未配镜像。 */
function isPlaceholderHost(manifest: ModelManifest, variant: string): boolean {
  const files = manifest.models.tinyclick?.variants[variant]?.files ?? []
  return files.every((f) => {
    try {
      return new URL(f.url).hostname.endsWith(".invalid")
    } catch {
      return false
    }
  })
}

/**
 * 当前可观测状态（plan:476 全形）。modelStatus 映射：
 *   有会话：getStatus()==="disabled" → "disabled"（熔断）；其余 → "ready"
 *   无会话：下载中 → "downloading"；磁盘轻量复验 absent/error/ready 细分（WI-4.2
 *   补全③留位）；error 附 reason（I1 词表），UI 走 model-state-messages 文案。
 */
async function statePayload(
  holder: ComputerModelSessionHolder,
  deps: ComputerModelHandlerDeps = {},
) {
  const cfg = getConfig().computer ?? { coordinateEnabled: false }
  const variant = cfg.modelVariant ?? "hybrid"
  const session = holder.session
  let modelStatus: string
  let sizeBytes: number | undefined
  let errorReason: string | undefined
  if (session) {
    modelStatus = session.getStatus() === "disabled" ? "disabled" : "ready"
  } else if (activeDownload) {
    modelStatus = "downloading"
  } else {
    try {
      const manifest = await (deps.manifestLoader ?? (() => loadModelManifest(defaultManifestPath())))()
      const probe = probeModelDir(variant, manifest)
      modelStatus = probe.status
      sizeBytes = probe.sizeBytes
      errorReason = probe.error
    } catch (err) {
      modelStatus = "error"
      errorReason = err instanceof Error && "code" in err ? String((err as { code?: string }).code) : "manifest-invalid"
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
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    ...(errorReason !== undefined ? { error: errorReason } : {}),
    faults: session?.getFaults() ?? 0,
  }
}

/** 后台下载（fire-and-forget；进度/完成/失败全走广播，ack 即时返回）。 */
function startBackgroundDownload(
  variant: string,
  ctx: ComputerModelHandlerContext,
  deps: ComputerModelHandlerDeps,
  holder: ComputerModelSessionHolder,
): void {
  activeDownload = { variant }
  const cfg = getConfig().computer ?? { coordinateEnabled: false }
  void (async () => {
    try {
      const manifest = await (deps.manifestLoader ?? (() => loadModelManifest(defaultManifestPath())))()
      await (deps.downloadImpl ?? downloadModelVariant)(
        {
          manifest,
          modelId: "tinyclick",
          variant,
          mirror: cfg.modelMirror,
          diskBudgetMB: cfg.modelDiskBudgetMB,
        },
        {
          onProgress: (file, receivedBytes, totalBytes) => {
            ctx.broadcast?.({ type: "computer.model.progress", variant, file, receivedBytes, totalBytes })
          },
        },
      )
      logger.info("computer.model.download.completed", { variant })
    } catch (err) {
      const reason = err instanceof ModelDownloadError ? err.reason : "network-error"
      logger.warn("computer.model.download.failed", { variant, reason })
    } finally {
      activeDownload = null
      // 完成/失败都广播最新状态（状态行随广播刷新）
      void statePayload(holder, deps).then((s) => ctx.broadcast?.(s))
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
      // 许可证状态机（裁决 2）：已拒绝 → 永久跳过；未接受/条款漂移（P1 哈希
      // 不符）→ license_required（config 零写入）。
      if (cfg.modelLicenseDeclined === true) {
        return modelError(
          "实验层许可证已被拒绝，本层永久跳过（复位路径 = 手改 config.json，ADR-010 显式 owner opt-in）",
          { code: "LICENSE_DECLINED" },
        )
      }
      if (!modelLicenseAccepted(cfg)) {
        return {
          type: "computer.model.license_required" as const,
          licenseText: LICENSE_DOOR_TEXT,
          notice: "阅读并接受许可证与免责声明后可开启实验层；拒绝则本层永久跳过，其余定位层不受影响。",
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
          "Enable TinyClick experimental locate layer (uncalibrated local-model suggestions; every hit still requires per-action human confirmation)",
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
      if (rest.accepted === true) {
        // 接受：写时间戳 + 文本版本哈希（P1）+ 清拒绝标记，自动触发 download（裁决 2）
        setComputerModelFields({
          modelLicenseAcceptedAt: new Date().toISOString(),
          modelLicenseAcceptedTextHash: LICENSE_DOOR_TEXT_HASH,
          modelLicenseDeclined: false,
        })
        logger.info("computer.model.license_accepted", { textHash: LICENSE_DOOR_TEXT_HASH })
        const cfg = getConfig().computer ?? { coordinateEnabled: false }
        const variant = cfg.modelVariant ?? "hybrid"
        let downloadNote: string | undefined
        if (activeDownload) {
          downloadNote = "already-running"
        } else {
          try {
            const manifest = await (deps.manifestLoader ?? (() => loadModelManifest(defaultManifestPath())))()
            if (!cfg.modelMirror && isPlaceholderHost(manifest, variant)) {
              // 占位主机禁网兜底（裁决 5）：如实告知，不伪造下载动作
              downloadNote = "download-host-unset"
              logger.info("computer.model.download.skipped", { reason: "download-host-unset", variant })
            } else {
              startBackgroundDownload(variant, ctx, deps, holder)
              downloadNote = "started"
            }
          } catch {
            downloadNote = "manifest-invalid"
          }
        }
        const state = await statePayload(holder, deps)
        ctx.broadcast?.(state)
        return { ...state, download: downloadNote }
      }
      // 拒绝：永久跳过（复位 = 手改 config.json，不提供 UI 复位——裁决 2）
      setComputerModelFields({ modelLicenseDeclined: true })
      logger.info("computer.model.license_declined", {})
      const state = await statePayload(holder, deps)
      ctx.broadcast?.(state)
      return state
    }

    case "computer.model.download": {
      const cfg = getConfig().computer ?? { coordinateEnabled: false }
      const variant = cfg.modelVariant ?? "hybrid"
      if (activeDownload) {
        return { type: "computer.model.download.result" as const, ok: true, status: "already-running", variant }
      }
      let manifest: ModelManifest
      try {
        manifest = await (deps.manifestLoader ?? (() => loadModelManifest(defaultManifestPath())))()
      } catch (err) {
        return modelError(
          `模型登记信息不可用: ${err instanceof Error ? err.message : String(err)}`,
          { code: "MANIFEST_INVALID" },
        )
      }
      // 禁网兜底（裁决 5）：占位主机 + 未配镜像 → fail-fast 零网络请求
      if (!cfg.modelMirror && isPlaceholderHost(manifest, variant)) {
        logger.info("computer.model.download.refused", { reason: "download-host-unset", variant })
        return modelError(
          "模型发布地址尚未配置（发布链 owner 决策中）——当前构建不可下载模型；UIA / OCR / 用户框选定位不受影响。",
          { code: "DOWNLOAD_HOST_UNSET" },
        )
      }
      // 下载对象 = 当前配置变体的文件组（P3：变体切换 = 手改 config + 重启）
      startBackgroundDownload(variant, ctx, deps, holder)
      logger.info("computer.model.download.started", { variant })
      return { type: "computer.model.download.result" as const, ok: true, status: "started", variant }
    }

    case "computer.model.delete": {
      const cfg = getConfig().computer ?? { coordinateEnabled: false }
      const variant = cfg.modelVariant ?? "hybrid"
      // dispose 会话 + holder=null（裁决 4）；删除是 fail-closed 方向免费动作
      if (holder.session) {
        try {
          await holder.session.dispose()
        } catch {
          /* best-effort dispose */
        }
        holder.session = null
      }
      const { removedBytes } = await (deps.deleteImpl ?? deleteModelVariant)({ variant })
      logger.info("computer.model.deleted", { variant, removedBytes })
      const state = await statePayload(holder, deps)
      ctx.broadcast?.(state)
      return { type: "computer.model.delete.result" as const, ok: true, variant, removedBytes }
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
