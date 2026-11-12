import { browserSiteTarget } from "./browser-site-target"

export type TaskTabOwner = { thread_id: string; execution_id: string }
type Claim = { token: string; owner: TaskTabOwner; adopted: boolean }
export type TaskTabCleanup = { token: string; navigation_key: string; automatic: boolean }

/** Only the server frame supplies this context; model tool parameters cannot. */
export function taskTabOwner(value: unknown): TaskTabOwner | undefined {
  if (!value || typeof value !== "object") return
  const v = value as Record<string, unknown>
  if (typeof v.thread_id !== "string" || !v.thread_id || v.thread_id.length > 128 ||
      typeof v.execution_id !== "string" || !/^[a-f0-9-]{36}$/.test(v.execution_id)) return
  return { thread_id: v.thread_id, execution_id: v.execution_id }
}

const same = (a: TaskTabOwner, b: TaskTabOwner | undefined) =>
  !!b && a.thread_id === b.thread_id && a.execution_id === b.execution_id

/** In-memory creation claims fail closed after an extension-worker restart. */
export class TaskTabs {
  private claims = new Map<number, Claim>()
  constructor(private deps: {
    tab(id: number): Promise<chrome.tabs.Tab>
    remove(id: number): Promise<void>
    edited(id: number): Promise<boolean>
    busy(id: number): boolean
  }) {}

  created(tabId: number, owner: TaskTabOwner): string {
    const token = crypto.randomUUID()
    this.claims.set(tabId, { token, owner, adopted: false })
    return token
  }
  forget(tabId: number) { this.claims.delete(tabId) }
  adopt(tabId: number) { const claim = this.claims.get(tabId); if (claim) claim.adopted = true }
  observe(tabId: number | undefined, owner: TaskTabOwner | undefined) {
    if (tabId === undefined) return
    const claim = this.claims.get(tabId)
    if (claim && !same(claim.owner, owner)) claim.adopted = true
  }

  async close(tabId: number, value: unknown, owner: TaskTabOwner | undefined): Promise<{
    success: boolean; error?: string; data?: { error_code: string; reason: string }
  }> {
    const retained = (reason: string) => ({ success: false, error: "TASK_TAB_RETAINED: " + reason,
      data: { error_code: "TASK_TAB_RETAINED", reason } })
    if (!value || typeof value !== "object") return retained("INVALID_CLEANUP")
    const guard = value as TaskTabCleanup
    const claim = this.claims.get(tabId)
    if (!claim || !same(claim.owner, owner) || claim.token !== guard.token ||
        !/^[a-f0-9]{64}$/.test(guard.navigation_key) || typeof guard.automatic !== "boolean") return retained("NOT_OWNED")
    const reason = (tab: chrome.tabs.Tab) => {
      if (this.claims.get(tabId) !== claim || claim.adopted) return "USER_OR_OTHER_TASK_ADOPTED"
      if (this.deps.busy(tabId)) return "OPERATION_IN_FLIGHT"
      if (tab.pinned || tab.audible) return "PINNED_OR_AUDIBLE"
      if (guard.automatic && tab.active) return "FOREGROUND_TAB"
      return undefined
    }
    try {
      const first = await this.deps.tab(tabId)
      let keep = reason(first)
      if (keep) return retained(keep)
      const target = await browserSiteTarget(tabId, first.url)
      if (!target || target.navigation_key !== guard.navigation_key) return retained("TARGET_CHANGED")
      if (await this.deps.edited(tabId)) return retained("EDITED_FORM")
      // Recheck browser metadata and adoption after all asynchronous inspection.
      const last = await this.deps.tab(tabId)
      keep = reason(last)
      if (keep) return retained(keep)
      if (last.url !== first.url) return retained("TARGET_CHANGED")
      await this.deps.remove(tabId)
      this.forget(tabId)
      return { success: true }
    } catch { return retained("CLOSE_OR_INSPECTION_FAILED") }
  }
}

/** Inspect only edit state; never copy form values or page text to the host. */
export async function taskTabHasEdits(tabId: number): Promise<boolean> {
  const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => {
    const edited = () => {
      if (Array.from(document.querySelectorAll("[contenteditable]")).some(node => (node as HTMLElement).isContentEditable)) return true
      return Array.from(document.querySelectorAll("input,textarea,select")).some(node => {
        if (node instanceof HTMLInputElement) {
          if (["checkbox", "radio"].includes(node.type)) return node.checked !== node.defaultChecked
          if (["button", "submit", "reset", "hidden"].includes(node.type)) return false
          if (node.type === "file") return !!node.files?.length
          // Browser-normalized defaults (range/color/number) can differ from the raw value attribute.
          const baseline = node.cloneNode(false) as HTMLInputElement
          baseline.value = node.defaultValue
          return node.value !== baseline.value
        }
        if (node instanceof HTMLTextAreaElement) return node.value !== node.defaultValue
        if (node instanceof HTMLSelectElement) {
          const options = Array.from(node.options)
          if (node.multiple) return options.some(option => option.selected !== option.defaultSelected)
          const explicit = options.map((option, index) => option.defaultSelected ? index : -1).filter(index => index >= 0)
          const initial = explicit.at(-1) ?? (node.size > 1 ? -1 : options.findIndex(option =>
            !option.disabled && !(option.parentElement?.tagName === "OPTGROUP" && (option.parentElement as HTMLOptGroupElement).disabled)))
          return node.selectedIndex !== initial
        }
        return false
      })
    }
    return { edited: edited(), child_frames: window.length }
  } })
  const frameIds = new Set(results.map(row => row.frameId))
  if (!frameIds.has(0) || frameIds.size !== results.length || results.some(row =>
      !row.result || typeof row.result.edited !== "boolean" || !Number.isSafeInteger(row.result.child_frames) || row.result.child_frames < 0) ||
      results.reduce((count, row) => count + row.result!.child_frames, 0) !== results.length - 1) throw new Error("EDIT_STATE_UNAVAILABLE")
  return results.some(row => row.result!.edited)
}
