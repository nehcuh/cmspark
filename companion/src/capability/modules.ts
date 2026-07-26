// Capability modules — enable gate + defaults for enterprise packs

import { getConfig, saveConfig, type CompanionConfig } from "../config"
import { appendCapabilityAudit } from "../packs/audit-log"

export type ModuleId = "appsec" | "devsec-workspace" | "shell" | "netsec"

export interface ModuleState {
  available: boolean
  enabled: boolean
  enabled_at?: string | null
  enabled_by?: string | null
  policy?: string
  target_allowlist?: string[]
  require_task_auth?: boolean
  allowlist_commands?: string[]
}

const DEFAULT_MODULES: Record<ModuleId, ModuleState> = {
  appsec: { available: true, enabled: false, enabled_at: null, enabled_by: null },
  "devsec-workspace": { available: true, enabled: false, enabled_at: null, enabled_by: null },
  shell: {
    available: true,
    enabled: false,
    enabled_at: null,
    enabled_by: null,
    policy: "confirm_per_command",
    allowlist_commands: [],
  },
  netsec: {
    available: true,
    enabled: false,
    enabled_at: null,
    enabled_by: null,
    target_allowlist: [],
    require_task_auth: true,
  },
}

export function ensureModulesDefaults(config: CompanionConfig): CompanionConfig {
  const modules = { ...DEFAULT_MODULES, ...(config.modules || {}) } as Record<string, ModuleState>
  // never silently enable high-risk modules
  for (const id of ["shell", "netsec", "devsec-workspace", "appsec"] as ModuleId[]) {
    if (!modules[id]) modules[id] = { ...DEFAULT_MODULES[id] }
    if (modules[id].available !== true) modules[id].available = DEFAULT_MODULES[id].available
    if (typeof modules[id].enabled !== "boolean") modules[id].enabled = false
  }
  config.modules = modules
  if (config.capability_profile !== "enterprise" && config.capability_profile !== "community") {
    config.capability_profile = "community"
  }
  return config
}

export function isModuleEnabled(moduleId: ModuleId): boolean {
  const config = ensureModulesDefaults(getConfig())
  const m = config.modules?.[moduleId]
  return !!(m && m.available && m.enabled)
}

export function getModule(moduleId: ModuleId): ModuleState | null {
  const config = ensureModulesDefaults(getConfig())
  return (config.modules?.[moduleId] as ModuleState) || null
}

export function requireModule(moduleId: ModuleId): { ok: true } | { ok: false; error: string } {
  if (!isModuleEnabled(moduleId)) {
    return {
      ok: false,
      error: `module_disabled:${moduleId} — enable in settings (modules.set_enabled) before use`,
    }
  }
  return { ok: true }
}

export function setModuleEnabled(
  moduleId: string,
  enabled: boolean,
  by: string = "user",
): { ok: true; modules: any } | { ok: false; error: string } {
  const config = ensureModulesDefaults(getConfig()) as any
  const mod = config.modules[moduleId]
  if (!mod || mod.available !== true) {
    return { ok: false, error: `module not available: ${moduleId}` }
  }
  // community profile cannot enable netsec/shell (enterprise-only high risk)
  if (enabled && (moduleId === "netsec" || moduleId === "shell")) {
    if (config.capability_profile !== "enterprise") {
      return {
        ok: false,
        error: "enterprise_profile_required — set capability_profile=enterprise for shell/netsec",
      }
    }
  }
  mod.enabled = enabled
  mod.enabled_at = enabled ? new Date().toISOString() : null
  mod.enabled_by = enabled ? by : null
  config.modules[moduleId] = mod
  saveConfig(config)
  appendCapabilityAudit({
    type: enabled ? "module.enable" : "module.disable",
    module: moduleId,
    by,
    at: new Date().toISOString(),
  })
  return { ok: true, modules: config.modules }
}

export function updateModuleConfig(
  moduleId: ModuleId,
  patch: Partial<ModuleState>,
): { ok: true; module: ModuleState } | { ok: false; error: string } {
  const config = ensureModulesDefaults(getConfig()) as any
  const mod = config.modules[moduleId]
  if (!mod) return { ok: false, error: `unknown module: ${moduleId}` }
  // never allow enabling via this path
  const { enabled: _e, available: _a, ...safe } = patch as any
  Object.assign(mod, safe)
  config.modules[moduleId] = mod
  saveConfig(config)
  return { ok: true, module: mod }
}
