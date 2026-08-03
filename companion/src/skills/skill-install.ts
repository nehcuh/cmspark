/**
 * skill_install — LLM-facing install of external skills into user skills dir.
 * Dest is ALWAYS getConfigDir()/skills (never repo skills/ or ~/.claude/skills).
 */

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { getConfigDir } from "../config"
import type { SkillEngine } from "./skill-engine"

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

function expandUserPath(p: string): string {
  const trimmed = p.trim()
  if (trimmed === "~") return os.homedir()
  if (trimmed.startsWith("~/") || trimmed.startsWith("~" + path.sep)) {
    return path.join(os.homedir(), trimmed.slice(2))
  }
  return trimmed
}

/**
 * Trust: skill_install may only read from user Downloads, cmspark data dir,
 * or an explicit allowlist of common package roots — never arbitrary FS
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
      const name = extractNameFromMarkdown(params.content)
      engine.importSkill(params.content)
      engine.refresh()
      const safe = (name || "skill").replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
      const dest = path.join(root, `${safe}.md`)
      return {
        ok: true,
        name: name || safe,
        dest_path: fs.existsSync(dest) ? dest : root,
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
            "zip_path must be under Downloads, %TEMP%, or ~/.cmspark-agent (arbitrary paths blocked for Trust)",
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
      engine.importSkillFolder(buf.toString("base64"))
      engine.refresh()
      return {
        ok: true,
        dest_path: root,
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
            "path must be under Downloads, %TEMP%, or ~/.cmspark-agent (arbitrary host paths blocked; use panel import for trusted dirs)",
          skills_root: root,
        }
      }
      const st = fs.statSync(resolved)
      if (st.isFile() && /\.md$/i.test(resolved)) {
        if (st.size > MAX_DIR_BYTES) {
          return { ok: false, error: "skill file too large", skills_root: root }
        }
        const content = fs.readFileSync(resolved, "utf-8")
        const name = extractNameFromMarkdown(content)
        engine.importSkill(content)
        engine.refresh()
        const safe = (name || path.basename(resolved, ".md"))
          .replace(/[^a-zA-Z0-9-]/g, "-")
          .toLowerCase()
        const dest = path.join(root, `${safe}.md`)
        return {
          ok: true,
          name: name || safe,
          dest_path: dest,
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
        engine.importSkillFromPath(resolved)
        engine.refresh()
        let name: string | undefined
        try {
          const md = fs.readFileSync(path.join(resolved, "SKILL.md"), "utf-8")
          name = extractNameFromMarkdown(md) || undefined
        } catch {
          /* ignore */
        }
        const safe = (name || path.basename(resolved)).replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
        return {
          ok: true,
          name,
          dest_path: path.join(root, safe),
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
        "先 downloads_find / browser_download 拿到 Downloads 下路径，再 skill_install。目标库固定 ~/.cmspark-agent/skills。",
    }
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message || String(e),
      skills_root: root,
    }
  }
}

export const SKILL_INSTALL_TOOL = {
  type: "function" as const,
  function: {
    name: "skill_install",
    description:
      "Install an external skill into the CMspark user skills library (~/.cmspark-agent/skills on Unix, %USERPROFILE%\\.cmspark-agent\\skills on Windows). Prefer this over shell copy. After downloads_find/browser_download of a skill zip or folder, pass path or zip_path. Never write skills into the git repo skills/ directory or ~/.claude/skills.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Local directory with SKILL.md, or a single .md skill file",
        },
        zip_path: {
          type: "string",
          description: "Local .zip containing SKILL.md (folder skill)",
        },
        content: {
          type: "string",
          description: "Raw markdown with YAML frontmatter (single skill file)",
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
  Trust: "source path allowlist; no arbitrary FS read; zip/dir size caps",
  Channel: "community",
} as const
