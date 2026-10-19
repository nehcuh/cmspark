import { z } from "zod"
import { canonicalRequest, evidenceDigest } from "../business-evidence/content"

export const GITHUB_RELEASE_SELECTOR = ".Box-body div.d-flex.flex-row.flex-wrap.color-fg-muted.flex-items-end"
const schema = z.object({
  schema_version: z.literal(1), adapter: z.literal("github_tagged_release.v1"),
  repository: z.string().regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  release_url: z.string(), tag: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/), head: z.string().regex(/^[a-f0-9]{40}$/),
}).strict()
export type GithubReleaseRelation = z.infer<typeof schema>

/** Current platform declaration only. This does not attest a historical tag,
 * publisher signature, artifact/build contents, or business release approval. */
export function validateGithubRelease(raw: unknown, observedUrl: string): GithubReleaseRelation {
  if (Buffer.byteLength(JSON.stringify(raw) || "", "utf8") > 65536) throw new Error("RELEASE_RELATION_CAPACITY")
  const value = schema.parse(raw)
  if (observedUrl !== value.release_url || value.release_url !== `${value.repository}/releases/tag/${value.tag}`) throw new Error("RELEASE_RELATION_IDENTITY_MISMATCH")
  return value
}
export function githubReleaseDigest(value: GithubReleaseRelation, html: string): string {
  return evidenceDigest(canonicalRequest({ relation: value, content_digest: evidenceDigest(html) }))
}
