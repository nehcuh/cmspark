// #775: the only host edge which may execute an explicitly selected installation.
import { discoverLcu, lcuCommandIdentity, probeLcu } from "./discovery"
import { lcuEnableRefusal, lcuEnvironment, lcuOwnedPadQualification, validLcuCommand, type LcuObservedStatus } from "./contract"
import { authorizeLcuOperation, type LcuHumanChannel } from "./authorization"
import { LcuRuntime, type LcuRuntimeConfig } from "./runtime"
import { OwnedStdioTransport } from "../../mcp/stdio-transport"
import { getComputerTaskAbortRegistry, onComputerTaskAbort } from "../task-abort-registry"

export interface LcuSettingsState {
  enabled: boolean
  coordinateEnabled: boolean
  platform: string
  architecture: string
  detection: "unsupported_platform" | "invalid_command" | "missing_lcu" | "detected_unverified"
  command?: string
  observed?: LcuObservedStatus
  ownedPadQualification?: "macos-arm64-20261026"
  refusal?: string
  activeRuns: number
  cleanupUnknown: boolean
  nativeVerified: false
}

let runtime: LcuRuntime | undefined
let cached: { command: string; observed: LcuObservedStatus; refusal?: string } | undefined
let settingsActive: AbortController | undefined
let settingsGeneration = 0

function config(): LcuRuntimeConfig {
  const computer = (require("../../config") as typeof import("../../config")).getConfig().computer
  return { coordinateEnabled: computer?.coordinateEnabled === true, enabled: computer?.lcu?.enabled === true,
    ...(computer?.lcu?.command ? { command: computer.lcu.command } : {}) }
}

export function getLcuRuntime(): LcuRuntime {
  if (!runtime) {
    runtime = new LcuRuntime({
      config,
      inspect: async (command, signal) => {
        const found = await discoverLcu(command)
        return found.status === "detected_unverified"
          ? probeLcu(found.identity, signal)
          : { status: "refused", refusal: `LCU_${found.status.toUpperCase()}` }
      },
      identity: lcuCommandIdentity,
      transport: identity => {
        const transport = new OwnedStdioTransport({ command: identity.realPath, args: [], env: lcuEnvironment(process.env) })
        // Do not buffer/log application/account paths or arbitrary original runtime stderr.
        transport.stderr.resume()
        return transport
      },
      tasks: getComputerTaskAbortRegistry(),
    })
    onComputerTaskAbort(taskId => runtime?.abort(taskId))
    const { configEvents, CONFIG_CHANGE_EVENT } = require("../../config") as typeof import("../../config")
    configEvents.on(CONFIG_CHANGE_EVENT, () => { cached = undefined; settingsGeneration++; settingsActive?.abort(); runtime?.abortStale() })
  }
  return runtime
}

export async function getLcuState(): Promise<LcuSettingsState> {
  const selected = config(), found = await discoverLcu(selected.command)
  const command = found.status === "detected_unverified" ? found.identity.command : selected.command
  const qualification = cached && cached.command === command ? lcuOwnedPadQualification(cached.observed) : undefined
  return {
    enabled: selected.enabled, coordinateEnabled: selected.coordinateEnabled,
    platform: process.platform, architecture: process.arch, detection: found.status,
    ...(command ? { command } : {}),
    ...(cached && cached.command === command ? { observed: cached.observed, ...(cached.refusal ? { refusal: cached.refusal } : {}) } : {}),
    ...(qualification ? { ownedPadQualification: qualification } : {}),
    activeRuns: runtime?.state.activeRuns ?? 0, cleanupUnknown: runtime?.state.cleanupUnknown ?? false, nativeVerified: false,
  }
}

async function settingsOperation<T>(channel: LcuHumanChannel, work: (bound: LcuHumanChannel, signal: AbortSignal) => Promise<T>): Promise<T> {
  getLcuRuntime() // registers revocation before any settings await; starts no process
  if (!channel.current()) throw new Error("LCU_OWNER_REVOKED")
  if (settingsActive) throw new Error("LCU_SETTINGS_BUSY")
  const abort = new AbortController(), generation = ++settingsGeneration
  settingsActive = abort
  const bound: LcuHumanChannel = {
    current: () => channel.current() && !abort.signal.aborted && generation === settingsGeneration,
    request: (details, signal) => channel.request(details, AbortSignal.any([abort.signal, ...(signal ? [signal] : [])])),
  }
  try { return await work(bound, abort.signal) }
  finally { if (settingsActive === abort) settingsActive = undefined }
}

async function inspectSelected(channel: LcuHumanChannel, signal?: AbortSignal) {
  const selected = config(), found = await discoverLcu(selected.command)
  if (found.status !== "detected_unverified") throw new Error(`LCU_${found.status.toUpperCase()}`)
  if (!await authorizeLcuOperation(channel, "computer.lcu.probe",
    `运行已选本机 LCU 的只读兼容检测：\n${found.identity.command}\n固定参数：status --json\n此操作不会安装软件或执行桌面操作。`, signal)) throw new Error("LCU_HUMAN_APPROVAL_REQUIRED")
  if (JSON.stringify(selected) !== JSON.stringify(config()) || !channel.current() || signal?.aborted) throw new Error("LCU_OWNER_OR_CONFIG_REVOKED")
  const result = await probeLcu(found.identity, signal)
  if (JSON.stringify(selected) !== JSON.stringify(config()) || !channel.current() || signal?.aborted) throw new Error("LCU_OWNER_OR_CONFIG_REVOKED")
  if (result.status !== "checked" || !result.observed) throw new Error(result.refusal ?? "LCU_STATUS_UNVERIFIED")
  cached = { command: found.identity.command, observed: result.observed, refusal: result.refusal }
  return result
}

export async function probeLcuFromSettings(channel: LcuHumanChannel, signal?: AbortSignal): Promise<LcuSettingsState> {
  return settingsOperation(channel, async (bound, operationSignal) => { await inspectSelected(bound, AbortSignal.any([operationSignal, ...(signal ? [signal] : [])])); return getLcuState() })
}

export async function configureLcuFromSettings(patch: { command: string | null }, channel: LcuHumanChannel): Promise<LcuSettingsState> {
  return settingsOperation(channel, async (bound) => {
    if (!bound.current()) throw new Error("LCU_OWNER_REVOKED")
    if (patch.command !== null && !validLcuCommand(patch.command)) throw new Error("LCU_COMMAND_INVALID")
    // Configuration never launches an executable or retains an old enable grant.
    const { setComputerLcuFields } = require("../../config") as typeof import("../../config")
    setComputerLcuFields({ command: patch.command, enabled: false })
    cached = undefined
    runtime?.abortStale()
    return getLcuState()
  })
}

export async function setLcuEnabledFromSettings(enabled: boolean, channel: LcuHumanChannel): Promise<LcuSettingsState> {
  if (!channel.current()) throw new Error("LCU_OWNER_REVOKED")
  const { setComputerLcuFields } = require("../../config") as typeof import("../../config")
  if (!enabled) {
    // A disable is never queued behind a pending enable/probe confirmation.
    settingsGeneration++; settingsActive?.abort(); settingsActive = undefined
    setComputerLcuFields({ enabled: false }); runtime?.abortStale()
    return getLcuState()
  }
  return settingsOperation(channel, async (bound, signal) => {
    const initial = JSON.stringify(config())
    if (!config().coordinateEnabled) throw new Error("LCU_GLOBAL_COMPUTER_DISABLED")
    if (runtime?.state.cleanupUnknown) throw new Error("LCU_CLEANUP_UNKNOWN")
    const inspected = await inspectSelected(bound, signal)
    const refusal = lcuEnableRefusal(inspected.observed)
    if (refusal) throw new Error(refusal)
    // The approved probe preview is read-only; enabling desktop use is a separate explicit act.
    if (!await authorizeLcuOperation(bound, "computer.lcu.set_enabled",
      "启用可选 LCU 桌面工具（实验性）。仅当前会话显式选择后提供；每次代码调用仍需人工确认和系统认证。桌面内容可能包含敏感信息，并将发送给当前视觉模型。" +
      (lcuOwnedPadQualification(inspected.observed) ? "此精确版本组合仅完成 CMspark 自有空白窗口的读取、输入、图片返回和停止验收，不代表其它应用或完整模型任务已验证。" : "此组合尚未经 CMspark 桌面实测。"), signal)) throw new Error("LCU_HUMAN_APPROVAL_REQUIRED")
    if (!bound.current() || initial !== JSON.stringify(config())) throw new Error("LCU_OWNER_OR_CONFIG_REVOKED")
    const before = inspected.identity && await lcuCommandIdentity(inspected.identity.command)
    if (!before || JSON.stringify(before) !== JSON.stringify(inspected.identity)) throw new Error("LCU_INSTALLATION_CHANGED")
    if (!bound.current() || initial !== JSON.stringify(config())) throw new Error("LCU_OWNER_OR_CONFIG_REVOKED")
    setComputerLcuFields({ enabled: true })
    return getLcuState()
  })
}
