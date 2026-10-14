import * as fs from "node:fs"
import * as path from "node:path"
import { randomUUID } from "node:crypto"

export const PROJECT_METHODS = ["project.list", "project.create", "project.rename", "project.archive", "project.restore", "thread.project.set"] as const
export type ProjectMethod = typeof PROJECT_METHODS[number]
export interface Project { id: string; name: string; created_at: string; updated_at: string; archived_at: string | null }
type StoredProject = Project & { creation_operation_id: string; creation_name: string }
type Binding = { thread_id: string; thread_created_at: string; project_id: string }
type State = { format_version: 1; revision: number; projects: StoredProject[]; bindings: Binding[] }
export type ProjectThread = { id: string; created_at: string; trashed_at?: string | null }
export const PROJECT_MAX_BYTES = 4 * 1024 * 1024
export const PROJECT_MAX_ROWS = 256
export const PROJECT_MAX_BINDINGS = 8192
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const COPY: Record<string, string> = {
  PROJECT_INVALID: "项目请求格式无效。", PROJECT_STORE_INVALID: "项目记录不可用；对话仍可访问，请检查项目记录后重试。",
  PROJECT_WRITE_FAILED: "项目尚未保存，请检查存储后重试。", PROJECT_STORE_BUSY: "项目记录正在写入或需要检查遗留锁，请稍后刷新。",
  PROJECT_CONFLICT: "项目记录已变化，请刷新并核对后重新保存。", PROJECT_NOT_FOUND: "原项目不可用。",
  PROJECT_ARCHIVED: "项目已归档，恢复后才可归入。", PROJECT_THREAD_NOT_FOUND: "对话不存在或已回收。",
  PROJECT_THREAD_BUSY: "请先结束执行或处理待确认操作，再整理对话。", PROJECT_ACTIVITY_UNKNOWN: "执行状态暂不可核实，请稍后刷新再整理。",
  PROJECT_LIMIT: "项目记录已达到容量上限，尚未保存。", PROJECT_METHOD_DENIED: "该入口不支持项目整理。",
}
export class ProjectError extends Error { constructor(public readonly code: string) { super(COPY[code] || COPY.PROJECT_INVALID) } }
function fail(code = "PROJECT_INVALID"): never { throw new ProjectError(code) }
function object(value: unknown): value is Record<string, any> { return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype }
function exact(value: unknown, keys: string[]) { if (!object(value) || Object.keys(value).some(k => !keys.includes(k))) fail() }
export function projectName(value: unknown): string {
  if (typeof value !== "string" || /[\x00-\x1f\x7f-\x9f]/.test(value)) fail()
  const name = value.normalize("NFC").trim()
  if (!name || [...name].length > 80 || Buffer.byteLength(name) > 320) fail()
  return name
}
function publicProject(row: StoredProject): Project {
  const { id, name, created_at, updated_at, archived_at } = row
  return { id, name, created_at, updated_at, archived_at }
}
export function validateProjectRequest(type: string, data: unknown): void {
  if (!(PROJECT_METHODS as readonly string[]).includes(type)) fail()
  const keys = type === "project.list" ? [] : ["operation_id", "expected_revision", "user_gesture",
    ...(type === "project.create" ? ["name"] : type === "project.rename" ? ["project_id", "name"] :
      type === "thread.project.set" ? ["thread_id", "project_id"] : ["project_id"])]
  exact(data, keys)
  const row = data as Record<string, any>
  if (type === "project.list") return
  if (!UUID.test(row.operation_id) || typeof row.operation_id !== "string" || row.user_gesture !== true || !Number.isSafeInteger(row.expected_revision) || row.expected_revision < 0) fail()
  if (type === "project.create" || type === "project.rename") projectName(row.name)
  if (type !== "project.create" && !(type === "thread.project.set" && row.project_id === null) && (typeof row.project_id !== "string" || !UUID.test(row.project_id))) fail()
  if (type === "thread.project.set" && (typeof row.thread_id !== "string" || !row.thread_id || row.thread_id.length > 200)) fail()
}
function empty(): State { return { format_version: 1, revision: 0, projects: [], bindings: [] } }
function ownedUnlink(file: string, identity: fs.Stats): void {
  try { const current = fs.lstatSync(file); if (current.isFile() && current.dev === identity.dev && current.ino === identity.ino) fs.unlinkSync(file) } catch { /* never remove unknown files */ }
}

/** Canonical project + incarnation-bound membership metadata. No message/index writes. */
export class ProjectStore {
  readonly file: string
  constructor(dataRoot: string) { this.file = path.join(dataRoot, "projects.json") }
  private read(): State {
    let fd: number
    let observed: fs.Stats
    try { observed = fs.lstatSync(this.file); if (!observed.isFile()) fail("PROJECT_STORE_INVALID") }
    catch (error: any) { if (error.code === "ENOENT") return empty(); fail("PROJECT_STORE_INVALID") }
    try { fd = fs.openSync(this.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)) }
    catch (error: any) { if (error.code === "ENOENT") return empty(); fail("PROJECT_STORE_INVALID") }
    try {
      const stat = fs.fstatSync(fd)
      if (!stat.isFile() || stat.dev !== observed.dev || stat.ino !== observed.ino || stat.size > PROJECT_MAX_BYTES) fail("PROJECT_STORE_INVALID")
      const data = JSON.parse(fs.readFileSync(fd, "utf8"))
      exact(data, ["format_version", "revision", "projects", "bindings"])
      if (data.format_version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0 || !Array.isArray(data.projects) || data.projects.length > PROJECT_MAX_ROWS || !Array.isArray(data.bindings) || data.bindings.length > PROJECT_MAX_BINDINGS) fail()
      const ids = new Set<string>(), operations = new Set<string>(), bindings = new Set<string>()
      for (const row of data.projects) {
        exact(row, ["id", "name", "created_at", "updated_at", "archived_at", "creation_operation_id", "creation_name"])
        if (typeof row.id !== "string" || !UUID.test(row.id) || ids.has(row.id) || typeof row.creation_operation_id !== "string" || !UUID.test(row.creation_operation_id) || operations.has(row.creation_operation_id) || projectName(row.name) !== row.name || projectName(row.creation_name) !== row.creation_name || !this.date(row.created_at) || !this.date(row.updated_at) || row.archived_at !== null && !this.date(row.archived_at)) fail()
        ids.add(row.id); operations.add(row.creation_operation_id)
      }
      for (const row of data.bindings) {
        exact(row, ["thread_id", "thread_created_at", "project_id"])
        if (typeof row.thread_id !== "string" || !row.thread_id || row.thread_id.length > 200 || !this.date(row.thread_created_at) || typeof row.project_id !== "string" || !UUID.test(row.project_id) || bindings.has(row.thread_id)) fail()
        bindings.add(row.thread_id)
      }
      return data as State
    } catch { fail("PROJECT_STORE_INVALID") } finally { fs.closeSync(fd) }
  }
  private date(value: unknown): boolean { return typeof value === "string" && Number.isFinite(Date.parse(value)) }
  list(): { revision: number; projects: Project[] } { const state = this.read(); return { revision: state.revision, projects: state.projects.map(publicProject) } }
  projectId(thread: ProjectThread): string | null { return this.read().bindings.find(b => b.thread_id === thread.id && b.thread_created_at === thread.created_at)?.project_id || null }
  projectIds(threads: ProjectThread[]): Map<string, string> {
    const state = this.read(), incarnations = new Map(threads.map(t => [t.id, t.created_at]))
    return new Map(state.bindings.filter(b => incarnations.get(b.thread_id) === b.thread_created_at).map(b => [b.thread_id, b.project_id]))
  }
  mutate(type: ProjectMethod, data: Record<string, any>, runtime: {
    thread: (id: string) => ProjectThread | undefined;
    busy: (id: string) => "idle" | "busy" | "unknown";
  }): { revision: number; project?: Project; thread_id?: string; project_id?: string | null; unchanged?: boolean } {
    validateProjectRequest(type, data)
    if (type === "project.list") fail()
    const lock = this.file + ".lock"
    let lockFd: number
    try { lockFd = fs.openSync(lock, "wx", 0o600) } catch (e: any) { fail(e.code === "EEXIST" ? "PROJECT_STORE_BUSY" : "PROJECT_WRITE_FAILED") }
    let lockIdentity: fs.Stats
    try { lockIdentity = fs.fstatSync(lockFd) }
    catch { try { fs.closeSync(lockFd) } catch {} return fail("PROJECT_WRITE_FAILED") }
    let temporary: { path: string; identity: fs.Stats } | undefined
    try {
      const state = this.read()
      if (type === "project.create") {
        const prior = state.projects.find(p => p.creation_operation_id === data.operation_id)
        if (prior) { if (prior.creation_name !== projectName(data.name)) fail(); return { revision: state.revision, project: publicProject(prior), unchanged: true } }
      }
      if (state.revision !== data.expected_revision) fail("PROJECT_CONFLICT")
      if (state.revision === Number.MAX_SAFE_INTEGER) fail("PROJECT_LIMIT")
      const now = new Date().toISOString()
      let changed: StoredProject | undefined, threadId: string | undefined
      const assertIdle = (id: string) => {
        let activity: string
        try { activity = runtime.busy(id) } catch { fail("PROJECT_ACTIVITY_UNKNOWN") }
        if (activity !== "idle") fail(activity === "busy" ? "PROJECT_THREAD_BUSY" : "PROJECT_ACTIVITY_UNKNOWN")
      }
      if (type === "project.create") {
        if (state.projects.length >= PROJECT_MAX_ROWS) fail("PROJECT_LIMIT")
        changed = { id: randomUUID(), name: projectName(data.name), created_at: now, updated_at: now, archived_at: null,
          creation_operation_id: data.operation_id, creation_name: projectName(data.name) }
        state.projects.push(changed)
      } else if (type === "thread.project.set") {
        const thread = runtime.thread(data.thread_id)
        if (!thread || thread.trashed_at) fail("PROJECT_THREAD_NOT_FOUND")
        if (data.project_id !== null) {
          const target = state.projects.find(p => p.id === data.project_id)
          if (!target) fail("PROJECT_NOT_FOUND")
          if (target.archived_at) fail("PROJECT_ARCHIVED")
        }
        assertIdle(thread.id)
        state.bindings = state.bindings.filter(b => b.thread_id !== thread.id)
        if (data.project_id !== null) state.bindings.push({ thread_id: thread.id, thread_created_at: thread.created_at, project_id: data.project_id })
        threadId = thread.id
      } else {
        changed = state.projects.find(p => p.id === data.project_id)
        if (!changed) fail("PROJECT_NOT_FOUND")
        if (type === "project.rename") changed.name = projectName(data.name)
        if (type === "project.archive") {
          for (const binding of state.bindings.filter(b => b.project_id === changed!.id)) {
            const thread = runtime.thread(binding.thread_id)
            if (thread?.created_at === binding.thread_created_at) assertIdle(thread.id)
          }
          if (changed.archived_at) return { revision: state.revision, project: publicProject(changed), unchanged: true }
          changed.archived_at = now
        }
        if (type === "project.restore") {
          if (!changed.archived_at) return { revision: state.revision, project: publicProject(changed), unchanged: true }
          changed.archived_at = null
        }
        changed.updated_at = now
      }
      state.revision++
      const bytes = JSON.stringify(state, null, 2) + "\n"
      if (state.bindings.length > PROJECT_MAX_BINDINGS || Buffer.byteLength(bytes) > PROJECT_MAX_BYTES) fail("PROJECT_LIMIT")
      const tempPath = this.file + ".tmp-" + randomUUID()
      const fd = fs.openSync(tempPath, "wx", 0o600)
      try { temporary = { path: tempPath, identity: fs.fstatSync(fd) }; fs.writeFileSync(fd, bytes); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      fs.renameSync(tempPath, this.file)
      temporary = undefined
      // No await or cached-state publication between the final runtime check and commit.
      return { revision: state.revision, ...(changed ? { project: publicProject(changed) } : {}),
        ...(threadId ? { thread_id: threadId, project_id: data.project_id } : {}) }
    } catch (error) { if (error instanceof ProjectError) throw error; return fail("PROJECT_WRITE_FAILED") }
    finally { if (temporary) ownedUnlink(temporary.path, temporary.identity); try { fs.closeSync(lockFd) } catch { /* commit result is not reversed by cleanup failure */ } ownedUnlink(lock, lockIdentity) }
  }
}
