// GitHub #322: SETTINGS_REQUIRED pointer card — pure logic.
//
// A restricted-capability tool error may carry a deterministic settings pointer
// (companion capability/settings-pointer.ts static map). The card renders fixed
// copy only; the deep-link opens the settings accordion at a whitelisted
// section id and pre-fills nothing. These strings are the UI-side template —
// they must never be assembled from model output, and they must never quote or
// explain the arming phrase (「我了解风险」).

import { SETTINGS_SECTION_IDS, type SettingsSectionId } from "./settings-sections"

export const SETTINGS_POINTER_LABEL = "此能力需要先在设置中开启"

export const SETTINGS_POINTER_CTA = "打开设置"

export type SettingsPointerView = {
  settings_section: SettingsSectionId
  settings_path: string
}

// Cheap payload bound — a crafted/garbage frame cannot flood the card.
const MAX_SETTINGS_PATH_CHARS = 120

/**
 * Extract a renderable settings pointer from a tool result, or null.
 * Fail-closed: any shape deviation (wrong error_code, non-whitelisted
 * section, oversized path) yields null and the card falls back to the plain
 * error rendering.
 */
export function extractSettingsPointer(result: unknown): SettingsPointerView | null {
  if (!result || typeof result !== "object") return null
  const r = result as { success?: unknown; data?: unknown }
  if (r.success !== false) return null
  const d = r.data
  if (!d || typeof d !== "object") return null
  const p = d as { error_code?: unknown; settings_section?: unknown; settings_path?: unknown }
  if (p.error_code !== "SETTINGS_REQUIRED") return null
  if (typeof p.settings_section !== "string") return null
  if (!(SETTINGS_SECTION_IDS as readonly string[]).includes(p.settings_section)) return null
  if (
    typeof p.settings_path !== "string" ||
    p.settings_path.length === 0 ||
    p.settings_path.length > MAX_SETTINGS_PATH_CHARS
  ) {
    return null
  }
  return {
    settings_section: p.settings_section as SettingsSectionId,
    settings_path: p.settings_path,
  }
}

/**
 * The exact line the pointer card shows. Kept as a pure function so tests can
 * assert the template (fixed label + companion-provided path — the only
 * dynamic part, itself a static string server-side).
 */
export function settingsPointerLine(view: SettingsPointerView): string {
  return `${SETTINGS_POINTER_LABEL}：${view.settings_path}`
}
