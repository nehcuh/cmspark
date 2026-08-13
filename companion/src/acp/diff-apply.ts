// Propose-diff parse + workspace-contained apply (P3). Never shell; no free-args.

import * as fs from "fs"
import * as path from "path"
import { atomicWriteText } from "../io"

export type ParsedDiffFile = {
  /** Path relative to workspace (posix-ish) */
  relPath: string
  /** Full unified diff for this file only (optional) */
  hunk: string
  /** New file body if we can reconstruct; else null → skip apply for that file */
  newContent: string | null
  isNew: boolean
  isDelete: boolean
}

/**
 * Extract ```diff / ```patch fenced blocks or raw unified diff from agent output.
 */
export function extractDiffText(handback: string): string | null {
  const raw = String(handback || "")
  const fence = raw.match(/```(?:diff|patch)\s*\n([\s\S]*?)```/i)
  if (fence?.[1]?.trim()) return fence[1].trim()
  if (/^diff --git /m.test(raw) || /^--- /m.test(raw)) {
    // strip UNTRUSTED frame if present
    const body = raw.replace(/<<<UNTRUSTED_ACP_HANDBACK[\s\S]*?<body>\n?/i, "")
      .replace(/\n?<\/body>[\s\S]*$/i, "")
    if (/^diff --git /m.test(body) || /^--- /m.test(body)) return body.trim()
  }
  return null
}

/**
 * Parse multi-file unified diffs into per-file ops.
 * Supports "diff --git a/x b/x" and simple "--- a/x / +++ b/x" forms.
 * Reconstruction: apply hunks to existing file when possible; new files from +++ only hunks.
 */
export function parseUnifiedDiff(diffText: string): ParsedDiffFile[] {
  const text = diffText.replace(/\r\n/g, "\n")
  const files: ParsedDiffFile[] = []
  // Split on diff --git or --- at line start when preceded by blank/start
  const chunks = text.split(/(?=^diff --git )/m).filter((c) => c.trim())
  const parts = chunks.length > 0 ? chunks : [text]

  for (const chunk of parts) {
    let relPath = ""
    let isNew = false
    let isDelete = false
    const plusMatch = chunk.match(/^\+\+\+\s+(?:b\/)?(.+)$/m)
    const minusMatch = chunk.match(/^---\s+(?:a\/)?(.+)$/m)
    const gitMatch = chunk.match(/^diff --git a\/(.+?) b\/(.+)$/m)
    if (gitMatch) {
      relPath = gitMatch[2].trim()
    } else if (plusMatch) {
      relPath = plusMatch[1].trim()
      if (relPath === "/dev/null") {
        isDelete = true
        relPath = minusMatch?.[1]?.replace(/^a\//, "").trim() || ""
      }
    }
    if (minusMatch?.[1] === "/dev/null" || minusMatch?.[1]?.endsWith("/dev/null")) {
      isNew = true
    }
    if (!relPath || relPath === "/dev/null") continue
    relPath = relPath.replace(/^b\//, "").replace(/^a\//, "")
    // security: reject path escape tokens early
    if (relPath.includes("\0") || path.isAbsolute(relPath)) continue

    const newContent = reconstructFromHunks(chunk)
    files.push({
      relPath,
      hunk: chunk,
      newContent,
      isNew,
      isDelete: isDelete || /^\+\+\+\s+\/dev\/null/m.test(chunk),
    })
  }
  return files
}

/** Best-effort: collect + lines from hunks into a full new file (works for new files / full rewrites). */
function reconstructFromHunks(chunk: string): string | null {
  const lines = chunk.split("\n")
  const out: string[] = []
  let inHunk = false
  let sawHunk = false
  for (const line of lines) {
    if (line.startsWith("@@")) {
      inHunk = true
      sawHunk = true
      continue
    }
    if (!inHunk) continue
    if (line.startsWith("diff --git") || line.startsWith("--- ") || line.startsWith("+++ ")) {
      inHunk = false
      continue
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      out.push(line.slice(1))
    } else if (line.startsWith(" ")) {
      out.push(line.slice(1))
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      // deleted line — omit
    }
  }
  if (!sawHunk) return null
  return out.join("\n") + (out.length ? "\n" : "")
}

export type ApplyResult = {
  ok: boolean
  applied: string[]
  skipped: Array<{ path: string; reason: string }>
  error?: string
}

/**
 * Apply parsed files under workspace root (realpath containment).
 * Deletes are skipped unless allowDelete (default false).
 */
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
    if (rel.startsWith("../") || rel.includes("/../") || rel.startsWith("..")) {
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
    if (f.newContent == null) {
      skipped.push({ path: rel, reason: "cannot_reconstruct_body" })
      continue
    }
    try {
      atomicWriteText(target, f.newContent, 0o644)
      applied.push(rel)
    } catch (e: any) {
      skipped.push({ path: rel, reason: e?.message || "write_failed" })
    }
  }
  return { ok: applied.length > 0, applied, skipped }
}

/** Human summary for chat */
export function summarizeDiffFiles(files: ParsedDiffFile[]): string {
  if (!files.length) return "（未解析到可应用的 diff 文件）"
  return files
    .map((f) => {
      const tag = f.isDelete ? "D" : f.isNew ? "A" : "M"
      return `- ${tag} \`${f.relPath}\`${f.newContent == null ? " （需人工在 IDE 应用）" : ""}`
    })
    .join("\n")
}
