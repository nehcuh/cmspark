import type { ThreadManager } from "../../threads/thread-manager"
import { isChromeExtensionWsOrigin } from "../../ws/handshake-surface"
import { resolveBrowserSiteTarget } from "../../site-context/browser-resolver"
import { siteTargetKey } from "../../site-context/target"
import { ERROR_CODE_LEVELS } from "../../security"
import { readSiteOriginCounter, resetSiteOriginCounter, SITE_ORIGIN_FAIL_ESCALATE } from "../../tool/site-op-memory"

type CounterSession = {
  origin?: string; surface?: string; panelId?: string; originWs?: unknown; isCurrentSession?: () => boolean
  executeTool: Parameters<typeof resolveBrowserSiteTarget>[0]
}
type Selection = { threadId: string; panelId: string; observed?: { tabId: number; targetKey: string } }
const selections = new WeakMap<object, Selection>()
function peer(session?: CounterSession): object | undefined {
  return session?.surface === "panel" && isChromeExtensionWsOrigin(session.origin) && !!session.panelId
    && session.isCurrentSession?.() === true && session.originWs && typeof session.originWs === "object" ? session.originWs : undefined
}
/** Only the actual authenticated thread.select caller updates this owner. */
export function noteSiteCounterThreadSelection(session: CounterSession | undefined, threadId: string): void {
  const ws = peer(session)
  if (ws) selections.set(ws, { threadId, panelId: session!.panelId! })
}
export function validateSiteCounterMessage(m: any): { valid: boolean; error?: string } {
  const reset = m?.type === "site.counter.reset"
  const allowed = new Set(["type", "id", "source", "thread_id", "context_tab_id", ...(reset ? ["target_key", "user_gesture"] : [])])
  if (!m || (m.type !== "site.counter.status" && !reset) || Object.keys(m).some(k => !allowed.has(k)) || m.source !== "settings"
    || typeof m.id !== "string" || !/^[A-Za-z0-9:_-]{1,100}$/.test(m.id)
    || typeof m.thread_id !== "string" || !m.thread_id.trim() || m.thread_id.length > 128
    || !Number.isSafeInteger(m.context_tab_id) || m.context_tab_id < 0
    || (reset && (m.user_gesture !== true || typeof m.target_key !== "string" || !/^[a-f0-9]{64}$/.test(m.target_key)))) {
    return { valid: false, error: "站点计数请求格式无效" }
  }
  return { valid: true }
}

export async function handleSiteCounterMessage(msg: any, manager: ThreadManager, session: CounterSession | undefined, busy: () => boolean) {
  const error = (code: string) => ({ type: "site.counter.error", id: typeof msg?.id === "string" && /^[A-Za-z0-9:_-]{1,100}$/.test(msg.id) ? msg.id : undefined, thread_id: typeof msg?.thread_id === "string" && msg.thread_id.length <= 128 ? msg.thread_id : undefined, code })
  if (!validateSiteCounterMessage(msg).valid) return error("SITE_COUNTER_INVALID")
  const ws = peer(session)
  if (!ws) return error("SITE_COUNTER_CALLER_DENIED")
  const selected = selections.get(ws)
  const current = () => peer(session) === ws && selections.get(ws) === selected && selected?.threadId === msg.thread_id
    && selected?.panelId === session!.panelId && !!manager.get(msg.thread_id) && !manager.get(msg.thread_id)?.trashed_at
  if (!current()) return error("SITE_COUNTER_STALE")
  const resetting = msg.type === "site.counter.reset"
  const observed = selected?.observed
  if (resetting && (!observed || observed.tabId !== msg.context_tab_id || observed.targetKey !== msg.target_key)) return error("SITE_COUNTER_STALE")
  if (resetting && busy()) return error("SITE_COUNTER_BUSY")
  const resolve = () => resolveBrowserSiteTarget(session!.executeTool, msg.thread_id, msg.context_tab_id, undefined, 1500, true)
  const first = await resolve()
  if (!current() || (resetting && selected!.observed !== observed)) return error("SITE_COUNTER_STALE")
  if (!first) return error("SITE_COUNTER_UNAVAILABLE")
  if (resetting) {
    if (first.navigation_key !== msg.target_key || busy()) return error(busy() ? "SITE_COUNTER_BUSY" : "SITE_COUNTER_STALE")
    const latest = await resolve()
    if (!current() || selected!.observed !== observed) return error("SITE_COUNTER_STALE")
    if (!latest || siteTargetKey(latest) !== siteTargetKey(first) || latest.navigation_key !== msg.target_key) return error("SITE_COUNTER_STALE")
    // Final liveness/selection/target comparison and busy fence are followed by
    // synchronous count-only mutation. No client idle/hostname authority or await.
    if (busy()) return error("SITE_COUNTER_BUSY")
    resetSiteOriginCounter(msg.thread_id, latest.origin)
  }
  const state = readSiteOriginCounter(msg.thread_id, first.origin, first.tab_id)
  selected!.observed = { tabId: first.tab_id, targetKey: first.navigation_key }
  return { type: "site.counter.state", id: msg.id, thread_id: msg.thread_id, context_tab_id: first.tab_id,
    origin: first.origin, target_key: first.navigation_key, fails: state.fails,
    last_code: ERROR_CODE_LEVELS.has(state.lastCode) ? state.lastCode : "UNKNOWN", threshold: SITE_ORIGIN_FAIL_ESCALATE,
    health: "unknown", locator_ban: state.locatorBan, attach_frozen: state.attachFrozen, busy: busy(), reset: resetting }
}
