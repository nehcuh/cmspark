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

/**
 * Validate a netsec allowlist entry (IPv4, CIDR, hostname, *.suffix).
 * Rejects wildcards that match everything and IPv6.
 */
export function isValidNetsecAllowlistEntry(raw: string): boolean {
  const t = (raw || "").trim()
  if (!t || t.length > 253) return false
  if (t === "*" || t === "*.*" || t === "*.") return false
  if (t.includes(":") || t.includes("/")) {
    // CIDR IPv4 only
    const m = t.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/)
    if (!m) return false
    const bits = parseInt(m[2], 10)
    if (bits < 0 || bits > 32) return false
    const parts = m[1].split(".").map((x) => parseInt(x, 10))
    return parts.every((p) => p >= 0 && p <= 255)
  }
  // IPv4
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(t)) {
    return t.split(".").every((x) => {
      const n = parseInt(x, 10)
      return n >= 0 && n <= 255
    })
  }
  // *.suffix (at least one label after *.)
  if (t.startsWith("*.")) {
    const suffix = t.slice(2)
    if (!suffix || suffix.includes("*")) return false
    return /^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(
      suffix,
    )
  }
  // hostname / single label (localhost)
  return /^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(
    t,
  )
}

export function updateModuleConfig(
  moduleId: ModuleId,
  patch: Partial<ModuleState>,
): { ok: true; module: ModuleState } | { ok: false; error: string } {
  const config = ensureModulesDefaults(getConfig()) as any
  const mod = config.modules[moduleId]
  if (!mod) return { ok: false, error: `unknown module: ${moduleId}` }

  // shell/netsec: enterprise can always update; community may update only when
  // the module is already enabled (e.g. hand-enabled or prior enterprise path)
  // so the Side Panel can manage allowlist without editing config.json.
  if (moduleId === "netsec" || moduleId === "shell") {
    if (config.capability_profile !== "enterprise" && mod.enabled !== true) {
      return {
        ok: false,
        error:
          "enterprise_profile_required for shell/netsec config updates (or enable the module first)",
      }
    }
  }

  // never allow enabling via this path
  const { enabled: _e, available: _a, ...safe } = patch as any

  if (moduleId === "netsec" && Array.isArray(safe.target_allowlist)) {
    const cleaned: string[] = []
    const rejected: string[] = []
    for (const item of safe.target_allowlist) {
      if (typeof item !== "string") continue
      const entry = item.trim()
      if (!entry) continue
      if (!isValidNetsecAllowlistEntry(entry)) {
        rejected.push(entry)
        continue
      }
      if (!cleaned.includes(entry)) cleaned.push(entry)
    }
    if (rejected.length) {
      return {
        ok: false,
        error: `invalid allowlist entries: ${rejected.join(", ")} (use IPv4, CIDR, hostname, or *.suffix)`,
      }
    }
    if (cleaned.length > 64) {
      return { ok: false, error: "target_allowlist max 64 entries" }
    }
    safe.target_allowlist = cleaned
  }

  Object.assign(mod, safe)
  config.modules[moduleId] = mod
  saveConfig(config)
  appendCapabilityAudit({
    type: "module.config_update",
    module: moduleId,
    keys: Object.keys(safe),
    at: new Date().toISOString(),
  })
  return { ok: true, module: mod }
}
