// WP5 I3 — computer.model.* WS handlers。
// 登记项③先行：reset_circuit_breaker 围栏 + get_state 观测面；
// set_enabled / license_response / download / delete 在 WI-3.4 补齐。
//
// ③ 围栏（父指令 + plan:480 M3）：reset_circuit_breaker 仅接受设置页声明来源
// （source:"settings"）——validateWsMessage 形状校验（server.ts）+ 本 handler
// 二次核查（belt：防校验面被绕过 / 未来调用方直调）+ 审计日志。
// 诚实边界：source 是声明式来源（同一 WS 连接内的页面标识），非密码学校验——
// 真正的安全性质来自动作本身无副作用（只复位熔断计数，不注入、不授权、不改
// 配置）；围栏防的是自动化循环调用把崩溃模型维持在「崩溃→复位→再崩溃」DoS
// 循环里（plan 攻击面 3 / A8）。
//
// 熔断语义（I2 从严实现，见 tinyclick-runtime.ts）：熔断一旦触发只能手动复位，
// 无自动恢复——本动作是唯一复位通道。

import { logger } from "../logger"
import type { TinyClickSession } from "./tinyclick-session"

/**
 * 进程级模型会话持有器——WI-3.4 admission 组装（开关开 + 模型 ready +
 * 无熔断）写入；本 handler 读取。单例即进程级真相（模型会话全局至多一个，
 * 与 host_computer 全局单任务不变量同型）。
 */
export interface ComputerModelSessionHolder {
  session: Pick<TinyClickSession, "resetCircuitBreaker" | "getStatus" | "getFaults"> | null
}

/** 生产默认持有器（server.ts 与 WI-3.4 接线共享同一实例；测试注入自有实例）。 */
export const computerModelSession: ComputerModelSessionHolder = { session: null }

export interface ComputerModelHandlerContext {
  broadcast?: (data: any) => void
}

function modelError(error: string, extra?: Record<string, unknown>) {
  return { type: "error", family: "computer" as const, error, ...extra }
}

/**
 * 当前可观测状态（③ 最小形）。modelStatus 映射：
 *   无会话 → "absent"（模型层本次进程从未 admitted；WI-3.4 以磁盘复验补全
 *   absent/error 细分）；session.getStatus()==="disabled" → "disabled"（熔断）；
 *   其余 → "ready"（会话存在 ⟹ 载入时文件经 I1 校验；WI-3.4 增补 modelEnabled /
 *   licenseAccepted / variant / sizeBytes 等 config 字段后形会扩，不缩）。
 */
function statePayload(holder: ComputerModelSessionHolder) {
  const session = holder.session
  const modelStatus = !session ? "absent" : session.getStatus() === "disabled" ? "disabled" : "ready"
  return {
    type: "computer.model.state" as const,
    modelStatus,
    faults: session?.getFaults() ?? 0,
  }
}

export async function handleComputerModelMessage(
  msg: any,
  ctx: ComputerModelHandlerContext = {},
  holder: ComputerModelSessionHolder = computerModelSession,
): Promise<any> {
  const { type, ...rest } = msg

  switch (type) {
    case "computer.model.get_state":
      return statePayload(holder)

    case "computer.model.reset_circuit_breaker": {
      // 围栏②（handler 层核查）：仅设置页声明来源。validateWsMessage 已强制
      // 同名字段——本核查防未来直调 / 校验面变更（belt & braces）。
      if (rest.source !== "settings") {
        logger.warn("computer.model.circuit_reset.refused", {
          source: typeof rest.source === "string" ? rest.source : undefined,
        })
        return modelError(
          'computer.model.reset_circuit_breaker only accepts the settings-page source (source:"settings")',
          { code: "INVALID_SOURCE" },
        )
      }
      const session = holder.session
      if (!session) {
        // 无会话 = 模型从未加载（或已 dispose）——熔断无从谈起。诚实 no-op：
        // 不伪造一次复位、不广播（无状态变化）。
        logger.info("computer.model.circuit_reset.noop", { reason: "no-session" })
        return { ...statePayload(holder), note: "no-session" }
      }
      session.resetCircuitBreaker()
      logger.info("computer.model.circuit_reset", { source: "settings" })
      const state = statePayload(holder)
      ctx.broadcast?.(state) // 设置页状态行随广播刷新（plan:480 状态变更广播）
      return state
    }

    default:
      return modelError(`Unknown computer model message type: ${type}`)
  }
}
