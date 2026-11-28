import { getConfig, getConfigRevision, saveConfig } from "../config"
import {
  invalidateShellReadiness, noteShellReady, projectionMatches, projectShellOnto,
  shellDesiredEnabled, shellEnabledIsLegacyBoolean, shellProjectionWriteActive, shellReadiness,
  type ShellReadiness,
} from "./shell-projection"
export {
  enterConfigWrite, invalidateShellReadiness, leaveConfigWrite, noteShellReady, projectionMatches,
  projectShellOnto, shellDesiredEnabled, shellReadiness, type ShellReadiness,
} from "./shell-projection"

export type ShellProvisionView = "provided" | "community" | "unavailable" | "unknown"

export function shellProvision(config: { capability_profile?: string; modules?: { shell?: { available?: boolean } } }): "provided" | "not_provided" {
  return shellDesiredEnabled(config) ? "provided" : "not_provided"
}

/** One view for list, profile receipt, scene row, and the settings assistant. */
export function shellProvisionView(config: { capability_profile?: string }, readinessState: ShellReadiness = shellReadiness()): ShellProvisionView {
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
    if (config === getConfig()) return shellProvisionView(getConfig(), repairShellProjection())
  } catch { /* a detached snapshot has no repair result */ }
  if (config.capability_profile === "enterprise") return config.modules?.shell?.available === false ? "unavailable" : "provided"
  return "community"
}

/** One revision-checked write after the config cache exists. Never called from load or getConfig. */
export function repairShellProjection(): ShellReadiness {
  if (shellProjectionWriteActive()) return shellReadiness()
  const before = getConfig()
  const revision = getConfigRevision()
  if (before.modules?.shell && !shellEnabledIsLegacyBoolean(before.modules.shell.enabled)) {
    invalidateShellReadiness()
    return "unknown"
  }
  if (projectionMatches(before)) {
    noteShellReady(before)
    return shellReadiness()
  }
  const updated = { ...before }
  projectShellOnto(updated)
  try {
    saveConfig({ modules: updated.modules }, undefined, revision)
  } catch {
    invalidateShellReadiness()
    return "unknown"
  }
  const after = getConfig()
  if (!projectionMatches(after)) {
    invalidateShellReadiness()
    return "unknown"
  }
  noteShellReady(after)
  return shellReadiness()
}
