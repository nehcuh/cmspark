// Obsidian vault profiler (P1).
//
// Scans a user's Obsidian vault (frontmatter + first 200 chars per note, capped at
// ~200 notes, skipping .obsidian/.trash/.git), asks the LLM to summarize the vault's
// conventions (frontmatter schema, naming, tags, folders, wikilinks), and caches the
// result to ~/.cmspark-agent/obsidian/profile.json. The exporter (markdown-export.ts)
// applies the cached profile at export time.
//
// Privacy: only frontmatter (capped) + a 200-char body preview per sampled note leaves
// the machine (to the user's configured LLM provider); the absolute vault path does NOT
// (only its basename is sent). Triggered on-demand by the user.

import * as fs from "fs"
import * as path from "path"
import matter from "gray-matter"
import { DATA_DIR } from "../config"
import { llmExtract, LlmExtractConfig } from "../llm/llm-extract"

export interface FrontmatterField {
  name: string
  type: string
}

export interface VaultProfile {
  vault_path: string // resolved absolute path (canonical key)
  generated_at: string
  files_sampled: number // notes actually sent to the LLM (≤ maxNotes)
  fingerprint: { file_count: number; newest_mtime_ms: number } // over ALL .md
  frontmatter_schema: FrontmatterField[]
  tag_conventions: string[]
  naming_pattern: string
  note_name_template?: string
  folder_structure: string
  wikilink_style: string
}

export interface VaultSample {
  relPath: string
  frontmatter: Record<string, any>
  bodyPreview: string
}

export const PROFILE_PATH = path.join(DATA_DIR, "obsidian", "profile.json")

const MAX_NOTES = 200
const BODY_PREVIEW_CHARS = 200
const NO_STRUCTURE_SENTINEL = "NO_VAULT_STRUCTURE"
const ALLOWED_PLACEHOLDERS = ["{{date}}", "{{time}}", "{{first_user_line}}", "{{thread_alias}}"]

// ---------------- path safety ----------------

export function resolveVaultPath(raw: string): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error("vault_path is required")
  }
  if (raw.includes("\0")) throw new Error("invalid vault_path")
  return path.resolve(raw)
}

// ---------------- scanning ----------------

export interface ScanResult {
  samples: VaultSample[]
  fileCount: number
  newestMtimeMs: number
}

/**
 * Recursively scan a vault for markdown notes. Collects up to `maxNotes` samples
 * (frontmatter + 200-char body preview), but counts ALL .md files + tracks the
 * newest mtime for the fingerprint. Skips dot-directories (.obsidian/.trash/.git)
 * and non-.md files. Symlinks are NOT followed (readdirSync dirent type is checked),
 * so a crafted vault can't exfiltrate out-of-vault content.
 */
export function scanVault(vaultPath: string, opts: { maxNotes?: number } = {}): ScanResult {
  const maxNotes = opts.maxNotes ?? MAX_NOTES
  const samples: VaultSample[] = []
  let fileCount = 0
  let newestMtimeMs = 0
  const stack: string[] = [vaultPath]
  while (stack.length) {
    const dir = stack.pop() as string
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue // unreadable dir — skip
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue // skip dot-dirs AND dotfiles
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        fileCount++
        try {
          const stat = fs.statSync(full)
          if (stat.mtimeMs > newestMtimeMs) newestMtimeMs = stat.mtimeMs
        } catch {
          /* ignore stat failure */
        }
        if (samples.length < maxNotes) {
          try {
            const raw = fs.readFileSync(full, "utf-8")
            const parsed = matter(raw)
            samples.push({
              relPath: path.relative(vaultPath, full),
              frontmatter: parsed.data || {},
              bodyPreview: (parsed.content || "").trim().slice(0, BODY_PREVIEW_CHARS),
            })
          } catch {
            /* skip unreadable/malformed note */
          }
        }
      }
    }
  }
  return { samples, fileCount, newestMtimeMs }
}

// ---------------- LLM extraction ----------------

const PROFILE_SYSTEM_PROMPT = `你是一个 Obsidian vault 分析助手。用户会给你若干篇笔记的采样（每篇含相对路径、YAML frontmatter、正文前 200 字）。请总结这个 vault 的约定，严格按以下 YAML frontmatter 格式输出（不要用代码块包裹整个输出，也不要任何前言/解释）：

---
frontmatter_schema:
  - name: <反复使用的属性名>
    type: <string|number|boolean|array|date>
tag_conventions:
  - <用户常用的 tag 或 tag 前缀，如 "topic/" 或 "项目/">
naming_pattern: <笔记命名规律的一句话描述，如 "YYYY-MM-DD 标题" 或 "Title Case">
note_name_template: <把命名规律翻译成可用的文件名模板，只能用占位符 {{date}} {{time}} {{first_user_line}} {{thread_alias}}，例如 "{{date}} {{first_user_line}}"。判断不了就留空>
folder_structure: <顶层文件夹结构的一句话描述>
wikilink_style: <wikilink 使用习惯的一句话描述，如 "频繁用 [[ ]] 互链" 或 "几乎不用">
---

只输出上面的 frontmatter，不要其他解释。frontmatter_schema 只列用户实际反复使用的属性（忽略一次性出现的）。如果采样里看不出任何结构化约定，只输出一行：${NO_STRUCTURE_SENTINEL}`

export async function profileVault(params: { vaultPath: string; config: LlmExtractConfig }): Promise<VaultProfile | null> {
  const { vaultPath, config } = params
  const { samples, fileCount, newestMtimeMs } = scanVault(vaultPath)
  if (samples.length === 0) return null
  // Send only the basename to the LLM (avoid leaking /Users/<user>/... to the provider).
  const output = await llmExtract({
    systemPrompt: PROFILE_SYSTEM_PROMPT,
    userContent: `以下是来自 vault "${path.basename(vaultPath)}" 的 ${samples.length} 篇采样笔记：\n\n${renderSamples(samples)}`,
    config,
  })
  if (!output || output.trim() === NO_STRUCTURE_SENTINEL) return null
  const extracted = parseVaultProfile(output)
  if (!extracted) return null
  return {
    ...extracted,
    vault_path: path.resolve(vaultPath),
    generated_at: new Date().toISOString(),
    files_sampled: samples.length,
    fingerprint: { file_count: fileCount, newest_mtime_ms: newestMtimeMs },
  }
}

function renderSamples(samples: VaultSample[]): string {
  return samples
    .map(s => {
      let fm: string
      try {
        // Cap frontmatter payload so one note with huge metadata can't blow the prompt.
        const entries = Object.entries(s.frontmatter).slice(0, 20)
        fm = JSON.stringify(Object.fromEntries(entries))
        if (fm.length > 500) fm = fm.slice(0, 500) + "…"
      } catch {
        fm = "(unserializable)"
      }
      if (fm === "{}") fm = "(无)"
      return `### ${s.relPath}\nfrontmatter: ${fm}\n正文: ${s.bodyPreview}`
    })
    .join("\n\n")
}

export type ExtractedProfile = Omit<VaultProfile, "vault_path" | "generated_at" | "files_sampled" | "fingerprint">

/**
 * Sanitize an LLM-proposed note-name template: strip path separators + control chars,
 * drop placeholders outside the allowlist. Returns undefined if nothing usable remains.
 * (Defense-in-depth — the exporter also sanitizes the final filename.)
 */
export function sanitizeTemplateName(raw: string): string | undefined {
  let s = (raw || "").replace(/[\0-\x1f\x7f/\\]/g, "") // control chars + path separators
  s = s.replace(/\{\{[^}]*\}\}/g, m => (ALLOWED_PLACEHOLDERS.includes(m) ? m : ""))
  s = s.trim()
  return s.length > 0 && s.length <= 120 ? s : undefined
}

/** Parse the LLM's frontmatter output into a profile. Returns null on sentinel/empty/failure. */
export function parseVaultProfile(output: string): ExtractedProfile | null {
  const trimmed = (output || "").trim()
  if (!trimmed || trimmed === NO_STRUCTURE_SENTINEL) return null
  // Tolerate leading/trailing prose: prefer the first fenced block anywhere, else the
  // first `---...---` frontmatter block anywhere; fall back to the whole string.
  let body = trimmed
  const fenced = trimmed.match(/```[a-zA-Z]*\n([\s\S]*?)```/)
  if (fenced) {
    body = fenced[1].trim()
  } else {
    const fm = trimmed.match(/---\n([\s\S]*?)\n---/)
    if (fm) body = `---\n${fm[1]}\n---`
  }
  let d: Record<string, any>
  try {
    d = matter(body).data || {}
  } catch {
    return null // e.g. duplicate YAML keys — treat as parse failure, caller retries
  }
  const schema: FrontmatterField[] = Array.isArray(d.frontmatter_schema)
    ? d.frontmatter_schema
        .filter((f: any) => f && typeof f.name === "string")
        .map((f: any) => ({ name: String(f.name), type: String(f.type || "string") }))
    : []
  const rawTemplate = typeof d.note_name_template === "string" ? d.note_name_template : ""
  const strField = (v: any): string => (typeof v === "string" ? v.trim() : "")
  const extracted: ExtractedProfile = {
    frontmatter_schema: schema,
    tag_conventions: Array.isArray(d.tag_conventions)
      ? d.tag_conventions.map(String).map((s: string) => s.trim()).filter(Boolean)
      : [],
    naming_pattern: strField(d.naming_pattern),
    note_name_template: sanitizeTemplateName(rawTemplate),
    folder_structure: strField(d.folder_structure),
    wikilink_style: strField(d.wikilink_style),
  }
  // Emptiness guard: a parse that yielded no usable conventions is a parse failure,
  // not a valid-but-blank profile (avoids caching/apply garbage from a degraded response).
  const isEmpty =
    extracted.frontmatter_schema.length === 0 &&
    extracted.tag_conventions.length === 0 &&
    !extracted.naming_pattern &&
    !extracted.folder_structure &&
    !extracted.wikilink_style &&
    !extracted.note_name_template
  return isEmpty ? null : extracted
}

// ---------------- cache ----------------

export function saveProfile(profile: VaultProfile, filePath: string = PROFILE_PATH): void {
  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), { mode: 0o600 })
}

/**
 * Load the cached profile for `vaultPath`. Returns null if missing / unreadable /
 * the cached profile was generated for a different vault. NOTE: does not rescan to
 * check staleness — the user refreshes on demand; export just uses whatever is cached.
 */
export function loadCachedProfile(
  vaultPath: string | null | undefined,
  filePath: string = PROFILE_PATH,
): VaultProfile | null {
  if (!vaultPath) return null
  try {
    const raw = fs.readFileSync(filePath, "utf-8")
    const profile = JSON.parse(raw) as VaultProfile
    if (!profile || !profile.vault_path) return null
    if (profile.vault_path !== path.resolve(vaultPath)) return null
    return profile
  } catch {
    return null
  }
}
