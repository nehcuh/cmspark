/**
 * Outbound MCP L4+ caller grants (ADR-022 P1 design lock 2026-08-04).
 *
 * Separate from Extension pairing `ws_secret`. Tokens are issued once (cmg_…),
 * only sha256 hashes are stored. When `outbound_mcp.require_grant` is true,
 * loopback HTTP accepts grant bearers only (never fall back to ws_secret).
 */

import * as fs from "fs"
import * as path from "path"
import * as crypto from "crypto"
import { getConfigDir } from "../config"
import { atomicWriteJSON } from "../io"
import { appendCapabilityAudit } from "../packs/audit-log"

export const OUTBOUND_GRANT_TOKEN_PREFIX = "cmg_"
export const DEFAULT_GRANT_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30d wall-clock
export const OUTBOUND_L1_DEFAULT_PROFILE = "outbound_l1_default"

/** #406 — grants file was frozen at module load (GRANTS_PATH), so env-redirected
 *  callers (stdio-mcp outbound tests, runtime retarget) wrote the real home dir.
 *  Live-resolve under getConfigDir() like config.json / logs / daemon.pid. */
function grantsFilePath(): string {
  return path.join(getConfigDir(), "outbound-grants.json")
}

export type OutboundGrantRecord = {
  id: string
  label: string
  caller_id: string
  token_hash: string
  profile: string
  created_at: string
  expires_at: string | null
  revoked_at: string | null
  last_used_at: string | null
  /** Durable page-export consent on the grant file (not the in-process disclosure Map). */
  allow_page_export: boolean
  allow_page_export_at: string | null
}

type GrantsFile = { grants: OutboundGrantRecord[] }

export type IssueGrantOpts = {
  label: string
  caller_id: string
  /** TTL ms; default 30d; 0 = no expiry */
  ttl_ms?: number
  profile?: string
  /** Persist page-export consent on the grant; default false. Does not arm disclosure. */
  allow_page_export?: boolean
}

export type IssueGrantResult = {
  id: string
  label: string
  caller_id: string
  profile: string
  token: string
  expires_at: string | null
  created_at: string
}

export type GrantVerifyOk = {
  ok: true
  grant_id: string
  caller_id: string
  profile: string
}

export type GrantVerifyFail = {
  ok: false
  error_code: "GRANT_REQUIRED" | "GRANT_EXPIRED" | "GRANT_REVOKED" | "GRANT_CALLER_MISMATCH"
  error: string
  http_status: 401 | 403
}

export type GrantVerifyResult = GrantVerifyOk | GrantVerifyFail

function nowIso(): string {
  return new Date().toISOString()
}

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex")
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex")
    const bb = Buffer.from(b, "hex")
    if (ba.length !== bb.length || ba.length === 0) return false
    return crypto.timingSafeEqual(ba, bb)
  } catch {
    return false
  }
}

function normalizeGrant(raw: OutboundGrantRecord): OutboundGrantRecord {
  return {
    ...raw,
    allow_page_export: raw.allow_page_export === true,
    allow_page_export_at: raw.allow_page_export_at ?? null,
  }
}

function loadFile(): GrantsFile {
  try {
    const raw = fs.readFileSync(grantsFilePath(), "utf8")
    const parsed = JSON.parse(raw) as GrantsFile
    if (!parsed || !Array.isArray(parsed.grants)) return { grants: [] }
    return { grants: parsed.grants.map(normalizeGrant) }
  } catch {
    return { grants: [] }
  }
}

function saveFile(data: GrantsFile): void {
  atomicWriteJSON(grantsFilePath(), data, 0o600)
}

function audit(type: string, fields: Record<string, unknown>): void {
  try {
    appendCapabilityAudit({
      type,
      at: nowIso(),
      ...fields,
    } as any)
  } catch {
    /* best-effort */
  }
}

/** Generate raw token: cmg_ + 64 hex chars (≥32 bytes). */
export function generateOutboundGrantToken(): string {
  return OUTBOUND_GRANT_TOKEN_PREFIX + crypto.randomBytes(32).toString("hex")
}

export function isOutboundGrantTokenShape(token: string): boolean {
  return typeof token === "string" && token.startsWith(OUTBOUND_GRANT_TOKEN_PREFIX) && token.length > OUTBOUND_GRANT_TOKEN_PREFIX.length + 16
}

/**
 * Issue a new grant. Returns raw token once (never stored).
 */
export function issueOutboundGrant(opts: IssueGrantOpts): IssueGrantResult {
  const caller_id = (opts.caller_id || "").trim()
  if (!caller_id) {
    throw new Error("caller_id required")
  }
  const label = (opts.label || caller_id).trim() || caller_id
  const profile = (opts.profile || OUTBOUND_L1_DEFAULT_PROFILE).trim()
  if (profile !== OUTBOUND_L1_DEFAULT_PROFILE) {
    throw new Error(`unsupported grant profile: ${profile} (Phase 1 only ${OUTBOUND_L1_DEFAULT_PROFILE})`)
  }

  const ttl =
    opts.ttl_ms === undefined ? DEFAULT_GRANT_TTL_MS : Math.max(0, Number(opts.ttl_ms) || 0)
  const created_at = nowIso()
  const expires_at =
    ttl > 0 ? new Date(Date.now() + ttl).toISOString() : null

  const token = generateOutboundGrantToken()
  const id = "gr_" + crypto.randomBytes(12).toString("hex")
  const allow_page_export = !!opts.allow_page_export
  const rec: OutboundGrantRecord = {
    id,
    label,
    caller_id,
    token_hash: hashToken(token),
    profile,
    created_at,
    expires_at,
    revoked_at: null,
    last_used_at: null,
    allow_page_export,
    allow_page_export_at: allow_page_export ? created_at : null,
  }

  const file = loadFile()
  file.grants.push(rec)
  saveFile(file)
  audit("outbound_mcp.grant_issue", {
    grant_id: id,
    caller_id,
    label,
    profile,
    expires_at,
    allow_page_export,
  })

  return {
    id,
    label,
    caller_id,
    profile,
    token,
    expires_at,
    created_at,
  }
}

/**
 * Verify bearer token as a grant. Optionally bind body caller_id.
 * Always reloads store (revoke/expiry take effect next request).
 */
export function verifyOutboundGrantToken(
  token: string | null | undefined,
  bodyCallerId?: string | null,
): GrantVerifyResult {
  if (!token || !token.trim()) {
    return {
      ok: false,
      error_code: "GRANT_REQUIRED",
      error: "missing outbound grant bearer token",
      http_status: 401,
    }
  }
  const raw = token.trim()
  if (!isOutboundGrantTokenShape(raw)) {
    return {
      ok: false,
      error_code: "GRANT_REQUIRED",
      error: "invalid grant token shape (expected cmg_…)",
      http_status: 401,
    }
  }

  const wantHash = hashToken(raw)
  const file = loadFile()
  const rec = file.grants.find((g) => safeEqualHex(g.token_hash, wantHash))
  if (!rec) {
    return {
      ok: false,
      error_code: "GRANT_REQUIRED",
      error: "unknown or invalid outbound grant",
      http_status: 401,
    }
  }
  if (rec.revoked_at) {
    return {
      ok: false,
      error_code: "GRANT_REVOKED",
      error: "outbound grant revoked",
      http_status: 403,
    }
  }
  if (rec.expires_at && Date.parse(rec.expires_at) <= Date.now()) {
    return {
      ok: false,
      error_code: "GRANT_EXPIRED",
      error: "outbound grant expired",
      http_status: 403,
    }
  }
  if (rec.profile !== OUTBOUND_L1_DEFAULT_PROFILE) {
    return {
      ok: false,
      error_code: "GRANT_REQUIRED",
      error: `grant profile not allowed: ${rec.profile}`,
      http_status: 401,
    }
  }

  const bodyCaller = (bodyCallerId || "").trim()
  if (bodyCaller && bodyCaller !== rec.caller_id) {
    return {
      ok: false,
      error_code: "GRANT_CALLER_MISMATCH",
      error: `caller_id "${bodyCaller}" does not match grant binding "${rec.caller_id}"`,
      http_status: 403,
    }
  }

  // Touch last_used (best-effort)
  try {
    rec.last_used_at = nowIso()
    saveFile(file)
  } catch {
    /* ignore */
  }

  audit("outbound_mcp.grant_use", {
    grant_id: rec.id,
    caller_id: rec.caller_id,
  })

  return {
    ok: true,
    grant_id: rec.id,
    caller_id: rec.caller_id,
    profile: rec.profile,
  }
}

export function revokeOutboundGrant(grantId: string): boolean {
  const file = loadFile()
  const rec = file.grants.find((g) => g.id === grantId)
  if (!rec) return false
  if (!rec.revoked_at) {
    rec.revoked_at = nowIso()
    saveFile(file)
    audit("outbound_mcp.grant_revoke", {
      grant_id: rec.id,
      caller_id: rec.caller_id,
    })
  }
  return true
}

export function revokeAllOutboundGrants(): number {
  const file = loadFile()
  let n = 0
  const at = nowIso()
  for (const g of file.grants) {
    if (!g.revoked_at) {
      g.revoked_at = at
      n++
    }
  }
  if (n > 0) {
    saveFile(file)
    audit("outbound_mcp.grant_revoke_all", { count: n })
  }
  return n
}

/** Public list without token hashes. */
export function listOutboundGrants(): Omit<OutboundGrantRecord, "token_hash">[] {
  return loadFile().grants.map(({ token_hash: _h, ...rest }) => rest)
}

/**
 * True iff a live (not revoked, not expired) grant for caller_id has
 * `allow_page_export === true`. Reloads JSON; does not consult the disclosure Map.
 *
 * Caller-level semantics — stdio track only (W2 dual-track): the stdio paths
 * hold no grant credential, so any live flagged key for the caller allows.
 * The authenticated HTTP path must use `grantAllowsPageExportById` instead.
 */
export function grantAllowsPageExport(callerId: string): boolean {
  const id = (callerId || "").trim()
  if (!id) return false
  const t = Date.now()
  return loadFile().grants.some(
    (g) =>
      g.caller_id === id &&
      g.allow_page_export === true &&
      !g.revoked_at &&
      !(g.expires_at && Date.parse(g.expires_at) <= t),
  )
}

/**
 * True iff the specific grant `grantId` is live (not revoked, not expired) and
 * has `allow_page_export === true`. HTTP per-key track (W2): sibling grants of
 * the same caller do NOT authorize this key.
 */
export function grantAllowsPageExportById(grantId: string): boolean {
  const id = (grantId || "").trim()
  if (!id) return false
  const t = Date.now()
  return loadFile().grants.some(
    (g) =>
      g.id === id &&
      g.allow_page_export === true &&
      !g.revoked_at &&
      !(g.expires_at && Date.parse(g.expires_at) <= t),
  )
}

/** Test helper: wipe grants file under the live data dir. */
export function resetOutboundGrantsForTests(): void {
  try {
    if (fs.existsSync(grantsFilePath())) fs.unlinkSync(grantsFilePath())
  } catch {
    /* */
  }
}
