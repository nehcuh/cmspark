import { createHash } from "node:crypto"
import type { AppEntry, AppPolicy } from "./types"

export interface BinaryDriftRecord {
  schema_version: 1
  status: "suspended" | "invalidated"
  approved_sha256: string
  observed_sha256: string
  restore_policy: AppPolicy
  subject_digest: string
}
const HEX = /^[a-f0-9]{64}$/
export function binaryDriftRecordError(entry: Record<string, any>): string | null {
  const r = entry.binary_drift
  if (r === undefined) return null
  const keys = ["schema_version", "status", "approved_sha256", "observed_sha256", "restore_policy", "subject_digest"]
  if (!r || typeof r !== "object" || Array.isArray(r) || ![Object.prototype, null].includes(Object.getPrototypeOf(r))
    || Object.keys(r).length !== keys.length || keys.some(k => !Object.hasOwn(r, k))
    || r.schema_version !== 1 || !["suspended", "invalidated"].includes(r.status)
    || !["manual", "ai", "auto"].includes(r.restore_policy)
    || [r.approved_sha256, r.observed_sha256, r.subject_digest].some(v => typeof v !== "string" || !HEX.test(v))
    || !binaryDriftSupported(entry as AppEntry) || entry.policy !== "manual" || typeof entry.exe?.sha256 !== "string"
    || r.approved_sha256 !== entry.exe.sha256.toLowerCase()) return "APP_DRIFT_STATE_INVALID"
  return null
}
export function binaryDriftSupported(entry: AppEntry | undefined): entry is AppEntry & { exe: NonNullable<AppEntry["exe"]> } {
  return !!entry && entry.kind === "gui" && typeof entry.token === "string" && entry.token.startsWith("win.app.")
    && typeof entry.exe?.path === "string" && !!entry.exe.path
    && typeof entry.exe.sha256 === "string" && /^[a-fA-F0-9]{64}$/.test(entry.exe.sha256)
    && !entry.aumid && !entry.bundleId && !entry.cli_manifest
}
/** The durable intent excludes the record itself and non-authority probe hints. */
export function binaryDriftDigest(entry: AppEntry, enabled: boolean): string {
  return createHash("sha256").update(JSON.stringify([enabled, entry.token, entry.kind, entry.source, entry.display_name,
    entry.added_at, entry.policy, entry.enabled, entry.exe?.path, entry.exe?.sha256, entry.exe?.signer,
    entry.exe?.user_writable_dir, entry.aumid, entry.bundleId, entry.coordinateAllowed, entry.templates, entry.cli_manifest])).digest("hex")
}
export function invalidateBinaryDrift(entry: AppEntry): AppEntry {
  return entry.binary_drift ? { ...entry, policy: "manual", binary_drift: { ...entry.binary_drift, status: "invalidated" } } : entry
}
export function validBinaryDriftMessage(message: any): boolean {
  if (!message || typeof message !== "object" || Array.isArray(message)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(message))) return false
  const reapprove = message.type === "apps.reapprove"
  if (!["apps.drift_status", "apps.check_drift", "apps.reapprove"].includes(message.type)) return false
  const keys = ["type", "id", "token", ...(reapprove ? ["expected_old_sha256", "expected_observed_sha256"] : [])]
  return Object.keys(message).every(k => keys.includes(k))
    && (message.id === undefined || typeof message.id === "string" && message.id.length <= 200)
    && typeof message.token === "string" && /^win\.app\.[a-z0-9][a-z0-9_-]{1,31}$/.test(message.token)
    && (!reapprove || [message.expected_old_sha256, message.expected_observed_sha256].every(v => typeof v === "string" && /^[a-fA-F0-9]{64}$/.test(v)))
}
