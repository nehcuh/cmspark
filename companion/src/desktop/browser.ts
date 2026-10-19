/** #476: per-native-owner browser view/next-run restriction, never a tool grant. */
import { randomBytes } from "node:crypto"
import { redactSecrets } from "../threads/distill"
import { acquireOrRenewTabLease, peekTabLease, releaseTabLease, type TabLease } from "../orchestrator/tab-lease"
import type { DesktopBrowserPeer } from "./browser-peer"
import type { WebSocket } from "ws"

export const DESKTOP_BROWSER_METHODS = ["desktop.browser.status", "desktop.browser.tasks", "desktop.browser.visibility", "desktop.browser.retire"] as const
export type BrowserRoute = { peer: WebSocket; tabId: number; remaining(): number; current(): boolean; finish(): Promise<boolean> }
export type DesktopBrowserRun = { target(): number | undefined; route(tool: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<BrowserRoute | undefined>; close(): void }
export type BrowserReservation = { bind(run: { id?: string; current(): boolean }): DesktopBrowserRun | undefined; close(): void }
type Tab = { tab_id: number; window_id: number; navigation_key: string; title: string; hostname: string; active: boolean; focused: boolean }
type Choice = { id: string; peer: DesktopBrowserPeer; tab: Tab }
type Snapshot = { request: string; thread: string; id: string; end: number; controller: AbortController; choices: Choice[]; timer: ReturnType<typeof setTimeout> }
type Policy = { request: string; thread: string; end: number; choice: Choice; mode: "background" | "foreground" }
const asciiId = (v: string, max: number) => v.length >= 1 && v.length <= max && !/[^a-zA-Z0-9_-]/.test(v)
const exactHex = (v: string, n: number) => v.length === n && !/[^a-f0-9]/.test(v)
const keys = (v: Record<string, unknown>, expected: string[]) => Object.keys(v).length === expected.length && expected.every(k => Object.hasOwn(v, k))
const id = () => randomBytes(16).toString("hex")
function tab(value: unknown): Tab | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const v = value as Record<string, unknown>
  if (!keys(v, ["tab_id", "window_id", "navigation_key", "title", "hostname", "active", "focused"]) || !Number.isSafeInteger(v.tab_id) || (v.tab_id as number) <= 0 || !Number.isSafeInteger(v.window_id) || (v.window_id as number) <= 0 || typeof v.navigation_key !== "string" || !exactHex(v.navigation_key, 64) || typeof v.title !== "string" || v.title.length > 200 || typeof v.hostname !== "string" || v.hostname.length > 253 || !v.hostname || typeof v.active !== "boolean" || typeof v.focused !== "boolean") return
  return v as Tab
}
const same = (a: Tab, b: Tab) => a.tab_id === b.tab_id && a.window_id === b.window_id && a.navigation_key === b.navigation_key
const target = (c: Choice) => ({ tab_id: c.tab.tab_id, window_id: c.tab.window_id, navigation_key: c.tab.navigation_key })
export function createDesktopBrowser(opts: { current(): boolean; hasThread(id: string): boolean; peers(): DesktopBrowserPeer[]; busy(tabId: number, threadId: string): boolean; now?: () => number }) {
  const now = opts.now || (() => performance.now())
  let policyExpiry: ReturnType<typeof setTimeout> | undefined
  let lastParent: string | undefined
  let snapshot: Snapshot | undefined, policy: Policy | undefined, reservation: { p: Policy; cancelled: boolean } | undefined
  let active: { p: Policy; run: { id?: string; current(): boolean }; closed: boolean; controller: AbortController; lease: Readonly<TabLease>; acquired: boolean; leaseJSON: string; onPeerClose?: () => void } | undefined
  const leaseSafe = (l: Readonly<TabLease>, p: Policy) => l.state === "HARD_HELD" && l.holderThreadId === p.thread && l.confirmId === undefined && l.mutationHolds === 0 && l.createdHoldUntil === null && l.softDeadline === undefined && l.forceReleasingAt === undefined && Date.now() <= l.idleDeadline && Date.now() <= l.hardMaxDeadline && !opts.busy(l.tabId, p.thread)
  const owner = () => opts.current()
  const live = (s: Snapshot) => owner() && snapshot === s && now() < s.end && !s.controller.signal.aborted && opts.hasThread(s.thread)
  function retireView() { const s = snapshot; snapshot = undefined; if (s) { clearTimeout(s.timer); s.controller.abort() } }
  function closeRun() { const a = active; active = undefined; if (a) { a.closed = true; a.controller.abort(); if (a.onPeerClose) a.p.choice.peer.socket.off("close", a.onPeerClose); if (a.acquired && peekTabLease(a.p.choice.tab.tab_id) === a.lease && JSON.stringify(a.lease) === a.leaseJSON && leaseSafe(a.lease, a.p)) releaseTabLease(a.p.choice.tab.tab_id, "desktop.browser.retire", a.p.thread) } }
  function clearPolicy() { policy = undefined; if (policyExpiry) clearTimeout(policyExpiry); policyExpiry = undefined }
  function cancel() { retireView(); clearPolicy(); if (reservation) reservation.cancelled = true; reservation = undefined; closeRun() }
  function intent(type: string, value?: unknown) {
    if (["thread.list", "mcp.list", "skill.list", "knowledge.list"].includes(type)) retireView()
    if (["thread.peek", "desktop.thread.open", "desktop.chat.send"].includes(type)) {
      const current = active?.p.thread || reservation?.p.thread || policy?.thread || snapshot?.thread
      if (current && current !== value) cancel(); else retireView()
    }
    if (type === "desktop.thread.create") cancel()
  }
  const inspect = async (c: Choice, signal: AbortSignal, end: number, op: "inspect" | "reveal" = "inspect") => {
    if (!c.peer.current() || signal.aborted || now() >= end) return
    const v = tab(await c.peer.request(op, target(c), signal, end - now()))
    return c.peer.current() && !signal.aborted && now() < end && v && same(c.tab, v) ? v : undefined
  }
  async function handle(f: Record<string, unknown>): Promise<Record<string, unknown>> {
    const fail = (code = "DESKTOP_BROWSER_INPUT_INVALID") => ({ type: String(f.type) + ".result", id: f.id, ...(typeof f.thread_id === "string" ? { thread_id: f.thread_id } : {}), ok: false, error_code: code })
    if (!owner()) return fail("DESKTOP_BROWSER_CONTEXT_STALE")
    if (f.type === "desktop.browser.retire") {
      if (!keys(f, ["type", "context_request_id", "scope"]) || typeof f.context_request_id !== "string" || !asciiId(f.context_request_id, 128) || !["view", "all"].includes(String(f.scope))) return fail()
      const parent = f.context_request_id
      if (snapshot?.request === parent) retireView()
      if (f.scope === "all" && parent === lastParent) { cancel(); return { type: "desktop.browser.retire.result", ok: true } }
      if (f.scope === "all") {
        if (policy?.request === parent) clearPolicy()
        if (reservation?.p.request === parent) { reservation.cancelled = true; reservation = undefined }
        if (active?.p.request === parent) closeRun()
      }
      return { type: "desktop.browser.retire.result", ok: true }
    }
    if (typeof f.id !== "string" || !asciiId(f.id, 128)) return fail()
    if (f.type === "desktop.browser.status") {
      if (!keys(f, ["type", "id"])) return fail()
      retireView()
      const n = opts.peers().filter(p => p.current()).length
      return { type: f.type + ".result", id: f.id, ok: true, availability: n === 0 ? "unavailable" : n === 1 ? "single_peer" : "multiple_peers", peer_count: Math.min(n, 21), truncated: n > 20, operations: { task_metadata: "supports_background", get_page_text: "supports_background", reveal_task_tab: "requires_foreground", unknown: "unavailable" } }
    }
    if (typeof f.thread_id !== "string" || !asciiId(f.thread_id, 64) || !opts.hasThread(f.thread_id)) return fail("DESKTOP_BROWSER_THREAD_NOT_FOUND")
    if (f.type === "desktop.browser.tasks") {
      if (!keys(f, ["type", "id", "thread_id"])) return fail()
      lastParent = f.id
      retireView(); clearPolicy(); if (reservation) { reservation.cancelled = true; reservation = undefined }
      if (active && active.p.thread !== f.thread_id) closeRun()
      const s: Snapshot = { request: f.id, thread: f.thread_id, id: id(), end: now() + 15000, controller: new AbortController(), choices: [], timer: undefined! }
      snapshot = s; s.timer = setTimeout(() => { if (snapshot === s) retireView(); if (policy?.request === s.request) clearPolicy() }, 15000); s.timer.unref?.()
      let truncated = false
      const seen = new Set<string>()
      try {
        const peers = opts.peers().filter(p => p.current()); truncated = peers.length > 20
        for (const [i, p] of peers.slice(0, 20).entries()) {
          const value = await p.request("snapshot", {}, s.controller.signal, s.end - now()) as any
          if (!live(s) || !p.current() || !value || !Array.isArray(value.tabs) || value.tabs.length > 20 || typeof value.truncated !== "boolean" || Object.keys(value).some(k => !["tabs", "truncated"].includes(k))) throw Error("UNAVAILABLE")
          truncated ||= value.truncated
          for (const raw of value.tabs) {
            const t = tab(raw); if (!t) throw Error("UNAVAILABLE")
            const identity = p.id + ":" + t.tab_id
            if (seen.has(identity)) throw Error("UNAVAILABLE"); seen.add(identity)
            if (active && (active.p.choice.peer !== p || !same(active.p.choice.tab, t))) continue
            if (s.choices.length === 20) { truncated = true; break }
            s.choices.push({ id: id(), peer: p, tab: t })
          }
          void i
        }
        if (!live(s)) throw Error("STALE")
        return { type: f.type + ".result", id: f.id, thread_id: s.thread, context_id: s.id, ok: true, remaining_ms: Math.max(0, Math.floor(s.end - now())), choices: s.choices.map(c => ({ selection_id: c.id, peer_label: "Chrome 扩展 " + (peers.indexOf(c.peer) + 1), title: redactSecrets(c.tab.title).text, hostname: c.tab.hostname, association: active ? "task" : "explicit_candidate" })), tasks: active ? [{ task_id: active.run.id, operation: "get_page_text", status: "running" }] : [], truncated }
      } catch { if (snapshot === s) retireView(); return fail("DESKTOP_BROWSER_UNAVAILABLE") }
    }
    if (f.type !== "desktop.browser.visibility" || !keys(f, ["type", "id", "thread_id", "context_id", "selection_id", "visibility"]) || typeof f.context_id !== "string" || !exactHex(f.context_id, 32) || typeof f.selection_id !== "string" || !exactHex(f.selection_id, 32) || !["background", "foreground"].includes(String(f.visibility))) return fail()
    const s = snapshot, c = s?.choices.find(c => c.id === f.selection_id)
    if (!s || !live(s) || s.id !== f.context_id || s.thread !== f.thread_id || !c) return fail("DESKTOP_BROWSER_CONTEXT_STALE")
    // Consume the selection before awaiting: duplicates cannot dispatch twice.
    s.choices = []
    try {
      const t = await inspect(c, s.controller.signal, s.end, f.visibility === "foreground" ? "reveal" : "inspect")
      if (!live(s) || !t || (f.visibility === "foreground" && (!t.active || !t.focused))) return fail("DESKTOP_BROWSER_UNCONFIRMED")
      if (!active) {
        clearPolicy(); const selected: Policy = { request: s.request, thread: s.thread, end: s.end, choice: c, mode: f.visibility as "background" | "foreground" }; policy = selected
        policyExpiry = setTimeout(() => { if (policy === selected) clearPolicy() }, Math.max(1, Math.ceil(s.end - now()))); policyExpiry.unref?.()
      }
      return { type: f.type + ".result", id: f.id, thread_id: s.thread, context_id: s.id, ok: true, outcome: f.visibility, observed_active: t.active, observed_focused: t.focused, policy_selected: !active, remaining_ms: Math.max(0, Math.floor(s.end - now())) }
    } catch { return fail("DESKTOP_BROWSER_UNCONFIRMED") }
  }
  function reserve(threadId: string): BrowserReservation | undefined {
    const p = policy; clearPolicy()
    if (!p || active || reservation || !owner() || !opts.hasThread(threadId) || p.thread !== threadId || now() >= p.end || !p.choice.peer.current()) return
    const ticket = { p, cancelled: false }; reservation = ticket
    let bound: DesktopBrowserRun | undefined
    const close = () => { ticket.cancelled = true; if (reservation === ticket) reservation = undefined; bound?.close() }
    return { close, bind(run) {
      if (reservation !== ticket || ticket.cancelled || !owner() || now() >= p.end || !run.id || !run.current() || !p.choice.peer.current()) { close(); return }
      reservation = undefined
      const prior = peekTabLease(p.choice.tab.tab_id)
      // Never let needsL2:false promote SOFT/HELD_PENDING or renew a prior holder.
      if (opts.busy(p.choice.tab.tab_id, p.thread) || (prior && !leaseSafe(prior, p))) { close(); return }
      const result = prior ? { ok: true as const, lease: prior } : acquireOrRenewTabLease({ tabId: p.choice.tab.tab_id, holderThreadId: p.thread, needsL2: false })
      if (!result.ok) { close(); return }
      const a = { p, run, lease: result.lease, acquired: !prior, leaseJSON: JSON.stringify(result.lease), closed: false, controller: new AbortController() }; active = a
      const onPeerClose = () => { if (active === a) closeRun() }; active.onPeerClose = onPeerClose; p.choice.peer.socket.once("close", onPeerClose)
      const valid = () => active === a && !a.closed && owner() && run.current() && opts.hasThread(p.thread) && p.choice.peer.current() && peekTabLease(p.choice.tab.tab_id) === a.lease && JSON.stringify(a.lease) === a.leaseJSON && leaseSafe(a.lease, p)
      if (!valid()) { closeRun(); close(); return }
      bound = { target: () => valid() ? p.choice.tab.tab_id : undefined, close: () => { if (active === a) closeRun() }, async route(tool, params, signal) {
        if (tool !== "get_page_text" || !valid() || signal?.aborted || Object.keys(params).some(k => !["tabId", "__thread_id"].includes(k)) || (params.tabId !== undefined && params.tabId !== p.choice.tab.tab_id) || (params.__thread_id !== undefined && params.__thread_id !== p.thread)) return
        const end = now() + 15000, combined = signal ? AbortSignal.any([signal, a.controller.signal]) : a.controller.signal
        try {
          if (!await inspect(p.choice, combined, end) || !valid()) { bound?.close(); return }
          return { peer: p.choice.peer.socket, tabId: p.choice.tab.tab_id, remaining: () => Math.max(0, Math.floor(end - now())), current: () => valid() && !combined.aborted && now() < end, async finish() { try { const after = await inspect(p.choice, combined, end); if (!after || !valid()) { bound?.close(); return false }; return true } catch { bound?.close(); return false } } }
        } catch { bound?.close(); return }
      } }; return bound
    } }
  }
  return { handle, intent, reserve, cancel }
}
