// Settings accordion expand state — pure helpers (settings-thread-compact W1).
// Spec: docs/superpowers/specs/2026-08-06-settings-thread-compact-ux.md

export const LS_SETTINGS_EXPAND = "cmspark.settings.expandSections"

/** Canonical section ids (order = IA). */
export const SETTINGS_SECTION_IDS = [
  "connection",
  "model",
  "secrets",
  "security",
  "integrations",
  "export",
  "experimental",
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number]

export type SettingsExpandInput = {
  /** User LS preference (section open). */
  userOpen: Set<SettingsSectionId>
  /** WS pairing known + paired */
  wsPaired: boolean | null
  /** F-S3 elevated trust */
  elevatedTrust: boolean
}

/** Default open set when LS empty (before force rules). */
export function defaultUserOpenSections(wsPaired: boolean | null): Set<SettingsSectionId> {
  // Unpaired / unknown: connection + model. Paired: model only (F-UX3).
  if (wsPaired === true) return new Set<SettingsSectionId>(["model"])
  return new Set<SettingsSectionId>(["connection", "model"])
}

export function parseSettingsExpand(raw: string | null): Set<SettingsSectionId> | null {
  if (!raw) return null
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return null
    const next = new Set<SettingsSectionId>()
    for (const x of arr) {
      if (typeof x === "string" && (SETTINGS_SECTION_IDS as readonly string[]).includes(x)) {
        next.add(x as SettingsSectionId)
      }
    }
    return next
  } catch {
    return null
  }
}

export function serializeSettingsExpand(open: Set<SettingsSectionId>): string {
  return JSON.stringify([...open])
}

/** Elevated trust flags (F-S3 set) — used for armed header badge, not force-open. */
export function isElevatedTrust(flags: {
  auto_approve_dangerous?: boolean
  auto_approve_enterprise_tools?: boolean
  allow_all_schemes?: boolean
  unattendedArmed?: boolean
}): boolean {
  return (
    flags.auto_approve_dangerous === true ||
    flags.auto_approve_enterprise_tools === true ||
    flags.allow_all_schemes === true ||
    flags.unattendedArmed === true
  )
}

/**
 * Effective open map: force rules beat LS (F-UX3 unpaired connection only).
 * - unpaired → force connection open
 * - elevatedTrust no longer force-opens security (2026-08-08 UX): section stays
 *   collapsible; SettingsSlideout still shows armed badge on the header (F-S2).
 * - model default-open on first load via defaultUserOpenSections
 *
 * `elevatedTrust` remains on the input for callers / future soft-open policies.
 */
export function isSectionEffectivelyOpen(
  id: SettingsSectionId,
  input: SettingsExpandInput,
): boolean {
  if (id === "connection" && input.wsPaired !== true) return true
  // elevatedTrust: badge only (SettingsSlideout); do not force-open security
  return input.userOpen.has(id)
}

export function toggleSectionOpen(
  id: SettingsSectionId,
  userOpen: Set<SettingsSectionId>,
): Set<SettingsSectionId> {
  const next = new Set(userOpen)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}
