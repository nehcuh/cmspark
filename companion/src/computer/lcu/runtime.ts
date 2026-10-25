// #775: run ownership and admission. OS/WS/config effects are injected at the host edge.
import type { LcuConfig, LcuToolName, LcuAppRequest } from "./contract"
import { lcuEnableRefusal } from "./contract"
import type { LcuCommandIdentity, LcuProbe } from "./discovery"
import { LcuSession, type LcuToolDefinition } from "./session"
import { projectLcuResult, type LcuProjectedResult } from "./result"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { resolveEffectiveExecutionPolicy, type ExecutionPolicy } from "../../tool/plan-readonly"

export const LCU_THREAD_SELECTION = "cmspark_lcu"

export interface LcuThreadPolicy {
  active_mcp_server_ids?: string[]
  agent_role?: string | null
  parent_thread_id?: string | null
  execution_policy?: ExecutionPolicy | null
  trashed_at?: string | null
}

/** The direct runtime bridge must retain the existing server execution cap. */
export function lcuThreadAdmitted(threadId: string, get: (id: string) => LcuThreadPolicy | undefined | null, isAllowed: (tool: LcuToolName) => boolean): boolean {
  try {
    const thread = get(threadId)
    return !!thread && !thread.trashed_at && thread.agent_role !== "worker" &&
      thread.active_mcp_server_ids?.includes(LCU_THREAD_SELECTION) === true &&
      resolveEffectiveExecutionPolicy(threadId, get) === "default" &&
      isAllowed("lcu_js") && isAllowed("lcu_js_reset")
  } catch { return false }
}


export interface LcuRuntimeConfig extends LcuConfig { coordinateEnabled: boolean }
export interface LcuRunOwner {
  threadId: string
  runId: string
  current: () => boolean
  signal?: AbortSignal
  /** Host-authenticated prompts; neither callback exists in model/WS arguments. */
  confirmTool: (name: LcuToolName, args: unknown, signal: AbortSignal) => Promise<boolean>
  confirmApp: (app: LcuAppRequest, signal: AbortSignal) => Promise<boolean>
}

export interface LcuRuntimeDeps {
  config: () => LcuRuntimeConfig
  inspect: (command: string | undefined, signal?: AbortSignal) => Promise<LcuProbe>
  identity: (command: string) => Promise<LcuCommandIdentity | undefined>
  transport: (identity: LcuCommandIdentity) => Transport
  /** Shared with the existing native CU single-task/abort registry. */
  tasks: Map<string, boolean>
  changed?: () => void
}

type Entry = {
  owner: LcuRunOwner
  abort: AbortController
  current: () => boolean
  session: LcuSession
  closed: boolean
  finish?: Promise<void>
  detachAbort: () => void
}

export interface LcuTurn {
  readonly instructions: string
  readonly tools: LcuToolDefinition[]
  call(name: LcuToolName, args: unknown, callId: string, signal?: AbortSignal): Promise<LcuProjectedResult>
  finish(event: "Stop" | "Interrupt"): Promise<void>
}

const fingerprint = (config: LcuRuntimeConfig) => JSON.stringify([
  config.enabled === true, config.coordinateEnabled === true, config.command ?? null,
])

export class LcuRuntime {
  private readonly turns = new Map<string, Entry>()
  private readonly openings = new Map<string, { owner: LcuRunOwner; current: () => boolean; abort: AbortController }>()
  private lease?: { entry: Entry; callId: string }
  private quarantine = false

  constructor(private readonly deps: LcuRuntimeDeps) {}

  private notify() { try { this.deps.changed?.() } catch { /* observation cannot change admission or cleanup */ } }

  get state() {
    return { activeRuns: this.turns.size, pendingRuns: this.openings.size, cleanupUnknown: this.quarantine }
  }

  /** Abort flags/config revocation are host events, not invented completion receipts. */
  abortStale() {
    for (const opening of this.openings.values()) if (!opening.current()) opening.abort.abort()
    for (const entry of this.turns.values()) {
      if (!entry.current()) {
        entry.abort.abort()
        void this.end(entry, "Interrupt")
      }
    }
  }

  abort(taskId?: string) {
    for (const opening of this.openings.values()) {
      if (!taskId || taskId === "*" || taskId === opening.owner.runId || taskId === opening.owner.threadId) opening.abort.abort()
    }
    for (const entry of this.turns.values()) {
      if (!taskId || taskId === "*" || taskId === entry.owner.runId || taskId === entry.owner.threadId) {
        entry.abort.abort()
        void this.end(entry, "Interrupt")
      }
    }
  }

  async open(owner: LcuRunOwner): Promise<LcuTurn> {
    if (this.turns.has(owner.runId) || this.openings.has(owner.runId) || this.turns.size + this.openings.size >= 2 || this.quarantine) throw new Error("LCU_SESSION_BUSY")
    const initial = fingerprint(this.deps.config()), abort = new AbortController()
    const signal = AbortSignal.any([abort.signal, ...(owner.signal ? [owner.signal] : [])])
    const reservedOwner = { ...owner, signal }
    this.openings.set(owner.runId, {
      owner, abort, current: () => !signal.aborted && owner.current() && fingerprint(this.deps.config()) === initial,
    })
    this.notify()
    try { return await this.openReserved(reservedOwner) }
    finally { this.openings.delete(owner.runId); this.notify() }
  }

  private async openReserved(owner: LcuRunOwner): Promise<LcuTurn> {
    const configured = this.deps.config(), initial = fingerprint(configured)
    const current = () => owner.current() && !owner.signal?.aborted && fingerprint(this.deps.config()) === initial
    if (!configured.enabled || !configured.coordinateEnabled || !current()) throw new Error("LCU_DISABLED_OR_REVOKED")
    if (this.quarantine) throw new Error("LCU_CLEANUP_UNKNOWN")
    if (this.turns.has(owner.runId) || this.turns.size >= 2) throw new Error("LCU_SESSION_BUSY")
    // Re-check the selected runtime for each real turn; no stale enable-time attestation.
    const probe = await this.deps.inspect(configured.command, owner.signal)
    if (!current()) throw new Error("LCU_DISABLED_OR_REVOKED")
    const refused = probe.status !== "checked" ? probe.refusal ?? "LCU_STATUS_UNVERIFIED" : lcuEnableRefusal(probe.observed)
    if (refused || !probe.identity) throw new Error(refused ?? "LCU_INSTALLATION_UNVERIFIED")
    const now = await this.deps.identity(probe.identity.command)
    if (!now || JSON.stringify(now) !== JSON.stringify(probe.identity) || !current()) throw new Error("LCU_INSTALLATION_CHANGED_OR_REVOKED")
    // An inspect await can overlap another run claiming the last slot.
    if (this.turns.has(owner.runId) || this.turns.size >= 2 || this.quarantine) throw new Error("LCU_SESSION_BUSY")
    const abort = new AbortController()
    let entry: Entry
    const signal = AbortSignal.any([abort.signal, ...(owner.signal ? [owner.signal] : [])])
    const session = new LcuSession({
      sessionId: owner.threadId, turnId: owner.runId,
      current: () => !entry.closed && !signal.aborted && current() && this.deps.tasks.get(owner.runId) !== true,
      confirmApp: (request, appSignal) => owner.confirmApp(request, appSignal),
      transport: this.deps.transport(now),
    })
    entry = { owner, abort, session, closed: false,
      current: () => !entry.closed && !signal.aborted && current() && this.deps.tasks.get(owner.runId) !== true,
      detachAbort: () => {},
    }
    const onAbort = () => { abort.abort(); void this.end(entry, "Interrupt") }
    owner.signal?.addEventListener("abort", onAbort, { once: true })
    entry.detachAbort = () => owner.signal?.removeEventListener("abort", onAbort)
    this.turns.set(owner.runId, entry)
    this.notify()
    try {
      await session.connect(signal)
      if (!entry.current()) throw new Error("LCU_DISABLED_OR_REVOKED")
    } catch {
      await this.end(entry, "Interrupt")
      throw new Error(this.quarantine ? "LCU_CLEANUP_UNKNOWN" : "LCU_CONNECT_FAILED")
    }
    return {
      get instructions() { return session.instructions },
      get tools() { return session.tools },
      call: (name, args, callId, callSignal) => this.call(entry, name, args, callId, callSignal),
      finish: event => this.end(entry, event),
    }
  }

  private async call(entry: Entry, name: LcuToolName, args: unknown, callId: string, external?: AbortSignal): Promise<LcuProjectedResult> {
    const refused = (error: string): LcuProjectedResult => ({ result: { success: false, error }, images: [] })
    if (!entry.current() || external?.aborted) return refused("LCU_DISABLED_OR_REVOKED")
    if (name !== "lcu_js" && name !== "lcu_js_reset") return refused("LCU_HOST_ONLY_TOOL")
    const signal = AbortSignal.any([entry.abort.signal, ...(external ? [external] : []), ...(entry.owner.signal ? [entry.owner.signal] : [])])
    try {
      if (!await entry.owner.confirmTool(name, args, signal) || !entry.current() || signal.aborted) return refused("LCU_HUMAN_APPROVAL_REQUIRED")
    } catch { return refused("LCU_HUMAN_APPROVAL_REQUIRED") }
    // No await between checking and claiming the shared native-input task slot.
    if (this.lease || this.deps.tasks.size > 0) return refused("COMPUTER_TASK_BUSY")
    const lease = { entry, callId }
    this.lease = lease
    this.deps.tasks.set(entry.owner.runId, false)
    this.notify()
    try {
      if (!entry.current() || signal.aborted) return refused("LCU_DISABLED_OR_REVOKED")
      const result = await entry.session.call(name, args, callId, signal)
      if (!entry.current() || signal.aborted) return refused("LCU_DISABLED_OR_REVOKED")
      return projectLcuResult(result)
    } catch (error) {
      const code = error instanceof Error && /^LCU_[A-Z_]+$/.test(error.message) ? error.message : "LCU_CALL_FAILED"
      if (code === "LCU_RESET_CLEANUP_UNKNOWN") {
        this.quarantine = true
        await this.end(entry, "Interrupt")
      }
      return refused(code)
    } finally {
      if (this.lease === lease) {
        this.lease = undefined
        if (this.quarantine) this.deps.tasks.set(entry.owner.runId, true)
        else this.deps.tasks.delete(entry.owner.runId)
      }
      this.notify()
    }
  }

  private end(entry: Entry, event: "Stop" | "Interrupt"): Promise<void> {
    if (entry.finish) return entry.finish
    entry.closed = true
    entry.abort.abort()
    entry.detachAbort()
    entry.finish = (async () => {
      try {
        const result = await entry.session.finish(event)
        if (result.cleanup !== "complete" || result.transport !== "closed") this.quarantine = true
      } catch { this.quarantine = true }
      finally {
        // Unknown native cleanup also blocks the legacy native backend through
        // its existing shared busy gate until this companion is restarted.
        if (this.quarantine) this.deps.tasks.set(entry.owner.runId, true)
        if (this.turns.get(entry.owner.runId) === entry) this.turns.delete(entry.owner.runId)
        this.notify()
      }
    })()
    return entry.finish
  }
}
