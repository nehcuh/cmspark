// GitHub #322: SETTINGS_REQUIRED structured tool errors.
//
// When a restricted capability fails because it is not configured (module off,
// empty allowlist), the tool error must point the user to the exact settings
// location — deterministically. settings_path / settings_section below are the
// single source of truth echoed verbatim into the LLM-facing error text and the
// Side Panel pointer card. They are static strings: never model-generated,
// never derived from tool params or page content.
//
// Constraints locked by the ticket:
// - no LLM free-form pointer copy (the model may only repeat settings_path)
// - the arming phrase is never quoted or explained by this payload
// - deep-link lands on a settings section only; nothing is pre-filled
// - gate semantics unchanged: this is error-surface dressing, not authorization

export type SettingsRequiredReason =
  /** Module power off — also covers community profile (module cannot be on). */
  | "module_disabled"
  /** netsec.target_allowlist empty — deny-all until configured. */
  | "allowlist_empty"

export type SettingsPointer = {
  /** Must match chrome-extension SETTINGS_SECTION_IDS (sidepanel re-validates). */
  settings_section: string
  /** Fixed human-readable path, echoed in tool error text + pointer card. */
  settings_path: string
}

/**
 * Static tool→settings map. v1 scope: netsec_port_scan only — its enable
 * toggle, allowlist, and per-thread authorization all live in the same
 * Settings「本机与集成」accordion, so one deep-link lands the user next to
 * every knob they may need. shell_exec's module power lives on the 场景
 * panel (not a settings section) — it joins this map only when it gains a
 * deep-linkable settings home.
 */
export const TOOL_SETTINGS_POINTERS: Record<string, SettingsPointer> = {
  netsec_port_scan: {
    settings_section: "integrations",
    settings_path: "设置 → 本机与集成 → 网络扫描（NetSec）",
  },
}

export function settingsPointerFor(toolName: string): SettingsPointer | null {
  return TOOL_SETTINGS_POINTERS[toolName] || null
}

/**
 * Compose a SETTINGS_REQUIRED tool result, or null when the tool has no
 * pointer (callers keep their existing error shape in that case).
 *
 * The base error keeps its original first line (LLM retry semantics and
 * classifyError patterns are untouched); the settings_path line is appended so
 * the model repeats the real location instead of hallucinating one.
 */
export function settingsRequiredResult(
  toolName: string,
  baseError: string,
  reason: SettingsRequiredReason,
): { success: false; error: string; data: Record<string, unknown> } | null {
  const pointer = settingsPointerFor(toolName)
  if (!pointer) return null
  return {
    success: false,
    error: `${baseError}\nsettings_path: ${pointer.settings_path}`,
    data: {
      error_code: "SETTINGS_REQUIRED",
      reason,
      settings_section: pointer.settings_section,
      settings_path: pointer.settings_path,
    },
  }
}
