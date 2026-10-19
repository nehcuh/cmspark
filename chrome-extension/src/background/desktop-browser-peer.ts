/** #476 fixed metadata/reveal channel; no debugger, scripting or tool execution. */
import { browserSiteTarget } from "./browser-site-target"
const exact = (v: Record<string, unknown>, fields: string[]) => Object.keys(v).length === fields.length && fields.every(k => Object.hasOwn(v, k))
const observations = new WeakMap<object, () => boolean>()
type Navigation = { current(): boolean; key(urlKey: string): Promise<string> }
type Track = (t: chrome.tabs.Tab) => Navigation | undefined
async function describe(t: chrome.tabs.Tab, owner: () => boolean, track: Track) {
  const nav = track(t); if (!nav) return
  const live = () => owner() && nav.current()
  if (!live()) return
  if (!Number.isSafeInteger(t.id) || (t.id || 0) <= 0 || !Number.isSafeInteger(t.windowId) || t.windowId <= 0 || typeof t.url !== "string") return
  const site = await browserSiteTarget(t.id!, t.url); if (!live() || !site) return
  const w = await chrome.windows.get(t.windowId); if (!live()) return
  const current = await chrome.tabs.get(t.id!)
  if (!live() || current.status === "loading" || current.pendingUrl !== undefined || current.url !== t.url || current.windowId !== t.windowId) return
  const navigationKey = await nav.key(site.navigation_key); if (!live()) return
  const result = { tab_id: t.id!, window_id: t.windowId, navigation_key: navigationKey, title: (t.title || "").slice(0, 200), hostname: site.hostname.slice(0, 253), active: current.active === true, focused: w.focused === true }
  observations.set(result, live); return result
}
async function execute(frame: Record<string, unknown>, live: () => boolean, track: Track) {
  const fail = () => ({ type: "desktop.browser.peer.result", id: frame.id, ok: false })
  if (typeof frame.id !== "string" || frame.id.length > 128 || !frame.id || /[^a-zA-Z0-9_-]/.test(frame.id)) return fail()
  try {
    if (frame.op === "snapshot") {
      if (!exact(frame, ["type", "id", "op", "remaining_ms"])) return fail()
      const all = await chrome.tabs.query({}), tabs = []; if (!live()) return fail()
      for (const t of all) { const d = await describe(t, live, track); if (d) tabs.push(d); if (tabs.length === 20) break }
      if (!live() || tabs.some(t => !observations.get(t)?.())) return fail()
      return { type: "desktop.browser.peer.result", id: frame.id, ok: true, data: { tabs, truncated: all.length > tabs.length } }
    }
    if (!["inspect", "reveal"].includes(String(frame.op)) || !exact(frame, ["type", "id", "op", "remaining_ms", "tab_id", "window_id", "navigation_key"]) || !Number.isSafeInteger(frame.tab_id) || (frame.tab_id as number) <= 0 || !Number.isSafeInteger(frame.window_id) || (frame.window_id as number) <= 0 || typeof frame.navigation_key !== "string" || frame.navigation_key.length !== 64 || /[^a-f0-9]/.test(frame.navigation_key)) return fail()
    const matches = (d: Awaited<ReturnType<typeof describe>>) => d && observations.get(d)?.() && d.tab_id === frame.tab_id && d.window_id === frame.window_id && d.navigation_key === frame.navigation_key
    const before = await describe(await chrome.tabs.get(frame.tab_id as number), live, track); if (!live() || !matches(before)) return fail()
    if (frame.op === "reveal") {
      if (!live() || !matches(before)) return fail()
      await chrome.tabs.update(before!.tab_id, { active: true }); if (!live()) return fail()
      if (!live() || !matches(await describe(await chrome.tabs.get(before!.tab_id), live, track))) return fail()
      if (!live() || !matches(before)) return fail()
      await chrome.windows.update(before!.window_id, { focused: true }); if (!live()) return fail()
    }
    const after = await describe(await chrome.tabs.get(before!.tab_id), live, track); if (!live() || !matches(after)) return fail()
    return { type: "desktop.browser.peer.result", id: frame.id, ok: true, data: after }
  } catch { return fail() }
}

/** Up to 64 in-flight requests, including cancelled unresolved Chrome calls.
 * Cancellation is never an undo; a hung old call cannot make capacity unbounded. */
export function createDesktopBrowserPeerHandler() {
  const pending = new Map<string, { active: boolean }>(), navigation = new Map<number, object>()
  const sessionKey = crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  let observing = false
  const track: Track = t => {
    if (!Number.isSafeInteger(t.id) || (t.id || 0) <= 0 || t.status === "loading" || t.pendingUrl !== undefined) return
    const id = t.id!; let token = navigation.get(id)
    if (!token) { if (navigation.size >= 64) navigation.delete(navigation.keys().next().value!); token = {}; navigation.set(id, token) }
    const owned = token, nonce = (owned as { nonce?: string }).nonce ||= crypto.randomUUID()
    return { current: () => navigation.get(id) === owned, async key(urlKey) { const bytes = await crypto.subtle.sign("HMAC", await sessionKey, new TextEncoder().encode(urlKey + ":" + nonce)); return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("") } }
  }
  function observe() {
    if (observing) return
    // These existing tabs events are evidence only when observed; no new permission.
    chrome.tabs.onUpdated.addListener((id, change) => { if (change.status === "loading" || Object.hasOwn(change, "url")) navigation.delete(id) })
    chrome.tabs.onRemoved.addListener(id => navigation.delete(id)); observing = true
  }
  return {
    cancel(frame: Record<string, unknown>) {
      if (exact(frame, ["type", "id"]) && typeof frame.id === "string") { const p = pending.get(frame.id); if (p) p.active = false }
    },
    reset() { for (const p of pending.values()) p.active = false; navigation.clear() },
    async request(frame: Record<string, unknown>, connectionCurrent: () => boolean) {
      const fail = () => ({ type: "desktop.browser.peer.result", id: frame.id, ok: false })
      if (typeof frame.id !== "string" || !frame.id || frame.id.length > 128 || /[^a-zA-Z0-9_-]/.test(frame.id) || pending.has(frame.id) || pending.size >= 64 || !Number.isSafeInteger(frame.remaining_ms) || (frame.remaining_ms as number) < 1 || (frame.remaining_ms as number) > 15000 || !connectionCurrent()) return fail()
      observe()
      const token = { active: true }, id = frame.id, end = performance.now() + (frame.remaining_ms as number)
      pending.set(id, token)
      const live = () => pending.get(id) === token && token.active && connectionCurrent() && performance.now() < end
      const timer = setTimeout(() => { if (pending.get(id) === token) token.active = false }, frame.remaining_ms as number)
      try { const result = await execute(frame, live, track); return live() ? result : fail() }
      finally { clearTimeout(timer); if (pending.get(id) === token) pending.delete(id) }
    },
  }
}
