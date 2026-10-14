/** Runtime-owned read-only probe. An unbound confirmation cannot be guessed idle. */
let confirmationProbe: (() => number) | null = null
const startupMethods = new Set(["chat.create", "chat.regenerate", "file.upload", "acp.ui_start", "acp.session.prompt", "acp.session.followup", "acp.apply_diff", "terminal.open"])
const admissions = new Map<string, number>()
let unknownAdmissions = 0
/** Registered by the router before its very first await, including dynamic module loading. */
export function beginProjectRunAdmission(type: string, owner: unknown): () => void {
  if (!startupMethods.has(type)) return () => {}
  const id = typeof owner === "string" && owner && owner.length <= 200 ? owner : null
  const scoped = id && (admissions.has(id) || admissions.size < 256) ? id : null
  if (scoped) admissions.set(scoped, (admissions.get(scoped) || 0) + 1)
  else unknownAdmissions++
  let released = false
  return () => {
    if (released) return
    released = true
    if (scoped) { const left = (admissions.get(scoped) || 1) - 1; if (left) admissions.set(scoped, left); else admissions.delete(scoped) }
    else unknownAdmissions--
  }
}
export function projectRunAdmissionActivity(id: string): "idle" | "busy" | "unknown" {
  return unknownAdmissions ? "unknown" : admissions.has(id) ? "busy" : "idle"
}
export function bindProjectConfirmationProbe(probe: (() => number) | null): void { confirmationProbe = probe }
export function projectConfirmationActivity(): "idle" | "busy" | "unknown" {
  if (!confirmationProbe) return "unknown"
  try { const count = confirmationProbe(); return Number.isSafeInteger(count) && count >= 0 ? count ? "busy" : "idle" : "unknown" }
  catch { return "unknown" }
}
