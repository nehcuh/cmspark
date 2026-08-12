/**
 * skill_install — LLM-facing install of external skills into user skills dir.
 * Dest is ALWAYS getConfigDir()/skills (never repo skills/ or ~/.claude/skills).
 *
 * Trust (S41 + product UX 2026-08-05):
 * - L2 forceConfirm at server (security_token) — durable skill-library write
 * - path/zip sources (two tiers, both still go through L2 unless full-autonomy cruise):
 *   - **default zone**: Downloads / 下载 / OS temp / ~/.cmspark-agent
 *   - **user home zone**: any path under the user's home directory (e.g. ~/Projects)
 *     — product: "need permission → confirm dialog", not hard-deny after user asked to install
 *   - **denied**: outside home and not in default zone (no silent ambient FS scrape)
 * - Full autonomy cruise (three-flag) waives L2 at server; source tier still applies
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
import { SkillEngine } from "./skill-engine"
import { appendCapabilityAudit } from "../packs/audit-log"

export type SkillInstallParams = {
  /** Local directory containing SKILL.md */
  path?: string
  /** Local .zip file path (prefer importSkillFolderFromPath; base64 only as fallback) */
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

/** Source trust tier for path/zip (consent = L2; denied = hard fail, no dialog useful). */
export type SkillInstallSourceTier = "default" | "user_home" | "denied"

function pathEqualsOrUnder(candidate: string, root: string): boolean {
  let c = path.resolve(candidate)
  let r = path.resolve(root)
  if (process.platform === "win32") {
    c = c.toLowerCase()
    r = r.toLowerCase()
  }
  if (c === r) return true
  const prefix = r.endsWith(path.sep) ? r : r + path.sep
  return c.startsWith(prefix)
}

function tryRealpath(p: string): string | null {
  try {
    return fs.realpathSync(p)
  } catch {
    try {
      return path.resolve(p)
    } catch {
      return null
    }
  }
}

/**
 * Classify skill_install path/zip source.
 * - default: OS temp / cmspark data dir / **home-bounded** Downloads·下载
 * - user_home: under os.homedir() (e.g. ~/Projects) — allowed; L2 is the user authorization
 * - denied: elsewhere (prevents agent ambient read of system paths into skill library)
 *
 * S46 compat: do **not** treat any path segment named "Downloads" as trusted
 * (e.g. /var/evil/Downloads must stay denied). Only ~/Downloads · ~/下载 (realpath).
 */
export function classifySkillInstallSource(resolvedPath: string): SkillInstallSourceTier {
  if (!resolvedPath) return "denied"
  const norm = path.resolve(resolvedPath)

  try {
    const data = fs.realpathSync(getConfigDir())
    if (pathEqualsOrUnder(norm, data)) return "default"
  } catch {
    /* ignore */
  }
  try {
    const tmp = fs.realpathSync(os.tmpdir())
    if (pathEqualsOrUnder(norm, tmp)) return "default"
  } catch {
    /* ignore */
  }

  // User home zone (realpath both sides so symlink escape out of home is denied)
  try {
    const home = tryRealpath(os.homedir())
    if (!home) return "denied"
    const cand = tryRealpath(norm) || norm
    if (!pathEqualsOrUnder(cand, home)) return "denied"

    // Browser download folders only under home (not bare path-segment heuristic)
    for (const leaf of ["Downloads", "下载"]) {
      const dl = tryRealpath(path.join(home, leaf))
      if (dl && pathEqualsOrUnder(cand, dl)) return "default"
    }
    return "user_home"
  } catch {
    /* ignore */
  }

  // Three-flag cruise: path risk accepted — allow absolute paths outside home
  // except volume roots / multi-user roots / OS system trees.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isCruisePathRiskAccepted, isCruiseHardDangerPath } =
      require("../security/cruise-path") as typeof import("../security/cruise-path")
    if (isCruisePathRiskAccepted() && !isCruiseHardDangerPath(norm)) {
      return "user_home"
    }
  } catch {
    /* ignore */
  }
  return "denied"
}

/** True when path/zip may be used as install source (L2 still required at server unless cruise). */
export function isSkillInstallSourceAllowed(resolvedPath: string): boolean {
  return classifySkillInstallSource(resolvedPath) !== "denied"
}

/** User-facing error when source is outside allowed zones. */
export function skillInstallSourceDeniedError(kind: "path" | "zip_path"): {
  error: string
  hint_zh: string
} {
  const field = kind === "zip_path" ? "zip_path" : "path"
  return {
    error:
      `${field} is outside the allowed install source zone ` +
      `(user home, Downloads, OS temp, or ~/.cmspark-agent). ` +
      `System paths cannot be used as skill install sources.`,
    hint_zh:
      "安装源须在用户主目录、下载目录、系统临时目录或 ~/.cmspark-agent 内。" +
      "例如 ~/Projects/xxx 可以：确认弹窗授权即可。" +
      "系统路径不可作为技能安装源；请改用 Side Panel 导入或先拷到主目录/下载目录。",
  }
}

/**
 * Compressed zip cap (aligned with large skill packs e.g. dashiai-ppt ~46MB).
 * Uncompressed / file-count budgets live on SkillEngine.MAX_ZIP_EXTRACT_*.
 */
export const MAX_ZIP_BYTES = 100 * 1024 * 1024
const MAX_DIR_BYTES = 120 * 1024 * 1024
const MAX_DIR_FILES = 2000
/** Content branch size cap (S41 multi-adv — free content is not unbounded). */
export const MAX_CONTENT_BYTES = 256 * 1024

function safeSkillName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
}

export type SkillInstallOverwritePreview = {
  mode: "content" | "zip" | "path" | "empty"
  name: string | null
  dest_path: string | null
  overwrite: boolean
  /** Set when zip cannot be previewed/installed (e.g. multi SKILL.md). */
  error?: string
  candidates?: string[]
}

/**
 * S42 P1: best-effort preview of install target for L2 dialog + token binding.
 * Detects whether dest already exists (overwrite) without writing.
 * Must stay lock-step with SkillEngine.pickSkillMdEntryResult for zip sources.
 */
export function skillInstallOverwritePreview(
  params: SkillInstallParams,
): SkillInstallOverwritePreview {
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
        // Lock-step with install: same picker as SkillEngine.importSkillFolder*
        const picked = SkillEngine.pickSkillMdEntryResult(entries)
        if (!picked.entryName) {
          return {
            mode: "zip",
            name: null,
            dest_path: null,
            overwrite: false,
            error: picked.error || "Zip must contain a SKILL.md file",
            candidates: picked.candidates,
          }
        }
        const skillMd = entries.find((e) => e.entryName === picked.entryName)
        if (!skillMd) {
          return {
            mode: "zip",
            name: null,
            dest_path: null,
            overwrite: false,
            error: "Zip SKILL.md entry missing after pick",
          }
        }
        const raw = zip.readAsText(skillMd)
        const parsed = matter(raw)
        const skillDirName = skillMd.entryName.replace(/\\/g, "/").replace(/\/?SKILL\.md$/i, "")
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
        const denied = skillInstallSourceDeniedError("zip_path")
        auditInstall(false, {
          mode: "zip",
          error: denied.error,
          tier: "denied",
          source: resolved,
        })
        return {
          ok: false,
          error: denied.error,
          skills_root: root,
          hint_zh: denied.hint_zh,
        }
      }
      if (!fs.statSync(resolved).isFile()) {
        return { ok: false, error: `zip_path is not a file: ${params.zip_path}`, skills_root: root }
      }
      if (!/\.zip$/i.test(resolved)) {
        return { ok: false, error: "zip_path must end with .zip", skills_root: root }
      }
      const zipBytes = fs.statSync(resolved).size
      if (zipBytes > MAX_ZIP_BYTES) {
        return {
          ok: false,
          error: `zip too large (${zipBytes} bytes; max ${MAX_ZIP_BYTES} bytes compressed)`,
          skills_root: root,
          hint_zh:
            "技能 ZIP 超过压缩体积上限。可先解压后只 skill_install({ path: 含 SKILL.md 的目录 })，" +
            "或拆出 skills/<name>/ 子目录再装。",
        }
      }
      // Prefer path import (no base64 33% memory blow-up) when engine supports it.
      let imported: { name: string; destPath: string }
      try {
        const eng = engine as SkillEngine & {
          importSkillFolderFromPath?: (p: string) => { name: string; destPath: string }
        }
        if (typeof eng.importSkillFolderFromPath === "function") {
          imported = eng.importSkillFolderFromPath(resolved)
        } else {
          const buf = fs.readFileSync(resolved)
          imported = engine.importSkillFolder(buf.toString("base64"))
        }
      } catch (e: any) {
        const msg = e?.message || String(e)
        auditInstall(false, {
          mode: "zip",
          error: msg,
          zip_bytes: zipBytes,
          source: resolved,
        })
        return {
          ok: false,
          error: msg,
          skills_root: root,
          hint_zh: /too large|too many files/i.test(msg)
            ? "解压体积或文件数超限。可只安装含 SKILL.md 的子目录（path=…/skills/xxx），或缩小包内资源。"
            : undefined,
        }
      }
      engine.refresh()
      const tier = classifySkillInstallSource(resolved)
      auditInstall(true, {
        mode: "zip",
        name: imported.name,
        dest_path: imported.destPath,
        zip_bytes: zipBytes,
        tier,
        source: resolved,
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
        const denied = skillInstallSourceDeniedError("path")
        auditInstall(false, {
          mode: "path",
          error: denied.error,
          tier: "denied",
          source: resolved,
        })
        return {
          ok: false,
          error: denied.error,
          skills_root: root,
          hint_zh: denied.hint_zh,
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
        const tier = classifySkillInstallSource(resolved)
        auditInstall(true, {
          mode: "path_md",
          name: imported.name,
          dest_path: imported.destPath,
          tier,
          source: resolved,
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
        const tier = classifySkillInstallSource(resolved)
        auditInstall(true, {
          mode: "path_dir",
          name: imported.name,
          dest_path: imported.destPath,
          tier,
          source: resolved,
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
        "可从用户主目录（如 ~/Projects）、下载目录、临时目录或 ~/.cmspark-agent 安装；" +
        "目标库固定 ~/.cmspark-agent/skills。普通模式需用户 L2 确认；全自动巡航（三旗）可免确认。",
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
      "Install an external skill into the CMspark user skills library (~/.cmspark-agent/skills on Unix, %USERPROFILE%\\.cmspark-agent\\skills on Windows). Prefer this over shell copy. Source may be under the user home (e.g. ~/Projects/...), Downloads, OS temp, or ~/.cmspark-agent. After downloads_find/browser_download of a skill zip or folder, pass path or zip_path. Requires user L2 confirmation unless full-autonomy cruise is on. Never write skills into the git repo skills/ directory or ~/.claude/skills. content is size-capped (256KiB).",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Local directory with SKILL.md, or a single .md skill file (user home / Downloads / tmp / data dir)",
        },
        zip_path: {
          type: "string",
          description:
            "Local .zip containing SKILL.md (folder skill; monorepo zips install the skills/<name>/ subtree). Source under home/Downloads/tmp/data. Compressed cap 100MiB; extract budgets higher for theme/font packs.",
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
// Axes (2026-08-12 hotfix): Surface=L0 skill library write + list/search UI chips elsewhere;
// Composition=existing skill primitive (not Pack/MCP/Agent runtime);
// Autonomy=L2 default (cruise may waive forceConfirm);
// Trust=L2 token binds name/overwrite via pickSkillMdEntryResult lock-step; multi-SKILL.md fail-closed;
// Channel=community install sources (Downloads/home/tmp/data only).
export const SKILL_INSTALL_CAPABILITY = {
  Surface:
    "L0 local install write to user skills; path/zip sources: user home + Downloads/tmp/data (system paths denied); monorepo zip installs single skills/<name>/ subtree only",
  Composition: "Skills install primitive — not a new Agent runtime; atomic tmp+rename overwrite",
  Autonomy: "L2 by default; full-autonomy cruise (three-flag) waives forceConfirm at server",
  Trust:
    "L2 forceConfirm (security_token) is user authorization for durable skill write; preview picker === install picker (pickSkillMdEntryResult); multi-SKILL.md refused before dialog; home-zone sources allowed with that consent (not hard-deny); outside home denied; content size-capped; zip budgets; zero-size bomb entries refused; audit tiers",
  Channel: "community",
} as const
