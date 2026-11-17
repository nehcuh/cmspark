import type { CompanionConfig } from "../config"

export type ShellReadiness = "ready_provided" | "ready_not_provided" | "unknown"
export type ShellProvisionView = "provided" | "community" | "unavailable" | "unknown"

let readiness: ShellReadiness = "unknown"
let saveDepth = 0

export function shellDesiredEnabled(config: { capability_profile?: string; modules?: { shell?: { available?: boolean } } }): boolean {
  return config.capability_profile === "enterprise" && config.modules?.shell?.available === true
}

export function shellProvision(config: { capability_profile?: string; modules?: { shell?: { available?: boolean } } }): "provided" | "not_provided" {
  return shellDesiredEnabled(config) ? "provided" : "not_provided"
}

export function shellReadiness(): ShellReadiness {
  return readiness
}

/** One view for list, profile receipt, scene row, and the settings assistant. */
export function shellProvisionView(config: { capability_profile?: string }, readinessState: ShellReadiness = readiness): ShellProvisionView {
  if (readinessState === "unknown") return "unknown"
  if (readinessState === "ready_provided") return "provided"
  return config.capability_profile === "enterprise" ? "unavailable" : "community"
}

export function shellProvisionSentence(view: ShellProvisionView): string {
  if (view === "provided") return "shell 已由 enterprise 档提供，没有单独电源。命令仍需策略和 L2 授权。"
  if (view === "unknown") return "shell 提供状态未知。请刷新本机能力列表，不要再次切换相同档位。"
  if (view === "unavailable") return "shell 模块不可用。这不是未开启的电源。"
  return "shell 随 enterprise 档提供。请打开「本机与工具」，确认升档。命令执行仍需单独授权。"
}

export function describeShellProvision(config: { capability_profile?: string; modules?: { shell?: { available?: boolean } } }): ShellProvisionView {
  try {
    const { getConfig } = require("../config") as typeof import("../config")
    if (config === getConfig()) return shellProvisionView(getConfig(), repairShellProjection())
  } catch { /* a detached snapshot has no repair result */ }
  if (config.capability_profile === "enterprise") return config.modules?.shell?.available === false ? "unavailable" : "provided"
  return "community"
}

export function invalidateShellReadiness(): void {
  readiness = "unknown"
}

export function enterConfigWrite(): void {
  saveDepth += 1
}

export function leaveConfigWrite(): void {
  saveDepth = Math.max(0, saveDepth - 1)
}

function shellEnabledIsLegacyBoolean(enabled: unknown): boolean {
  return enabled === undefined || enabled === null || typeof enabled === "boolean"
}

export function projectionMatches(config: CompanionConfig): boolean {
  const shell = config.modules?.shell
  if (shell && !shellEnabledIsLegacyBoolean(shell.enabled)) return false
  if (shellDesiredEnabled(config)) return shell?.enabled === true && shell.enabled_by === "profile.enterprise"
  if (!shell) return true
  return shell.enabled === false && shell.enabled_at == null && shell.enabled_by == null
}

/** Pure. Changes only shell enabled, enabled_at, and enabled_by when enabled is a legacy boolean. */
export function projectShellOnto(config: CompanionConfig): void {
  const shell = config.modules?.shell
  if (shell && !shellEnabledIsLegacyBoolean(shell.enabled)) return
  if (!shell && !shellDesiredEnabled(config)) return
  const next = { ...(shell || { available: true, enabled: false, policy: "confirm_per_command", allowlist_commands: [] as string[] }) }
  if (shellDesiredEnabled(config)) {
    if (next.enabled !== true) next.enabled_at = new Date().toISOString()
    next.enabled = true
    next.enabled_by = "profile.enterprise"
  } else {
    next.enabled = false
    next.enabled_at = null
    next.enabled_by = null
  }
  config.modules = { ...(config.modules || {}), shell: next }
}

function markReady(config: CompanionConfig): void {
  readiness = shellDesiredEnabled(config) ? "ready_provided" : "ready_not_provided"
}

export function noteShellReady(config: CompanionConfig): void {
  if (projectionMatches(config)) markReady(config)
}

/** One revision-checked write after the config cache exists. Never called from load or getConfig. */
export function repairShellProjection(): ShellReadiness {
  if (saveDepth > 0) return readiness
  const { getConfig, getConfigRevision, saveConfig } = require("../config") as typeof import("../config")
  const before = getConfig()
  const revision = getConfigRevision()
  if (before.modules?.shell && !shellEnabledIsLegacyBoolean(before.modules.shell.enabled)) {
    readiness = "unknown"
    return readiness
  }
  if (projectionMatches(before)) {
    markReady(before)
    return readiness
  }
  const shell = { ...(before.modules?.shell || { available: true, enabled: false, policy: "confirm_per_command", allowlist_commands: [] as string[] }) }
  if (shellDesiredEnabled(before)) {
    if (shell.enabled !== true) shell.enabled_at = new Date().toISOString()
    shell.enabled = true
    shell.enabled_by = "profile.enterprise"
  } else {
    shell.enabled = false
    shell.enabled_at = null
    shell.enabled_by = null
  }
  try {
    saveConfig({ modules: { ...(before.modules || {}), shell } } as Partial<CompanionConfig>, undefined, revision)
  } catch {
    readiness = "unknown"
    return readiness
  }
  const after = getConfig()
  if (!projectionMatches(after)) {
    readiness = "unknown"
    return readiness
  }
  markReady(after)
  return readiness
}
