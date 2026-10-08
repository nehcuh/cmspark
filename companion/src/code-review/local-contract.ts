import { z } from "zod"
import { reviewAgentPolicy } from "./local-agent-policy"
import { canonicalRequest, evidenceDigest } from "../business-evidence/content"

export const LOCAL_LIMITS = {
  downloadBytes: 20 * 1024 * 1024, expandedBytes: 64 * 1024 * 1024,
  entryBytes: 2 * 1024 * 1024, entries: 2000, findings: 128,
  concurrent: 2, queued: 8, jobsPerScope: 16, timeoutMs: 120_000,
} as const
export const localRunSchema = z.object({
  review_id: z.string().uuid(), request_id: z.string().trim().min(1).max(128),
  agent_id: z.string().min(1).max(128).optional(),
  artifacts: z.array(z.object({
    role: z.enum(["base", "head", "artifact"]),
    url: z.string().url().max(8192).refine(value => {
      const u = new URL(value)
      return u.protocol === "https:" && !u.username && !u.password && !u.hash && (!u.port || u.port === "443")
    }, "Direct public HTTPS URL required"),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    strip_prefix: z.string().max(512).default("").refine(value => !value ||
      /^(?:[A-Za-z0-9_.-]+\/)+$/.test(value) && !value.split("/").includes("..")),
  }).strict()).min(2).max(4),
}).strict().refine(value => value.artifacts.filter(a => a.role === "base").length === 1
  && value.artifacts.filter(a => a.role === "head").length === 1, "Exactly one base and one head ZIP required")
export type LocalRun = z.infer<typeof localRunSchema>
export const localJobIdSchema = z.object({ job_id: z.string().uuid() }).strict()
export function localRunInput(params: Record<string, unknown>): LocalRun {
  const { security_token: _token, __thread_id: _thread, __local_review_agent_digest: _digest, tabId: _tab, ...input } = params
  return localRunSchema.parse(input)
}
/** Full normalized input and server-owned thread binding; no preview truncation. */
export function localReviewBinding(params: Record<string, unknown>): string {
  const input = localRunInput(params)
  const agent = input.agent_id ? reviewAgentPolicy(input.agent_id).digest : "static-only"
  if (params.__local_review_agent_digest && params.__local_review_agent_digest !== agent) throw new Error("LOCAL_REVIEW_AGENT_CONFIG_CHANGED")
  return `code_review_run|${String(params.__thread_id || "")}|${agent}|${evidenceDigest(canonicalRequest(input))}`
}

export const localScanSchema = z.object({
  scanner: z.literal("local-static.v1"),
  artifacts: z.array(z.object({ role: z.enum(["base", "head", "artifact"]), sha256: z.string(),
    entries: z.number(), scanned: z.number(), omitted: z.array(z.object({ path: z.string(), reason: z.string() })),
  })),
  changes: z.array(z.object({ path: z.string(), kind: z.enum(["added", "modified", "deleted"]),
    base_hash: z.string().nullable(), head_hash: z.string().nullable(), inspected: z.boolean(),
  })),
  findings: z.array(z.object({ role: z.enum(["base", "head", "artifact"]), path: z.string(), line: z.number(),
    rule: z.string(), severity: z.enum(["major", "minor"]), summary: z.string(),
    file_hash: z.string(), line_hash: z.string(), introduced: z.boolean(),
  })),
  gaps: z.array(z.string()),
}).strict()
export type LocalScan = z.infer<typeof localScanSchema>

export const localAgentReportSchema = z.object({
  job_id: z.string().uuid(), input_digest: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["completed", "partial"]), summary: z.string().min(1).max(8192),
  reviewed_files: z.array(z.string().min(1).max(512)).max(128),
  findings: z.array(z.object({ path: z.string().min(1).max(512), line: z.number().int().positive(),
    severity: z.enum(["major", "minor", "info"]), summary: z.string().min(1).max(4096),
  }).strict()).max(128), gaps: z.array(z.string().max(512)).max(128),
}).strict()
export type LocalAgentReport = z.infer<typeof localAgentReportSchema>
