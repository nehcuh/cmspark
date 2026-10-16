import os from "node:os"
import { getConfig, replaceAppsEntries } from "../config"
import { logger } from "../logger"
import { requireAppsBiometric } from "./biometric-gate"
import { measureAppBinary } from "./binary-drift-files"
import { binaryDriftDigest, binaryDriftRecordError, binaryDriftSupported, validBinaryDriftMessage } from "./binary-drift-state"
import { maxPolicyForEntry, validateAppEntry, type AppEntry, type AppPolicy } from "./types"
import type { SecurityConfirmationDecision, SecurityConfirmationDetails } from "../security-confirmation"

export interface BinaryDriftContext {
  ownerCurrent?: () => boolean
  requestConfirmation?: (details: SecurityConfirmationDetails) => Promise<SecurityConfirmationDecision>
}
interface Watch { current(): { entries: Record<string, AppEntry>; entry: AppEntry } | undefined; close(): void }
export interface BinaryDriftDeps {
  platform?: NodeJS.Platform
  measure?: typeof measureAppBinary
  gate?: typeof requireAppsBiometric
  /** Explicit internal seams; not accepted from transport or App configuration. */
  persistEntries?: typeof replaceAppsEntries
  clearTrust: (token: string) => number
  watch: (token: string, entry: AppEntry) => Watch
  notify: (entries: Record<string, AppEntry>) => void
}
const rank: Record<AppPolicy, number> = { manual: 0, ai: 1, auto: 2 }
function failure(code: string, extra: Record<string, unknown> = {}) {
  return { type: "error", family: "apps", error: "应用文件检查或批准未完成，请刷新当前应用状态后核对。", code, ...extra }
}
function status(entry: AppEntry, enabled: boolean) {
  if (binaryDriftRecordError(entry)) return failure("APP_DRIFT_STATE_INVALID")
  if (!binaryDriftSupported(entry)) return { type: "apps.drift.result", family: "apps", token: entry.token, status: "unsupported" }
  const record = entry.binary_drift
  return { type: "apps.drift.result", family: "apps", token: entry.token,
    status: !record ? "not_checked" : !enabled || !entry.enabled || record.status === "invalidated"
      || record.subject_digest !== binaryDriftDigest(entry, enabled) ? "review_again" : "suspended",
    registered_sha256: entry.exe.sha256!.toLowerCase(),
    ...(record ? { last_observed_sha256: record.observed_sha256, restore_policy: record.restore_policy } : {}),
  }
}

/** Explicit owner management, never a tool/grant or a background drift scanner. */
export async function handleBinaryDrift(message: any, ctx: BinaryDriftContext, deps: BinaryDriftDeps) {
  if (!validBinaryDriftMessage(message)) return failure("INVALID_APP_DRIFT_REQUEST")
  if (typeof ctx.ownerCurrent !== "function" || !ctx.ownerCurrent()) return failure("APP_DRIFT_REVIEW_STALE")
  const config = getConfig().apps, entry = config?.entries[message.token]
  if (!entry) return failure("NOT_FOUND")
  if (binaryDriftRecordError(entry)) return failure("APP_DRIFT_STATE_INVALID")
  const supported = (deps.platform ?? os.platform()) === "win32" && binaryDriftSupported(entry)
  if (message.type === "apps.drift_status") return supported ? status(entry, config!.enabled)
    : { type: "apps.drift.result", family: "apps", token: message.token, status: "unsupported" }
  if (!supported) return failure("APP_DRIFT_UNSUPPORTED")
  if (!config?.enabled || !entry.enabled) return failure("APP_DRIFT_DISABLED")
  const initial = structuredClone(entry), watch = deps.watch(message.token, initial)
  const checkpoint = () => {
    if (!ctx.ownerCurrent!() || !watch.current()) throw new Error("APP_GRANT_STALE")
  }
  let writerAttempted = false
  const uncertain = () => {
    let current_status: unknown
    try { const apps = getConfig().apps, now = apps?.entries[message.token]; if (now) current_status = status(now, apps!.enabled) } catch { /* remain unknown */ }
    return failure("APP_DRIFT_COMMIT_UNCERTAIN", { outcome: "unknown", ...(current_status ? { current_status } : {}) })
  }
  const commit = (next: AppEntry) => {
    checkpoint()
    const current = watch.current()!
    if (validateAppEntry(next)) throw new Error("APP_DRIFT_STATE_INVALID")
    writerAttempted = true
    ;(deps.persistEntries ?? replaceAppsEntries)({ ...current.entries, [message.token]: next })
  }
  const measure = async () => {
    checkpoint()
    const snapshot = await (deps.measure ?? measureAppBinary)(structuredClone(initial), checkpoint)
    checkpoint(); snapshot.recheck()
    if (!/^[a-f0-9]{64}$/.test(snapshot.sha256) || (snapshot.signer ?? "") !== (initial.exe?.signer ?? "")) throw new Error("APP_DRIFT_SIGNER_UNSUPPORTED")
    return snapshot
  }
  try {
    checkpoint()
    if (message.type === "apps.check_drift") {
      const measured = await measure()
      checkpoint(); measured.recheck()
      const current = watch.current()!.entry
      const old = current.binary_drift, pin = current.exe!.sha256!.toLowerCase()
      if (!old && measured.sha256 === pin) return { ...status(current, true), status: "matches_pin", measured_sha256: measured.sha256 }
      const sameIntent = old?.status === "suspended" && old.subject_digest === binaryDriftDigest(current, true)
      const next: AppEntry = { ...current, policy: "manual", binary_drift: {
        schema_version: 1, status: "suspended", approved_sha256: pin, observed_sha256: measured.sha256,
        restore_policy: sameIntent ? old!.restore_policy : current.policy, subject_digest: "",
      } }
      next.binary_drift!.subject_digest = binaryDriftDigest(next, true)
      checkpoint(); measured.recheck(); commit(next)
      try { deps.clearTrust(message.token) } catch { return failure("APP_DRIFT_TRUST_CLEAR_FAILED", { outcome: "committed" }) }
      deps.notify(getConfig().apps?.entries ?? {})
      logger.info("apps.binary_drift", { token: message.token, via: "explicit_check", old_sha256: pin,
        new_sha256: measured.sha256, from_policy: current.policy, to_policy: "manual" })
      return status(next, true)
    }
    const record = initial.binary_drift
    if (!record || record.status !== "suspended" || record.subject_digest !== binaryDriftDigest(initial, true)) return failure("APP_DRIFT_REVIEW_STALE")
    const pin = initial.exe!.sha256!.toLowerCase(), expected = message.expected_observed_sha256.toLowerCase()
    if (message.expected_old_sha256.toLowerCase() !== pin || expected !== record.observed_sha256) return failure("APP_DRIFT_CHANGED_AGAIN")
    if (!ctx.requestConfirmation) return failure("NO_CONFIRMATION_CHANNEL")
    const first = await measure()
    if (first.sha256 !== expected) return failure("APP_DRIFT_CHANGED_AGAIN")
    const reason = [`重新批准应用 ${JSON.stringify(initial.display_name)} (${initial.token})`, `原指纹: ${pin}`,
      `当前指纹: ${expected}`, `恢复策略: ${record.restore_policy}`, "文件模板仍受原已支持版本/profile限制。"].join("\n")
    const decision = await (deps.gate ?? requireAppsBiometric)({ action: "apps.reapprove", reason, requestConfirmation: ctx.requestConfirmation })
    checkpoint()
    if (!decision.approved) return failure("BIOMETRIC_DENIED", { reason: decision.reason })
    const final = await measure()
    if (final.sha256 !== expected) return failure("APP_DRIFT_CHANGED_AGAIN")
    const current = watch.current()!.entry
    const { binary_drift: _oldIntent, ...rest } = current
    const next: AppEntry = { ...rest, policy: record.restore_policy,
      exe: { ...current.exe!, sha256: final.sha256, user_writable_dir: final.userWritable,
        ...(final.signer ? { signer: final.signer } : { signer: undefined }) } }
    if (rank[next.policy] > rank[maxPolicyForEntry(next)]) return failure("APP_DRIFT_POLICY_CAP")
    // No asynchronous boundary from strict trust clear and last file/owner fences to persistence.
    deps.clearTrust(message.token)
    checkpoint(); final.recheck(); commit(next)
    deps.notify(getConfig().apps?.entries ?? {})
    logger.info("apps.binary_reapproved", { token: message.token, old_sha256: pin, new_sha256: final.sha256,
      restore_policy: next.policy, method: decision.method })
    return { type: "apps.drift.result", family: "apps", token: message.token, status: "reapproved",
      registered_sha256: final.sha256, policy: next.policy, outcome: "committed" }
  } catch (error) {
    if (writerAttempted) return uncertain()
    const code = (error as Error)?.message
    const safe = ["APP_GRANT_STALE", "APP_DRIFT_STATE_INVALID", "APP_DRIFT_SIGNER_UNSUPPORTED"].includes(code) ? code : "APP_DRIFT_MEASUREMENT_FAILED"
    logger.warn("apps.binary_reapproval_denied", { token: message.token, reason: safe })
    return failure(safe)
  } finally { watch.close() }
}
