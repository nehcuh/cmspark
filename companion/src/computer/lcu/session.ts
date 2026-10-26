// #775: protocol/lifetime only. The installed original runtime owns desktop behavior.
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { randomUUID } from "node:crypto"
import { lcuAppRequest, lcuAppResponse, type LcuAppRequest, type LcuToolName } from "./contract"

export interface LcuToolDefinition {
  type: "function"
  function: { name: LcuToolName; description: string; parameters: { type: string; [key: string]: unknown } }
}

export interface LcuSessionOptions {
  sessionId: string
  turnId: string
  current: () => boolean
  /** Already bound to the authenticated human's connection, never model parameters. */
  confirmApp: (request: LcuAppRequest, signal: AbortSignal) => Promise<boolean>
  transport: Transport
}

class CallClock {
  private timer?: ReturnType<typeof setTimeout>
  private started = 0
  private paused = false
  private closed = false
  constructor(private remaining: number, private expire: () => void) { this.resume() }
  pause() {
    if (this.closed || this.paused) return
    this.remaining = Math.max(0, this.remaining - (performance.now() - this.started))
    this.paused = true
    if (this.timer) clearTimeout(this.timer)
  }
  resume() {
    if (this.closed || (this.timer && !this.paused)) return
    this.paused = false
    this.started = performance.now()
    this.timer = setTimeout(this.expire, this.remaining)
  }
  close() { this.closed = true; if (this.timer) clearTimeout(this.timer) }
}

type PendingCall = { id: string; signal: AbortSignal; clock: CallClock }

export class LcuSession {
  private readonly client: Client
  private readonly stopped = new AbortController()
  private phase: "new" | "connecting" | "ready" | "closing" | "closed" = "new"
  private active?: PendingCall
  private instructionsValue = ""
  private toolsValue: LcuToolDefinition[] = []
  private ran = false
  private ranJs = false
  private upstreamTurnId: string
  private cleanupUnknown = false
  private ending?: Promise<{ cleanup: "complete" | "unknown"; transport: "closed" | "unknown" }>

  constructor(private readonly options: LcuSessionOptions) {
    if (![options.sessionId, options.turnId].every(v => typeof v === "string" && v.length > 0 && v.length <= 256 && !/[\x00-\x1f]/.test(v))) {
      throw new Error("LCU_HOST_IDENTITY_INVALID")
    }
    this.upstreamTurnId = options.turnId
    this.client = new Client({ name: "cmspark-lcu", version: "0.7.0" }, { capabilities: { elicitation: {} } })
    this.client.setRequestHandler(ElicitRequestSchema, async (request, extra) => {
      const call = this.active
      if (!call || this.phase !== "ready" || !this.options.current() || call.signal.aborted) return { action: "cancel" }
      const app = lcuAppRequest(request.params)
      if (!app) return { action: "cancel" }
      const signal = AbortSignal.any([call.signal, extra.signal, this.stopped.signal])
      call.clock.pause()
      try {
        const approved = await this.options.confirmApp(app, signal)
        return lcuAppResponse(app, approved, this.active === call && this.phase === "ready" && this.options.current() && !signal.aborted)
      } catch { return { action: "cancel" } }
      finally { if (this.active === call) call.clock.resume() }
    })
  }

  get instructions(): string {
    if (this.phase !== "ready") throw new Error("LCU_NOT_READY")
    return this.instructionsValue
  }

  get tools(): LcuToolDefinition[] {
    if (this.phase !== "ready") return []
    return structuredClone(this.toolsValue)
  }

  async connect(signal?: AbortSignal): Promise<void> {
    if (this.phase !== "new" || !this.options.current() || signal?.aborted) throw new Error("LCU_SESSION_UNAVAILABLE")
    this.phase = "connecting"
    try {
      await this.client.connect(this.options.transport, { timeout: 15000, signal })
      if (!this.options.current() || signal?.aborted || this.phase !== "connecting") throw new Error("LCU_SESSION_REVOKED")
      const instructions = this.client.getInstructions()
      if (typeof instructions !== "string" || !instructions.trim() || Buffer.byteLength(instructions) > 512 * 1024) throw new Error("LCU_INSTRUCTIONS_INVALID")
      const tools: Array<{ name: string; description?: string; inputSchema: { type: string; [key: string]: unknown } }> = []
      let cursor: string | undefined
      const seen = new Set<string>()
      for (let page = 0; page < 10; page++) {
        const result = await this.client.listTools(cursor ? { cursor } : undefined, { signal, timeout: 15000 })
        for (const tool of result.tools) {
          if (seen.has(tool.name)) throw new Error("LCU_DUPLICATE_TOOL")
          seen.add(tool.name)
          if (tool.name === "js" || tool.name === "js_reset") tools.push(tool)
        }
        cursor = result.nextCursor
        if (!cursor) break
        if (page === 9) throw new Error("LCU_CATALOG_INCOMPLETE")
      }
      if (tools.length !== 2 || !["js", "js_reset"].every(name => tools.some(tool => tool.name === name))) throw new Error("LCU_PUBLIC_TOOLS_MISSING")
      if (Buffer.byteLength(JSON.stringify(tools)) > 128 * 1024) throw new Error("LCU_TOOL_SCHEMA_TOO_LARGE")
      if (!this.options.current() || signal?.aborted || this.phase !== "connecting") throw new Error("LCU_SESSION_REVOKED")
      this.instructionsValue = instructions
      this.toolsValue = tools.map(tool => ({
        type: "function",
        function: {
          name: tool.name === "js" ? "lcu_js" : "lcu_js_reset",
          description: `${tool.description ?? ""}\nCMspark: original LCU ${tool.name}; explicit human confirmation required. JS is bounded to 64 KiB and timeout_ms to 60 seconds.`,
          parameters: structuredClone(tool.inputSchema),
        },
      }))
      this.phase = "ready"
    } catch {
      this.phase = "closed"
      this.stopped.abort()
      try { await this.client.close() } catch { throw new Error("LCU_CONNECT_TEARDOWN_UNKNOWN") }
      throw new Error("LCU_CONNECT_FAILED")
    }
  }

  async call(name: LcuToolName, args: unknown, callId: string, signal?: AbortSignal): Promise<unknown> {
    if (this.phase !== "ready" || !this.options.current() || signal?.aborted || this.stopped.signal.aborted) throw new Error("LCU_SESSION_REVOKED")
    if (this.active) throw new Error("LCU_CALL_BUSY")
    if (!args || typeof args !== "object" || Array.isArray(args) || typeof callId !== "string" || !callId || callId.length > 256 || /[\x00-\x1f\x7f]/.test(callId)) throw new Error("LCU_ARGUMENT_INVALID")
    const input = args as Record<string, unknown>
    let tool: "js" | "js_reset", budget = 30000
    if (name === "lcu_js") {
      if (Object.keys(input).some(k => !["code", "title", "timeout_ms"].includes(k)) || typeof input.code !== "string" || !input.code.trim() || Buffer.byteLength(input.code) > 64 * 1024 ||
          (input.title !== undefined && (typeof input.title !== "string" || input.title.length > 256)) ||
          (input.timeout_ms !== undefined && (typeof input.timeout_ms !== "number" || !Number.isInteger(input.timeout_ms) || input.timeout_ms < 1 || input.timeout_ms > 60000))) throw new Error("LCU_ARGUMENT_INVALID")
      tool = "js"
      if (typeof input.timeout_ms === "number") budget = input.timeout_ms
    } else if (name === "lcu_js_reset") {
      if (Object.keys(input).length) throw new Error("LCU_ARGUMENT_INVALID")
      tool = "js_reset"
    } else throw new Error("LCU_HOST_ONLY_TOOL")
    const deadline = new AbortController()
    const combined = AbortSignal.any([deadline.signal, this.stopped.signal, ...(signal ? [signal] : [])])
    const clock = new CallClock(budget + 30000, () => deadline.abort())
    const active: PendingCall = { id: callId, signal: combined, clock }
    this.active = active
    this.ran = true
    try {
      // Upstream createWorkerTurns/reset: finish the old Sky hook before the
      // trusted worker disappears, then map this real host turn to a fresh id.
      if (tool === "js_reset" && this.ranJs) {
        try {
          const ended = await this.client.callTool({ name: "turn_ended", arguments: {
            hook_event_name: "Interrupt", session_id: this.options.sessionId, turn_id: this.upstreamTurnId,
          } }, undefined, { signal: combined, timeout: 10000 })
          if (ended.isError) throw new Error("LCU_RESET_CLEANUP_UNKNOWN")
        } catch {
          this.cleanupUnknown = true
          this.phase = "closing"
          this.stopped.abort()
          throw new Error("LCU_RESET_CLEANUP_UNKNOWN")
        }
        this.upstreamTurnId = randomUUID()
        this.ranJs = false
      }
      if (combined.aborted || !this.options.current()) throw new Error("LCU_SESSION_REVOKED")
      if (tool === "js") this.ranJs = true
      const result = await this.client.callTool({ name: tool, arguments: input, _meta: {
        "x-codex-turn-metadata": { session_id: this.options.sessionId, turn_id: this.upstreamTurnId, call_id: callId },
      } }, undefined, { signal: combined, timeout: 3600000 })
      if (!this.options.current() || this.phase !== "ready" || combined.aborted) throw new Error("LCU_SESSION_REVOKED")
      return result
    } catch {
      if (this.cleanupUnknown) throw new Error("LCU_RESET_CLEANUP_UNKNOWN")
      throw new Error(combined.aborted ? "LCU_CALL_CANCELLED_OR_TIMED_OUT" : "LCU_CALL_FAILED")
    } finally {
      clock.close()
      if (this.active === active) this.active = undefined
    }
  }

  finish(event: "Stop" | "Interrupt"): Promise<{ cleanup: "complete" | "unknown"; transport: "closed" | "unknown" }> {
    if (this.ending) return this.ending
    const wasReady = this.phase === "ready"
    this.phase = "closing"
    this.stopped.abort()
    this.ending = (async () => {
      let cleanup: "complete" | "unknown" = this.cleanupUnknown ? "unknown" : "complete"
      let transport: "closed" | "unknown" = "closed"
      try {
        if (wasReady && this.ran) {
          const result = await this.client.callTool({ name: "turn_ended", arguments: {
            hook_event_name: event, session_id: this.options.sessionId, turn_id: this.upstreamTurnId,
          } }, undefined, { timeout: 10000 })
          if (result.isError) cleanup = "unknown"
        }
      } catch { cleanup = "unknown" }
      try { await this.client.close() } catch { transport = "unknown" }
      this.phase = "closed"
      this.active?.clock.close()
      this.active = undefined
      this.instructionsValue = ""
      this.toolsValue = []
      return { cleanup, transport }
    })()
    return this.ending
  }
}
