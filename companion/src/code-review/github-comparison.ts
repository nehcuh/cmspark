import { z } from "zod"
import { canonicalRequest, evidenceDigest, normalizeEvidenceText } from "../business-evidence/content"
import { parseUnifiedDiff, validDiffPath } from "./diff"

const count = z.number().int().safe().nonnegative()
const filePath = z.string().max(8192).refine(validDiffPath).nullable()
const sha = z.string().regex(/^[a-f0-9]{40}$/)
const schema = z.object({
  schema_version: z.literal(1), adapter: z.literal("github_compare_two_dot.v1"),
  repository: z.string().regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  base: sha, head: sha, semantics: z.literal("two_dot_trees"),
  file_count: count.min(1).max(128), additions: count, deletions: count,
  diff_text: z.string().max(65536),
  manifest: z.array(z.object({ old_path: filePath, new_path: filePath, additions: count, deletions: count }).strict()).min(1).max(128),
}).strict()
export type GithubComparison = z.infer<typeof schema>

/** Pure revalidation of an already authenticated browser result. Neither this
 * object nor its hash grants permission to capture a page or choose a scope. */
export function validateGithubComparison(raw: unknown, observedUrl: string): GithubComparison {
  if (Buffer.byteLength(JSON.stringify(raw) || "", "utf8") > 65536) throw new Error("CODE_COMPARISON_CAPACITY")
  const value = schema.parse(raw)
  if (value.base === value.head || observedUrl !== `${value.repository}/compare/${value.base}..${value.head}`
    || value.diff_text !== normalizeEvidenceText(value.diff_text)) throw new Error("CODE_COMPARISON_IDENTITY_MISMATCH")
  const files = parseUnifiedDiff(value.diff_text)
  if (files.length !== value.file_count || value.manifest.length !== files.length) throw new Error("CODE_COMPARISON_INVENTORY_MISMATCH")
  let additions = 0, deletions = 0
  for (let i = 0; i < files.length; i++) {
    const f = files[i], m = value.manifest[i]
    const a = f.lines.filter(l => l.old_line === null).length, d = f.lines.filter(l => l.new_line === null).length
    if (f.old_path !== m.old_path || f.new_path !== m.new_path || a !== m.additions || d !== m.deletions
      || f.old_path !== null && f.new_path !== null && f.old_path !== f.new_path) throw new Error("CODE_COMPARISON_INVENTORY_MISMATCH")
    additions += a; deletions += d
  }
  if (additions !== value.additions || deletions !== value.deletions) throw new Error("CODE_COMPARISON_INVENTORY_MISMATCH")
  return value
}
export function githubComparisonDigest(value: GithubComparison): string {
  return evidenceDigest(canonicalRequest(value))
}
