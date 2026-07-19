// computer.* WS handlers (A10). The global coordinate switch flips only
// through the biometric gate (same D2 pattern as the App tab add-auto flow);
// disabling is always free (fail-closed direction).

import * as fs from "fs"
import * as path from "path"
import { spawn } from "child_process"
import { getConfig, setComputerCoordinateEnabled } from "../config"
import { logger } from "../logger"
import type {
  SecurityConfirmationDecision,
  SecurityConfirmationDetails,
} from "../security-confirmation"
import { requireAppsBiometric } from "../apps/biometric-gate"
import { assertNotReparsePath, evidenceBaseDir, type ReparseFsLike } from "./evidence"

export interface ComputerHandlerContext {
  requestConfirmation?: (
    details: SecurityConfirmationDetails,
  ) => Promise<SecurityConfirmationDecision>
  broadcast?: (data: any) => void
  /**
   * WP4: 面板(WS 连接)标识——computer.evidence.open 的 P6 频率上限按每面板
   * 计数。缺省退化为进程级单桶(独立调用方/旧接线)。
   */
  panelId?: string
}

/**
 * P6 (WP4 对抗裁决): computer.evidence.open 频率上限——每面板每分钟 5 次
 * (滑动窗口)。已认证面板循环调用可在用户桌面刷 explorer 窗口(路径已锁死,
 * 社会工程价值低,但可用性骚扰成立);上限只是可用性缓解,不替代路径校验。
 */
export class EvidenceOpenRateLimiter {
  private hits = new Map<string, number[]>()
  constructor(
    private readonly limit = 5,
    private readonly windowMs = 60_000,
  ) {}
  /** true = 放行(已计数);false = 超限拒绝。 */
  tryConsume(panelId: string, nowMs: number = Date.now()): boolean {
    const arr = (this.hits.get(panelId) ?? []).filter((t) => nowMs - t < this.windowMs)
    if (arr.length >= this.limit) {
      this.hits.set(panelId, arr)
      return false
    }
    arr.push(nowMs)
    this.hits.set(panelId, arr)
    return true
  }
}

const evidenceOpenLimiter = new EvidenceOpenRateLimiter()

/** computer.evidence.open 的可注入表面(测试 fake;生产默认真实实现)。 */
export interface EvidenceOpenSurface {
  baseDir?: string
  exists?: (p: string) => boolean
  openDir?: (dir: string) => void
  limiter?: EvidenceOpenRateLimiter
  now?: () => number
  /** Y5 reparse 复查的 lstat 表面(测试注入;生产默认真 fs)。 */
  reparseFs?: ReparseFsLike
}

export interface ComputerHandlerDeps {
  gate?: typeof requireAppsBiometric
  evidenceOpen?: EvidenceOpenSurface
}

/** 生产默认:explorer 打开目录。dir 作为独立 argv(绝不拼进命令行模板)。 */
function defaultOpenDir(dir: string): void {
  const child = spawn("explorer.exe", [dir], { detached: true, stdio: "ignore" })
  // spawn 的 ENOENT 经 error 事件异步到达——吞掉(打开失败对用户可见性低,
  // 但绝不能成为未捕获异常)。explorer 对存在目录的打开几乎不会失败。
  child.on("error", () => {})
  child.unref()
}

function computerError(error: string, extra?: Record<string, unknown>) {
  return { type: "error", family: "computer" as const, error, ...extra }
}

function statePayload() {
  const cfg = getConfig()
  return {
    type: "computer.state",
    coordinateEnabled: cfg.computer?.coordinateEnabled === true,
  }
}

export async function handleComputerMessage(
  msg: any,
  ctx: ComputerHandlerContext = {},
  deps: ComputerHandlerDeps = {},
): Promise<any> {
  const { type, ...rest } = msg

  switch (type) {
    case "computer.get_state":
      return statePayload()

    case "computer.set_enabled": {
      if (typeof rest.enabled !== "boolean") {
        return computerError("computer.set_enabled requires boolean enabled", { code: "INVALID_ENABLED" })
      }
      // Disabling is always free — fail-closed direction.
      if (rest.enabled === false) {
        setComputerCoordinateEnabled(false)
        logger.info("computer.coordinate_disabled", {})
        ctx.broadcast?.(statePayload())
        return statePayload()
      }
      // Enabling = persistent capability grant -> biometric gate (A10.1).
      if (!ctx.requestConfirmation) {
        return computerError("computer.set_enabled(true) requires an interactive confirmation channel", {
          code: "NO_CONFIRMATION_CHANNEL",
        })
      }
      const gate = deps.gate ?? requireAppsBiometric
      const outcome = await gate({
        action: "computer.set_enabled",
        reason: "Enable coordinate computer-use (input injection into whitelisted app windows)",
        requestConfirmation: ctx.requestConfirmation,
      })
      if (!outcome.approved) {
        logger.warn("computer.coordinate_enable_denied", { reason: outcome.reason })
        return computerError(
          `enabling coordinate computer-use ${outcome.reason === "cancelled" ? "cancelled by user" : `denied (${outcome.reason})`} — stays OFF`,
          { code: "BIOMETRIC_DENIED", reason: outcome.reason },
        )
      }
      setComputerCoordinateEnabled(true)
      logger.info("computer.coordinate_enabled", { method: outcome.method })
      ctx.broadcast?.(statePayload())
      return statePayload()
    }

    case "computer.evidence.open": {
      // WP4: 「打开证据目录」。校验四件套 + P6 频率上限(对抗裁决 §2):
      // 严格字符集 → 基目录内解析 → reparse 复查 → 存在性检查;taskId 绝不
      // 拼进命令行模板(独立 argv 传给 explorer)。
      const taskId = typeof rest.task_id === "string" ? rest.task_id : ""
      if (!/^[a-zA-Z0-9_-]+$/.test(taskId)) {
        return computerError("computer.evidence.open requires task_id matching ^[a-zA-Z0-9_-]+$", {
          code: "INVALID_TASK_ID",
        })
      }
      const surf = deps.evidenceOpen ?? {}
      // P6: 每面板每分钟 5 次(每连接计数;无 panelId 退化为进程级单桶)。
      const limiter = surf.limiter ?? evidenceOpenLimiter
      const now = surf.now ?? (() => Date.now())
      if (!limiter.tryConsume(ctx.panelId ?? "default", now())) {
        return { type: "computer.evidence.open.result", ok: false, error: "rate_limited" }
      }
      const base = evidenceBaseDir(surf.baseDir)
      const dir = path.join(base, taskId)
      try {
        // Y5 复查:基目录与任务目录都不得是 reparse point。
        assertNotReparsePath(base, surf.reparseFs)
        assertNotReparsePath(dir, surf.reparseFs)
      } catch (err) {
        return computerError((err as Error)?.message ?? String(err), { code: "EVIDENCE_ERROR" })
      }
      const exists = surf.exists ?? ((p: string) => fs.existsSync(p))
      if (!exists(dir)) {
        return { type: "computer.evidence.open.result", ok: false, error: "not_found" }
      }
      try {
        ;(surf.openDir ?? defaultOpenDir)(dir)
      } catch (err) {
        return { type: "computer.evidence.open.result", ok: false, error: String((err as Error)?.message ?? err) }
      }
      logger.info("computer.evidence.opened", { taskId })
      return { type: "computer.evidence.open.result", ok: true }
    }

    default:
      return computerError(`Unknown computer message type: ${type}`)
  }
}