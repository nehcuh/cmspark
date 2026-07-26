import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import AdmZip from "adm-zip"
import matter from "gray-matter"
import * as yaml from "js-yaml"
import { getConfigDir, getConfig, saveConfig, type CompanionConfig } from "../config"
import { SkillEngine } from "../skills/skill-engine"
import { ThreadManager } from "../threads/thread-manager"
import { appendCapabilityAudit } from "./audit-log"
import { validatePackDir } from "./validator"
import {
  MAX_PACK_TOTAL_BYTES,
  MAX_ZIP_ENTRIES,
  type PackListItem,
  type PackManifest,
  type SelectionMode,
  type ThreadPackSnapshot,
  type ToolsMode,
} from "./types"

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
): string[] {
  const skillIds: string[] = []
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
  }
  return skillIds
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
    })
  }
  return items.sort((a, b) => a.id.localeCompare(b.id))
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

    removeNamespacedAssets(v2.manifest.id)
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
    fs.renameSync(tmp, dest)

    // Re-validate after rename so skillAbsPaths point at dest (not tmp)
    const v3 = validatePackDir(dest)
    if (!v3.ok) return { ok: false, error: v3.error }
    installAssetsFromValidated(dest, v3.manifest, v3.skillAbsPaths, v3.knowledgeAbsPaths)
    skillEngine.refresh()
    appendCapabilityAudit({
      type: "pack.install",
      pack_id: v3.manifest.id,
      at: new Date().toISOString(),
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

function mergeSystemPromptAppend(existing: string | null | undefined, packAppend: string): string {
  const packBlock = `--- Mission Pack ---\n${packAppend}`
  if (existing && existing.trim()) {
    return `${packBlock}\n\n--- User ---\n${existing}`
  }
  return packBlock
}

function snapshotFromThread(thread: any): ThreadPackSnapshot {
  return {
    tool_whitelist: thread.tool_whitelist ?? null,
    active_skill_ids: Array.isArray(thread.active_skill_ids) ? [...thread.active_skill_ids] : [],
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
    skill_selection_mode: snap.skill_selection_mode as SelectionMode | undefined,
    knowledge_selection_mode: snap.knowledge_selection_mode as SelectionMode | undefined,
    mcp_selection_mode: snap.mcp_selection_mode as SelectionMode | undefined,
    active_mcp_server_ids: snap.active_mcp_server_ids,
    system_prompt_append: snap.system_prompt_append,
  })
}

export function applyPack(
  packId: string,
  threadId: string,
  threadManager: ThreadManager,
  skillEngine: SkillEngine,
  opts?: { workspace_path?: string },
): { ok: true; thread: any } | { ok: false; error: string; code?: string } {
  const config = getConfig()
  const { dir, result } = readInstalledManifest(packId)
  if (!result.ok) return { ok: false, error: result.error }

  const blocked = computeApplyBlocked(result.manifest, config)
  if (blocked) {
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

  const thread = threadManager.get(threadId)
  if (!thread) return { ok: false, error: `thread not found: ${threadId}` }

  // If switching packs, restore previous snapshot first
  if (thread.mission_pack_id && thread.mission_pack_id !== packId && thread.mission_pack_snapshot) {
    restoreSnapshot(threadManager, threadId, thread.mission_pack_snapshot as ThreadPackSnapshot)
  }

  const fresh = threadManager.get(threadId)!
  const snap = snapshotFromThread(fresh)

  // Re-install namespaced assets from installed dir (idempotent)
  const skillIds = installAssetsFromValidated(
    dir,
    result.manifest,
    result.skillAbsPaths,
    result.knowledgeAbsPaths,
  )
  skillEngine.refresh()

  const whitelist = computeWhitelist(
    result.manifest.tools.mode,
    result.manifest.tools.allow,
    result.manifest.tools.deny,
    fresh.tool_whitelist,
  )

  const existingAppend =
    typeof fresh.config_override?.system_prompt_append === "string"
      ? fresh.config_override.system_prompt_append
      : null
  // When re-applying same pack, snapshot already captured pre-pack state; for append
  // use snapshot's system_prompt_append as the "user" part when re-apply
  const userAppendBase =
    fresh.mission_pack_id === packId && snap.system_prompt_append !== null
      ? // re-apply: avoid stacking pack blocks — use snapshot user portion if stored as full string
        null
      : existingAppend && !existingAppend.includes("--- Mission Pack ---")
        ? existingAppend
        : snap.system_prompt_append && !String(snap.system_prompt_append).includes("--- Mission Pack ---")
          ? snap.system_prompt_append
          : existingAppend?.includes("--- User ---")
            ? existingAppend.split("--- User ---\n").slice(1).join("--- User ---\n")
            : existingAppend?.includes("--- Mission Pack ---")
              ? null
              : existingAppend

  const systemPromptAppend = mergeSystemPromptAppend(userAppendBase, result.manifest.system_prompt_append)

  const td = result.manifest.thread_defaults || {}

  try {
    const updated = threadManager.applyPackPatch(threadId, {
      mission_pack_id: packId,
      mission_pack_snapshot: snap,
      tool_whitelist: whitelist,
      active_skill_ids: skillIds.length > 0 ? skillIds : fresh.active_skill_ids,
      skill_selection_mode: td.skill_selection_mode || "manual",
      knowledge_selection_mode: td.knowledge_selection_mode || "manual",
      mcp_selection_mode: td.mcp_selection_mode || "manual",
      active_mcp_server_ids: result.manifest.mcp_servers || [],
      system_prompt_append: systemPromptAppend,
      workspace_root: opts?.workspace_path ?? fresh.workspace_root ?? null,
    })
    appendCapabilityAudit({
      type: "pack.apply",
      pack_id: packId,
      thread_id: threadId,
      at: new Date().toISOString(),
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
  for (const t of threadManager.list()) {
    if (t.mission_pack_id === packId) {
      if (t.mission_pack_snapshot) {
        restoreSnapshot(threadManager, t.id, t.mission_pack_snapshot as ThreadPackSnapshot)
      } else {
        threadManager.applyPackPatch(t.id, {
          mission_pack_id: null,
          mission_pack_snapshot: null,
          tool_whitelist: null,
          active_skill_ids: (t.active_skill_ids || []).filter((s: string) => !s.startsWith(`pack--${packId}--`)),
          system_prompt_append: null,
        })
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

export function setModuleEnabled(
  moduleId: string,
  enabled: boolean,
  by: string = "user",
): { ok: true; modules: any } | { ok: false; error: string } {
  const config = getConfig() as any
  if (!config.modules || typeof config.modules !== "object") {
    config.modules = {}
  }
  const mod = config.modules[moduleId]
  if (!mod || mod.available !== true) {
    return { ok: false, error: `module not available: ${moduleId}` }
  }
  // Shell/NetSec must not exist as enabled by default; appsec allowed
  mod.enabled = enabled
  mod.enabled_at = enabled ? new Date().toISOString() : null
  mod.enabled_by = enabled ? by : null
  config.modules[moduleId] = mod
  saveConfig(config)
  appendCapabilityAudit({
    type: enabled ? "module.enable" : "module.disable",
    module: moduleId,
    by,
    at: new Date().toISOString(),
  })
  return { ok: true, modules: config.modules }
}
