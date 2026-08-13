// Propose-diff parse + workspace-contained apply (P3).
// Partial hunks are applied against existing file content — never truncate by
// writing only + lines (Pi REJECT 2026-08-13).

import * as fs from "fs"
import * as path from "path"
import { atomicWriteText } from "../io"

export type ParsedDiffFile = {
  relPath: string
  hunk: string
  /** If set, write this body directly (new file or fully reconstructed). */
  newContent: string | null
  isNew: boolean
  isDelete: boolean
  /** Structured hunks for safe apply on existing files */
  hunks: DiffHunk[]
}

export type DiffHunk = {
  oldStart: number // 1-based
  oldCount: number
  newStart: number
  newCount: number
  lines: string[] // including leading + / - / space / \\
}

export function extractDiffText(handback: string): string | null {
  const raw = String(handback || "")
  const fence = raw.match(/```(?:diff|patch)\s*\n([\s\S]*?)```/i)
  if (fence?.[1]?.trim()) return fence[1].trim()
  if (/^diff --git /m.test(raw) || /^--- /m.test(raw)) {
    const body = raw
      .replace(/<<<UNTRUSTED_ACP_HANDBACK[\s\S]*?<body>\n?/i, "")
      .replace(/\n?<\/body>[\s\S]*$/i, "")
    if (/^diff --git /m.test(body) || /^--- /m.test(body)) return body.trim()
  }
  return null
}

export function parseUnifiedDiff(diffText: string): ParsedDiffFile[] {
  const text = diffText.replace(/\r\n/g, "\n")
  const chunks = text.split(/(?=^diff --git )/m).filter((c) => c.trim())
  const parts = chunks.length > 0 ? chunks : [text]
  const files: ParsedDiffFile[] = []

  for (const chunk of parts) {
    let relPath = ""
    let isNew = false
    let isDelete = false
    const plusMatch = chunk.match(/^\+\+\+\s+(?:b\/)?(.+)$/m)
    const minusMatch = chunk.match(/^---\s+(?:a\/)?(.+)$/m)
    const gitMatch = chunk.match(/^diff --git a\/(.+?) b\/(.+)$/m)
    if (gitMatch) relPath = gitMatch[2].trim()
    else if (plusMatch) {
      relPath = plusMatch[1].trim()
      if (relPath === "/dev/null") {
        isDelete = true
        relPath = minusMatch?.[1]?.replace(/^a\//, "").trim() || ""
      }
    }
    if (minusMatch?.[1] === "/dev/null" || minusMatch?.[1]?.endsWith("/dev/null")) {
      isNew = true
    }
    if (/^\+\+\+\s+\/dev\/null/m.test(chunk)) isDelete = true
    if (!relPath || relPath === "/dev/null") continue
    relPath = relPath.replace(/^b\//, "").replace(/^a\//, "")
    if (relPath.includes("\0") || path.isAbsolute(relPath)) continue

    const hunks = parseHunks(chunk)
    let newContent: string | null = null
    if (isNew && !isDelete) {
      newContent = applyHunksToLines([], hunks)
    }

    files.push({
      relPath,
      hunk: chunk,
      newContent,
      isNew,
      isDelete,
      hunks,
    })
  }
  return files
}

function parseHunks(chunk: string): DiffHunk[] {
  const lines = chunk.split("\n")
  const hunks: DiffHunk[] = []
  let i = 0
  while (i < lines.length) {
    const m = lines[i].match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s@@/)
    if (!m) {
      i++
      continue
    }
    const oldStart = parseInt(m[1], 10)
    const oldCount = m[2] !== undefined ? parseInt(m[2], 10) : 1
    const newStart = parseInt(m[3], 10)
    const newCount = m[4] !== undefined ? parseInt(m[4], 10) : 1
    i++
    const hLines: string[] = []
    while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("diff --git")) {
      const L = lines[i]
      if (
        L.startsWith("+") ||
        L.startsWith("-") ||
        L.startsWith(" ") ||
        L.startsWith("\\")
      ) {
        hLines.push(L)
      } else if (L.startsWith("---") || L.startsWith("+++")) {
        break
      }
      i++
    }
    hunks.push({ oldStart, oldCount, newStart, newCount, lines: hLines })
  }
  return hunks
}

/** Apply unified hunks to an existing line array (0-based internal). */
export function applyHunksToLines(original: string[], hunks: DiffHunk[]): string | null {
  // Work on a copy without trailing empty from split if file ended with newline
  let lines = original.slice()
  // Apply from bottom to top so line numbers stay valid
  const ordered = [...hunks].sort((a, b) => b.oldStart - a.oldStart)
  for (const h of ordered) {
    const start = Math.max(0, h.oldStart - 1)
    let oi = start
    const out: string[] = []
    for (const raw of h.lines) {
      if (raw.startsWith("\\")) continue // "\ No newline at end of file"
      const tag = raw[0]
      const text = raw.slice(1)
      if (tag === " ") {
        if (oi >= lines.length || lines[oi] !== text) {
          // context mismatch — refuse rather than corrupt
          return null
        }
        out.push(text)
        oi++
      } else if (tag === "-") {
        if (oi >= lines.length || lines[oi] !== text) {
          return null
        }
        oi++
      } else if (tag === "+") {
        out.push(text)
      }
    }
    const end = oi
    lines = [...lines.slice(0, start), ...out, ...lines.slice(end)]
  }
  return lines.join("\n") + (lines.length ? "\n" : "")
}

export type ApplyResult = {
  ok: boolean
  applied: string[]
  skipped: Array<{ path: string; reason: string }>
  error?: string
}

export function applyParsedDiffs(
  workspaceRoot: string,
  files: ParsedDiffFile[],
  opts: { allowDelete?: boolean } = {},
): ApplyResult {
  let root: string
  try {
    root = fs.realpathSync(workspaceRoot)
  } catch {
    return { ok: false, applied: [], skipped: [], error: "workspace root missing" }
  }
  const applied: string[] = []
  const skipped: Array<{ path: string; reason: string }> = []

  for (const f of files) {
    const rel = f.relPath.replace(/\\/g, "/")
    if (rel.startsWith("../") || rel.includes("/../") || rel === ".." || rel.startsWith("..")) {
      skipped.push({ path: rel, reason: "path_escape" })
      continue
    }
    const abs = path.resolve(root, rel)
    let absRealParent: string
    try {
      const parent = path.dirname(abs)
      if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true })
      absRealParent = fs.realpathSync(parent)
    } catch {
      skipped.push({ path: rel, reason: "parent_unresolvable" })
      continue
    }
    if (absRealParent !== root && !absRealParent.startsWith(root + path.sep)) {
      skipped.push({ path: rel, reason: "outside_workspace" })
      continue
    }
    const target = path.join(absRealParent, path.basename(abs))

    if (f.isDelete) {
      if (!opts.allowDelete) {
        skipped.push({ path: rel, reason: "delete_not_allowed" })
        continue
      }
      try {
        if (fs.existsSync(target)) fs.unlinkSync(target)
        applied.push(rel)
      } catch (e: any) {
        skipped.push({ path: rel, reason: e?.message || "delete_failed" })
      }
      continue
    }

    let body: string | null = f.newContent
    if (body == null) {
      if (!fs.existsSync(target)) {
        // treat as new if hunks only additions
        body = applyHunksToLines([], f.hunks)
        if (body == null) {
          skipped.push({ path: rel, reason: "cannot_create_from_hunks" })
          continue
        }
      } else {
        const existing = fs.readFileSync(target, "utf8")
        const existingLines = existing.split("\n")
        // drop trailing empty from split if file ended with \n
        if (existingLines.length && existingLines[existingLines.length - 1] === "") {
          existingLines.pop()
        }
        body = applyHunksToLines(existingLines, f.hunks)
        if (body == null) {
          skipped.push({ path: rel, reason: "hunk_context_mismatch" })
          continue
        }
      }
    }

    try {
      atomicWriteText(target, body, 0o644)
      applied.push(rel)
    } catch (e: any) {
      skipped.push({ path: rel, reason: e?.message || "write_failed" })
    }
  }
  return { ok: applied.length > 0, applied, skipped }
}

export function summarizeDiffFiles(files: ParsedDiffFile[]): string {
  if (!files.length) return "（未解析到可应用的 diff 文件）"
  return files
    .map((f) => {
      const tag = f.isDelete ? "D" : f.isNew ? "A" : "M"
      const note =
        !f.isNew && !f.isDelete && f.hunks.length === 0
          ? " （无 hunk）"
          : ""
      return `- ${tag} \`${f.relPath}\`${note}`
    })
    .join("\n")
}
