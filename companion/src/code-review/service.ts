import * as fs from "node:fs"
import * as path from "node:path"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import { atomicWriteJSON } from "../io"
import { EvidenceStore, type Observation } from "../business-evidence/store"
import { canonicalRequest, evidenceDigest, evidenceScopeHash, exactExcerpt, excerptSupportsValue, type EvidenceScope } from "../business-evidence/content"
import { REVIEW_LIMITS, boundRequest, reviewCreateSchema, reviewIdSchema, type ReviewCreate } from "./contract"
import { parseUnifiedDiff } from "./diff"
import { receiptSchema, reportSchema, checkReport } from "./report"
import { BusinessEvidenceService } from "../business-evidence/service"
import { checkBusinessReferences } from "./context"

const recordSchema = z.object({ id: z.string().uuid(), created_at: z.string().datetime(), input: reviewCreateSchema, input_digest: z.string().regex(/^[a-f0-9]{64}$/), receipt: receiptSchema.optional(), assessment: z.object({ digest: z.string().regex(/^[a-f0-9]{64}$/), report: reportSchema }).strict().optional() }).strict()
const fileSchema = z.object({ schema_version: z.literal(1), jobs: z.array(recordSchema).max(REVIEW_LIMITS.jobs) }).strict()
type ReviewFile = z.infer<typeof fileSchema>

/** All writes are synchronous critical sections in the single owning Companion
 * process; no await or multi-process writer is supported. Scope is server-owned. */
export class CodeReviewService {
  private readonly filePath: string
  private readonly evidence: EvidenceStore
  constructor(private readonly dataDir: string, private readonly scope: EvidenceScope) {
    if (scope.kind !== "chat") throw new Error("CODE_REVIEW_CHAT_SCOPE_REQUIRED")
    this.filePath = path.join(dataDir, "code-review-v1", `${evidenceScopeHash(scope)}.json`)
    this.evidence = new EvidenceStore(dataDir, scope)
  }
  private load(): ReviewFile {
    let bytes: Buffer
    try {
      if (fs.statSync(this.filePath).size > REVIEW_LIMITS.storeBytes) throw new Error("CODE_REVIEW_CAPACITY")
      bytes = fs.readFileSync(this.filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schema_version: 1, jobs: [] }
      throw error
    }
    if (bytes.length > REVIEW_LIMITS.storeBytes) throw new Error("CODE_REVIEW_CAPACITY")
    let raw: unknown
    try { raw = JSON.parse(bytes.toString("utf8")) } catch { throw new Error("CODE_REVIEW_CORRUPT") }
    if ((raw as { schema_version?: unknown } | null)?.schema_version !== 1) throw new Error("CODE_REVIEW_SCHEMA_UNSUPPORTED")
    const parsed = fileSchema.safeParse(raw)
    if (!parsed.success) throw new Error("CODE_REVIEW_CORRUPT")
    const state = parsed.data
    const ids = new Set<string>(), requests = new Set<string>()
    for (const job of state.jobs) {
      boundRequest(job.input)
      if (job.receipt) boundRequest(job.receipt.report)
      if (job.assessment) boundRequest(job.assessment.report)
      if (job.input_digest !== evidenceDigest(canonicalRequest(job.input)) || ids.has(job.id) || requests.has(job.input.request_id)) throw new Error("CODE_REVIEW_CORRUPT")
      ids.add(job.id); requests.add(job.input.request_id)
      if (job.receipt && job.receipt.digest !== evidenceDigest(canonicalRequest(job.receipt.report))) throw new Error("CODE_REVIEW_CORRUPT")
      if (job.assessment && job.assessment.digest !== evidenceDigest(canonicalRequest(job.assessment.report))) throw new Error("CODE_REVIEW_CORRUPT")
    }
    return state
  }
  private save(state: ReviewFile): void {
    if (Buffer.byteLength(JSON.stringify(state, null, 2), "utf8") > REVIEW_LIMITS.storeBytes) throw new Error("CODE_REVIEW_CAPACITY")
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 })
    atomicWriteJSON(this.filePath, state, 0o600)
  }
  private snapshot(input: ReviewCreate) {
    const observations = this.evidence.read().observations
    const contextGaps = checkBusinessReferences(input.business_context || [], observations, input.head)
    const materialViews = (input.materials || []).map(ref => {
      // DraftRepository exposes create/update/read only (no delete). Missing or
      // corrupt source files fail closed, as do missing/corrupt Observations.
      const checked = new BusinessEvidenceService(this.dataDir, this.scope).read({ draft_id: ref.draft_id })
      const current = checked.draft.revision === ref.revision
      if (!current) contextGaps.push("CODE_REVIEW_MATERIAL_REVISION_CHANGED")
      return { ...ref, kind: checked.draft.kind, current_revision: checked.draft.revision,
        fields: current ? checked.draft.fields : {}, gaps: current ? checked.gaps : ["DRAFT_REVISION_CHANGED"] }
    })
    const materialsTooLarge = Buffer.byteLength(JSON.stringify(materialViews), "utf8") > 65536
    if (materialsTooLarge) contextGaps.push("BUSINESS_CONTEXT_TOO_LARGE")
    let observation: Observation | undefined
    if (input.diff) {
      observation = observations.find(item => item.id === input.diff!.observation_id)
      if (!observation || observation.tool !== "get_page_text" || !exactExcerpt(observation.content, input.diff)) throw new Error("CODE_DIFF_CITATION_INVALID")
      if (observation.provenance.text_transform !== "unchanged") throw new Error("CODE_DIFF_RECAPTURE_REQUIRED")
    }
    const diffText = input.diff && observation ? Array.from(observation.content).slice(input.diff.start, input.diff.end).join("") : null
    const files = diffText !== null ? parseUnifiedDiff(diffText) : []
    // Metadata must be outside the code span, on the same atomic page read.
    const metadata = input.identity_citations.filter(citation => observation && citation.observation_id === observation.id
      && (citation.end <= input.diff!.start || citation.start >= input.diff!.end) && exactExcerpt(observation.content, citation))
    const identity_present = !!observation && [input.repository, input.base, input.head].every(value =>
      metadata.some(citation => excerptSupportsValue(observation!.content, citation, value, true)))
    return {
      business_context: input.business_context || [], materials: materialsTooLarge ? [] : materialViews,
      material_bindings: input.materials || [],
      files, diff_hash: diffText !== null ? evidenceDigest(diffText) : null,
      identity_state: identity_present ? "page_text_present" as const : "requested_only" as const,
      coverage: observation?.provenance.truncated === true ? "partial" as const : "unknown" as const,
      gaps: ["HOST_COMPARISON_UNVERIFIED", "WEB_DIFF_COVERAGE_UNKNOWN",
        ...contextGaps,
        ...(input.diff ? ["CODE_DIFF_CITED_SPAN_ONLY"] : []),
        ...(!input.diff ? ["CODE_DIFF_MISSING"] : []), ...(!identity_present ? ["CODE_IDENTITY_UNVERIFIED"] : []),
        ...(observation?.provenance.truncated === true ? ["CODE_SOURCE_TRUNCATED"] : [])],
      sources: observation ? [{ observation_id: observation.id, url: observation.target.url, observed_at: observation.observed_at,
        digest: observation.digest, normalization: "NFC_LF", provenance: observation.provenance }] : [],
    }
  }
  create(raw: unknown) {
    boundRequest(raw)
    const input = reviewCreateSchema.parse(raw)
    boundRequest(input)
    const state = this.load(), digest = evidenceDigest(canonicalRequest(input))
    const existing = state.jobs.find(job => job.input.request_id === input.request_id)
    if (existing) {
      if (existing.input_digest !== digest) throw new Error("CODE_REVIEW_REQUEST_CONFLICT")
      return this.view(existing)
    }
    if (state.jobs.length >= REVIEW_LIMITS.jobs) throw new Error("CODE_REVIEW_CAPACITY")
    this.snapshot(input)
    const record = { id: randomUUID(), created_at: new Date().toISOString(), input, input_digest: digest }
    state.jobs.push(record); this.save(state)
    return this.view(record)
  }
  read(raw: unknown) {
    const { review_id } = reviewIdSchema.parse(raw)
    const job = this.load().jobs.find(item => item.id === review_id)
    if (!job) throw new Error("CODE_REVIEW_NOT_FOUND")
    return this.view(job)
  }
  list() { return this.load().jobs.map(job => ({ review_id: job.id, repository: job.input.repository, base: job.input.base, head: job.input.head, created_at: job.created_at })) }
  /** CMspark's own web-based judgement, never labelled an external Agent receipt. */
  assess(raw: unknown) {
    boundRequest(raw)
    const report = reportSchema.parse(raw), state = this.load()
    boundRequest(report)
    const job = state.jobs.find(item => item.id === report.review_id)
    if (!job) throw new Error("CODE_REVIEW_NOT_FOUND")
    checkReport(this.view(job), report, this.evidence.read().observations, Date.now(), "cmspark")
    if (job.assessment && canonicalRequest(job.assessment.report) !== canonicalRequest(report)) throw new Error("CODE_ASSESSMENT_ALREADY_RECORDED")
    if (!job.assessment) { job.assessment = { digest: evidenceDigest(canonicalRequest(report)), report }; this.save(state) }
    return this.view(job)
  }
  /** Internal UI handler only, after origin-bound confirmation. Not a model tool. */
  previewReport(raw: unknown) {
    boundRequest(raw)
    const report = reportSchema.parse(raw)
    boundRequest(report)
    checkReport(this.read({ review_id: report.review_id }), report, this.evidence.read().observations)
    return report
  }
  receive(raw: unknown) {
    boundRequest(raw)
    const report = reportSchema.parse(raw)
    boundRequest(report)
    const state = this.load(), job = state.jobs.find(item => item.id === report.review_id)
    if (!job) throw new Error("CODE_REVIEW_NOT_FOUND")
    const view = this.view(job)
    checkReport(view, report, this.evidence.read().observations)
    const digest = evidenceDigest(canonicalRequest(report))
    if (job.receipt) {
      if (job.receipt.digest !== digest) throw new Error("CODE_REPORT_ALREADY_RECEIVED")
      return job.receipt
    }
    const receipt = { id: randomUUID(), received_at: new Date().toISOString(), digest, origin: "user_confirmed_external_assessment" as const, report }
    job.receipt = receipt; this.save(state)
    return receipt
  }
  private view(job: z.infer<typeof recordSchema>) {
    const view = { review_id: job.id, created_at: job.created_at, repository: job.input.repository, base: job.input.base, head: job.input.head,
      ...this.snapshot(job.input), review_ready: false, untrusted: true, adapter: "unified_diff_text.v1" }
    const observations = this.evidence.read().observations
    const reportGaps = job.receipt ? checkReport(view, job.receipt.report, observations) : []
    const ownGaps = job.assessment ? checkReport(view, job.assessment.report, observations, Date.now(), "cmspark") : []
    return { ...view, gaps: [...new Set([...view.gaps, ...reportGaps, ...ownGaps])], receipt: job.receipt ?? null,
      assessment: job.assessment ? { origin: "cmspark_assessment" as const, report: job.assessment.report } : null }
  }
}
