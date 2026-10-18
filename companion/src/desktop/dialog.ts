/** #476 native-only conversation projection. No generic message-router forwarding. */
import { ThreadManager, type DesktopDialogHistory } from "../threads/thread-manager"
import { redactSecrets } from "../threads/distill"

export type NativeDialogRun = Readonly<{ current(): boolean; stop(): boolean }>
export type NativeDialogStart = {
  threadId: string; message: string; messageId: string
  current(): boolean
  started(run: NativeDialogRun): void
  event(frame: Record<string, unknown>): void
}
export type NativeDialogRuntime = { start(input: NativeDialogStart): Promise<void> }
export type NativeDialogHistory = DesktopDialogHistory
export const DESKTOP_DIALOG_METHODS = ["desktop.thread.create", "desktop.thread.open", "desktop.chat.send", "desktop.chat.stop"] as const
const safe = (value: unknown) => redactSecrets(typeof value === "string" ? value : "").text
const exact = (frame: Record<string, unknown>, keys: string[]) => Object.keys(frame).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(frame, k))
type Manager = Pick<ThreadManager, "create" | "desktopMetadataSnapshot"> & { readDesktopDialog?(id: string): NativeDialogHistory }
type Frame = Record<string, unknown>
type Operation = { id: string; thread: string; message: string; run?: NativeDialogRun; userPersisted: boolean; failed: boolean; done: boolean; unknown: boolean; cancelled: boolean }
export function createDesktopDialog(opts: { threads: Manager; runtime?: NativeDialogRuntime; current(): boolean; send(frame: Frame): void; maxPayload: number }) {
  let operation: Operation | undefined
  let lastSend: { id: string; thread: string; message: string; result: Frame } | undefined
  let lastCreate: { id: string; result: Frame } | undefined
  function send(frame: Frame) {
    if (!opts.current()) return
    if (Buffer.byteLength(JSON.stringify(frame)) > opts.maxPayload) {
      if (operation) operation.unknown = true
      frame = { type: frame.type, id: frame.id, thread_id: frame.thread_id, run_id: frame.run_id, kind: "error", ok: false, error_code: "DESKTOP_DIALOG_FRAME_TOO_LARGE" }
    }
    try { opts.send(frame) } catch { /* A lost delivery is never a new execution. */ }
  }
  function result(frame: Frame, values: Frame) { send({ type: String(frame.type) + ".result", id: frame.id, ...(typeof frame.thread_id === "string" ? { thread_id: frame.thread_id } : {}), ...values }) }
  function target(id: unknown): id is string { return typeof id === "string" && ThreadManager.isSafeThreadId(id) && opts.threads.desktopMetadataSnapshot().some(t => t.id === id) }
  function live(op: Operation) { return opts.current() && operation === op && !op.cancelled }
  function event(op: Operation, frame: Frame) {
    if (!live(op) || frame.thread_id !== op.thread) return
    const common = { type: "desktop.chat.event", id: op.id, run_id: op.id, thread_id: op.thread }
    switch (frame.type) {
      case "chat.user":
        if (typeof frame.message_id !== "string" || frame.client_message_id !== op.id) return
        op.userPersisted = true
        send({ ...common, kind: "user", message_id: frame.message_id, content: safe(frame.content), persisted: true }); break
      case "chat.token": send({ ...common, kind: "snapshot", content: safe(frame.content) }); break
      case "chat.assistant":
        if (typeof frame.message_id === "string") send({ ...common, kind: "assistant", message_id: frame.message_id, content: safe(frame.content), persisted: true }); break
      case "chat.done":
        op.done = true
        send({ ...common, kind: "done", ...(typeof frame.message_id === "string" ? { message_id: frame.message_id, persisted: true } : { persisted: false }), truncated: frame.truncated === true, round_limit: frame.terminal === "round_limit" }); break
      case "desktop.chat.confirmation_unavailable": send({ ...common, kind: "confirmation_unavailable", error_code: "DESKTOP_CONFIRMATION_UNAVAILABLE" }); break
      case "chat.aborted": op.failed = true; send({ ...common, kind: "aborted" }); break
      case "chat.error": op.failed = true; send({ ...common, kind: "error", error_code: "DESKTOP_CHAT_FAILED" }); break
    }
  }
  function handle(frame: Frame): void {
    const type = String(frame.type), keys = type === "desktop.thread.create" ? ["type", "id"] : type === "desktop.thread.open" ? ["type", "id", "thread_id"] : type === "desktop.chat.send" ? ["type", "id", "thread_id", "message"] : ["type", "id", "thread_id", "run_id"]
    if (!(DESKTOP_DIALOG_METHODS as readonly string[]).includes(type) || !exact(frame, keys) || typeof frame.id !== "string" || !frame.id || !/^[a-zA-Z0-9_-]{1,128}$/.test(frame.id) || redactSecrets(frame.id).hits > 0 || (type !== "desktop.thread.create" && !target(frame.thread_id))) { result(frame, { ok: false, error_code: "DESKTOP_DIALOG_INPUT_INVALID" }); return }
    if (!opts.current()) return
    if (type === "desktop.thread.create") {
      if (lastCreate?.id === frame.id) { send(lastCreate.result); return }
      let reply: Frame
      try { const thread = opts.threads.create(""); reply = { type: type + ".result", id: frame.id, ok: true, created: true, thread_id: thread.id, title: safe(thread.alias || thread.id) } }
      catch { reply = { type: type + ".result", id: frame.id, ok: false, created: false, error_code: "DESKTOP_CREATE_UNKNOWN" } }
      lastCreate = { id: frame.id, result: reply }; send(reply); return
    }
    if (type === "desktop.thread.open") {
      try {
        const history = opts.threads.readDesktopDialog?.(frame.thread_id as string)
        if (!history) throw Error("DESKTOP_HISTORY_UNAVAILABLE")
        result(frame, { ok: true, history, owned_run_id: operation && operation.thread === frame.thread_id ? operation.id : null, running: operation?.thread === frame.thread_id })
      } catch { result(frame, { ok: false, error_code: "DESKTOP_HISTORY_UNAVAILABLE" }) }
      return
    }
    if (type === "desktop.chat.stop") {
      const op = operation
      if (!op || op.id !== frame.run_id || op.thread !== frame.thread_id || (op.run && !op.run.current())) { result(frame, { ok: false, stopped: false, error_code: "DESKTOP_RUN_STALE" }); return }
      op.cancelled = true; op.failed = true
      const stopped = op.run ? op.run.stop() : true
      result(frame, { ok: stopped, stopped, run_id: op.id }); return
    }
    if (typeof frame.message !== "string" || !frame.message.trim()) { result(frame, { ok: false, error_code: "DESKTOP_DIALOG_INPUT_INVALID" }); return }
    if (lastSend?.id === frame.id) {
      if (lastSend.thread === frame.thread_id && lastSend.message === frame.message) send(lastSend.result)
      else result(frame, { ok: false, error_code: "DESKTOP_REQUEST_REUSED" })
      return
    }
    if (operation) { result(frame, { ok: false, error_code: "DESKTOP_CHAT_BUSY" }); return }
    if (!opts.runtime) { result(frame, { ok: false, error_code: "DESKTOP_CHAT_UNAVAILABLE" }); return }
    const op: Operation = { id: frame.id, thread: frame.thread_id as string, message: frame.message, userPersisted: false, failed: false, done: false, unknown: false, cancelled: false }; operation = op
    result(frame, { ok: true, accepted: true, run_id: op.id })
    void Promise.resolve().then(() => {
      if (!live(op)) return
      return opts.runtime!.start({ threadId: op.thread, message: op.message, messageId: op.id, current: () => live(op), started: run => { op.run = run; if (!live(op)) run.stop() }, event: frame => event(op, frame) })
    }).catch(() => { op.failed = true }).finally(() => {
      if (operation !== op) return
      const terminal = { type: "desktop.chat.event", id: op.id, run_id: op.id, thread_id: op.thread, kind: "terminal", state: op.unknown || (!op.done && !op.failed) ? "unknown" : op.failed ? "stopped_or_failed" : "done", user_persisted: op.userPersisted }
      lastSend = { id: op.id, thread: op.thread, message: op.message, result: terminal }; send(terminal); operation = undefined
    })
  }
  function cancel() { const op = operation; operation = undefined; op?.run?.stop() }
  return { handle, cancel }
}
