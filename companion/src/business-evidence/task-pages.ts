import { randomUUID } from "node:crypto"
import { EvidenceStore, EVIDENCE_LIMITS, type EvidenceFile } from "./store"
import { siteTargetFromBridge } from "../site-context/target"
import type { EvidenceScope } from "./content"
import { redactSecrets } from "../threads/distill"
import type { ToolExecutorFn, ToolExecuteInvokeOpts } from "../server"

type Result = { success: boolean; data?: any; error?: string }
type Execute = ToolExecutorFn
export type TaskPage = {
  id: string; thread_id: string; execution_id: string; tab_id: number
  url: string; title: string; created_at: string; observation_ids: string[]
  state: "open" | "closing" | "closed" | "retained"; reason?: string; closed_at?: string
}
type Entry = { page: TaskPage; token: string; navigationKey: string; ready: boolean }

function pages(file: EvidenceFile): TaskPage[] {
  if (file.task_pages === undefined) return []
  if (!Array.isArray(file.task_pages) || file.task_pages.length > EVIDENCE_LIMITS.observations ||
      file.task_pages.some(p => !p || typeof p.id !== "string" || typeof p.thread_id !== "string" ||
        typeof p.execution_id !== "string" || !Number.isSafeInteger(p.tab_id) || typeof p.url !== "string" ||
        typeof p.title !== "string" || !Array.isArray(p.observation_ids) ||
        p.observation_ids.some((id: unknown) => typeof id !== "string") ||
        !["open", "closing", "closed", "retained"].includes(p.state))) throw new Error("TASK_PAGE_STORE_INVALID")
  return file.task_pages as TaskPage[]
}

function safeTitle(value: unknown): string {
  if (typeof value !== "string") return ""
  return redactSecrets(value.replace(/https?:\/\/[^\s<>"']+/gi, raw => {
    try { const url = new URL(raw); return url.origin + url.pathname } catch { return "[URL omitted]" }
  })).text.slice(0, 1024)
}

/** Only scope-bound local records are exposed; no browser calls or writes. */
export function readBrowserSources(dataDir: string, scope: EvidenceScope | undefined, observationId?: string): Result {
  if (!scope || scope.kind !== "chat") return { success: false, error: "BROWSER_SOURCES_CHAT_SCOPE_REQUIRED" }
  try {
    const file = new EvidenceStore(dataDir, scope).read()
    const sources = pages(file)
    if (observationId !== undefined) {
      const source = sources.find(page => page.observation_ids.includes(observationId))
      const observation = source && file.observations.find(item => item.id === observationId)
      return observation ? { success: true, data: { source, observation } }
        : { success: false, error: "BROWSER_SOURCE_NOT_FOUND" }
    }
    return { success: true, data: { sources: sources.map(source => ({ ...source,
      evidence: source.observation_ids.map(id => file.observations.find(item => item.id === id))
        .filter(item => !!item).map(item => ({ observation_id: item.id, tool_call_id: item.tool_call_id,
          digest: item.digest, observed_at: item.observed_at, summary: item.summary })),
    })) } }
  } catch { return { success: false, error: "BROWSER_SOURCE_STORE_UNAVAILABLE" } }
}

const pageChanges = new Set(["navigate", "set_tab_url", "click", "dblclick", "type", "fill_form", "press_key",
  "scroll", "scroll_to", "select_option", "drag_and_drop", "evaluate", "upload_file"])

/** Per actual chatCreate execution. Creation claims never survive into model arguments or disk. */
export class TaskBrowserTabs {
  private entries = new Map<number, Entry>()
  private store: EvidenceStore
  constructor(private opts: { dataDir: string; threadId: string; executionId: string; execute: Execute; current(): boolean }) {
    this.store = new EvidenceStore(opts.dataDir, { kind: "chat", threadId: opts.threadId })
  }

  private save(entry: Entry, patch: Partial<TaskPage> = {}) {
    const page = { ...entry.page, ...patch }
    this.store.transaction(file => {
      const all = pages(file)
      const index = all.findIndex(item => item.id === page.id)
      if (index < 0 && all.length >= EVIDENCE_LIMITS.observations) throw new Error("TASK_PAGE_CAPACITY")
      file.task_pages = index < 0 ? [...all, page] : all.map((item, i) => i === index ? page : item)
    })
    entry.page = page
  }

  execute: Execute = async (id, name, params, signal, invokeOpts) => {
    // A model cannot smuggle an internal guard into any existing-user-tab call.
    const { __task_tab_cleanup: _untrustedCleanup, ...input } = params || {}
    const entry = this.entries.get(input.tabId)
    if (name === "close_tab" && entry) return this.close(id, entry, false, signal, invokeOpts)
    if (entry && (pageChanges.has(name) || name === "get_page_text" || name === "get_page_html")) entry.ready = false
    let result = await this.opts.execute(id, name, input, signal, invokeOpts)
    if (name === "create_tab" && result.success && result.data) {
      const { task_tab: claim, ...data } = result.data
      result = { ...result, data }
      if (!this.opts.current() || signal?.aborted || input.keep_open === true) return result
      const target = siteTargetFromBridge(claim?.target)
      if (!target || target.tab_id !== data.id || typeof claim?.token !== "string" || !claim.token) return result
      const created: Entry = { token: claim.token, navigationKey: target.navigation_key, ready: false,
        page: { id: randomUUID(), thread_id: this.opts.threadId, execution_id: this.opts.executionId,
          tab_id: target.tab_id, url: target.url, title: safeTitle(data.title), created_at: new Date().toISOString(),
          observation_ids: [], state: "open" } }
      this.entries.set(target.tab_id, created)
      try { this.save(created) }
      catch { result = this.archiveWarning(result) }
    }
    if (entry && result.success && ["get_page_text", "get_page_html"].includes(name) &&
        !signal?.aborted && this.opts.current() && result.data?.evidence_capture?.capture_status === "captured") {
      try {
        const observation = this.store.read().observations.find(item => item.id === result.data.observation_id &&
          item.tool_call_id === id && item.tool === name && item.target.tab_id === entry.page.tab_id)
        if (!observation) return result
        this.save(entry, { url: observation.target.url, title: safeTitle(result.data.provenance?.title) || entry.page.title,
          observation_ids: [...new Set([...entry.page.observation_ids, observation.id])], state: "open", reason: undefined })
        entry.navigationKey = observation.target.navigation_key
        entry.ready = true
      } catch { result = this.archiveWarning(result) }
    }
    return result
  }

  private archiveWarning(result: Result): Result {
    return { ...result, data: { ...result.data, task_tab_lifecycle: { state: "retained", reason: "SOURCE_ARCHIVE_FAILED" } } }
  }

  private async close(id: string, entry: Entry, automatic: boolean, signal?: AbortSignal, invokeOpts?: ToolExecuteInvokeOpts): Promise<Result> {
    const retained = (reason: string): Result => ({ success: false, error: "TASK_TAB_RETAINED: " + reason,
      data: { error_code: "TASK_TAB_RETAINED", reason } })
    if (!this.opts.current() || signal?.aborted) return retained("RUN_NO_LONGER_CURRENT")
    // Evidence/association must be durable BEFORE any close dispatch, including explicit release of an unread tab.
    try { this.save(entry, { state: "closing", reason: automatic ? "task_finished" : "explicit_release" }) }
    catch { return retained("SOURCE_ARCHIVE_FAILED") }
    let result: Result
    try {
      result = await this.opts.execute(id, "close_tab", { tabId: entry.page.tab_id, __thread_id: this.opts.threadId,
        __task_tab_cleanup: { token: entry.token, navigation_key: entry.navigationKey, automatic } }, signal,
        { ...invokeOpts, ...(automatic ? { taskTabCleanupExecutionId: this.opts.executionId } : {}) })
    } catch {
      result = retained("CLOSE_ACKNOWLEDGEMENT_MISSING")
    }
    try {
      this.save(entry, result.success
        ? { state: "closed", closed_at: new Date().toISOString() }
        : { state: "retained", reason: typeof result.data?.reason === "string" && /^[A-Z_]{1,64}$/.test(result.data.reason) ? result.data.reason : "CLOSE_FAILED" })
    } catch {
      // Keep the pre-dispatch `closing` record; never fabricate a durable close acknowledgement.
      result = result.success ? { ...result, data: { ...result.data,
        task_tab_lifecycle: { state: "close_acknowledgement_unrecorded", reason: "SOURCE_ARCHIVE_FAILED" } } } : this.archiveWarning(result)
    }
    if (result.success) this.entries.delete(entry.page.tab_id)
    else entry.ready = false
    return result
  }

  async finish(successful: boolean): Promise<{ closed: number; retained: number }> {
    const summary = { closed: 0, retained: 0 }
    if (!successful || !this.opts.current()) return summary
    for (const entry of [...this.entries.values()]) {
      if (!this.opts.current()) break
      if (!entry.ready) {
        try { this.save(entry, { state: "retained", reason: "NO_SAVED_CURRENT_EVIDENCE" }) } catch { /* tab stays open */ }
        summary.retained++
        continue
      }
      const result = await this.close(randomUUID(), entry, true)
      if (result.success) summary.closed++
      else summary.retained++
    }
    return summary
  }
}
