import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import AdmZip from "adm-zip"
import matter from "gray-matter"
import * as yaml from "js-yaml"
import { getConfigDir, getConfig, saveConfig, type CompanionConfig } from "../config"
import { atomicWriteJSON } from "../io"
import { SkillEngine } from "../skills/skill-engine"
import { ThreadManager } from "../threads/thread-manager"
import { appendCapabilityAudit } from "./audit-log"
import { validatePackDir } from "./validator"
import {
  MAX_PACK_TOTAL_BYTES,
  MAX_SYSTEM_PROMPT_APPEND,
  MAX_ZIP_ENTRIES,
  PACK_ID_RE,
  TOOL_IMPLIED_MODULES,
  type PackDetail,
  type PackListItem,
  type PackManifest,
  type PackOrigin,
  type PackTools,
  type PackTrustSnapshot,
  type SelectionMode,
  type ThreadPackSnapshot,
  type ToolsMode,
  type UserPackSaveInput,
  type UserPackTrustPolicy,
} from "./types"
import { getAllToolDefinitions } from "../bridge/tool-definitions"
import { setModuleEnabled } from "../capability/modules"

const DEFAULT_USER_TOOLS: PackTools = { mode: "unchanged", allow: [], deny: [] }

/** Derive requires_modules from allow-list (replace, not merge — avoids stale requires). */
export function deriveRequiresModulesFromTools(tools: PackTools): string[] {
  if (tools.mode === "unchanged") return []
  const mods = new Set<string>()
  for (const t of tools.allow || []) {
    const m = TOOL_IMPLIED_MODULES[t]
    if (m) mods.add(m)
  }
  return [...mods].sort()
}

/**
 * Resolve tools for user pack save.
 * - input.tools present → validate + normalize
 * - update omit → keep existing
 * - create omit → unchanged
 */
export function resolveUserPackTools(
  input: UserPackSaveInput,
  existing: PackTools | null,
): { ok: true; tools: PackTools } | { ok: false; error: string } {
  const known = new Set(getAllToolDefinitions().map((t) => t.function.name))
  if (input.tools) {
    const mode = input.tools.mode
    if (mode !== "allowlist" && mode !== "intersect" && mode !== "unchanged") {
      return { ok: false, error: `invalid tools.mode: ${mode}` }
    }
    let allow = Array.isArray(input.tools.allow)
      ? input.tools.allow.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim())
      : []
    const deny = Array.isArray(input.tools.deny)
      ? input.tools.deny.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim())
      : []
    for (const t of [...allow, ...deny]) {
      if (!known.has(t)) return { ok: false, error: `unknown tool in tools: ${t}` }
    }
    // D9: skill_ids present → ensure use_skill on allowlist/intersect
    const skillIds = Array.isArray(input.skill_ids) ? input.skill_ids : []
    if ((mode === "allowlist" || mode === "intersect") && skillIds.length > 0) {
      if (known.has("use_skill") && !allow.includes("use_skill") && !deny.includes("use_skill")) {
        allow = [...allow, "use_skill"]
      }
    }
    if (mode === "allowlist" && allow.filter((t) => !deny.includes(t)).length === 0) {
      return { ok: false, error: "tools.mode=allowlist requires a non-empty allow list" }
    }
    return { ok: true, tools: { mode, allow, deny } }
  }
  if (existing) return { ok: true, tools: { ...existing, allow: [...existing.allow], deny: [...existing.deny] } }
  return { ok: true, tools: { ...DEFAULT_USER_TOOLS } }
}

function toolsSummaryZh(tools: PackTools, custom?: string): string {
  if (custom && custom.trim()) return custom.trim()
  if (tools.mode === "unchanged") {
    return "不额外限制工具；优先使用本场景勾选的技能与 MCP"
  }
  const effective = (tools.allow || []).filter((t) => !(tools.deny || []).includes(t))
  const preview = effective.slice(0, 8).join(", ")
  const more = effective.length > 8 ? ` 等 ${effective.length} 个` : ""
  if (tools.mode === "intersect") {
    return `在当前对话工具面内再收窄为：${preview}${more}`
  }
  return `仅允许：${preview}${more}`
}

function normalizeUserTrust(input: UserPackTrustPolicy | null | undefined): UserPackTrustPolicy | null {
  if (!input || typeof input !== "object") return null
  const enable = Array.isArray(input.enable_modules)
    ? input.enable_modules.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim())
    : []
  const t: UserPackTrustPolicy = {
    set_enterprise_profile: input.set_enterprise_profile === true,
    enable_modules: enable.length > 0 ? enable : undefined,
    auto_approve_dangerous: input.auto_approve_dangerous === true,
    auto_approve_enterprise_tools: input.auto_approve_enterprise_tools === true,
    allow_all_schemes: input.allow_all_schemes === true,
    skip_l2: input.skip_l2 === true,
  }
  // Empty policy → null
  if (
    !t.set_enterprise_profile &&
    !t.enable_modules?.length &&
    !t.auto_approve_dangerous &&
    !t.auto_approve_enterprise_tools &&
    !t.allow_all_schemes &&
    !t.skip_l2
  ) {
    return null
  }
  return t
}

/** Snapshot global Trust/modules before a trust-writing pack apply. */
export function captureTrustSnapshot(): PackTrustSnapshot {
  const cfg = getConfig() as any
  const mods = cfg.modules || {}
  const modules: Record<string, { enabled: boolean }> = {}
  for (const [id, m] of Object.entries(mods)) {
    modules[id] = { enabled: !!(m as any)?.enabled }
  }
  return {
    capability_profile: cfg.capability_profile || "community",
    auto_approve_dangerous: cfg.security?.auto_approve_dangerous === true,
    auto_approve_enterprise_tools: cfg.security?.auto_approve_enterprise_tools === true,
    allow_all_schemes: cfg.security?.allow_all_schemes === true,
    modules,
  }
}

/**
 * Product B: apply user-pack trust to global Companion config.
 * skip_l2 → full three-flag cruise. enable_modules → setModuleEnabled.
 */
export function applyUserPackTrust(
  trust: UserPackTrustPolicy,
  by: string = "pack.apply",
): { ok: true } | { ok: false; error: string } {
  const cfg = getConfig() as any
  let profile = cfg.capability_profile || "community"
  const modulesToEnable = [...(trust.enable_modules || [])]
  if (trust.set_enterprise_profile || modulesToEnable.some((m) => m === "shell" || m === "netsec")) {
    profile = "enterprise"
  }

  // skip_l2 shorthand = full autonomy cruise flags
  let dangerous = trust.auto_approve_dangerous === true
  let enterprise = trust.auto_approve_enterprise_tools === true
  let schemes = trust.allow_all_schemes === true
  if (trust.skip_l2) {
    dangerous = true
    enterprise = true
    schemes = true
  }

  saveConfig({
    capability_profile: profile,
    security: {
      ...(cfg.security || {}),
      auto_approve_dangerous: dangerous,
      auto_approve_enterprise_tools: enterprise,
      allow_all_schemes: schemes,
    },
  } as any)

  for (const mod of modulesToEnable) {
    const r = setModuleEnabled(mod, true, by)
    if (!r.ok) {
      return { ok: false, error: r.error }
    }
  }

  appendCapabilityAudit({
    type: "pack.trust_apply",
    by,
    at: new Date().toISOString(),
    skip_l2: !!trust.skip_l2,
    auto_approve_dangerous: dangerous,
    auto_approve_enterprise_tools: enterprise,
    allow_all_schemes: schemes,
    enable_modules: modulesToEnable,
    capability_profile: profile,
  })
  return { ok: true }
}

/** Restore Trust snapshot captured before pack.apply (best-effort). */
export function restoreTrustSnapshot(snap: PackTrustSnapshot, by: string = "pack.unapply"): void {
  const cfg = getConfig() as any
  saveConfig({
    capability_profile: snap.capability_profile || "community",
    security: {
      ...(cfg.security || {}),
      auto_approve_dangerous: snap.auto_approve_dangerous === true,
      auto_approve_enterprise_tools: snap.auto_approve_enterprise_tools === true,
      allow_all_schemes: snap.allow_all_schemes === true,
    },
  } as any)
  for (const [id, st] of Object.entries(snap.modules || {})) {
    const want = st?.enabled === true
    const cur = (getConfig() as any).modules?.[id]?.enabled === true
    if (want !== cur) {
      setModuleEnabled(id, want, by)
    }
  }
  appendCapabilityAudit({
    type: "pack.trust_restore",
    by,
    at: new Date().toISOString(),
  })
}

/** True when value looks like a PackTrustSnapshot we can restore. */
export function isPackTrustSnapshot(v: unknown): v is PackTrustSnapshot {
  return !!v && typeof v === "object" && !Array.isArray(v) && "modules" in (v as object)
}

/**
 * Best-effort restore of a thread's stored trust cookie (does not clear the cookie).
 * Callers must clear mission_pack_trust_snapshot separately when leaving the pack.
 */
export function restoreTrustFromThreadCookie(
  trustCookie: unknown,
  by: string,
): boolean {
  if (!isPackTrustSnapshot(trustCookie)) return false
  try {
    restoreTrustSnapshot(trustCookie, by)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Trust B lifecycle journal + single-holder (S46 residual F4 / crash F1)
// ---------------------------------------------------------------------------

/** Durable journal under DATA_DIR — survives crash mid-apply. */
export type PackTrustJournal = {
  phase: "applying" | "held"
  thread_id: string
  pack_id: string
  snap: PackTrustSnapshot
  at: string
}

export function trustJournalPath(): string {
  return path.join(getConfigDir(), "mission-pack-trust-journal.json")
}

export function readTrustJournal(): PackTrustJournal | null {
  const p = trustJournalPath()
  try {
    if (!fs.existsSync(p)) return null
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"))
    if (!raw || typeof raw !== "object") return null
    if (raw.phase !== "applying" && raw.phase !== "held") return null
    if (typeof raw.thread_id !== "string" || typeof raw.pack_id !== "string") return null
    if (!isPackTrustSnapshot(raw.snap)) return null
    return {
      phase: raw.phase,
      thread_id: raw.thread_id,
      pack_id: raw.pack_id,
      snap: raw.snap,
      at: typeof raw.at === "string" ? raw.at : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export function writeTrustJournal(j: PackTrustJournal): void {
  atomicWriteJSON(trustJournalPath(), j, 0o600)
}

export function clearTrustJournal(): void {
  try {
    fs.unlinkSync(trustJournalPath())
  } catch {
    /* ignore */
  }
}

/** Other threads that currently hold a Trust restore cookie (single-holder policy). */
export function findOtherTrustHolders(
  threadManager: ThreadManager,
  excludeThreadId: string,
): Array<{ id: string; pack_id: string | null }> {
  const out: Array<{ id: string; pack_id: string | null }> = []
  for (const t of threadManager.list()) {
    if (t.id === excludeThreadId) continue
    if (isPackTrustSnapshot(t.mission_pack_trust_snapshot)) {
      out.push({ id: t.id, pack_id: t.mission_pack_id ?? null })
    }
  }
  return out
}

/**
 * Boot / reconnect: heal crash mid-apply and orphan held Trust with no thread cookie.
 * Call after ThreadManager is constructed (server initServices).
 */
export function reconcilePackTrustOnBoot(threadManager: ThreadManager): {
  action: "none" | "restored_applying" | "restored_orphan_held" | "cleared_stale_held"
  journal: PackTrustJournal | null
} {
  const j = readTrustJournal()
  if (!j) return { action: "none", journal: null }

  if (j.phase === "applying") {
    // Crash between trust write and thread cookie commit
    restoreTrustFromThreadCookie(j.snap, "pack.trust_reconcile:applying")
    clearTrustJournal()
    appendCapabilityAudit({
      type: "pack.trust_reconcile",
      at: new Date().toISOString(),
      action: "restored_applying",
      thread_id: j.thread_id,
      pack_id: j.pack_id,
    })
    return { action: "restored_applying", journal: j }
  }

  // phase === held: cookie should exist on that thread
  const thr = threadManager.get(j.thread_id)
  if (thr && isPackTrustSnapshot(thr.mission_pack_trust_snapshot)) {
    return { action: "none", journal: j }
  }

  // Orphan held: thread gone or cookie cleared without restore
  restoreTrustFromThreadCookie(j.snap, "pack.trust_reconcile:orphan_held")
  clearTrustJournal()
  appendCapabilityAudit({
    type: "pack.trust_reconcile",
    at: new Date().toISOString(),
    action: "restored_orphan_held",
    thread_id: j.thread_id,
    pack_id: j.pack_id,
  })
  return { action: "restored_orphan_held", journal: j }
}

function markTrustHeld(threadId: string, packId: string, snap: PackTrustSnapshot): void {
  writeTrustJournal({
    phase: "held",
    thread_id: threadId,
    pack_id: packId,
    snap,
    at: new Date().toISOString(),
  })
}

function markTrustApplying(threadId: string, packId: string, snap: PackTrustSnapshot): void {
  writeTrustJournal({
    phase: "applying",
    thread_id: threadId,
    pack_id: packId,
    snap,
    at: new Date().toISOString(),
  })
}

/** Clear journal when this thread releases Trust (or after failed apply). */
export function releaseTrustJournalIfMatch(threadId: string, _packId?: string | null): void {
  const j = readTrustJournal()
  if (!j) return
  if (j.thread_id !== threadId) return
  clearTrustJournal()
}

/**
 * Call before thread delete / trash / cleanup_empty so deleting a Trust-holding
 * conversation does not leave sticky cruise (Pi dual-review nit / S46).
 *
 * S51 P0: after restore, **clear** `mission_pack_trust_snapshot` so a later
 * hard-delete-from-trash cannot re-fire the same cookie (user may have changed
 * Settings between trash and permanent delete). Idempotent on second call.
 *
 * Soft-trash honesty (S52 N1): this releases Trust globals + cookie only —
 * it does **not** clear `mission_pack_id` / whitelist / skills (composition).
 * Product: restored-from-trash threads may still show 场景 chip; re-elevate
 * requires a new pack.apply with user_gesture + allowTrust.
 *
 * @param threadManager When provided, persists cookie clear via `update`.
 *   Without it, still mutates the live thread object (tests / best-effort).
 */
export function releaseTrustBeforeThreadGone(
  thread: {
    id: string
    mission_pack_id?: string | null
    mission_pack_trust_snapshot?: unknown
    /** When set, soft-delete already ran restore; leftover cookie is migration — clear only. */
    trashed_at?: string | null
  },
  by: string = "thread.delete",
  threadManager?: { update: (id: string, updates: { mission_pack_trust_snapshot: null }) => unknown },
): boolean {
  if (!isPackTrustSnapshot(thread.mission_pack_trust_snapshot)) return false

  // Soft-delete path calls release *before* trash(); hard-delete-from-trash has trashed_at set.
  // Pre-S51 rows may still hold a cookie after trash — never re-restore on hard-delete.
  const alreadyTrashed = !!(thread.trashed_at && String(thread.trashed_at).length > 0)
  if (!alreadyTrashed) {
    restoreTrustFromThreadCookie(thread.mission_pack_trust_snapshot, by)
    releaseTrustJournalIfMatch(thread.id, thread.mission_pack_id)
  } else {
    releaseTrustJournalIfMatch(thread.id, thread.mission_pack_id)
  }

  // Clear cookie after restore (or migration clear-only) so a later path cannot re-fire.
  try {
    if (threadManager) {
      threadManager.update(thread.id, { mission_pack_trust_snapshot: null })
    } else {
      ;(thread as { mission_pack_trust_snapshot?: unknown }).mission_pack_trust_snapshot = null
    }
  } catch {
    try {
      ;(thread as { mission_pack_trust_snapshot?: unknown }).mission_pack_trust_snapshot = null
    } catch {
      /* best-effort clear */
    }
  }
  appendCapabilityAudit({
    type: alreadyTrashed
      ? "pack.trust_cookie_cleared_on_trashed_delete"
      : "pack.trust_release_on_thread_gone",
    at: new Date().toISOString(),
    by,
    thread_id: thread.id,
    pack_id: thread.mission_pack_id || null,
  })
  return true
}

/**
 * Drop a leftover trust cookie on a trashed (or any) thread **without** restoring
 * globals. Use when release already ran (or for pre-S51 trash rows) before TTL purge.
 */
export function clearTrustCookieWithoutRestore(
  thread: { id: string; mission_pack_trust_snapshot?: unknown },
  threadManager: { update: (id: string, updates: { mission_pack_trust_snapshot: null }) => unknown },
  by: string = "thread.purge_clear_cookie",
): boolean {
  if (!isPackTrustSnapshot(thread.mission_pack_trust_snapshot)) return false
  try {
    threadManager.update(thread.id, { mission_pack_trust_snapshot: null })
  } catch {
    try {
      ;(thread as { mission_pack_trust_snapshot?: unknown }).mission_pack_trust_snapshot = null
    } catch {
      return false
    }
  }
  appendCapabilityAudit({
    type: "pack.trust_cookie_cleared_no_restore",
    at: new Date().toISOString(),
    by,
    thread_id: thread.id,
  })
  return true
}

/**
 * Install path must never persist origin=user or a trust block (S46 Security F2).
 * Only saveUserPack may author origin:user + trust. Builtin origin is preserved.
 * Returns sanitized manifest + whether rewrite of pack.yaml is required.
 */
export function sanitizeManifestForInstall(manifest: PackManifest): {
  manifest: PackManifest
  rewritten: boolean
} {
  const hadUserOrigin = manifest.origin === "user"
  const hadTrust = !!manifest.trust
  if (!hadUserOrigin && !hadTrust) {
    return { manifest, rewritten: false }
  }
  const next: PackManifest = {
    ...manifest,
    origin: manifest.origin === "builtin" ? "builtin" : "installed",
  }
  delete next.trust
  // Spoofed user origin never stays user on install
  if (hadUserOrigin) {
    next.origin = "installed"
  }
  return { manifest: next, rewritten: true }
}

/** Persist sanitized manifest to pack.yaml (install path only). */
function rewritePackYaml(destDir: string, manifest: PackManifest): void {
  const doc: Record<string, unknown> = {
    schema_version: manifest.schema_version,
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    channel: manifest.channel,
    min_capability: manifest.min_capability,
    requires_modules: manifest.requires_modules,
    origin: manifest.origin || "installed",
    skills: manifest.skills,
    skill_refs: manifest.skill_refs,
    knowledge: manifest.knowledge,
    mcp_servers: manifest.mcp_servers,
    tools: manifest.tools,
    system_prompt_append: manifest.system_prompt_append,
    board_mode: manifest.board_mode,
    thread_defaults: manifest.thread_defaults,
    workspace: manifest.workspace,
    author: manifest.author,
    tags: manifest.tags,
    ui: manifest.ui,
    // intentionally omit trust
  }
  // Drop undefined keys for cleaner yaml
  for (const k of Object.keys(doc)) {
    if (doc[k] === undefined) delete doc[k]
  }
  const yamlBody = yaml.dump(doc, { lineWidth: -1, noRefs: true })
  fs.writeFileSync(path.join(destDir, "pack.yaml"), yamlBody, { mode: 0o600 })
}

function packsInstalledDir(): string {
  return path.join(getConfigDir(), "packs", "installed")
}

function skillsDir(): string {
  return path.join(getConfigDir(), "skills")
}

function knowledgeGlobalDir(): string {
  return path.join(getConfigDir(), "knowledge", "global")
}

export function ensurePackDirs(): void {
  fs.mkdirSync(packsInstalledDir(), { recursive: true, mode: 0o700 })
  fs.mkdirSync(path.join(getConfigDir(), "logs"), { recursive: true, mode: 0o700 })
  fs.mkdirSync(path.join(getConfigDir(), "cache"), { recursive: true, mode: 0o700 })
}

export function computeWhitelist(
  mode: ToolsMode,
  allow: string[],
  deny: string[],
  current: string[] | null,
): string[] | null {
  const denySet = new Set(deny)
  const allowClean = allow.filter((t) => !denySet.has(t))
  if (mode === "unchanged") return current
  if (mode === "allowlist") return allowClean
  // intersect: null current → degrade to allowlist (S11)
  if (current === null) return allowClean
  return current.filter((t) => allowClean.includes(t) && !denySet.has(t))
}

function skillFileName(packId: string, originalName: string): string {
  const safe = originalName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^\.+/, "")
  return `pack--${packId}--${safe}.md`
}

function skillId(packId: string, originalName: string): string {
  return `pack--${packId}--${originalName}`
}

function extractFrontmatterName(filePath: string): string {
  try {
    const raw = fs.readFileSync(filePath, "utf-8")
    const parsed = matter(raw)
    if (typeof parsed.data?.name === "string" && parsed.data.name.trim()) {
      return parsed.data.name.trim()
    }
  } catch {
    /* fall through */
  }
  return path.basename(filePath, path.extname(filePath))
}

function rewriteSkillWithNamespacedName(srcPath: string, destPath: string, namespacedName: string): void {
  const raw = fs.readFileSync(srcPath, "utf-8")
  const parsed = matter(raw)
  const data: Record<string, unknown> = { ...(parsed.data as Record<string, unknown>), name: namespacedName }
  // Preserve type if missing for skills
  if (!data.type) data.type = "prompt_template"
  const body = parsed.content || ""
  const out = `---\n${yaml.dump(data, { lineWidth: -1 }).trim()}\n---\n${body.startsWith("\n") ? body : "\n" + body}`
  fs.writeFileSync(destPath, out, { mode: 0o600 })
}

function copyKnowledge(srcPath: string, destPath: string, namespacedName: string): void {
  const raw = fs.readFileSync(srcPath, "utf-8")
  const parsed = matter(raw)
  const data: Record<string, unknown> = { ...(parsed.data as Record<string, unknown>), name: namespacedName }
  if (!data.type) data.type = "domain_knowledge"
  const body = parsed.content || ""
  const out = `---\n${yaml.dump(data, { lineWidth: -1 }).trim()}\n---\n${body.startsWith("\n") ? body : "\n" + body}`
  fs.writeFileSync(destPath, out, { mode: 0o600 })
}

function removeNamespacedAssets(packId: string): void {
  const skillPrefix = `pack--${packId}--`
  for (const dir of [skillsDir(), knowledgeGlobalDir()]) {
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(skillPrefix) && f.endsWith(".md")) {
        try {
          fs.unlinkSync(path.join(dir, f))
        } catch {
          /* ignore */
        }
      }
    }
  }
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true, mode: 0o700 })
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name)
    const d = path.join(dest, ent.name)
    if (ent.isDirectory()) copyDirRecursive(s, d)
    else if (ent.isFile()) fs.copyFileSync(s, d)
  }
}

function installAssetsFromValidated(
  packDir: string,
  manifest: PackManifest,
  skillAbs: string[],
  knowledgeAbs: string[],
): { skillIds: string[]; knowledgeIds: string[] } {
  const skillIds: string[] = []
  const knowledgeIds: string[] = []
  fs.mkdirSync(skillsDir(), { recursive: true, mode: 0o700 })
  fs.mkdirSync(knowledgeGlobalDir(), { recursive: true, mode: 0o700 })

  for (const abs of skillAbs) {
    const orig = extractFrontmatterName(abs)
    const ns = skillId(manifest.id, orig)
    const dest = path.join(skillsDir(), skillFileName(manifest.id, orig))
    rewriteSkillWithNamespacedName(abs, dest, ns)
    skillIds.push(ns)
  }
  for (const abs of knowledgeAbs) {
    const orig = extractFrontmatterName(abs)
    const ns = skillId(manifest.id, orig)
    const dest = path.join(knowledgeGlobalDir(), skillFileName(manifest.id, orig))
    copyKnowledge(abs, dest, ns)
    knowledgeIds.push(ns)
  }
  return { skillIds, knowledgeIds }
}

function readInstalledManifest(packId: string): { dir: string; result: ReturnType<typeof validatePackDir> } {
  const dir = path.join(packsInstalledDir(), packId)
  return { dir, result: validatePackDir(dir) }
}

export function listInstalledPacks(cfg?: CompanionConfig): PackListItem[] {
  ensurePackDirs()
  const config = cfg || getConfig()
  const root = packsInstalledDir()
  if (!fs.existsSync(root)) return []
  const items: PackListItem[] = []
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name)
    if (!fs.statSync(dir).isDirectory()) continue
    const v = validatePackDir(dir)
    if (!v.ok) {
      items.push({
        id: name,
        name: name,
        version: "?",
        channel: "community",
        min_capability: "L0",
        requires_modules: [],
        apply_blocked: `invalid: ${v.error}`,
        installed_path: dir,
      })
      continue
    }
    const ui = v.manifest.ui
    const origin = resolvePackOrigin(v.manifest)
    const trust = v.manifest.trust
    const hasTrust = !!trust
    items.push({
      id: v.manifest.id,
      name: v.manifest.name,
      description: v.manifest.description,
      version: v.manifest.version,
      channel: v.manifest.channel,
      min_capability: v.manifest.min_capability,
      requires_modules: v.manifest.requires_modules,
      apply_blocked: computeApplyBlocked(v.manifest, config),
      installed_path: dir,
      suitable_for: typeof ui?.suitable_for === "string" ? ui.suitable_for : undefined,
      unsuitable_for: typeof ui?.unsuitable_for === "string" ? ui.unsuitable_for : undefined,
      tools_summary_zh: typeof ui?.tools_summary_zh === "string" ? ui.tools_summary_zh : undefined,
      origin,
      skill_refs: v.manifest.skill_refs,
      mcp_servers: v.manifest.mcp_servers,
      editable: origin === "user",
      has_trust: hasTrust,
      trust_skip_l2: trust?.skip_l2 === true,
    })
  }
  return items.sort((a, b) => a.id.localeCompare(b.id))
}

function resolvePackOrigin(manifest: PackManifest): PackOrigin {
  if (manifest.origin === "user" || manifest.origin === "builtin" || manifest.origin === "installed") {
    return manifest.origin
  }
  // Heuristic: ids we ship under packs/builtin
  if (
    manifest.id === "appsec-prd-review" ||
    manifest.id === "netsec-port-survey" ||
    manifest.author === "cmspark"
  ) {
    return "builtin"
  }
  return "installed"
}

export function getPackDetail(
  packId: string,
  skillEngine?: SkillEngine,
): { ok: true; pack: PackDetail } | { ok: false; error: string } {
  if (!packId || typeof packId !== "string") return { ok: false, error: "pack_id required" }
  const { result } = readInstalledManifest(packId)
  if (!result.ok) return { ok: false, error: result.error }
  const m = result.manifest
  const origin = resolvePackOrigin(m)
  const ui = m.ui
  const nsPrefix = `pack--${m.id}--`
  let installedSkillIds: string[] = []
  let installedKnowledgeIds: string[] = []
  if (skillEngine) {
    installedSkillIds = skillEngine
      .list()
      .map((s) => s.name)
      .filter((n) => n.startsWith(nsPrefix))
    installedKnowledgeIds = skillEngine
      .listKnowledge()
      .map((k) => k.name)
      .filter((n) => n.startsWith(nsPrefix))
  } else {
    // Best-effort from disk without SkillEngine
    try {
      const dir = skillsDir()
      if (fs.existsSync(dir)) {
        installedSkillIds = fs
          .readdirSync(dir)
          .filter((f) => f.startsWith(nsPrefix) && f.endsWith(".md"))
          .map((f) => f.replace(/\.md$/, ""))
      }
    } catch {
      /* ignore */
    }
    try {
      const kdir = knowledgeGlobalDir()
      if (fs.existsSync(kdir)) {
        installedKnowledgeIds = fs
          .readdirSync(kdir)
          .filter((f) => f.startsWith(nsPrefix) && f.endsWith(".md"))
          .map((f) => f.replace(/\.md$/, ""))
      }
    } catch {
      /* ignore */
    }
  }
  return {
    ok: true,
    pack: {
      id: m.id,
      name: m.name,
      description: m.description,
      version: m.version,
      channel: m.channel,
      origin,
      editable: origin === "user",
      system_prompt_append: m.system_prompt_append,
      skill_refs: Array.isArray(m.skill_refs) ? [...m.skill_refs] : [],
      knowledge_refs: Array.isArray(m.knowledge_refs) ? [...m.knowledge_refs] : [],
      mcp_servers: Array.isArray(m.mcp_servers) ? [...m.mcp_servers] : [],
      skills: Array.isArray(m.skills) ? [...m.skills] : [],
      installed_skill_ids: installedSkillIds,
      installed_knowledge_ids: installedKnowledgeIds,
      requires_modules: Array.isArray(m.requires_modules) ? [...m.requires_modules] : [],
      tools: {
        mode: m.tools.mode,
        allow: [...(m.tools.allow || [])],
        deny: [...(m.tools.deny || [])],
      },
      trust: m.trust ? { ...m.trust, enable_modules: m.trust.enable_modules ? [...m.trust.enable_modules] : undefined } : null,
      suitable_for: ui?.suitable_for,
      unsuitable_for: ui?.unsuitable_for,
      tools_summary_zh: ui?.tools_summary_zh,
    },
  }
}

function slugifyPackName(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  if (ascii) return ascii
  // CJK / non-ascii names: stable short hash so PACK_ID_RE still matches
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return `scene-${h.toString(36).slice(0, 8)}`
}

function allocateUserPackId(preferred?: string, name?: string): string {
  const base =
    preferred && PACK_ID_RE.test(preferred)
      ? preferred
      : `user-${slugifyPackName(name || "scene")}`
  let id = base.startsWith("user-") || preferred ? base : `user-${base}`
  if (!PACK_ID_RE.test(id)) id = `user-scene-${Date.now().toString(36)}`
  if (!fs.existsSync(path.join(packsInstalledDir(), id))) return id
  for (let i = 2; i < 1000; i++) {
    const candidate = `${id}-${i}`.slice(0, 64)
    if (PACK_ID_RE.test(candidate) && !fs.existsSync(path.join(packsInstalledDir(), candidate))) {
      return candidate
    }
  }
  return `user-scene-${Date.now().toString(36)}`
}

/**
 * Create or update a user-authored scene template (origin:user).
 * Does not overwrite builtin/installed packs. UI-only — require user_gesture at RPC layer.
 */
export function saveUserPack(
  input: UserPackSaveInput,
  skillEngine: SkillEngine,
): { ok: true; id: string; packs: PackListItem[] } | { ok: false; error: string; code?: string } {
  ensurePackDirs()
  const name = typeof input.name === "string" ? input.name.trim() : ""
  if (!name) return { ok: false, error: "name is required", code: "invalid_input" }

  const append =
    typeof input.system_prompt_append === "string" ? input.system_prompt_append.trim() : ""
  if (!append) {
    return { ok: false, error: "system_prompt_append is required", code: "invalid_input" }
  }
  if (append.length > MAX_SYSTEM_PROMPT_APPEND) {
    return {
      ok: false,
      error: `system_prompt_append exceeds ${MAX_SYSTEM_PROMPT_APPEND} chars`,
      code: "invalid_input",
    }
  }

  const skillIds = Array.isArray(input.skill_ids)
    ? input.skill_ids.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim())
    : []
  for (const s of skillIds) {
    if (s.includes("/") || s.includes("\\") || s.includes("..")) {
      return { ok: false, error: `invalid skill id: ${s}`, code: "invalid_input" }
    }
  }
  // Always rewrite from input array (same as skill_ids — UI always sends).
  const knowledgeIds = Array.isArray(input.knowledge_ids)
    ? input.knowledge_ids.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim())
    : []
  for (const s of knowledgeIds) {
    if (s.includes("/") || s.includes("\\") || s.includes("..")) {
      return { ok: false, error: `invalid knowledge id: ${s}`, code: "invalid_input" }
    }
  }
  const mcpIds = Array.isArray(input.mcp_server_ids)
    ? input.mcp_server_ids.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim())
    : []

  const existingId = typeof input.id === "string" && input.id.trim() ? input.id.trim() : undefined
  let packId: string
  if (existingId) {
    if (!PACK_ID_RE.test(existingId)) {
      return { ok: false, error: `invalid pack id: ${existingId}`, code: "invalid_input" }
    }
    const dest = path.join(packsInstalledDir(), existingId)
    if (fs.existsSync(dest)) {
      const { result } = readInstalledManifest(existingId)
      if (!result.ok) return { ok: false, error: result.error }
      if (resolvePackOrigin(result.manifest) !== "user") {
        return {
          ok: false,
          error: "cannot overwrite non-user scene; create a new one or use 另存为 later",
          code: "not_user_pack",
        }
      }
      packId = existingId
    } else {
      packId = existingId.startsWith("user-") ? existingId : allocateUserPackId(existingId, name)
    }
  } else {
    packId = allocateUserPackId(undefined, name)
  }

  const description =
    typeof input.description === "string" && input.description.trim()
      ? input.description.trim()
      : undefined

  // Preserve tools/trust on update when client omits fields
  let existingTools: PackTools | null = null
  let existingTrust: UserPackTrustPolicy | null = null
  const destExisting = path.join(packsInstalledDir(), packId)
  if (fs.existsSync(destExisting)) {
    const { result } = readInstalledManifest(packId)
    if (result.ok) {
      existingTools = result.manifest.tools
      existingTrust = result.manifest.trust || null
    }
  }
  const toolsRes = resolveUserPackTools(input, existingTools)
  if (!toolsRes.ok) return { ok: false, error: toolsRes.error, code: "invalid_input" }
  const tools = toolsRes.tools
  const requiresModules = deriveRequiresModulesFromTools(tools)
  // Merge trust: input.trust === null clears; undefined preserves; object sets
  let trust: UserPackTrustPolicy | null = null
  if (input.trust === null) {
    trust = null
  } else if (input.trust !== undefined) {
    trust = normalizeUserTrust(input.trust)
  } else {
    trust = existingTrust
  }
  // If trust wants modules, ensure requires_modules includes them
  if (trust?.enable_modules?.length) {
    for (const m of trust.enable_modules) {
      if (!requiresModules.includes(m)) requiresModules.push(m)
    }
    requiresModules.sort()
  }
  // Enterprise channel when shell/netsec or trust set_enterprise / skip_l2 modules
  const channel =
    requiresModules.some((m) => m === "shell" || m === "netsec") ||
    trust?.set_enterprise_profile ||
    trust?.skip_l2 ||
    trust?.enable_modules?.some((m) => m === "shell" || m === "netsec")
      ? "enterprise"
      : "community"
  const customSummary =
    typeof input.tools_summary_zh === "string" && input.tools_summary_zh.trim()
      ? input.tools_summary_zh.trim()
      : undefined

  const manifestDoc: Record<string, unknown> = {
    schema_version: 1,
    id: packId,
    name,
    description,
    version: "0.1.0",
    channel,
    min_capability: requiresModules.length > 0 || trust ? "L1" : "L0",
    requires_modules: requiresModules,
    origin: "user",
    skills: [],
    skill_refs: skillIds,
    knowledge: [],
    knowledge_refs: knowledgeIds,
    mcp_servers: mcpIds,
    tools: {
      mode: tools.mode,
      allow: tools.allow,
      deny: tools.deny,
    },
    ...(trust ? { trust } : {}),
    system_prompt_append: append,
    thread_defaults: {
      skill_selection_mode: "manual",
      knowledge_selection_mode: "manual",
      mcp_selection_mode: "manual",
    },
    workspace: { type: "none" },
    author: "user",
    tags: ["user-scene"],
    ui: {
      suitable_for:
        typeof input.suitable_for === "string" && input.suitable_for.trim()
          ? input.suitable_for.trim()
          : description || `用户场景：${name}`,
      unsuitable_for:
        typeof input.unsuitable_for === "string" && input.unsuitable_for.trim()
          ? input.unsuitable_for.trim()
          : "需要强制收窄工具面的专业模板（请用内置场景）",
      tools_summary_zh: toolsSummaryZh(tools, customSummary),
    },
  }

  const tmp = path.join(getConfigDir(), "cache", `user-pack-${Date.now()}`)
  try {
    fs.mkdirSync(tmp, { recursive: true, mode: 0o700 })
    const yamlBody = yaml.dump(manifestDoc, { lineWidth: -1, noRefs: true })
    fs.writeFileSync(path.join(tmp, "pack.yaml"), yamlBody, { mode: 0o600 })

    const v = validatePackDir(tmp)
    if (!v.ok) return { ok: false, error: v.error, code: "validation_failed" }

    const dest = path.join(packsInstalledDir(), packId)
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
    fs.renameSync(tmp, dest)

    skillEngine.refresh()
    appendCapabilityAudit({
      type: "pack.save_user",
      pack_id: packId,
      at: new Date().toISOString(),
      tools_mode: tools.mode,
      tools_allow_count: tools.allow.length,
      requires_modules: requiresModules,
      high_risk: tools.allow.some((t) =>
        ["shell_exec", "evaluate", "osascript_eval", "host_computer", "netsec_port_scan"].includes(t),
      ),
      trust: trust
        ? {
            skip_l2: !!trust.skip_l2,
            auto_approve_dangerous: !!trust.auto_approve_dangerous,
            auto_approve_enterprise_tools: !!trust.auto_approve_enterprise_tools,
            allow_all_schemes: !!trust.allow_all_schemes,
            enable_modules: trust.enable_modules || [],
          }
        : null,
    })
    return { ok: true, id: packId, packs: listInstalledPacks() }
  } catch (e: any) {
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    return { ok: false, error: e?.message || String(e) }
  }
}

/**
 * Delete a user-authored scene. Builtin/installed packs must use pack.uninstall.
 */
export function deleteUserPack(
  packId: string,
  threadManager: ThreadManager,
  skillEngine: SkillEngine,
): { ok: true; restored_threads: string[]; packs: PackListItem[] } | { ok: false; error: string; code?: string } {
  if (!packId) return { ok: false, error: "pack_id required", code: "invalid_input" }
  const dest = path.join(packsInstalledDir(), packId)
  if (!fs.existsSync(dest)) return { ok: false, error: `pack not installed: ${packId}`, code: "not_found" }
  const { result } = readInstalledManifest(packId)
  if (!result.ok) return { ok: false, error: result.error }
  if (resolvePackOrigin(result.manifest) !== "user") {
    return {
      ok: false,
      error: "only user-authored scenes can be deleted via pack.delete_user",
      code: "not_user_pack",
    }
  }
  const un = uninstallPack(packId, threadManager, skillEngine)
  if (!un.ok) return un
  return { ok: true, restored_threads: un.restored_threads, packs: listInstalledPacks() }
}

function computeApplyBlocked(manifest: PackManifest, config: CompanionConfig): string | null {
  const profile = (config as any).capability_profile || "community"
  if (manifest.channel === "enterprise" && profile !== "enterprise") {
    return "enterprise_profile_required"
  }
  const modules = (config as any).modules || {}
  for (const mod of manifest.requires_modules) {
    const m = modules[mod]
    if (!m || m.available !== true) return `module_unavailable:${mod}`
    if (m.enabled !== true) return `module_disabled:${mod}`
  }
  return null
}

export function installPackFromDirectory(
  sourceDir: string,
  skillEngine: SkillEngine,
  opts?: { force?: boolean },
): { ok: true; id: string } | { ok: false; error: string } {
  ensurePackDirs()
  const v = validatePackDir(sourceDir)
  if (!v.ok) return { ok: false, error: v.error }

  const dest = path.join(packsInstalledDir(), v.manifest.id)
  if (fs.existsSync(dest) && !opts?.force) {
    return { ok: false, error: `pack already installed: ${v.manifest.id} (use force to replace)` }
  }

  const tmp = path.join(getConfigDir(), "cache", `pack-install-${Date.now()}`)
  try {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true })
    copyDirRecursive(sourceDir, tmp)
    const v2 = validatePackDir(tmp)
    if (!v2.ok) return { ok: false, error: v2.error }

    // S46 P0-3: strip origin=user + trust on install path (only saveUserPack may author them)
    const sanitized = sanitizeManifestForInstall(v2.manifest)
    if (sanitized.rewritten) {
      rewritePackYaml(tmp, sanitized.manifest)
    }

    removeNamespacedAssets(v2.manifest.id)
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
    fs.renameSync(tmp, dest)

    // Re-validate after rename so skillAbsPaths point at dest (not tmp)
    const v3 = validatePackDir(dest)
    if (!v3.ok) return { ok: false, error: v3.error }
    // Defense in depth: trust must never remain on installed tree after sanitize
    if (v3.manifest.trust || v3.manifest.origin === "user") {
      const again = sanitizeManifestForInstall(v3.manifest)
      rewritePackYaml(dest, again.manifest)
      const v4 = validatePackDir(dest)
      if (!v4.ok) return { ok: false, error: v4.error }
      installAssetsFromValidated(dest, v4.manifest, v4.skillAbsPaths, v4.knowledgeAbsPaths)
      skillEngine.refresh()
      appendCapabilityAudit({
        type: "pack.install",
        pack_id: v4.manifest.id,
        at: new Date().toISOString(),
        trust_stripped: true,
        origin_forced: again.manifest.origin,
      })
      return { ok: true, id: v4.manifest.id }
    }
    installAssetsFromValidated(dest, v3.manifest, v3.skillAbsPaths, v3.knowledgeAbsPaths)
    skillEngine.refresh()
    appendCapabilityAudit({
      type: "pack.install",
      pack_id: v3.manifest.id,
      at: new Date().toISOString(),
      trust_stripped: sanitized.rewritten,
      origin_forced: sanitized.rewritten ? sanitized.manifest.origin : undefined,
    })
    return { ok: true, id: v3.manifest.id }
  } catch (e: any) {
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    return { ok: false, error: e?.message || String(e) }
  }
}

/**
 * Install from zip buffer/path with zip-slip protection.
 */
export function installPackFromZip(
  zipPath: string,
  skillEngine: SkillEngine,
  opts?: { force?: boolean },
): { ok: true; id: string } | { ok: false; error: string } {
  ensurePackDirs()
  const tmpRoot = path.join(getConfigDir(), "cache", `pack-zip-${Date.now()}`)
  fs.mkdirSync(tmpRoot, { recursive: true, mode: 0o700 })
  const tmpReal = fs.realpathSync(tmpRoot)
  try {
    const zip = new AdmZip(zipPath)
    const entries = zip.getEntries()
    if (entries.length > MAX_ZIP_ENTRIES) {
      return { ok: false, error: `too many zip entries (>${MAX_ZIP_ENTRIES})` }
    }
    let total = 0
    for (const entry of entries) {
      if (entry.isDirectory) continue
      total += entry.header.size
      if (total > MAX_PACK_TOTAL_BYTES) {
        return { ok: false, error: "zip uncompressed size exceeds limit" }
      }
      // Prevent zip slip: resolve destination and check containment
      const dest = path.resolve(tmpRoot, entry.entryName)
      if (!dest.startsWith(tmpReal + path.sep) && dest !== tmpReal) {
        return { ok: false, error: `zip slip rejected: ${entry.entryName}` }
      }
    }
    zip.extractAllTo(tmpRoot, true)
    // After extract, verify every file stays contained
    const walk = (dir: string): string | null => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name)
        const real = fs.realpathSync(p)
        if (!real.startsWith(tmpReal + path.sep) && real !== tmpReal) {
          return `zip slip after extract: ${p}`
        }
        if (ent.isDirectory()) {
          const err = walk(p)
          if (err) return err
        }
      }
      return null
    }
    const slip = walk(tmpRoot)
    if (slip) return { ok: false, error: slip }

    // Find pack.yaml root (either at top or single nested dir)
    let packRoot = tmpRoot
    if (!fs.existsSync(path.join(packRoot, "pack.yaml"))) {
      const kids = fs.readdirSync(tmpRoot).filter((n) => fs.statSync(path.join(tmpRoot, n)).isDirectory())
      if (kids.length === 1 && fs.existsSync(path.join(tmpRoot, kids[0], "pack.yaml"))) {
        packRoot = path.join(tmpRoot, kids[0])
      } else {
        return { ok: false, error: "pack.yaml not found in zip" }
      }
    }
    return installPackFromDirectory(packRoot, skillEngine, opts)
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

function mergeSystemPromptAppend(userPortion: string | null | undefined, packAppend: string): string {
  const packBlock = `--- Mission Pack ---\n${packAppend}`
  if (userPortion && userPortion.trim()) {
    return `${packBlock}\n\n--- User ---\n${userPortion.trim()}`
  }
  return packBlock
}

/** Extract user-authored append text from a combined or plain system_prompt_append. */
export function extractUserAppendPortion(existing: string | null | undefined): string | null {
  if (!existing || !existing.trim()) return null
  if (existing.includes("--- User ---")) {
    const user = existing.split("--- User ---\n").slice(1).join("--- User ---\n").trim()
    return user || null
  }
  if (existing.includes("--- Mission Pack ---")) {
    // Pack-only block with no user section
    return null
  }
  return existing.trim()
}

function snapshotFromThread(thread: any): ThreadPackSnapshot {
  return {
    tool_whitelist: thread.tool_whitelist ?? null,
    active_skill_ids: Array.isArray(thread.active_skill_ids) ? [...thread.active_skill_ids] : [],
    active_knowledge_ids: Array.isArray(thread.active_knowledge_ids)
      ? [...thread.active_knowledge_ids]
      : [],
    skill_selection_mode: thread.skill_selection_mode,
    knowledge_selection_mode: thread.knowledge_selection_mode,
    mcp_selection_mode: thread.mcp_selection_mode,
    active_mcp_server_ids: Array.isArray(thread.active_mcp_server_ids)
      ? [...thread.active_mcp_server_ids]
      : [],
    system_prompt_append:
      typeof thread.config_override?.system_prompt_append === "string"
        ? thread.config_override.system_prompt_append
        : null,
  }
}

function restoreSnapshot(threadManager: ThreadManager, threadId: string, snap: ThreadPackSnapshot): void {
  threadManager.applyPackPatch(threadId, {
    mission_pack_id: null,
    mission_pack_snapshot: null,
    tool_whitelist: snap.tool_whitelist,
    active_skill_ids: snap.active_skill_ids,
    active_knowledge_ids: Array.isArray(snap.active_knowledge_ids) ? [...snap.active_knowledge_ids] : [],
    skill_selection_mode: snap.skill_selection_mode as SelectionMode | undefined,
    knowledge_selection_mode: snap.knowledge_selection_mode as SelectionMode | undefined,
    mcp_selection_mode: snap.mcp_selection_mode as SelectionMode | undefined,
    active_mcp_server_ids: snap.active_mcp_server_ids,
    system_prompt_append: snap.system_prompt_append,
    // Clear sticky board_mode on uninstall/restore (keep mission_board data)
    board_mode: false,
    mission_pack_trust_snapshot: null,
  })
}

/** Configured MCP server ids (intersect pack list with these — §6.4). */
function configuredMcpServerIds(config: CompanionConfig): Set<string> {
  const servers = (config as any).mcp?.servers
  if (!servers || typeof servers !== "object") return new Set()
  return new Set(Object.keys(servers))
}

/**
 * Build the post-apply state in memory without mutating the thread until one applyPackPatch.
 * - Switching packs: base state = existing mission_pack_snapshot (pre-A), not current post-A thread
 * - Re-apply same pack: freeze original snapshot; recompute whitelist/append from base
 * - First apply: snapshot = current thread
 *
 * @param opts.allowTrust - When true (UI pack.apply / save+apply only), origin=user trust may
 *   write global config. Default **false** so spawn_worker / non-gesture paths cannot elevate Trust B.
 */
export function applyPack(
  packId: string,
  threadId: string,
  threadManager: ThreadManager,
  skillEngine: SkillEngine,
  opts?: { workspace_path?: string; allowTrust?: boolean },
): { ok: true; thread: any } | { ok: false; error: string; code?: string } {
  let config = getConfig()
  const { dir, result } = readInstalledManifest(packId)
  if (!result.ok) return { ok: false, error: result.error }

  const thread = threadManager.get(threadId)
  if (!thread) return { ok: false, error: `thread not found: ${threadId}` }

  const allowTrust = opts?.allowTrust === true
  const switchingAway =
    !!thread.mission_pack_id && thread.mission_pack_id !== packId

  // S46 P0-1: leaving pack A for B — restore A's global Trust BEFORE writing B.
  // Cookie stays until final applyPackPatch (B success writes B's snap or null).
  // Re-apply same pack keeps prior cookie (handled below).
  if (switchingAway && isPackTrustSnapshot(thread.mission_pack_trust_snapshot)) {
    restoreTrustFromThreadCookie(
      thread.mission_pack_trust_snapshot,
      `pack.switch_away:${thread.mission_pack_id}`,
    )
    releaseTrustJournalIfMatch(threadId, thread.mission_pack_id)
    // Re-read config after restore so B's module/enterprise gates see true globals
    config = getConfig()
  }

  // Product B: apply Trust FIRST so module_disabled / enterprise_profile gates pass
  // Only when allowTrust (UI gesture path) + origin=user + trust block.
  let trustSnap: PackTrustSnapshot | null = null
  let trustJustWritten = false
  const packTrust = result.manifest.trust
  const originUser = resolvePackOrigin(result.manifest) === "user"
  if (packTrust && originUser && allowTrust) {
    // Single-holder: another thread already owns Trust B → refuse (clear UI error).
    const others = findOtherTrustHolders(threadManager, threadId)
    if (others.length > 0) {
      const o = others[0]
      return {
        ok: false,
        error:
          `Trust 已被其他对话占用（thread=${o.id}` +
          (o.pack_id ? `, pack=${o.pack_id}` : "") +
          `）。请先在该对话「退出场景」后再对本对话应用 Trust 场景。` +
          ` Trust is held by another thread; unapply there first.`,
        code: "trust_holder_conflict",
      }
    }

    // Keep original pre-trust snapshot across **same-pack** re-apply so unapply restores correctly.
    // On switch A→B: never reuse A's cookie — capture after switch_away restore (fresh baseline).
    const prior = thread.mission_pack_trust_snapshot as PackTrustSnapshot | null | undefined
    const samePackReapply = thread.mission_pack_id === packId
    const reusingPrior = samePackReapply && isPackTrustSnapshot(prior)
    trustSnap = reusingPrior ? prior! : captureTrustSnapshot()

    // Crash window: journal "applying" BEFORE durable saveConfig so boot can restore.
    markTrustApplying(threadId, packId, trustSnap)

    const trustToApply: UserPackTrustPolicy = {
      ...packTrust,
      enable_modules: [
        ...new Set([
          ...(packTrust.enable_modules || []),
          ...(result.manifest.requires_modules || []),
        ]),
      ],
      set_enterprise_profile:
        packTrust.set_enterprise_profile ||
        packTrust.skip_l2 ||
        (result.manifest.requires_modules || []).some((m) => m === "shell" || m === "netsec") ||
        (packTrust.enable_modules || []).some((m) => m === "shell" || m === "netsec"),
    }
    const tr = applyUserPackTrust(trustToApply, `pack.apply:${packId}`)
    if (!tr.ok) {
      // Always roll back to pre-attempt snap (new or reused) — applyUserPackTrust may
      // have partially enabled modules before returning ok:false.
      if (trustSnap) {
        restoreTrustFromThreadCookie(trustSnap, `pack.apply_trust_fail:${packId}`)
      }
      clearTrustJournal()
      return { ok: false, error: tr.error, code: "trust_apply_failed" }
    }
    trustJustWritten = true
    config = getConfig()
  } else if (packTrust && originUser && !allowTrust) {
    // Spawn / non-gesture: composition only — do not write global Trust
    appendCapabilityAudit({
      type: "pack.trust_skipped",
      by: `pack.apply:${packId}`,
      at: new Date().toISOString(),
      reason: "allowTrust_false",
      thread_id: threadId,
    })
  }

  /** Roll back Trust written in this call + clear applying journal. */
  const rollbackTrust = (reason: string) => {
    if (trustSnap && trustJustWritten) {
      restoreTrustFromThreadCookie(trustSnap, reason)
      clearTrustJournal()
    }
  }

  const blocked = computeApplyBlocked(result.manifest, config)
  if (blocked) {
    if (trustJustWritten) {
      rollbackTrust(`pack.apply_blocked_rollback:${packId}`)
    }
    return {
      ok: false,
      error: blocked,
      code: blocked.startsWith("module_disabled")
        ? "module_disabled"
        : blocked === "enterprise_profile_required"
          ? "enterprise_profile_required"
          : "apply_blocked",
    }
  }

  // --- Derive base (pre-pack) state without mutating yet ---
  let baseSnap: ThreadPackSnapshot
  let freezeSnap: ThreadPackSnapshot

  if (thread.mission_pack_id === packId && thread.mission_pack_snapshot) {
    // Re-apply same pack: freeze original pre-pack snapshot
    freezeSnap = thread.mission_pack_snapshot as ThreadPackSnapshot
    baseSnap = freezeSnap
  } else if (thread.mission_pack_id && thread.mission_pack_id !== packId && thread.mission_pack_snapshot) {
    // Switch A→B: base is pre-A snapshot (restore target)
    freezeSnap = thread.mission_pack_snapshot as ThreadPackSnapshot
    baseSnap = freezeSnap
  } else {
    // First apply (or dirty without snapshot)
    baseSnap = snapshotFromThread(thread)
    freezeSnap = baseSnap
  }

  // Install assets (disk only — safe if apply fails later; refresh may show skills early)
  let skillIds: string[]
  let knowledgeIds: string[]
  try {
    const installed = installAssetsFromValidated(
      dir,
      result.manifest,
      result.skillAbsPaths,
      result.knowledgeAbsPaths,
    )
    skillIds = installed.skillIds
    knowledgeIds = installed.knowledgeIds
    skillEngine.refresh()
  } catch (e: any) {
    // S46 P0-2: Trust already written — must restore or cruise sticks with no cookie
    if (trustJustWritten) {
      rollbackTrust(`pack.apply_assets_fail:${packId}`)
    }
    return { ok: false, error: e?.message || String(e) }
  }

  const whitelist = computeWhitelist(
    result.manifest.tools.mode,
    result.manifest.tools.allow,
    result.manifest.tools.deny,
    baseSnap.tool_whitelist,
  )

  // User portion: from base snapshot's append (pre-pack), not live post-pack thread
  const userPortion = extractUserAppendPortion(baseSnap.system_prompt_append)
  // Also preserve any user portion if base still has pure user text
  const systemPromptAppend = mergeSystemPromptAppend(userPortion, result.manifest.system_prompt_append)

  const td = result.manifest.thread_defaults || {}
  const configured = configuredMcpServerIds(config)
  const mcpIds = (result.manifest.mcp_servers || []).filter((id) => configured.has(id))

  // skill_refs: global skill names already on disk (user scenes). Filter missing.
  // When skill_refs is present (even []), prefer refs ∪ pack-local over pre-pack snapshot.
  let activeSkillIds: string[]
  if (result.manifest.skill_refs !== undefined) {
    const known = new Set(skillEngine.list().map((s) => s.name))
    const refs = result.manifest.skill_refs.filter((id) => known.has(id))
    activeSkillIds = [...new Set([...skillIds, ...refs])]
  } else {
    activeSkillIds = skillIds.length > 0 ? skillIds : baseSnap.active_skill_ids
  }

  // Wave A / D8: pack knowledge (installed ns + knowledge_refs) REPLACE when non-empty;
  // empty → preserve baseSnap (cannot explicit-clear via empty knowledge_refs; intentional).
  const knownK = new Set(skillEngine.listKnowledge().map((k) => k.name))
  const kRefs = (result.manifest.knowledge_refs || []).filter((id) => knownK.has(id))
  const packKnowledge = [...new Set([...knowledgeIds, ...kRefs])]
  const activeKnowledgeIds =
    packKnowledge.length > 0
      ? packKnowledge
      : Array.isArray(baseSnap.active_knowledge_ids)
        ? [...baseSnap.active_knowledge_ids]
        : []

  try {
    // Single mutation — S8: failure here leaves thread as before this call
    // (note: switch case does NOT restore A first, so A remains until this succeeds)
    const updated = threadManager.applyPackPatch(threadId, {
      mission_pack_id: packId,
      mission_pack_snapshot: freezeSnap,
      tool_whitelist: whitelist,
      active_skill_ids: activeSkillIds,
      active_knowledge_ids: activeKnowledgeIds,
      skill_selection_mode: td.skill_selection_mode || "manual",
      knowledge_selection_mode: td.knowledge_selection_mode || "manual",
      mcp_selection_mode: td.mcp_selection_mode || "manual",
      active_mcp_server_ids: mcpIds,
      system_prompt_append: systemPromptAppend,
      workspace_root: opts?.workspace_path ?? thread.workspace_root ?? null,
      // ADR-016: explicit true/false so non-board packs clear sticky board_mode
      board_mode: result.manifest.board_mode === true,
      // Only keep cookie when this apply wrote (or re-applied) Trust
      mission_pack_trust_snapshot: trustSnap
        ? (JSON.parse(JSON.stringify(trustSnap)) as Record<string, unknown>)
        : null,
    })
    // Promote journal applying → held; non-trust apply releases this thread's journal
    if (trustSnap && allowTrust) {
      markTrustHeld(threadId, packId, trustSnap)
    } else if (!trustSnap) {
      releaseTrustJournalIfMatch(threadId)
    }
    appendCapabilityAudit({
      type: "pack.apply",
      pack_id: packId,
      thread_id: threadId,
      at: new Date().toISOString(),
      trust_applied: !!trustSnap && allowTrust,
      allow_trust: allowTrust,
    })
    return { ok: true, thread: updated }
  } catch (e: any) {
    // Best-effort restore trust if thread patch failed after trust write
    if (trustJustWritten) {
      rollbackTrust(`pack.apply_rollback:${packId}`)
    }
    return { ok: false, error: e?.message || String(e) }
  }
}

/**
 * Exit scene on one thread: restore pre-pack snapshot (or clear pack fields).
 * Does NOT clear workspace_root. UI-only RPC — never LLM tool.
 */
export function unapplyPack(
  threadId: string,
  threadManager: ThreadManager,
): { ok: true; thread: any } | { ok: false; error: string; code?: string } {
  const thread = threadManager.get(threadId)
  if (!thread) return { ok: false, error: `thread not found: ${threadId}`, code: "thread_not_found" }
  if (!thread.mission_pack_id) {
    return { ok: true, thread } // idempotent
  }
  const packId = thread.mission_pack_id
  const trustSnap = thread.mission_pack_trust_snapshot as PackTrustSnapshot | null | undefined
  try {
    if (thread.mission_pack_snapshot) {
      restoreSnapshot(threadManager, threadId, thread.mission_pack_snapshot as ThreadPackSnapshot)
    } else {
      threadManager.applyPackPatch(threadId, {
        mission_pack_id: null,
        mission_pack_snapshot: null,
        tool_whitelist: null,
        active_skill_ids: (thread.active_skill_ids || []).filter(
          (s: string) => !s.startsWith(`pack--${packId}--`),
        ),
        active_knowledge_ids: (thread.active_knowledge_ids || []).filter(
          (s: string) => !s.startsWith(`pack--${packId}--`),
        ),
        system_prompt_append: null,
        board_mode: false,
        mission_pack_trust_snapshot: null,
      })
    }
    // Product B: restore global Trust if this apply had written it
    if (isPackTrustSnapshot(trustSnap)) {
      try {
        restoreTrustSnapshot(trustSnap, `pack.unapply:${packId}`)
      } catch {
        /* best-effort */
      }
      releaseTrustJournalIfMatch(threadId, packId)
    }
    const updated = threadManager.get(threadId)
    appendCapabilityAudit({
      type: "pack.unapply",
      pack_id: packId,
      thread_id: threadId,
      at: new Date().toISOString(),
      trust_restored: !!trustSnap,
    })
    return { ok: true, thread: updated }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

export function uninstallPack(
  packId: string,
  threadManager: ThreadManager,
  skillEngine: SkillEngine,
): { ok: true; restored_threads: string[] } | { ok: false; error: string } {
  const dest = path.join(packsInstalledDir(), packId)
  if (!fs.existsSync(dest)) return { ok: false, error: `pack not installed: ${packId}` }

  const restored: string[] = []
  let trustRestoredCount = 0
  for (const t of threadManager.list()) {
    if (t.mission_pack_id === packId) {
      // S46 P0-1: read trust cookie BEFORE restoreSnapshot nulls it
      const trustCookie = t.mission_pack_trust_snapshot
      if (t.mission_pack_snapshot) {
        restoreSnapshot(threadManager, t.id, t.mission_pack_snapshot as ThreadPackSnapshot)
      } else {
        threadManager.applyPackPatch(t.id, {
          mission_pack_id: null,
          mission_pack_snapshot: null,
          tool_whitelist: null,
          active_skill_ids: (t.active_skill_ids || []).filter((s: string) => !s.startsWith(`pack--${packId}--`)),
          active_knowledge_ids: (t.active_knowledge_ids || []).filter(
            (s: string) => !s.startsWith(`pack--${packId}--`),
          ),
          system_prompt_append: null,
          board_mode: false,
          mission_pack_trust_snapshot: null,
        })
      }
      if (restoreTrustFromThreadCookie(trustCookie, `pack.uninstall:${packId}`)) {
        trustRestoredCount += 1
        releaseTrustJournalIfMatch(t.id, packId)
      }
      restored.push(t.id)
    }
  }

  removeNamespacedAssets(packId)
  fs.rmSync(dest, { recursive: true, force: true })
  skillEngine.refresh()
  appendCapabilityAudit({
    type: "pack.uninstall",
    pack_id: packId,
    at: new Date().toISOString(),
    restored_threads: restored,
    trust_restored_count: trustRestoredCount,
  })
  return { ok: true, restored_threads: restored }
}

/** Resolve builtin packs shipped with companion source/dist */
export function getBuiltinPacksRoot(): string {
  // Prefer src path in monorepo; fall back relative to this file
  const candidates = [
    path.join(__dirname, "builtin"),
    path.join(__dirname, "..", "packs", "builtin"),
    path.join(process.cwd(), "src", "packs", "builtin"),
    path.join(process.cwd(), "companion", "src", "packs", "builtin"),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return path.join(__dirname, "builtin")
}

export function ensureBuiltinPacksInstalled(skillEngine: SkillEngine): string[] {
  ensurePackDirs()
  const root = getBuiltinPacksRoot()
  const installed: string[] = []
  if (!fs.existsSync(root)) return installed
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name)
    if (!fs.statSync(dir).isDirectory()) continue
    if (!fs.existsSync(path.join(dir, "pack.yaml"))) continue
    const dest = path.join(packsInstalledDir(), name)
    // Always refresh builtin on ensure (force) so content updates ship
    const r = installPackFromDirectory(dir, skillEngine, { force: true })
    if (r.ok) installed.push(r.id)
  }
  return installed
}

export { setModuleEnabled } from "../capability/modules"
