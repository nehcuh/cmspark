// Markdown builder for NotebookLM import.
//
// Pure: no IO, no DOM, no LLM. Input = the page-extracted {title,url,text} + extraction
// timestamp; output = {content, filename}. Mirrors the shape of
// companion/src/threads/markdown-export.ts (thread → markdown) but lives extension-side
// because v1 doesn't involve the companion (Round 2 architecture decision: Z, not X).
//
// Filename + YAML safety (Round 2 catch): titles can contain anything — including
// path separators (which break downloads), YAML injection sequences, or control chars.
// We sanitize to a slug and YAML-double-quote the frontmatter values.

export interface BuildMarkdownInput {
  title: string
  url: string
  text: string
  extractedAt: Date
}

export interface BuildMarkdownResult {
  content: string
  filename: string
}

const MAX_TITLE_SLUG = 40
const MAX_HEADING = 200
const MAX_YAML_VALUE = 500

/** CJK + letters + digits + dash; everything else collapses to a single '-'. */
export function slugify(s: string): string {
  const cleaned = s
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, MAX_TITLE_SLUG)
  return cleaned || "untitled"
}

/** YAML safe string: always double-quoted, escape backslash + double-quote + newline
 *  + control chars. C0 controls (\x00-\x1f) are not legal inside YAML double-quoted
 *  scalars and can break downstream parsers (NotebookLM, Obsidian, etc.). */
export function escapeYaml(s: string): string {
  const capped = s
    .replace(/[\r\n]+/g, " ")
    .replace(/[\x00-\x1f]/g, " ")
    .slice(0, MAX_YAML_VALUE)
  return '"' + capped.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'
}

/** One-line title for the H1 — no newlines, length-capped. */
export function flattenTitle(s: string): string {
  return s.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_HEADING)
}

/** YYYYMMDD-HHMMSS-mmm in UTC, filesystem-safe. Millisecond precision prevents
 *  same-second-same-title filename collisions when the user double-exports. */
export function timestampSlug(d: Date): string {
  const iso = d.toISOString()
  return (
    iso.slice(0, 10).replace(/-/g, "") +
    "-" +
    iso.slice(11, 19).replace(/:/g, "") +
    "-" +
    iso.slice(20, 23)
  )
}

export function buildMarkdown(args: BuildMarkdownInput): BuildMarkdownResult {
  const iso = args.extractedAt.toISOString()
  const flatTitle = flattenTitle(args.title)

  const content = `---
title: ${escapeYaml(args.title)}
source_url: ${escapeYaml(args.url)}
extracted_at: ${iso}
extracted_via: CMspark Browser Agent
---

# ${flatTitle}

> Source: ${args.url}
> Extracted: ${iso}

---

${args.text}

---

*Exported by CMspark Browser Agent → drag this file into [NotebookLM](https://notebooklm.google.com) as a source.*
`

  const filename = `notebooklm-${timestampSlug(args.extractedAt)}-${slugify(args.title)}.md`
  return { content, filename }
}
