import { z } from "zod"
import { citationSchema } from "../business-evidence/draft-contract"
import { exactExcerpt, excerptSupportsValue } from "../business-evidence/content"
import type { Observation } from "../business-evidence/store"

export const businessReferenceSchema = z.object({
  kind: z.enum(["requirement", "development_task", "test"]), external_id: z.string().min(1).max(8192),
  citation: citationSchema, commit_id: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).optional(),
}).strict()
export type BusinessReference = z.infer<typeof businessReferenceSchema>

export function checkBusinessReferences(refs: BusinessReference[], observations: Observation[], head: string, now = Date.now()): string[] {
  const gaps: string[] = []
  for (const ref of refs) {
    const source = observations.find(item => item.id === ref.citation.observation_id)
    if (!source || !exactExcerpt(source.content, ref.citation) || !excerptSupportsValue(source.content, ref.citation, ref.external_id, true)
      || ref.commit_id && !excerptSupportsValue(source.content, ref.citation, ref.commit_id, true)) throw new Error("CODE_REPORT_BUSINESS_CITATION_INVALID")
    gaps.push("BUSINESS_MAPPING_IS_ASSESSMENT")
    if (source.provenance.truncated === true) gaps.push("BUSINESS_SOURCE_PARTIAL")
    const age = now - Date.parse(source.observed_at)
    if (age > 24 * 3600_000 || age < -5 * 60_000) gaps.push("BUSINESS_SOURCE_STALE")
    if (ref.kind === "test" && ref.commit_id !== head) gaps.push("CODE_REPORT_TEST_COMMIT_MISMATCH")
  }
  return [...new Set(gaps)]
}
