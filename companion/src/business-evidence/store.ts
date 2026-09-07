import * as fs from "node:fs"
import * as path from "node:path"
import { randomUUID } from "node:crypto"
import { atomicWriteJSON } from "../io"
import { siteTargetFromBridge, type SiteTarget } from "../site-context/target"
import { evidenceDigest, evidenceScopeHash, normalizeEvidenceText, type EvidenceScope } from "./content"
import { applyPilotCoverage, validateLockedPilot, type LockedPilotContract } from "./pilot-contract"

export const EVIDENCE_LIMITS = Object.freeze({ observations: 64, contentBytes: 64 * 1024, scopeBytes: 4 * 1024 * 1024, drafts: 16 })
export interface Observation {
  schema_version: 1
  id: string
  tool_call_id: string
  tool: "get_page_text" | "get_page_html"
  observed_at: string
  target: SiteTarget
  content: string
  digest: string
  summary: string
  provenance: Record<string, unknown>
}
export interface EvidenceFile {
  schema_version: 1
  observations: Observation[]
  drafts: Record<string, unknown>[]
  locked_pilot?: LockedPilotContract
  /** Reserved on first write; false→true costs no extra serialized bytes. */
  capacity_gap: boolean
  /** Unknown schema-1 extension fields survive read-modify-write. */
  [key: string]: unknown
}

function fail(code: string): never { throw new Error(code) }

function validateFile(value: unknown): EvidenceFile {
  if (!value || typeof value !== "object") return fail("EVIDENCE_CORRUPT")
  const file = value as EvidenceFile
  if (file.schema_version !== 1) return fail("EVIDENCE_SCHEMA_UNSUPPORTED")
  if (!Array.isArray(file.observations) || !Array.isArray(file.drafts)) return fail("EVIDENCE_CORRUPT")
  if (typeof file.capacity_gap !== "boolean") return fail("EVIDENCE_CORRUPT")
  if (file.observations.length > EVIDENCE_LIMITS.observations || file.drafts.length > EVIDENCE_LIMITS.drafts) return fail("EVIDENCE_CAPACITY")
  if (file.locked_pilot !== undefined) validateLockedPilot(file.locked_pilot)
  const seen = new Set<string>()
  for (const observation of file.observations) {
    if (!observation || observation.schema_version !== 1 || typeof observation.id !== "string"
      || !observation.id || seen.has(observation.id) || typeof observation.tool_call_id !== "string"
      || !["get_page_text", "get_page_html"].includes(observation.tool)
      || typeof observation.content !== "string" || typeof observation.observed_at !== "string"
      || !Number.isFinite(Date.parse(observation.observed_at))
      || observation.content !== normalizeEvidenceText(observation.content)
      || Buffer.byteLength(observation.content, "utf8") > EVIDENCE_LIMITS.contentBytes
      || observation.digest !== evidenceDigest(observation.content)
      || !siteTargetFromBridge(observation.target)
      || !observation.provenance || typeof observation.provenance !== "object") return fail("EVIDENCE_CORRUPT")
    seen.add(observation.id)
  }
  if (file.drafts.some(draft => !draft || typeof draft !== "object" || Array.isArray(draft))) return fail("EVIDENCE_CORRUPT")
  return file
}

/** Bound to an authenticated scope by its caller. No tool receives this path.
 * Transactions contain no await: read/check/rename is one JS critical section,
 * including when two service instances address the same scope in this process.
 * The Companion process owns the store; no multi-process writer is supported. */
export class EvidenceStore {
  private readonly filePath: string
  constructor(dataDir: string, scope: EvidenceScope) {
    this.filePath = path.join(dataDir, "business-evidence-v1", `${evidenceScopeHash(scope)}.json`)
  }

  read(): EvidenceFile {
    let bytes: Buffer
    try {
      if (fs.statSync(this.filePath).size > EVIDENCE_LIMITS.scopeBytes) return fail("EVIDENCE_CAPACITY")
      bytes = fs.readFileSync(this.filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schema_version: 1, observations: [], drafts: [], capacity_gap: false }
      throw error
    }
    if (bytes.length > EVIDENCE_LIMITS.scopeBytes) return fail("EVIDENCE_CAPACITY")
    let parsed: unknown
    try { parsed = JSON.parse(bytes.toString("utf8")) } catch { return fail("EVIDENCE_CORRUPT") }
    return validateFile(parsed)
  }

  /** Internal service transaction, never a public mutation tool. */
  transaction<T>(mutate: (state: EvidenceFile) => T): T {
    const state = this.read()
    const beforeObservations = JSON.stringify(state.observations)
    const beforePilot = state.locked_pilot === undefined ? undefined : JSON.stringify(state.locked_pilot)
    const originalCount = state.observations.length
    const result = mutate(state)
    if (result && typeof (result as any).then === "function") return fail("ASYNC_EVIDENCE_MUTATION")
    // Appends are legal; rewriting/evicting an existing Observation is not.
    if (state.observations.length < originalCount
      || JSON.stringify(state.observations.slice(0, originalCount)) !== beforeObservations) return fail("OBSERVATION_IMMUTABLE")
    if (beforePilot !== undefined && JSON.stringify(state.locked_pilot) !== beforePilot) return fail("PILOT_CONTRACT_IMMUTABLE")
    validateFile(state)
    if (Buffer.byteLength(JSON.stringify(state, null, 2), "utf8") > EVIDENCE_LIMITS.scopeBytes) return fail("EVIDENCE_CAPACITY")
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 })
    atomicWriteJSON(this.filePath, state, 0o600)
    return result
  }

  /** Called only after the local browser executor has returned successfully.
   * The model cannot invoke this method or supply an Observation identity. */
  capture(toolCallId: string, tool: string, result: unknown, now = Date.now()):
    { capture_status: "captured"; observation_id: string }
    | { capture_status: "skipped"; reason: string } {
    const response = result as any
    if (!["get_page_text", "get_page_html"].includes(tool) || response?.success !== true) {
      return { capture_status: "skipped", reason: "INELIGIBLE_TOOL_RESULT" }
    }
    const metadata = response.data?.provenance
    if (metadata?.schema_version !== 1 || metadata.capture_status !== "eligible") {
      return { capture_status: "skipped", reason: ["TARGET_CHANGED", "TARGET_UNAVAILABLE"].includes(metadata?.capture_status) ? metadata.capture_status : "PROVENANCE_UNAVAILABLE" }
    }
    const target = siteTargetFromBridge(metadata.target, now)
    const rawContent = response.data?.[tool === "get_page_text" ? "text" : "html"]
    if (!target || typeof rawContent !== "string" || !toolCallId || !Number.isFinite(now)) {
      return { capture_status: "skipped", reason: "PROVENANCE_UNAVAILABLE" }
    }
    const content = normalizeEvidenceText(rawContent)
    if (Buffer.byteLength(content, "utf8") > EVIDENCE_LIMITS.contentBytes) {
      this.transaction(state => { state.capacity_gap = true })
      return { capture_status: "skipped", reason: "CAPACITY" }
    }
    // Whitelist metadata rather than copying arbitrary browser result keys.
    const scope = metadata.scope?.kind === "document" ? { kind: "document" }
      : metadata.scope?.kind === "selector" && typeof metadata.scope.selector === "string"
        ? { kind: "selector", selector: metadata.scope.selector } : undefined
    if (!scope || tool === "get_page_text" && scope.kind !== "document" || !["cdp", "isolated", "main", "dom"].includes(metadata.channel)
      || metadata.frame !== "top" || typeof metadata.truncated !== "boolean") {
      return { capture_status: "skipped", reason: "PROVENANCE_UNAVAILABLE" }
    }
    const observation: Observation = {
      schema_version: 1, id: randomUUID(), tool_call_id: toolCallId,
      tool: tool as Observation["tool"], observed_at: new Date(now).toISOString(), target,
      content, digest: evidenceDigest(content), summary: Array.from(content).slice(0, 512).join(""),
      provenance: {
        text_transform: Array.isArray(response.data?.threats_removed) ? (response.data.threats_removed.length === 0 ? "unchanged" : "sanitized") : "unknown",
        scope, channel: metadata.channel, frame: "top", truncated: metadata.truncated,
        coverage: metadata.truncated ? "partial" : "unknown", complete_for_scope: false,
        pagination: "unknown", virtualization: "unknown", iframe_coverage: "not_traversed",
      },
    }
    try {
      this.transaction(state => { state.observations.push(applyPilotCoverage(observation, state.locked_pilot)) })
      return { capture_status: "captured", observation_id: observation.id }
    } catch (error) {
      if ((error as Error).message === "EVIDENCE_CAPACITY") {
        this.transaction(state => { state.capacity_gap = true })
        return { capture_status: "skipped", reason: "CAPACITY" }
      }
      throw error
    }
  }
}
