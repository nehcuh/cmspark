import type { Thread } from "../types"
export interface Project { id: string; name: string; created_at: string; updated_at: string; archived_at: string | null }
export interface ProjectState { revision: number; projects: Project[] }
export interface ProjectChanged { type: "project.changed"; revision: number; operation_id: string; project?: Project; thread?: Thread; project_id?: string | null; thread_id?: string; unchanged?: boolean }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export function isProject(value: any): value is Project {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(k => ["id", "name", "created_at", "updated_at", "archived_at"].includes(k)) &&
    typeof value.id === "string" && UUID.test(value.id) && typeof value.name === "string" && value.name.length <= 160 &&
    typeof value.created_at === "string" && typeof value.updated_at === "string" && (value.archived_at === null || typeof value.archived_at === "string")
}
export function matchingProjectReply(message: any, type: string, data: Record<string, any>): boolean {
  if (!Number.isSafeInteger(message?.revision) || message.revision < 0) return false
  if (type === "project.list") return message.type === "project.state" && Array.isArray(message.projects) && message.projects.length <= 256 && message.projects.every(isProject)
  if (message.type !== "project.changed" || message.operation_id !== data.operation_id) return false
  if (type === "thread.project.set") return message.thread_id === data.thread_id && message.project_id === data.project_id && message.thread?.id === data.thread_id && message.thread?.project_id === data.project_id
  if (!isProject(message.project) || type !== "project.create" && message.project.id !== data.project_id) return false
  if (type === "project.create" && !message.unchanged || type === "project.rename") return message.project.name === data.name.normalize("NFC").trim()
  if (type === "project.archive") return message.project.archived_at !== null
  if (type === "project.restore") return message.project.archived_at === null
  return true
}

/** Only the matching persisted backend response completes an operation. Transport ACK is not save. */
export function requestProject(type: string, data: Record<string, any>, signal: AbortSignal): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = "project-" + crypto.randomUUID()
    let settled = false, timer: ReturnType<typeof setTimeout>
    const finish = (error?: Error, value?: any) => {
      if (settled) return
      settled = true; clearTimeout(timer); chrome.runtime.onMessage.removeListener(receive); signal.removeEventListener("abort", cancel)
      error ? reject(error) : resolve(value)
    }
    const cancel = () => finish(new Error("已离开项目编辑；已发送的保存结果请刷新核实。"))
    const receive = (message: any) => {
      if (message?.id !== id) return
      if (message.type === "project.error" && message.operation_id !== undefined && message.operation_id !== data.operation_id) return
      if (message.type === "project.error" || message.type === "error") finish(new Error(message.error || "项目尚未保存，请刷新核实。"))
      else if (matchingProjectReply(message, type, data)) finish(undefined, message)
    }
    if (signal.aborted) { cancel(); return }
    chrome.runtime.onMessage.addListener(receive); signal.addEventListener("abort", cancel, { once: true })
    timer = setTimeout(() => finish(new Error("尚未收到项目保存确认，请刷新核实；不会自动重试。")), 15_000)
    try { Promise.resolve(chrome.runtime.sendMessage({ type, ...data, id, require_connected: true })).then(ack => {
      if (ack?.ok === false) finish(new Error(ack.error || "连接不可用，保存结果请刷新核实。"))
    }).catch(() => finish(new Error("连接中断，保存结果请刷新核实。"))) }
    catch { finish(new Error("连接中断，保存结果请刷新核实。")) }
  })
}

/** Existing thread.create, then a separate explicit project.set; no fake cross-store transaction. */
export function requestProjectThread(signal: AbortSignal, onCreated?: (thread: Thread) => void): Promise<Thread> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    let settled = false, timer: ReturnType<typeof setTimeout>
    const finish = (error?: Error, value?: Thread) => {
      if (settled) return
      settled = true; clearTimeout(timer); chrome.runtime.onMessage.removeListener(receive); signal.removeEventListener("abort", cancel)
      error ? reject(error) : resolve(value!)
    }
    const cancel = () => finish(new Error("创建对话结果请刷新核实。"))
    const receive = (message: any) => { if (message?.id !== id) return; if (message.type === "thread.created" && message.thread?.id === id) { onCreated?.(message.thread); finish(undefined, message.thread) } else if (message.type === "error") finish(new Error("新对话尚未确认创建，请刷新核实。")) }
    if (signal.aborted) { cancel(); return }
    chrome.runtime.onMessage.addListener(receive); signal.addEventListener("abort", cancel, { once: true })
    timer = setTimeout(() => finish(new Error("创建对话结果请刷新核实。")), 15_000)
    try { Promise.resolve(chrome.runtime.sendMessage({ type: "thread.create", alias: "新项目对话", id })).then(ack => {
      if (ack?.ok === false) finish(new Error("新对话尚未确认创建，请刷新核实。"))
    }).catch(cancel) } catch { cancel() }
  })
}
