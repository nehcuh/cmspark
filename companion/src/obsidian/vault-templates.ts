// Obsidian vault templates (P2, lightweight).
//
// Detects the user's template folder (`.obsidian/templates.json` → core Templates plugin,
// or a `templates/`/`Templates/` fallback), stores template files (raw frontmatter text +
// body), and applies one at export time via STATIC placeholder substitution. No Templater
// JS execution — only common `{{...}}` and a few `<% tp.* %>` patterns are substituted;
// unknown `<% %>` are left as-is. Cached to ~/.cmspark-agent/obsidian/templates.json.
//
// Template frontmatter is stored RAW and parsed with a SIMPLE line parser (not yaml.load):
// `{{placeholders}}` aren't valid YAML scalars (would be parsed as flow maps), and a
// substituted title containing a colon/URL would break YAML + get silently dropped. The
// line parser keeps every value as a plain string (or string[] for `[a, b]`), so placeholders
// and arbitrary substituted content survive intact.

import * as fs from "fs"
import * as path from "path"
import matter from "gray-matter"
import { DATA_DIR } from "../config"

export interface VaultTemplate {
  name: string // basename without .md
  frontmatterRaw: string // raw frontmatter text (placeholders preserved)
  body: string // raw body (may contain {{...}} / <% %> / {{content}})
}

export interface VaultTemplates {
  vault_path: string
  generated_at: string
  templates: VaultTemplate[]
}

export interface TemplateVars {
  title: string
  date: string // YYYY-MM-DD
  time: string // HHmm
  content: string // the exported body (+ footer) to inject
}

export interface AppliedTemplate {
  frontmatter: Record<string, any> // placeholders substituted (values stay strings/arrays)
  body: string // placeholders substituted + content injected
}

export const TEMPLATES_PATH = path.join(DATA_DIR, "obsidian", "templates.json")
const MAX_TEMPLATES = 10

/** Detect + collect templates from the vault. Empty list if no (contained) template folder. */
export function detectTemplates(vaultPath: string): VaultTemplates {
  const templates: VaultTemplate[] = []
  const dir = resolveTemplatesDir(vaultPath) // absolute, containment-checked
  const root = path.resolve(vaultPath)
  const realRoot = realpathSafe(root)
  if (dir && realRoot) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (templates.length >= MAX_TEMPLATES) break
        if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
          try {
            const filePath = path.join(dir, entry.name)
            // Defense-in-depth: ensure the file we are about to read is still inside the vault
            // (mitigates TOCTOU where a file inside the template dir is swapped for a symlink
            // that escapes the vault between readdir and readFile).
            const realFile = realpathSafe(filePath)
            if (!realFile || !isStrictlyInside(realFile, realRoot)) continue
            const raw = fs.readFileSync(filePath, "utf-8")
            const parsed = matter(raw)
            templates.push({
              name: entry.name.replace(/\.md$/i, ""),
              frontmatterRaw: parsed.matter || "",
              body: parsed.content || "",
            })
          } catch {
            /* skip unreadable/malformed template */
          }
        }
      }
    } catch {
      /* unreadable folder */
    }
  }
  return { vault_path: root, generated_at: new Date().toISOString(), templates }
}

/**
 * Resolve the templates folder to an ABSOLUTE directory path contained within the vault.
 * Tries `.obsidian/templates.json` `{folder}` first, then `templates/`/`Templates/` fallbacks.
 *
 * Containment is enforced on REAL paths (fs.realpathSync), not lexical ones: path.resolve does
 * NOT resolve symlinks, so a `templates.json` pointing at a symlink that escapes the vault would
 * otherwise let detectTemplates read files outside the vault. Realpath comparison blocks
 * `..` traversal, absolute outside paths, the vault root itself, AND symlinked escapes.
 */
function resolveTemplatesDir(vaultPath: string): string | null {
  const root = path.resolve(vaultPath)
  const realRoot = realpathSafe(root)
  if (!realRoot) return null
  const candidates: string[] = []
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, ".obsidian", "templates.json"), "utf-8"))
    if (cfg && typeof cfg.folder === "string" && cfg.folder.trim()) candidates.push(cfg.folder.trim())
  } catch {
    /* no/invalid templates.json */
  }
  candidates.push("templates", "Templates")
  for (const folder of candidates) {
    const resolved = path.resolve(root, folder)
    // Containment: the REAL path of the candidate must be STRICTLY inside the vault
    // (rejects outside traversal, the vault root itself, and symlinks escaping the vault).
    const realResolved = realpathSafe(resolved)
    if (!realResolved || !isStrictlyInside(realResolved, realRoot)) continue
    try {
      // Use lstat + !isSymbolicLink to avoid a TOCTOU race where the candidate is a real
      // directory during the realpath check but is swapped to a symlink before stat follows it.
      const st = fs.lstatSync(resolved)
      if (st.isDirectory() && !st.isSymbolicLink()) return resolved
    } catch {
      /* not present */
    }
  }
  return null
}

/** realpathSync that returns null instead of throwing for missing/broken paths. */
function realpathSafe(p: string): string | null {
  try {
    return fs.realpathSync(p)
  } catch {
    return null
  }
}

/** True iff `target` (real, absolute) is strictly below `root` (real, absolute) — not root itself. */
export function isStrictlyInside(target: string, root: string): boolean {
  if (target === root) return false
  // When root is the filesystem root ("/"), root + path.sep becomes "//", which would
  // incorrectly reject every legitimate child path. Normalize the trailing separator.
  const prefix = root.endsWith(path.sep) ? root : root + path.sep
  return target.startsWith(prefix)
}

/** Pick the template to apply: prefer one named default/默认/Default, else the first, else null. */
export function pickTemplate(t: VaultTemplates | null): VaultTemplate | null {
  if (!t || t.templates.length === 0) return null
  const def = t.templates.find(x => /^(default|默认)$/i.test(x.name))
  return def || t.templates[0]
}

/** Substitute placeholders in a string: core `{{...}}` + common Templater `<% tp.* %>` (static, no JS). */
export function substituteTemplateText(text: string, vars: TemplateVars): string {
  return text
    .replace(/\{\{title\}\}/g, vars.title)
    .replace(/\{\{date\}\}/g, vars.date)
    .replace(/\{\{time\}\}/g, vars.time)
    .replace(/<%\s*tp\.file\.title\s*%>/g, vars.title)
    .replace(/<%\s*tp\.date\.now\([^)]*\)\s*%>/g, vars.date)
    .replace(/<%\s*tp\.file\.creation_date\([^)]*\)\s*%>/g, vars.date)
  // NOTE: {{content}} is handled by applyTemplate (whole-body injection), not here.
  // Unknown <% %> Templater directives are intentionally left as-is (we don't execute JS).
}

/** Recursively substitute placeholders in any parsed value (strings in objects/arrays). */
export function substituteTemplateValue(v: any, vars: TemplateVars): any {
  if (typeof v === "string") return substituteTemplateText(v, vars)
  if (Array.isArray(v)) return v.map(x => substituteTemplateValue(x, vars))
  if (v && typeof v === "object") {
    const out: Record<string, any> = {}
    for (const [k, val] of Object.entries(v)) out[k] = substituteTemplateValue(val, vars)
    return out
  }
  return v
}

/**
 * Parse template frontmatter as a flat key→(string|string[]) map via a simple line parser.
 * Avoids yaml.load so `{{placeholders}}` and substituted values (colons, URLs) aren't mangled
 * or YAML-coerced (no Date/int auto-typing). Handles `key: value` and `key: [a, b]`.
 */
export function parseTemplateFrontmatter(raw: string): Record<string, any> {
  const out: Record<string, any> = {}
  for (const line of (raw || "").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!m) continue
    const key = m[1]
    const rawVal = m[2]
    const arr = rawVal.match(/^\[(.*)\]$/)
    out[key] = arr ? arr[1].split(",").map(s => s.trim()).filter(Boolean) : rawVal
  }
  return out
}

/** Apply a template: parse frontmatter (line parser) + substitute, substitute + inject content into body. */
export function applyTemplate(template: VaultTemplate, vars: TemplateVars): AppliedTemplate {
  const frontmatter = substituteTemplateValue(parseTemplateFrontmatter(template.frontmatterRaw), vars)
  let body = substituteTemplateText(template.body, vars)
  if (body.includes("{{content}}")) {
    body = body.replace(/\{\{content\}\}/g, vars.content)
  } else if (body.trim()) {
    body = body.replace(/\s+$/, "") + "\n\n" + vars.content
  } else {
    body = vars.content
  }
  return { frontmatter, body }
}

export function saveTemplates(t: VaultTemplates, filePath: string = TEMPLATES_PATH): void {
  fs.writeFileSync(filePath, JSON.stringify(t, null, 2), { mode: 0o600 })
}

export function loadCachedTemplates(
  vaultPath: string | null | undefined,
  filePath: string = TEMPLATES_PATH,
): VaultTemplates | null {
  if (!vaultPath) return null
  try {
    const raw = fs.readFileSync(filePath, "utf-8")
    const t = JSON.parse(raw) as VaultTemplates
    if (!t || !t.vault_path) return null
    if (t.vault_path !== path.resolve(vaultPath)) return null
    return t
  } catch {
    return null
  }
}
