import type { CompanionConfig } from "../config"

export type ShellReadiness = "ready_provided" | "ready_not_provided" | "unknown"
let readiness: ShellReadiness = "unknown"
let saveDepth = 0

export function shellDesiredEnabled(config: { capability_profile?: string; modules?: { shell?: { available?: boolean } } }): boolean {
  return config.capability_profile === "enterprise" && config.modules?.shell?.available === true
}

export function shellReadiness(): ShellReadiness {
  return readiness
}

export function invalidateShellReadiness(): void {
  readiness = "unknown"
}

export function shellProjectionWriteActive(): boolean {
  return saveDepth > 0
}

export function enterConfigWrite(): void {
  saveDepth += 1
}

export function leaveConfigWrite(): void {
  saveDepth = Math.max(0, saveDepth - 1)
}

export function shellEnabledIsLegacyBoolean(enabled: unknown): boolean {
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
