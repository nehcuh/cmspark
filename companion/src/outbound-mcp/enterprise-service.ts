import { randomUUID, verify } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getConfigDir } from "../config"
import { atomicWriteJSON } from "../io"
import { appendCapabilityAudit } from "../packs/audit-log"
import { requireEnterpriseGrant } from "./outbound-grants"
import { canonicalJSON, canonicalURL, deny, digest, EnterpriseError, identifier, inScope, object, string, type EnterprisePolicy, type EnterpriseAction } from "./enterprise-policy"
import { mintEnterprisePermit } from "./enterprise-permit"
import { gateOutboundTabLease, outboundHolderThreadId } from "./dual-entry"
import { getTabLease } from "../orchestrator/tab-lease"
import type { OutboundToolRunner } from "./companion-http"

type Peer = { peer: object; epoch: string }
type Snapshot = { tab_id: number; url: string; document_id: string; generation: number; frames: { id: number; document_id: string; url: string }[]; state: string; last_business_url?: string; business_target_unavailable?: boolean; target?: Record<string, unknown> }
type Binding = { grant_id: string; subject: string; change_id: string; instance_id: string; profile_id: string; revision: string; policy_digest: string; peer_epoch: string; expires_at: string }
type Challenge = Binding & { purpose: "approval" | "login_view"; session: string; operation?: string; operation_digest?: string; nonce: string }
type Session = Binding & { handle: string; request_key: string; request_digest: string; state: string; tab_id?: number; presentation: Challenge }
type Operation = { handle: string; session: string; request_key: string; request_digest: string; tool: string; state: string; execute_requested: boolean; effect: "read_only" | "write"; operation_digest?: string; challenge?: Challenge; error_code?: string; approval_used?: string }
type Store = { version: 1; sessions: Session[]; operations: Operation[] }
type Args = Record<string, unknown>
const SESSION_STATES = ["opening", "ready", "login_required", "blocked", "unsupported", "terminated", "outcome_unknown"]
const OP_STATES = ["prepared", "waiting_login", "waiting_human", "executing", "completed", "cancelled", "failed", "outcome_unknown", "terminated"]
const TERMINAL = new Set(["completed", "cancelled", "failed", "outcome_unknown", "terminated"])
export type EnterpriseDependencies = { peer: () => Peer; runner: () => OutboundToolRunner | null; path?: string; monitor?: boolean }

/** Durable claims and idempotency only. Browser text, pictures, URLs, selectors,
 * typed values and private frame snapshots are deliberately process-memory data. */
export class EnterpriseBrowserService {
  private store: Store = { version: 1, sessions: [], operations: [] }
  private args = new Map<string, Args>()
  private snapshots = new Map<string, Snapshot>()
  private outputs = new Map<string, unknown>()
  private outputBytes = new Map<string, number>()
  private queues = new Map<string, Promise<unknown>>()
  private controllers = new Map<string, AbortController>()
  private destinations = new Map<string, string>()
  private operationDestinations = new Map<string, string>()
  private restoredTargets = new Set<string>()
  private scheduled = new Set<string>()
  private timer?: ReturnType<typeof setInterval>
  private healthy = true
  private readonly path: string
  constructor(private readonly deps: EnterpriseDependencies) {
    this.path = deps.path || join(getConfigDir(), "enterprise-browser-state.json")
    if (existsSync(this.path)) {
      try {
        const text = readFileSync(this.path, "utf8")
        if (Buffer.byteLength(text) > 2 * 1024 * 1024) deny("STATE_CORRUPT", 503)
        const raw = object(JSON.parse(text), ["version", "sessions", "operations"])
        if (raw.version !== 1 || !Array.isArray(raw.sessions) || !Array.isArray(raw.operations) || raw.sessions.length > 128 || raw.operations.length > 1024) deny("STATE_CORRUPT", 503)
        for (const value of raw.sessions) {
          const session = value as Session
          identifier(session.handle); identifier(session.grant_id); identifier(session.subject); identifier(session.change_id); identifier(session.instance_id); identifier(session.profile_id); identifier(session.revision); identifier(session.peer_epoch)
          identifier(session.request_key)
          if (!SESSION_STATES.includes(session.state) || !/^[a-f0-9]{64}$/.test(session.policy_digest) || !/^[a-f0-9]{64}$/.test(session.request_digest) || !Number.isFinite(Date.parse(session.expires_at))) deny("STATE_CORRUPT", 503)
          session.state = session.state === "opening" ? "outcome_unknown" : "terminated"
        }
        for (const value of raw.operations) {
          const op = value as Operation
          identifier(op.handle); identifier(op.session); identifier(op.request_key)
          if (!OP_STATES.includes(op.state) || !raw.sessions.some(s => s.handle === op.session) || !/^[a-f0-9]{64}$/.test(op.request_digest)) deny("STATE_CORRUPT", 503)
          if (!TERMINAL.has(op.state)) { op.state = op.state === "executing" ? "outcome_unknown" : "terminated"; op.error_code = "SERVICE_RESTARTED" }
        }
        if (new Set(raw.sessions.map(s => s.handle)).size !== raw.sessions.length || new Set(raw.operations.map(o => o.handle)).size !== raw.operations.length) deny("STATE_CORRUPT", 503)
        this.store = raw as Store
        this.save()
      } catch { this.healthy = false }
    }
    if (deps.monitor !== false) { this.timer = setInterval(() => { void this.tick() }, 2000); this.timer.unref() }
  }
  close(): void { if (this.timer) clearInterval(this.timer); for (const controller of this.controllers.values()) controller.abort() }
  private save(): void {
    if (!this.healthy) deny("STATE_CORRUPT", 503)
    try { atomicWriteJSON(this.path, this.store, 0o600) } catch { this.healthy = false; deny("STATE_UNWRITABLE", 503) }
  }
  private authority(grantId: string, subject: string) {
    if (!this.healthy) deny("STATE_CORRUPT", 503)
    const result = requireEnterpriseGrant(grantId)
    if (result.policy.subject !== subject) deny("SUBJECT_MISMATCH")
    return result
  }
  private bound(grantId: string, subject: string, handle: string, requirePeer = true): { session: Session; policy: EnterprisePolicy; peer?: Peer } {
    const { policy } = this.authority(grantId, subject)
    const session = this.store.sessions.find(s => s.handle === handle && s.grant_id === grantId && s.subject === subject)
    if (!session) deny("SESSION_UNAVAILABLE", 404)
    if (digest(policy) !== session.policy_digest || Date.parse(session.expires_at) <= Date.now()) deny("SESSION_AUTHORITY_CHANGED")
    if (requirePeer) {
      if (["terminated", "outcome_unknown"].includes(session.state)) deny("SESSION_TERMINATED", 409)
      const peer = this.deps.peer()
      if (peer.epoch !== session.peer_epoch) deny("ENTERPRISE_PEER_CHANGED", 409)
      return { session, policy, peer }
    }
    return { session, policy }
  }
  private challenge(session: Session, purpose: Challenge["purpose"], operation?: Operation): Challenge {
    return { grant_id: session.grant_id, subject: session.subject, change_id: session.change_id, instance_id: session.instance_id, profile_id: session.profile_id, revision: session.revision, policy_digest: session.policy_digest, peer_epoch: session.peer_epoch,
      expires_at: new Date(Math.min(Date.parse(session.expires_at), Date.now() + 120_000)).toISOString(), purpose, session: session.handle, nonce: randomUUID(),
      ...(operation ? { operation: operation.handle, operation_digest: operation.operation_digest! } : {}) }
  }
  private validateProof(value: unknown, expected: Challenge, policy: EnterprisePolicy, decision?: "approve" | "deny"): string {
    const proof = object(value, ["payload", "signature"])
    const payload = object(proof.payload, [...Object.keys(expected), ...(decision ? ["decision"] : [])])
    if (canonicalJSON(payload) !== canonicalJSON({ ...expected, ...(decision ? { decision } : {}) }) || Date.parse(expected.expires_at) <= Date.now()) deny("HUMAN_PROOF_INVALID")
    const signature = string(proof.signature, 128)
    if (!/^[A-Za-z0-9_-]{86}$/.test(signature)) deny("HUMAN_PROOF_INVALID")
    if (!verify(null, Buffer.from(canonicalJSON(payload)), policy.authority_public_key, Buffer.from(signature, "base64url"))) deny("HUMAN_PROOF_INVALID")
    return digest(payload)
  }
  private audit(session: Session, operation: Operation | undefined, mode: string, code?: string): void {
    appendCapabilityAudit({ type: "enterprise_browser.operation", at: new Date().toISOString(), grant_id: session.grant_id, subject: session.subject, change_id: session.change_id, instance_id: session.instance_id, revision: session.revision,
      session: session.handle, operation: operation?.handle, tool: operation?.tool, operation_digest: operation?.operation_digest, mode, error_code: code } as any)
  }
  private guard(policy: EnterprisePolicy, mode: string, expires_at: string, expected?: Snapshot, rule?: EnterpriseAction): Record<string, unknown> {
    return { version: 1, profile_id: policy.profile_id, mode, expires_at, policy: { navigation: policy.navigation, evidence: policy.evidence, login: policy.login, ready: policy.ready, login_markers: policy.login_markers },
      ...(expected ? { expected } : {}), ...(rule ? { rule } : {}) }
  }
  private async invoke(session: Session, policy: EnterprisePolicy, peer: Peer, tool: string, args: Args, mode: string, expected?: Snapshot, rule?: EnterpriseAction, signal?: AbortSignal, approvalDeadline?: string): Promise<any> {
    const recheck = () => {
      const live = this.bound(session.grant_id, session.subject, session.handle)
      if (live.peer!.peer !== peer.peer || signal?.aborted) deny("EXECUTION_CANCELLED", 409)
      if (typeof args.tabId === "number" && tool !== "list_tabs") {
        const holder = outboundHolderThreadId(session.grant_id + ":" + session.handle)
        if (getTabLease(args.tabId)?.holderThreadId !== holder) deny("TAB_LEASE_LOST", 409)
      }
    }
    if (typeof args.tabId === "number" && tool !== "list_tabs") {
      const lease = gateOutboundTabLease(tool, args, session.grant_id + ":" + session.handle)
      if (!lease.ok) deny(lease.error_code, 409)
    }
    const runner = this.deps.runner()
    if (!runner) deny("EXTENSION_UNAVAILABLE", 503)
    const expires_at = new Date(Math.min(Date.parse(session.expires_at), Date.now() + 30_000, approvalDeadline ? Date.parse(approvalDeadline) : Infinity)).toISOString()
    const permit = mintEnterprisePermit(tool, args, this.guard(policy, mode, expires_at, expected, rule), peer.peer, peer.epoch, recheck)
    const result = await runner(randomUUID(), tool, { ...args, __outbound_mcp: true, __outbound_caller_id: session.grant_id, __thread_id: outboundHolderThreadId(session.grant_id + ":" + session.handle) }, { enterprisePermit: permit, signal })
    recheck()
    if (!result.success) {
      const code = typeof result.error === "string" && /^[A-Z_]{3,80}$/.test(result.error) ? result.error : "ENTERPRISE_EXECUTION_UNAVAILABLE"
      deny(code, 409)
    }
    return result.data
  }
  private async inspect(session: Session, policy: EnterprisePolicy, peer: Peer, rule?: EnterpriseAction): Promise<Snapshot> {
    if (session.tab_id === undefined) deny("SESSION_OPENING", 409)
    const raw = await this.invoke(session, policy, peer, "list_tabs", { tabId: session.tab_id }, "inspect", undefined, rule)
    if (!raw || raw.tab_id !== session.tab_id || typeof raw.url !== "string" || typeof raw.document_id !== "string" || !Array.isArray(raw.frames) || typeof raw.generation !== "number") deny("ENTERPRISE_BRIDGE_INCOMPATIBLE", 409)
    const snapshot = raw as Snapshot
    if (!Number.isSafeInteger(snapshot.generation) || snapshot.generation < 0 || snapshot.frames.length > 128 || Buffer.byteLength(canonicalJSON(snapshot)) > 64 * 1024) deny("BROWSER_METADATA_BUDGET", 409)
    if (snapshot.state === "ready" && inScope(canonicalURL(snapshot.url), policy.navigation)) this.destinations.set(session.handle, canonicalURL(snapshot.url).href)
    else if (snapshot.business_target_unavailable === true) this.destinations.delete(session.handle)
    else if (snapshot.state === "login_required" && snapshot.last_business_url !== undefined) {
      const destination = canonicalURL(snapshot.last_business_url)
      if (!inScope(destination, policy.navigation)) deny("RETURN_TARGET_FORBIDDEN", 409)
      this.destinations.set(session.handle, destination.href)
    }
    if (snapshot.state === "login_required") session.state = "login_required"
    else if (snapshot.state === "ready") session.state = "ready"
    else if (snapshot.state === "blocked") session.state = "blocked"
    else session.state = "unsupported"
    this.save()
    return snapshot
  }
  private queue<T>(handle: string, action: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(handle) || Promise.resolve()
    const current = previous.catch(() => {}).then(action)
    this.queues.set(handle, current)
    void current.finally(() => { if (this.queues.get(handle) === current) this.queues.delete(handle) }).catch(() => {})
    return current
  }
  private schedule(op: Operation): Promise<void> {
    if (this.scheduled.has(op.handle)) return Promise.resolve()
    this.scheduled.add(op.handle)
    return this.queue(op.session, () => this.run(op)).finally(() => { this.scheduled.delete(op.handle) })
  }
  private publicSession(session: Session): unknown {
    return { session_handle: session.handle, state: session.state, subject: session.subject, change_id: session.change_id, instance_id: session.instance_id, profile_id: session.profile_id, revision: session.revision, expires_at: session.expires_at,
      ...(session.state === "login_required" ? { presentation_challenge: session.presentation } : {}) }
  }
  private publicOperation(operation: Operation): unknown {
    return { operation_handle: operation.handle, session_handle: operation.session, state: operation.state, tool: operation.tool, effect: operation.effect,
      ...(operation.challenge && operation.state === "waiting_human" ? { challenge: operation.challenge, review: { tool: operation.tool, effect: operation.effect, parameters: this.args.get(operation.handle), operation_digest: operation.operation_digest } } : {}), ...(operation.error_code ? { error_code: operation.error_code } : {}),
      ...(operation.state === "completed" ? (this.outputs.has(operation.handle) ? { data: this.outputs.get(operation.handle) } : { data_not_retained: true }) : {}) }
  }
  capabilities(grantId: string, subject: string): unknown {
    const { policy } = this.authority(grantId, subject)
    return { contract_version: 1, tools: policy.tools, subject: policy.subject, instance_id: policy.instance_id, profile_id: policy.profile_id, revision: policy.revision,
      login: { main_frame_redirect: true, same_origin_markers: true, iframe: false, popup: false }, approval: "ed25519-canonical-json-v1", restart: "terminate-pending-no-replay", workbook_export: false }
  }
  async open(grantId: string, value: unknown): Promise<unknown> {
    const body = object(value, ["subject", "change_id", "request_key", "url"]), subject = identifier(body.subject), change_id = identifier(body.change_id), request_key = identifier(body.request_key), url = canonicalURL(body.url)
    const { grant, policy } = this.authority(grantId, subject)
    if (!policy.tools.includes("create_tab") || !inScope(url, policy.navigation)) deny("NAVIGATION_FORBIDDEN")
    const request_digest = digest({ subject, change_id, url: url.href })
    const existing = this.store.sessions.find(s => s.grant_id === grantId && s.request_key === request_key)
    if (existing) { if (existing.request_digest !== request_digest) deny("IDEMPOTENCY_CONFLICT", 409); this.bound(grantId, subject, existing.handle, false); return this.publicSession(existing) }
    if (this.store.sessions.length >= 128) deny("CAPACITY", 429)
    const peer = this.deps.peer()
    const session = { handle: randomUUID(), request_key, request_digest, state: "opening", grant_id: grantId, subject, change_id, instance_id: policy.instance_id, profile_id: policy.profile_id, revision: policy.revision,
      policy_digest: digest(policy), peer_epoch: peer.epoch, expires_at: new Date(Math.min(Date.parse(policy.expires_at), Date.parse(grant.expires_at!), Date.now() + 8 * 3600_000)).toISOString() } as Session
    session.presentation = this.challenge(session, "login_view")
    this.destinations.set(session.handle, url.href)
    this.store.sessions.push(session); this.save()
    try {
      const probe = await this.invoke(session, policy, peer, "list_tabs", {}, "probe")
      if (probe?.enterprise_contract !== 1 || probe.profile_id !== policy.profile_id) deny("ENTERPRISE_BRIDGE_INCOMPATIBLE", 409)
      const opened = await this.invoke(session, policy, peer, "create_tab", { url: url.href }, "open")
      if (!Number.isSafeInteger(opened?.tab_id) || opened.tab_id < 0) deny("ENTERPRISE_BRIDGE_INCOMPATIBLE", 409)
      session.tab_id = opened.tab_id; session.state = "unsupported"; this.save()
      this.audit(session, undefined, "policy_auto")
      // Loading is asynchronous. Status polling/monitor detects readiness.
    } catch (error) { session.state = "outcome_unknown"; this.save(); throw error }
    return this.publicSession(session)
  }
  async status(grantId: string, subject: string, handle: string): Promise<unknown> {
    const initial = this.bound(grantId, subject, handle, false)
    if (!["terminated", "outcome_unknown", "opening"].includes(initial.session.state)) await this.queue(handle, async () => {
      const { session, policy, peer } = this.bound(grantId, subject, handle)
      await this.inspect(session, policy, peer!)
      if (Date.parse(session.presentation.expires_at) <= Date.now()) { session.presentation = this.challenge(session, "login_view"); this.save() }
    })
    return this.publicSession(initial.session)
  }
  private parseArgs(tool: string, value: unknown, policy: EnterprisePolicy): { args: Args; rule?: EnterpriseAction; effect: Operation["effect"] } {
    if (!policy.tools.includes(tool) || tool === "create_tab") deny("ENTERPRISE_TOOL_FORBIDDEN")
    const args = object(value, tool === "navigate" ? ["url"] : ["click", "type"].includes(tool) ? ["rule_id", ...(tool === "type" ? ["text"] : [])] : tool === "scroll" ? ["delta"] : [])
    if (tool === "navigate") { const url = canonicalURL(args.url); if (!inScope(url, policy.navigation)) deny("NAVIGATION_FORBIDDEN"); return { args: { url: url.href }, effect: "read_only" } }
    if (tool === "scroll") { if (!Number.isSafeInteger(args.delta) || Math.abs(Number(args.delta)) > 2000 || !args.delta) deny("INVALID_INPUT", 400); return { args: { delta: args.delta }, effect: "read_only" } }
    if (["click", "type"].includes(tool)) {
      const rule = policy.actions.find(rule => rule.id === identifier(args.rule_id) && rule.tool === tool)
      if (!rule) deny("ACTION_RULE_FORBIDDEN")
      return { args: tool === "type" ? { text: string(args.text, rule.max_length || 4096) } : {}, rule, effect: rule.effect }
    }
    if (!["get_page_text", "screenshot"].includes(tool)) deny("ENTERPRISE_TOOL_FORBIDDEN")
    return { args: {}, effect: "read_only" }
  }
  async prepare(grantId: string, value: unknown): Promise<unknown> {
    const body = object(value, ["subject", "session_handle", "request_key", "tool", "args"]), subject = identifier(body.subject), handle = identifier(body.session_handle), request_key = identifier(body.request_key), tool = identifier(body.tool)
    return this.queue(handle, async () => {
      const { session, policy, peer } = this.bound(grantId, subject, handle)
      const parsed = this.parseArgs(tool, body.args, policy), request_digest = digest({ tool, args: parsed.args, rule: parsed.rule || null })
      const existing = this.store.operations.find(op => op.session === handle && op.request_key === request_key)
      if (existing) { if (existing.request_digest !== request_digest) deny("IDEMPOTENCY_CONFLICT", 409); return this.publicOperation(existing) }
      if (this.store.operations.length >= 1024) deny("CAPACITY", 429)
      const snapshot = await this.inspect(session, policy, peer!, parsed.rule)
      const navigation = tool === "navigate" && inScope(canonicalURL(snapshot.url), [...policy.navigation, ...policy.login])
      if (!navigation && !["ready", "login_required"].includes(snapshot.state)) deny(snapshot.state === "blocked" ? "NAVIGATION_FORBIDDEN" : "SITE_OR_TARGET_UNSUPPORTED", 409)
      if (["get_page_text", "screenshot"].includes(tool) && snapshot.state === "ready" && !inScope(canonicalURL(snapshot.url), policy.evidence)) deny("EVIDENCE_FORBIDDEN")
      const destination = snapshot.state === "ready" ? canonicalURL(snapshot.url).href : this.destinations.get(session.handle)
      if (snapshot.state === "login_required" && !destination && !navigation) deny("RETURN_TARGET_NOT_RETAINED", 409)
      const op: Operation = { handle: randomUUID(), session: handle, request_key, request_digest, tool, state: !navigation && snapshot.state === "login_required" ? "waiting_login" : "prepared", effect: parsed.effect, execute_requested: false }
      this.args.set(op.handle, { ...parsed.args, ...(parsed.rule ? { rule_id: parsed.rule.id } : {}) }); this.snapshots.set(op.handle, snapshot)
      if (destination) this.operationDestinations.set(op.handle, destination)
      this.store.operations.push(op)
      if (snapshot.state === "ready" || navigation) this.bindOperation(session, op, snapshot)
      this.save(); return this.publicOperation(op)
    })
  }
  private bindOperation(session: Session, op: Operation, snapshot: Snapshot): void {
    delete op.error_code
    op.operation_digest = digest({ grant_id: session.grant_id, subject: session.subject, session: session.handle, policy: session.policy_digest, request: op.request_digest, snapshot })
    this.snapshots.set(op.handle, snapshot)
    if (op.effect === "write") { op.state = "waiting_human"; op.challenge = this.challenge(session, "approval", op) }
    else op.state = "prepared"
  }
  private findOperation(grantId: string, subject: string, handle: string, requirePeer = true) {
    const op = this.store.operations.find(o => o.handle === handle)
    if (!op) deny("OPERATION_UNAVAILABLE", 404)
    const bound = this.bound(grantId, subject, op.session, requirePeer)
    return { op, ...bound }
  }
  operationStatus(grantId: string, subject: string, handle: string): unknown {
    const { op, session } = this.findOperation(grantId, subject, handle, false)
    if (!["terminated", "outcome_unknown"].includes(session.state)) this.bound(grantId, subject, session.handle)
    return this.publicOperation(op)
  }
  execute(grantId: string, value: unknown): unknown {
    const body = object(value, ["subject", "operation_handle", "human_proof"]), subject = identifier(body.subject), handle = identifier(body.operation_handle)
    const { op, session, policy } = this.findOperation(grantId, subject, handle)
    if (TERMINAL.has(op.state) || op.state === "executing") {
      if (body.human_proof !== undefined) deny("APPROVAL_ALREADY_CONSUMED", 409)
      return this.publicOperation(op)
    }
    if (op.effect === "write" && op.state !== "waiting_login") {
      if (op.approval_used) deny("APPROVAL_ALREADY_CONSUMED", 409)
      if (!op.challenge || op.state !== "waiting_human") deny("APPROVAL_REQUIRED", 409)
      const proof = object(body.human_proof, ["payload", "signature"])
      const decision = (proof.payload as any)?.decision
      if (!["approve", "deny"].includes(decision)) deny("HUMAN_PROOF_INVALID")
      op.approval_used = this.validateProof(proof, op.challenge, policy, decision)
      if (decision === "deny") { op.state = "cancelled"; op.error_code = "HUMAN_DENIED"; this.audit(session, op, "deny"); this.save(); return this.publicOperation(op) }
    } else if (body.human_proof !== undefined) deny("UNEXPECTED_HUMAN_PROOF", 400)
    op.execute_requested = true; this.save()
    void this.schedule(op).catch(() => {})
    return this.publicOperation(op)
  }
  cancel(grantId: string, subject: string, handle: string): unknown {
    const { op, session } = this.findOperation(grantId, subject, handle, false)
    if (!TERMINAL.has(op.state)) {
      this.controllers.get(handle)?.abort()
      op.state = op.state === "executing" ? "outcome_unknown" : "cancelled"; op.error_code = "CALLER_CANCELLED"
      this.audit(session, op, "cancel"); this.save()
    }
    return this.publicOperation(op)
  }
  private async run(op: Operation): Promise<void> {
    if (!op.execute_requested || TERMINAL.has(op.state) || op.state === "executing") return
    const controller = new AbortController(); this.controllers.set(op.handle, controller)
    let session: Session | undefined
    try {
      session = this.store.sessions.find(s => s.handle === op.session)!
      const { policy, peer } = this.bound(session.grant_id, session.subject, session.handle)
      const stored = this.args.get(op.handle)
      if (!stored) deny("OPERATION_DATA_NOT_RETAINED", 409)
      const { rule_id, ...args } = stored
      const rule = typeof rule_id === "string" ? policy.actions.find(r => r.id === rule_id) : undefined
      let current = await this.inspect(session, policy, peer!, op.state === "waiting_login" ? undefined : rule)
      if (TERMINAL.has(op.state) || controller.signal.aborted) return
      if (current.state === "login_required" && op.tool !== "navigate") {
        if (op.approval_used) deny("APPROVAL_TARGET_CHANGED", 409)
        op.state = "waiting_login"; this.save(); return
      }
      if (op.tool === "navigate") {
        if (!inScope(canonicalURL(current.url), [...policy.navigation, ...policy.login])) deny("NAVIGATION_FORBIDDEN")
      } else if (current.state !== "ready") deny("SITE_OR_TARGET_UNSUPPORTED", 409)
      if (op.state === "waiting_login" && op.tool !== "navigate") {
        const destination = this.operationDestinations.get(op.handle)
        if (!destination) deny("RETURN_TARGET_NOT_RETAINED", 409)
        if (canonicalURL(current.url).href !== destination) {
          if (!policy.tools.includes("navigate")) deny("RETURN_TARGET_RESTORE_FORBIDDEN", 409)
          if (this.restoredTargets.has(op.handle)) deny("AUTH_RETURN_TARGET_MISMATCH", 409)
          this.restoredTargets.add(op.handle)
          await this.invoke(session, policy, peer!, "navigate", { tabId: session.tab_id, url: destination }, "navigate", current, undefined, controller.signal)
          op.state = "waiting_login"; this.save(); return
        }
      }
      if (op.state === "waiting_login") {
        if (rule) {
          current = await this.inspect(session, policy, peer!, rule)
          if (TERMINAL.has(op.state) || controller.signal.aborted) return
          if (current.state === "login_required") { this.save(); return }
          if (current.state !== "ready") deny("SITE_OR_TARGET_UNSUPPORTED", 409)
          if (canonicalURL(current.url).href !== this.operationDestinations.get(op.handle)) deny("AUTH_RETURN_TARGET_MISMATCH", 409)
        }
        this.bindOperation(session, op, current); this.save()
        if (op.effect === "write") return
      }
      const expected = this.snapshots.get(op.handle)
      if (!expected || canonicalJSON(current) !== canonicalJSON(expected)) deny("APPROVAL_TARGET_CHANGED", 409)
      if (op.effect === "write" && (!op.approval_used || !op.challenge || Date.parse(op.challenge.expires_at) <= Date.now())) { op.state = "waiting_human"; this.save(); return }
      // Durable claim precedes any business effect. No await between claim/cancel check.
      op.state = "executing"; this.save()
      const mode = op.tool === "get_page_text" ? "text" : op.tool === "screenshot" ? "business-screenshot" : op.tool === "navigate" ? "navigate" : "act"
      const data = await this.invoke(session, policy, peer!, op.tool, { tabId: session.tab_id, ...args }, mode, expected, rule, controller.signal, op.challenge?.expires_at)
      if (op.state !== "executing" || controller.signal.aborted) return
      const bytes = Buffer.byteLength(canonicalJSON(data))
      if (bytes > 4 * 1024 * 1024) deny("EVIDENCE_BUDGET", 409)
      while ([...this.outputBytes.values()].reduce((a, b) => a + b, 0) + bytes > 16 * 1024 * 1024) {
        const oldest = this.outputBytes.keys().next().value
        if (!oldest) break
        this.outputBytes.delete(oldest); this.outputs.delete(oldest)
      }
      this.outputs.set(op.handle, data); this.outputBytes.set(op.handle, bytes); op.state = "completed"; delete op.challenge; delete op.error_code
      if (op.tool === "navigate") this.destinations.set(session.handle, String(args.url))
      this.audit(session, op, op.effect === "write" ? "human_itcra" : "policy_auto"); this.save()
    } catch (error) {
      if (!TERMINAL.has(op.state)) {
        op.error_code = error instanceof EnterpriseError ? error.code : "ENTERPRISE_EXECUTION_UNAVAILABLE"
        // This fixed actuator error is emitted synchronously before any effect.
        // A normal operation can return to login wait without replaying an effect.
        op.state = op.error_code === "READINESS_CHANGED" && op.effect === "read_only" ? "waiting_login" : op.state === "executing" ? "outcome_unknown" : "failed"
        this.save()
        if (session) this.audit(session, op, "deny", op.error_code)
      }
    } finally {
      this.controllers.delete(op.handle)
      if (TERMINAL.has(op.state)) { this.args.delete(op.handle); this.snapshots.delete(op.handle); this.operationDestinations.delete(op.handle) }
    }
  }
  async loginSnapshot(grantId: string, value: unknown): Promise<unknown> {
    const body = object(value, ["subject", "session_handle", "presentation_proof"]), subject = identifier(body.subject), handle = identifier(body.session_handle)
    return this.queue(handle, async () => {
      const { session, policy, peer } = this.bound(grantId, subject, handle)
      this.validateProof(body.presentation_proof, session.presentation, policy)
      session.presentation = this.challenge(session, "login_view"); this.save() // single use before capture
      const current = await this.inspect(session, policy, peer!)
      if (current.state !== "login_required") deny("LOGIN_VIEW_UNAVAILABLE", 409)
      const image = await this.invoke(session, policy, peer!, "screenshot", { tabId: session.tab_id }, "login-screenshot", current)
      this.audit(session, undefined, "human_presentation")
      return { ...image, audience: "human_only", cache: "no-store" }
    })
  }
  async tick(): Promise<void> {
    if (!this.healthy) return
    for (const op of this.store.operations) {
      if (op.state === "waiting_human" && op.challenge && Date.parse(op.challenge.expires_at) <= Date.now()) {
        op.state = "cancelled"; op.error_code = "APPROVAL_EXPIRED"; this.save()
      }
    }
    const pending = this.store.operations.filter(op => op.execute_requested && op.state === "waiting_login")
    await Promise.allSettled(pending.map(op => this.schedule(op)))
  }
  async drain(): Promise<void> { await Promise.allSettled([...this.queues.values()]) }
}
