import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import { atomicWriteJSON } from "../io"
import { evidenceScopeHash, evidenceDigest, canonicalRequest, type EvidenceScope } from "../business-evidence/content"
import { CodeReviewService } from "./service"
import { LOCAL_LIMITS, localRunSchema, localScanSchema, localAgentReportSchema, localJobIdSchema, type LocalRun } from "./local-contract"
import { downloadArtifact } from "./local-download"
import { assertAuthorizedReviewAgent, runLocalAgentReview } from "./local-agent"
import { buildAgentCapsule, scanArtifacts } from "./local-scan"

const statusSchema = z.enum(["queued", "running", "completed", "failed", "cancelled", "timed_out", "interrupted"])
const jobSchema = z.object({
  schema_version: z.literal(1), job_id: z.string().uuid(), scope_hash: z.string().regex(/^[a-f0-9]{64}$/),
  created_at: z.string().datetime(), updated_at: z.string().datetime(), input: localRunSchema,
  input_digest: z.string().regex(/^[a-f0-9]{64}$/), status: statusSchema,
  agent_config_digest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  agent_result: z.object({ session_id: z.string(), agent_id: z.string(), destination: z.string(), report: localAgentReportSchema }).strict().optional(),
  result: localScanSchema.optional(), error: z.string().regex(/^[A-Z][A-Z0-9_]+$/).optional(),
}).strict()
type Job = z.infer<typeof jobSchema>
type Work = { scope: EvidenceScope; id: string; abort: AbortController; timer: NodeJS.Timeout }
export type LocalJobDeps = { download?: typeof downloadArtifact; scan?: typeof scanArtifacts; timeoutMs?: number }
const terminal = (status: Job["status"]) => !["queued", "running"].includes(status)

/** One owner per dataDir/process. Result lifetime is independent of a socket;
 * approvals authorize this immutable job, never another URL or resubmission.
 * On process restart, unfinished jobs become interrupted, not auto-replayed. */
export class LocalReviewJobs {
  private readonly recovered = new Set<string>()
  private readonly pending: Work[] = []
  private readonly work = new Map<string, Work>()
  private running = 0
  constructor(private readonly dataDir: string, private readonly deps: LocalJobDeps = {}) {}
  private scopeDir(scope: EvidenceScope) {
    if (scope.kind !== "chat") throw new Error("CODE_REVIEW_CHAT_SCOPE_REQUIRED")
    return path.join(this.dataDir, "local-review-v1", evidenceScopeHash(scope))
  }
  private file(scope: EvidenceScope, id: string) {
    localJobIdSchema.parse({ job_id: id })
    return path.join(this.scopeDir(scope), `${id}.json`)
  }
  private load(scope: EvidenceScope, id: string): Job {
    const file = this.file(scope, id)
    try {
      if (fs.statSync(file).size > 8 * 1024 * 1024) throw new Error("LOCAL_REVIEW_STORE_LIMIT")
      const job = jobSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")))
      if (job.scope_hash !== evidenceScopeHash(scope) || job.job_id !== id
        || job.input_digest !== evidenceDigest(canonicalRequest(job.input))) throw new Error("LOCAL_REVIEW_CORRUPT")
      return job
    } catch (error: any) {
      if (error?.code === "ENOENT") throw new Error("LOCAL_REVIEW_NOT_FOUND")
      throw new Error("LOCAL_REVIEW_CORRUPT")
    }
  }
  private save(scope: EvidenceScope, job: Job) {
    job.updated_at = new Date().toISOString()
    if (Buffer.byteLength(JSON.stringify(job)) > 8 * 1024 * 1024) throw new Error("LOCAL_REVIEW_STORE_LIMIT")
    const file = this.file(scope, job.job_id)
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    atomicWriteJSON(file, job)
  }
  private ids(scope: EvidenceScope): string[] {
    try { return fs.readdirSync(this.scopeDir(scope)).filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).map(name => name.slice(0, -5)) }
    catch (error: any) { if (error?.code === "ENOENT") return []; throw error }
  }
  private recover(scope: EvidenceScope) {
    const hash = evidenceScopeHash(scope)
    if (this.recovered.has(hash)) return
    for (const id of this.ids(scope)) {
      const job = this.load(scope, id)
      if (!terminal(job.status)) { job.status = "interrupted"; job.error = "COMPANION_RESTARTED_NO_AUTOMATIC_REPLAY"; this.save(scope, job) }
    }
    this.recovered.add(hash)
  }
  private view(job: Job) {
    // Signed download query strings never need to be echoed in tool results.
    return { job_id: job.job_id, review_id: job.input.review_id, request_id: job.input.request_id,
      created_at: job.created_at, updated_at: job.updated_at, status: job.status,
      artifacts: job.input.artifacts.map(a => ({ role: a.role, sha256: a.sha256 })),
      agent_id: job.input.agent_id ?? null, agent_result: job.agent_result ?? null,
      result: job.result ?? null, error: job.error ?? null, untrusted: true, review_ready: false }
  }
  submit(scope: EvidenceScope, raw: unknown) {
    const input = localRunSchema.parse(raw)
    new CodeReviewService(this.dataDir, scope).read({ review_id: input.review_id })
    this.recover(scope)
    const digest = evidenceDigest(canonicalRequest(input)), ids = this.ids(scope)
    for (const id of ids) {
      const job = this.load(scope, id)
      if (job.input.request_id !== input.request_id) continue
      if (job.input_digest !== digest) throw new Error("LOCAL_REVIEW_REQUEST_CONFLICT")
      return this.view(job)
    }
    if (ids.length >= LOCAL_LIMITS.jobsPerScope || this.pending.length >= LOCAL_LIMITS.queued) throw new Error("LOCAL_REVIEW_CAPACITY")
    const agentDigest = input.agent_id ? assertAuthorizedReviewAgent(input.agent_id) : undefined
    const now = new Date().toISOString()
    const job: Job = { schema_version: 1, job_id: randomUUID(), scope_hash: evidenceScopeHash(scope),
      created_at: now, updated_at: now, input, input_digest: digest, status: "queued" }
    if (agentDigest) job.agent_config_digest = agentDigest
    this.save(scope, job)
    const work: Work = { scope, id: job.job_id, abort: new AbortController(), timer: setTimeout(() => {
      try { this.stop(scope, job.job_id, "timed_out") } catch { this.work.get(job.job_id)?.abort.abort() }
    }, this.deps.timeoutMs ?? LOCAL_LIMITS.timeoutMs) }
    work.timer.unref()
    this.work.set(job.job_id, work); this.pending.push(work)
    // Return the durable id before download/scanning, freeing the chat tool
    // turn and its socket. Consumers can poll after reconnect via this id.
    setImmediate(() => this.pump())
    return this.view(job)
  }
  read(scope: EvidenceScope, raw: unknown) {
    const { job_id } = localJobIdSchema.parse(raw)
    this.recover(scope)
    return this.view(this.load(scope, job_id))
  }
  list(scope: EvidenceScope) {
    this.recover(scope)
    return this.ids(scope).map(id => {
      const { result: _result, agent_result: _agent, ...summary } = this.view(this.load(scope, id))
      return summary
    })
  }
  cancel(scope: EvidenceScope, raw: unknown) {
    const { job_id } = localJobIdSchema.parse(raw)
    this.recover(scope); this.stop(scope, job_id, "cancelled")
    return this.view(this.load(scope, job_id))
  }
  private stop(scope: EvidenceScope, id: string, status: "cancelled" | "timed_out") {
    const job = this.load(scope, id)
    if (terminal(job.status)) return
    const work = this.work.get(id)
    // Commit terminal state before abort callbacks; late results cannot win.
    job.status = status; job.error = status === "cancelled" ? "LOCAL_REVIEW_CANCELLED" : "LOCAL_REVIEW_TIMEOUT"
    this.save(scope, job)
    if (work) { clearTimeout(work.timer); work.abort.abort(); this.work.delete(id) }
    const queued = this.pending.findIndex(item => item.id === id)
    if (queued >= 0) this.pending.splice(queued, 1)
    this.pump()
  }
  private pump() {
    while (this.running < LOCAL_LIMITS.concurrent && this.pending.length) {
      const work = this.pending.shift()!
      if (work.abort.signal.aborted) continue
      this.running++
      void this.run(work).catch(() => { /* persistence failure is not an unhandled rejection */ }).finally(() => {
        clearTimeout(work.timer); this.work.delete(work.id); this.running--; this.pump()
      })
    }
  }
  private async run(work: Work) {
    const { scope, id, abort } = work
    try {
      const job = this.load(scope, id)
      if (terminal(job.status)) return
      if (job.input.agent_id && assertAuthorizedReviewAgent(job.input.agent_id) !== job.agent_config_digest) throw new Error("LOCAL_REVIEW_AGENT_CONFIG_CHANGED")
      job.status = "running"; this.save(scope, job)
      const artifacts: Array<LocalRun["artifacts"][number] & { bytes: Buffer }> = []
      for (const artifact of job.input.artifacts) {
        abort.signal.throwIfAborted()
        const bytes = await (this.deps.download || downloadArtifact)(artifact.url, artifact.sha256, abort.signal)
        artifacts.push({ ...artifact, bytes })
      }
      const capsule = job.input.agent_id ? await buildAgentCapsule(artifacts, abort.signal) : null
      const result = localScanSchema.parse(capsule?.result || await (this.deps.scan || scanArtifacts)(artifacts, abort.signal))
      abort.signal.throwIfAborted()
      let current = this.load(scope, id)
      if (terminal(current.status)) return
      current.result = result; this.save(scope, current)
      if (job.input.agent_id && capsule) {
        if (assertAuthorizedReviewAgent(job.input.agent_id) !== job.agent_config_digest) throw new Error("LOCAL_REVIEW_AGENT_CONFIG_CHANGED")
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-review-agent-"))
        const agentResult = await runLocalAgentReview({ agentId: job.input.agent_id, threadId: scope.kind === "chat" ? scope.threadId : "",
          jobId: id, inputDigest: job.input_digest, workspace, scan: result, sources: capsule.sources, signal: abort.signal })
        abort.signal.throwIfAborted()
        current = this.load(scope, id)
        if (terminal(current.status)) return
        current.agent_result = agentResult
      }
      current.status = "completed"; this.save(scope, current)
    } catch (error: any) {
      const current = this.load(scope, id)
      if (terminal(current.status)) return
      current.status = "failed"
      current.error = /^[A-Z][A-Z0-9_]+$/.test(error?.message || "") ? error.message : "LOCAL_REVIEW_FAILED"
      this.save(scope, current)
    }
  }
}
const managers = new Map<string, LocalReviewJobs>()
export function getLocalReviewJobs(dataDir: string): LocalReviewJobs {
  const key = path.resolve(dataDir)
  let manager = managers.get(key)
  if (!manager) { manager = new LocalReviewJobs(key); managers.set(key, manager) }
  return manager
}
