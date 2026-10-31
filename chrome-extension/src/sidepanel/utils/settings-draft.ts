/** Draft state is in memory only; a send callback is not a save receipt. */
export type SettingsDraft<T extends object> = {
  base: T
  value: T
  revision: string
  dirty: Partial<Record<keyof T, number>>
  conflicts: Partial<Record<keyof T, true>>
  /** Revision that first caused a conflict; null means multiple/unknown origins. */
  conflictOrigins: Partial<Record<keyof T, string | null>>
  clock: number
}

export type SettingsSubmission<T extends object> = {
  id: string
  revision: string
  patch: Partial<T>
  generations: Partial<Record<keyof T, number>>
}

// Normalized wire values are JSON data. Compare structurally so a fresh array
// object in an unrelated broadcast does not falsely conflict with a draft.
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function createSettingsDraft<T extends object>(base: T, revision: string): SettingsDraft<T> {
  return { base: { ...base }, value: { ...base }, revision, dirty: {}, conflicts: {}, conflictOrigins: {}, clock: 0 }
}

export function editSettingsDraft<T extends object>(draft: SettingsDraft<T>, patch: Partial<T>): SettingsDraft<T> {
  const dirty = { ...draft.dirty }
  let clock = draft.clock
  for (const key of Object.keys(patch) as Array<keyof T>) dirty[key] = ++clock
  return { ...draft, value: { ...draft.value, ...patch }, dirty, clock }
}

/** A changed redacted secret cannot be compared; report a conflict conservatively. */
export function receiveSettingsSnapshot<T extends object>(
  draft: SettingsDraft<T>, snapshot: T, revision: string, opaque: ReadonlySet<keyof T>,
): SettingsDraft<T> {
  const value = { ...snapshot }
  const conflicts = { ...draft.conflicts }
  const conflictOrigins = { ...draft.conflictOrigins }
  for (const key of Object.keys(draft.dirty) as Array<keyof T>) {
    value[key] = draft.value[key]
    if (revision !== draft.revision && (opaque.has(key) || !sameValue(draft.base[key], snapshot[key]))) {
      conflictOrigins[key] = conflicts[key] && conflictOrigins[key] !== revision ? null : revision
      conflicts[key] = true
    }
  }
  return { ...draft, base: { ...snapshot }, value, revision, conflicts, conflictOrigins }
}

export function prepareSettingsSubmission<T extends object>(draft: SettingsDraft<T>, id: string): SettingsSubmission<T> {
  if (Object.keys(draft.conflicts).length) throw new Error("SETTINGS_DRAFT_CONFLICT")
  const patch: Partial<T> = {}
  const generations: Partial<Record<keyof T, number>> = {}
  for (const key of Object.keys(draft.dirty) as Array<keyof T>) {
    patch[key] = draft.value[key]
    generations[key] = draft.dirty[key]
  }
  return { id, revision: draft.revision, patch, generations }
}

/** The user chooses whether to keep their edit against the latest snapshot. */
export function resolveSettingsConflict<T extends object>(
  draft: SettingsDraft<T>, key: keyof T, choice: "mine" | "remote",
): SettingsDraft<T> {
  if (!draft.conflicts[key]) return draft
  const conflicts = { ...draft.conflicts }
  const conflictOrigins = { ...draft.conflictOrigins }
  const dirty = { ...draft.dirty }
  const value = { ...draft.value }
  delete conflicts[key]
  delete conflictOrigins[key]
  if (choice === "remote") {
    delete dirty[key]
    value[key] = draft.base[key]
  }
  return { ...draft, conflicts, conflictOrigins, dirty, value }
}

/** Only a correlated result can settle a field, and later edits remain dirty. */
export function acknowledgeSettingsSubmission<T extends object>(
  draft: SettingsDraft<T>, submission: SettingsSubmission<T>, id: string,
  snapshot: T, revision: string, opaque: ReadonlySet<keyof T>, confirmedOpaque: ReadonlySet<keyof T> = new Set(),
  appliedRevision?: string,
): SettingsDraft<T> {
  if (submission.id !== id) return receiveSettingsSnapshot(draft, snapshot, revision, opaque)
  const next = receiveSettingsSnapshot(draft, snapshot, revision, opaque)
  for (const key of Object.keys(submission.generations) as Array<keyof T>) {
    // Only a correlated server receipt can confirm a masked credential.
    const confirmed = opaque.has(key) ? confirmedOpaque.has(key) : sameValue(submission.patch[key], snapshot[key])
    const ownConflict = appliedRevision === revision && next.conflictOrigins[key] === revision && confirmed
    if (ownConflict) {
      delete next.conflicts[key]
      delete next.conflictOrigins[key]
    }
    if (draft.dirty[key] !== submission.generations[key]) continue
    if (!confirmed || next.conflicts[key]) {
      next.conflicts[key] = true
      if (next.conflictOrigins[key] === undefined) next.conflictOrigins[key] = null
      continue
    }
    delete next.dirty[key]
    next.value[key] = snapshot[key]
  }
  return next
}

/** Correlation IDs are generated for settings saves, not user content. */
export function isSettingsSaveError(message: { type?: unknown; id?: unknown }): message is { type: "error"; id: string } {
  return message.type === "error" && typeof message.id === "string" && /^settings-save:[A-Za-z0-9_-]{1,70}$/.test(message.id)
}

/** Compare revisions only within the same process epoch; other epochs are unordered. */
export function compareSettingsRevisions(current: string, incoming: string): "older" | "current" | "newer" | "unordered" {
  if (current === incoming) return "current"
  const parse = (value: string) => {
    const match = /^(.*):(0|[1-9][0-9]*)$/.exec(value)
    if (!match || !match[1]) return null
    const sequence = Number(match[2])
    return Number.isSafeInteger(sequence) ? { epoch: match[1], sequence } : null
  }
  const a = parse(current), b = parse(incoming)
  if (!a || !b || a.epoch !== b.epoch) return "unordered"
  return b.sequence < a.sequence ? "older" : "newer"
}
