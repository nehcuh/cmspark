// #723 D3: process-private, connection-local read consent. Never serialized.
import type { SecurityConfirmationDecision, SecurityConfirmationManager } from "../security-confirmation"
import { parseToolArgs } from "../bridge/tool-schemas"
import { InjectionRateLimiter } from "./rate-limit"
import { ComputerError } from "./types"

/** Data descriptors only; do not execute accessors from an internal JS caller.
 * Wire JSON is already data. Descriptor traps may throw; no generic Proxy claim. */
export function readonlyComputerDraft(value: unknown): Record<string, any> | undefined {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return
    const top = Object.getOwnPropertyDescriptors(value), copy: Record<string, any> = {}
    const allowed = new Set(["task", "app", "actions", "budget", "trigger_reason", "security_token", "__thread_id"])
    for (const key of Object.keys(top)) {
      if (!allowed.has(key) || !("value" in top[key])) return
      if (key !== "security_token" && key !== "__thread_id") copy[key] = top[key].value
    }
    const raw = copy.actions
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 50) return
    const actions = []
    for (let i = 0; i < raw.length; i++) {
      const slot = Object.getOwnPropertyDescriptor(raw, String(i))
      if (!slot || !("value" in slot) || !slot.value || typeof slot.value !== "object" || Array.isArray(slot.value)) return
      const descriptors = Object.getOwnPropertyDescriptors(slot.value), action: Record<string, unknown> = {}
      for (const key of Object.keys(descriptors)) {
        if (!("value" in descriptors[key])) return
        action[key] = descriptors[key].value
      }
      if (action.action !== "describe" && action.action !== "screenshot" && action.action !== "wait") return
      actions.push(action)
    }
    const parsed = parseToolArgs("host_computer", { ...copy, actions }) as Record<string, any>
    for (const action of parsed.actions) Object.freeze(action)
    Object.freeze(parsed.actions)
    return Object.freeze(parsed)
  } catch { return }
}

export type ComputerReadSubject = {
  thread: object; app: object; configuration: object; auth: object
  threadId: string
  current(): boolean
  mayRetain(): boolean
}
export type ComputerReadOperation = {
  readonly draft: Record<string, any>
  readonly reuse: boolean
  readonly signal: AbortSignal
  assertCurrent(): void
  approve(manager: SecurityConfirmationManager, decision: SecurityConfirmationDecision, socket: any): boolean
  credential(seen: boolean): void
  finish(success: boolean): void
}
const connections = new Set<ComputerReadConnection>()
const connectionsBySocket = new WeakMap<object, ComputerReadConnection>()
export function computerReadConnectionFor(socket: { once(event: string, fn: () => void): unknown }): ComputerReadConnection {
  let connection = connectionsBySocket.get(socket)
  if (!connection) { connection = new ComputerReadConnection(socket); connectionsBySocket.set(socket, connection) }
  return connection
}
export function retireComputerReadonlyThread(threadId?: string): void {
  for (const connection of connections) if (!threadId || connection.threadId === threadId) connection.retire()
}

export class ComputerReadConnection {
  private record?: { subject: ComputerReadSubject; allowed: boolean; operation?: object; cancel?: () => void }
  private removeAbort?: () => void
  private closed = false
  threadId?: string

  constructor(socket: { once(event: string, fn: () => void): unknown }) {
    connections.add(this)
    socket.once("close", () => { this.closed = true; this.retire(); connections.delete(this) })
  }
  observeThread(threadId?: string): void {
    if (threadId !== this.threadId) this.retire()
    this.threadId = threadId
  }
  retire(): void {
    const previous = this.record; this.record = undefined
    this.removeAbort?.(); this.removeAbort = undefined
    previous?.cancel?.()
  }

  begin(subject: ComputerReadSubject, draft: Record<string, any>, signal?: AbortSignal): ComputerReadOperation {
    const previous = this.record
    if (!previous || previous.subject.thread !== subject.thread || previous.subject.app !== subject.app ||
        previous.subject.configuration !== subject.configuration || previous.subject.auth !== subject.auth || !previous.subject.current()) {
      this.retire(); this.record = { subject, allowed: false }
    }
    const record = this.record!
    if (!subject.mayRetain()) record.allowed = false
    if (record.operation) throw new ComputerError("COMPUTER_TASK_BUSY", "computer: read confirmation/execution already pending")
    record.subject = subject
    const operation = {}; record.operation = operation
    let approved = record.allowed, retain = true, finished = false
    const pending = new AbortController()
    record.cancel = () => pending.abort()
    const retireOwned = () => { if (this.record === record) this.retire() }
    const current = () => !this.closed && !signal?.aborted && this.record === record && record.operation === operation && subject.current()
    const assertCurrent = () => {
      if (!current()) { retireOwned(); throw new ComputerError("APP_NOT_WHITELISTED", "computer: readonly subject is no longer current") }
    }
    const abort = retireOwned
    signal?.addEventListener("abort", abort, { once: true })
    this.removeAbort?.(); this.removeAbort = () => signal?.removeEventListener("abort", abort)
    assertCurrent()
    return {
      draft, reuse: record.allowed, signal: pending.signal,
      assertCurrent,
      approve: (manager, decision, socket) => {
        assertCurrent()
        approved = manager.isOriginApproval(decision, socket)
        return approved
      },
      credential: seen => { if (seen) retain = false },
      finish: success => {
        if (finished) return
        finished = true
        if (!success || !approved || !retain || !current() || !subject.mayRetain()) { retireOwned(); return }
        record.allowed = true; record.operation = undefined; record.cancel = undefined
        // Keep this signal's abort listener while its consent remains live.
      },
    }
  }
}

// Independent account; the existing injection account is never reset/mutated.
const readAttempts = new InjectionRateLimiter()
export function consumeComputerReadAttempt(account: InjectionRateLimiter = readAttempts): void {
  if (account.saturated()) throw new ComputerError("RATE_LIMITED", "computer: readonly capture attempt rate limit reached")
  account.record()
}
