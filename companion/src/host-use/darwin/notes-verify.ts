// Grill G4 — Notes create post-verify (S-semantic success contract).
// After writeOne create, confirm the returned target_id appears in list-notes.
// Pure helpers for unit tests; side-effecting path lives in server host_write.

export interface NotesCreateVerifyInput {
  /** Body that was written (first line used as note name by create-note). */
  body: string
  /** target_id returned by writeOne (encoded darwin TargetId). */
  targetId: string | undefined | null
  /**
   * Body (or preview) re-read from Notes after create (grill Q6=A).
   * Preferred verification path — required for verified:true.
   */
  reReadBody?: string | null
  /** Optional: list-notes ids for defense-in-depth membership check. */
  listedIds?: string[]
}

export interface NotesCreateVerifyResult {
  posted: true
  verified: boolean
  reason?: string
}

/**
 * Decide verified for a Notes create (Q6=A).
 * Fail-closed unless re-read body contains the written content needle
 * (first line, min 1 char). Optional listedIds: if provided and non-empty,
 * target_id must also appear (exact match or exact note-<suffix> segment).
 */
export function evaluateNotesCreateVerify(input: NotesCreateVerifyInput): NotesCreateVerifyResult {
  const needle = (input.body || "").split("\n")[0].slice(0, 80).trim()
  if (!input.targetId || typeof input.targetId !== "string") {
    return { posted: true, verified: false, reason: "create returned no target_id" }
  }
  if (needle.length === 0) {
    return { posted: true, verified: false, reason: "empty note body" }
  }
  const reRead = typeof input.reReadBody === "string" ? input.reReadBody : ""
  if (reRead.trim().length === 0) {
    return { posted: true, verified: false, reason: "no body re-read from Notes" }
  }
  // Notes may wrap body in HTML; plain needle must appear.
  if (!reRead.includes(needle)) {
    return { posted: true, verified: false, reason: "re-read body does not contain written title/body needle" }
  }
  const ids = Array.isArray(input.listedIds) ? input.listedIds.map(String) : []
  if (ids.length > 0) {
    if (ids.includes(input.targetId)) {
      return { posted: true, verified: true }
    }
    const m = /note-([A-Za-z0-9_\-]+)$/.exec(input.targetId)
    if (m) {
      const segment = `note-${m[1]}`
      if (ids.some((id) => id === input.targetId || id.endsWith(segment) || id.includes(`:${segment}`))) {
        return { posted: true, verified: true }
      }
    }
    return {
      posted: true,
      verified: false,
      reason: "body re-read ok but target_id not in list-notes",
    }
  }
  // Body re-read alone is sufficient when list not consulted.
  return { posted: true, verified: true }
}

/** Mail read fields that must be non-empty for verified:true (grill Q6=A). */
export function evaluateMailReadVerify(data: {
  sender?: string
  subject?: string
  date_received?: string
  body_preview?: string
}): { verified: boolean; reason?: string } {
  const fields = ["sender", "subject", "date_received", "body_preview"] as const
  for (const f of fields) {
    if (typeof data[f] !== "string" || data[f]!.trim().length === 0) {
      return { verified: false, reason: `missing or empty field: ${f}` }
    }
  }
  return { verified: true }
}
