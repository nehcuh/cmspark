/**
 * skill_install — LLM-facing install of external skills into user skills dir.
 * Dest is ALWAYS getConfigDir()/skills (never repo skills/ or ~/.claude/skills).
 *
 * Trust (S41 multi-adv + dual re-review):
 * - L2 forceConfirm at server (security_token) — durable skill-library write
 * - path/zip sources: Downloads segment / tmp / data dir allowlist
 * - content: size-capped (not free arbitrary FS, but still needs L2)
 * - zip: compressed + uncompressed extract budgets
 * - dest_path/name honesty from engine import return values
 */

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import matter from "gray-matter"
import AdmZip from "adm-zip"
import { getConfigDir } from "../config"
import type { SkillEngine } from "./skill-engine"
import { appendCapabilityAudit } from "../packs/audit-log"

export type SkillInstallParams = {
  /** Local directory containing SKILL.md */
  path?: string
  /** Local .zip file path (will be base64-imported) */
  zip_path?: string
  /** Raw markdown content of a single skill .md */
  content?: string
}

export type SkillInstallResult = {
  ok: boolean
  name?: string
  dest_path?: string
  skills_root?: string
  error?: string
  hint_zh?: string
}

export function getUserSkillsRoot(): string {
  return path.join(getConfigDir(), "skills")
}

/** Expand ~ and Windows %VAR% (advertised in tool errors; S41 Compat C4). */
export function expandUserPath(p: string): string {
  let trimmed = p.trim()
  // %USERPROFILE% / %TEMP% etc.
  trimmed = trimmed.replace(/%([^%]+)%/g, (_m, name: string) => {
    const v =
      process.env[name] ??
      process.env[name.toUpperCase()] ??
      process.env[name.toLowerCase()]
    return v != null && v !== "" ? v : `%${name}%`
  })
  if (trimmed === "~") return os.homedir()
  if (trimmed.startsWith("~/") || trimmed.startsWith("~" + path.sep)) {
    return path.join(os.homedir(), trimmed.slice(2))
  }
  return trimmed
}

/**
 * Trust: skill_install may only read from user Downloads, cmspark data dir,
 * or OS temp — never arbitrary FS
 * (would chain with use_skill into ungated .md exfil; dual-review M1 B2).
 */
export function isSkillInstallSourceAllowed(resolvedPath: string): boolean {
  if (!resolvedPath) return false
  const norm = path.resolve(resolvedPath)
  const lower = norm.replace(/\\/g, "/").toLowerCase()
  const segments = lower.split("/").filter(Boolean)
  if (segments.includes("downloads") || segments.includes("下载")) return true
  // CMspark data dir (skills/cache/…)
  try {
    const data = fs.realpathSync(getConfigDir())
    const dataNorm = path.resolve(data)
    if (norm === dataNorm || norm.startsWith(dataNorm + path.sep)) return true
  } catch {
    /* ignore */
  }
  // Temp dirs (browser extract / OS temp)
  try {
    const tmp = fs.realpathSync(os.tmpdir())
    if (norm === tmp || norm.startsWith(tmp + path.sep)) return true
  } catch {
    /* ignore */
  }
  return false
}

const MAX_ZIP_BYTES = 25 * 1024 * 1024
const MAX_DIR_BYTES = 25 * 1024 * 1024
const MAX_DIR_FILES = 500
/** Content branch size cap (S41 multi-adv — free content is not unbounded). */
export const MAX_CONTENT_BYTES = 256 * 1024

function safeSkillName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
}

/**
 * S42 P1: best-effort preview of install target for L2 dialog + token binding.
 * Detects whether dest already exists (overwrite) without writing.
 */
export function skillInstallOverwritePreview(params: SkillInstallParams): {
  mode: "content" | "zip" | "path" | "empty"
  name: string | null
  dest_path: string | null
  overwrite: boolean
} {
  const root = getUserSkillsRoot()
  const checkDest = (name: string | null | undefined): {
    name: string | null
    dest_path: string | null
    overwrite: boolean
  } => {
    if (!name || !String(name).trim()) {
      return { name: null, dest_path: null, overwrite: false }
    }
    const safe = safeSkillName(String(name))
    if (!safe || safe === "-") {
      return { name: String(name), dest_path: null, overwrite: false }
    }
    const filePath = path.join(root, `${safe}.md`)
    const dirPath = path.join(root, safe)
    const overwrite = fs.existsSync(filePath) || fs.existsSync(dirPath)
    // Prefer file path for single-md installs, dir for folder-shaped names
    const dest_path = fs.existsSync(dirPath) ? dirPath : filePath
    return { name: String(name), dest_path, overwrite }
  }

  try {
    if (params.content && typeof params.content === "string" && params.content.trim()) {
      try {
        const parsed = matter(params.content)
        const name = parsed.data?.name ? String(parsed.data.name) : null
        return { mode: "content", ...checkDest(name) }
      } catch {
        return { mode: "content", name: null, dest_path: null, overwrite: false }
      }
    }

    if (params.zip_path && typeof params.zip_path === "string") {
      try {
        const expanded = expandUserPath(params.zip_path)
        const resolved = fs.realpathSync(path.resolve(expanded))
        if (!fs.statSync(resolved).isFile()) {
          return { mode: "zip", name: null, dest_path: null, overwrite: false }
        }
        const zip = new AdmZip(resolved)
        const entries = zip.getEntries()
        const skillMd = entries.find(
          (e) => e.entryName.endsWith("SKILL.md") || e.entryName.endsWith("SKILL.md/"),
        )
        if (!skillMd) {
          return { mode: "zip", name: null, dest_path: null, overwrite: false }
        }
        const raw = zip.readAsText(skillMd)
        const parsed = matter(raw)
        const skillDirName = skillMd.entryName.replace(/\/?SKILL\.md\/?$/, "")
        const folderName = path.basename(skillDirName) || "skill"
        const name = parsed.data?.name ? String(parsed.data.name) : folderName
        return { mode: "zip", ...checkDest(name) }
      } catch {
        return { mode: "zip", name: null, dest_path: null, overwrite: false }
      }
    }

    if (params.path && typeof params.path === "string") {
      try {
        const expanded = expandUserPath(params.path)
        const resolved = fs.realpathSync(path.resolve(expanded))
        const st = fs.statSync(resolved)
        if (st.isFile() && /\.md$/i.test(resolved)) {
          const content = fs.readFileSync(resolved, "utf-8")
          const parsed = matter(content)
          const name = parsed.data?.name ? String(parsed.data.name) : path.basename(resolved, ".md")
          return { mode: "path", ...checkDest(name) }
        }
        if (st.isDirectory()) {
          const skillMd = path.join(resolved, "SKILL.md")
          if (fs.existsSync(skillMd)) {
            const content = fs.readFileSync(skillMd, "utf-8")
            const parsed = matter(content)
            const name = parsed.data?.name
              ? String(parsed.data.name)
              : path.basename(resolved)
            return { mode: "path", ...checkDest(name) }
          }
        }
      } catch {
        /* fall through */
      }
      return { mode: "path", name: null, dest_path: null, overwrite: false }
    }
  } catch {
    /* best-effort */
  }
  return { mode: "empty", name: null, dest_path: null, overwrite: false }
}

function assertDirBudget(dir: string, acc = { bytes: 0, files: 0 }): void {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      assertDirBudget(full, acc)
    } else if (ent.isFile()) {
      acc.files++
      if (acc.files > MAX_DIR_FILES) {
        throw new Error(`skill directory has too many files (max ${MAX_DIR_FILES})`)
      }
      const st = fs.statSync(full)
      acc.bytes += st.size
      if (acc.bytes > MAX_DIR_BYTES) {
        throw new Error(`skill directory too large (max ${MAX_DIR_BYTES} bytes)`)
      }
    }
  }
}

function extractNameFromMarkdown(md: string): string | null {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return null
  const nameLine = m[1].match(/^name:\s*(.+)$/m)
  return nameLine ? nameLine[1].trim().replace(/^["']|["']$/g, "") : null
}

function auditInstall(ok: boolean, extra: Record<string, unknown>): void {
  try {
    appendCapabilityAudit({
      type: ok ? "skill_install.ok" : "skill_install.fail",
      at: new Date().toISOString(),
      ...extra,
    })
  } catch {
    /* audit must never break install */
  }
}

/**
 * Install skill into user skills root via SkillEngine import helpers.
 */
export function skillInstall(
  engine: SkillEngine,
  params: SkillInstallParams,
): SkillInstallResult {
  const root = getUserSkillsRoot()
  const hint =
    "技能已写入用户库。路径固定为 ~/.cmspark-agent/skills（Windows: %USERPROFILE%\\.cmspark-agent\\skills）。请勿写入仓库 skills/ 或 ~/.claude/skills。"

  try {
    if (params.content && typeof params.content === "string" && params.content.trim()) {
      const contentBytes = Buffer.byteLength(params.content, "utf-8")
      if (contentBytes > MAX_CONTENT_BYTES) {
        const err = `content too large (max ${MAX_CONTENT_BYTES} bytes)`
        auditInstall(false, { mode: "content", error: err, bytes: contentBytes })
        return { ok: false, error: err, skills_root: root }
      }
      const imported = engine.importSkill(params.content)
      engine.refresh()
      auditInstall(true, {
        mode: "content",
        name: imported.name,
        dest_path: imported.destPath,
        bytes: contentBytes,
      })
      return {
        ok: true,
        name: imported.name,
        dest_path: imported.destPath,
        skills_root: root,
        hint_zh: hint,
      }
    }

    if (params.zip_path && typeof params.zip_path === "string") {
      const expanded = expandUserPath(params.zip_path)
      let resolved: string
      try {
        resolved = fs.realpathSync(path.resolve(expanded))
      } catch {
        return { ok: false, error: `zip not found: ${params.zip_path}`, skills_root: root }
      }
      if (!isSkillInstallSourceAllowed(resolved)) {
        return {
          ok: false,
          error:
            "zip_path must be under Downloads, OS temp, or ~/.cmspark-agent (arbitrary paths blocked for Trust)",
          skills_root: root,
        }
      }
      if (!fs.statSync(resolved).isFile()) {
        return { ok: false, error: `zip_path is not a file: ${params.zip_path}`, skills_root: root }
      }
      if (!/\.zip$/i.test(resolved)) {
        return { ok: false, error: "zip_path must end with .zip", skills_root: root }
      }
      const buf = fs.readFileSync(resolved)
      if (buf.length > MAX_ZIP_BYTES) {
        return { ok: false, error: `zip too large (max ${MAX_ZIP_BYTES} bytes)`, skills_root: root }
      }
      const imported = engine.importSkillFolder(buf.toString("base64"))
      engine.refresh()
      auditInstall(true, {
        mode: "zip",
        name: imported.name,
        dest_path: imported.destPath,
        zip_bytes: buf.length,
      })
      return {
        ok: true,
        name: imported.name,
        dest_path: imported.destPath,
        skills_root: root,
        hint_zh: hint,
      }
    }

    if (params.path && typeof params.path === "string") {
      const expanded = expandUserPath(params.path)
      let resolved: string
      try {
        resolved = fs.realpathSync(path.resolve(expanded))
      } catch {
        return { ok: false, error: `path not found: ${params.path}`, skills_root: root }
      }
      if (!isSkillInstallSourceAllowed(resolved)) {
        return {
          ok: false,
          error:
            "path must be under Downloads, OS temp, or ~/.cmspark-agent (arbitrary host paths blocked; use panel import for trusted dirs)",
          skills_root: root,
        }
      }
      const st = fs.statSync(resolved)
      if (st.isFile() && /\.md$/i.test(resolved)) {
        if (st.size > MAX_DIR_BYTES) {
          return { ok: false, error: "skill file too large", skills_root: root }
        }
        if (st.size > MAX_CONTENT_BYTES) {
          return {
            ok: false,
            error: `skill file too large for content import (max ${MAX_CONTENT_BYTES} bytes)`,
            skills_root: root,
          }
        }
        const content = fs.readFileSync(resolved, "utf-8")
        const imported = engine.importSkill(content)
        engine.refresh()
        auditInstall(true, {
          mode: "path_md",
          name: imported.name,
          dest_path: imported.destPath,
        })
        return {
          ok: true,
          name: imported.name,
          dest_path: imported.destPath,
          skills_root: root,
          hint_zh: hint,
        }
      }
      if (st.isDirectory()) {
        try {
          assertDirBudget(resolved)
        } catch (e: any) {
          return { ok: false, error: e?.message || String(e), skills_root: root }
        }
        const imported = engine.importSkillFromPath(resolved)
        engine.refresh()
        auditInstall(true, {
          mode: "path_dir",
          name: imported.name,
          dest_path: imported.destPath,
        })
        return {
          ok: true,
          name: imported.name,
          dest_path: imported.destPath,
          skills_root: root,
          hint_zh: hint,
        }
      }
      return {
        ok: false,
        error: "path must be a skill directory (SKILL.md) or a .md file",
        skills_root: root,
      }
    }

    return {
      ok: false,
      error: "skill_install requires path, zip_path, or content",
      skills_root: root,
      hint_zh:
        "先 downloads_find / browser_download 拿到 Downloads 下路径，再 skill_install。目标库固定 ~/.cmspark-agent/skills。需用户 L2 确认。",
    }
  } catch (e: any) {
    const err = e?.message || String(e)
    auditInstall(false, { error: err })
    return {
      ok: false,
      error: err,
      skills_root: root,
    }
  }
}

export const SKILL_INSTALL_TOOL = {
  type: "function" as const,
  function: {
    name: "skill_install",
    description:
      "Install an external skill into the CMspark user skills library (~/.cmspark-agent/skills on Unix, %USERPROFILE%\\.cmspark-agent\\skills on Windows). Prefer this over shell copy. After downloads_find/browser_download of a skill zip or folder, pass path or zip_path. Requires user L2 confirmation. Never write skills into the git repo skills/ directory or ~/.claude/skills. content is size-capped (256KiB).",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Local directory with SKILL.md, or a single .md skill file (under Downloads/tmp/data)",
        },
        zip_path: {
          type: "string",
          description: "Local .zip containing SKILL.md (folder skill); compressed+extract size capped",
        },
        content: {
          type: "string",
          description: "Raw markdown with YAML frontmatter (single skill file, max 256KiB); still requires L2",
        },
      },
      required: [] as string[],
    },
  },
}

// Capability declaration (ADR-020) for skill_install
export const SKILL_INSTALL_CAPABILITY = {
  Surface: "L0 local install write to user skills; path sources limited to Downloads/tmp/data dir",
  Composition: "Skills install primitive — not a new Agent runtime",
  Autonomy: "none",
  Trust:
    "L2 forceConfirm (security_token); path allowlist for path/zip; content size-capped; zip compressed+uncompressed budgets; audit lines; not free like record_experience for agent install",
  Channel: "community",
} as const
