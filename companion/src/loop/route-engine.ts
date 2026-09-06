// L-3 (#389) route-switch engine — directive steer + blocked declaration +
// strategy chain + IMPOSSIBLE report + checkpoint restore.
// Design: FINAL-SYNTHESIS §分歧 2 + L-3.
//
// NEVER: force a tool call (close door / instruct / declare only);
// put evaluate / spawn_worker / module-enable on the chain;
// treat plan-approve as CU authorize; flip computer.coordinateEnabled.
// #357/#358 originFails counters are READ-ONLY here.

import { evidenceItems } from "./completion-predicate"
import { buildUnlockContract, type TriedRoute, type UnlockContract } from "./stall-classifier"
import type { RunProgress } from "../threads/run-progress"

/** Strategy chain. evaluate / spawn_worker / module-enable are NOT on it. */
export const ROUTE_CHAIN = [
  "cdp-dom",
  "cdp-alt",
  "host_computer",
  "osascript",
  "human",
] as const
export type RouteClass = (typeof ROUTE_CHAIN)[number]

export const ROUTE_BUDGETS = {
  /** Cross-class attempts per checklist item. */
  crossClassPerItem: 2,
  /** Route-directive steers per item. Two ignores after steers → blocked. */
  steerPerItem: 2,
} as const

export function maxTotalSteers(runCount: number): number {
  return Math.max(0, Math.floor(runCount / 2))
}

const CDP_DOM = new Set([
  "click",
  "dblclick",
  "type",
  "hover",
  "fill_form",
  "get_element_info",
  "select_option",
  "press_key",
  "drag_and_drop",
  "wait_for",
  "scroll",
  "scroll_to",
  "get_page_text",
  "get_page_html",
])
const CDP_ALT = new Set(["navigate", "create_tab", "set_tab_url", "screenshot", "list_tabs"])

/** Map a tool to a chain class. Forbidden tools (evaluate, spawn_worker) → null. */
export function classifyToolRoute(toolName: string): RouteClass | null {
  if (toolName === "host_computer") return "host_computer"
  if (toolName === "osascript_eval") return "osascript"
  if (toolName === "loop_declare_blocked") return "human"
  if (CDP_DOM.has(toolName)) return "cdp-dom"
  if (CDP_ALT.has(toolName)) return "cdp-alt"
  return null
}

/** Alternative to CDP after origin escalate: R3/R4/R5 only. R2 is still CDP. */
export function isPostEscalateAlternative(route: RouteClass | null): boolean {
  return route === "host_computer" || route === "osascript" || route === "human"
}

export type RouteCapabilities = {
  /** computer.coordinateEnabled — READ, never written by this engine. */
  cuArmed: boolean
  osascriptAvailable: boolean
  /**
   * L-4 (#390) tier cap: "browser-tier" when the cruise tier (仅 L1 面) keeps
   * the host surface out of the fan-out — unlock copy then points at 升档,
   * not at coordinateEnabled. Null/undefined = the L-3 unarmed-CU semantics.
   */
  r3CapReason?: "browser-tier" | null
}

export type ItemRouteState = {
  itemId: string
  triedRoutes: TriedRoute[]
  crossClassCount: number
  steerCount: number
  ignoreCount: number
  /** Runs after origin-escalate with no alt route and no tick. */
  staleRuns: number
  blocked: UnlockContract | null
  lastSteerTarget: RouteClass | null
}

export type RouteSteer = {
  itemId: string
  itemText: string
  target: RouteClass
  text: string
}

export type RouteEngineState = {
  runCount: number
  totalSteers: number
  items: Record<string, ItemRouteState>
  /** Steers injected at the start of the current run (for ignore detection). */
  injectedThisRun: RouteSteer[]
  toolsThisRun: string[]
  /** #409-B: per-tool success outcome — a FAILED host_computer/osascript is not a route switch. */
  toolSuccessThisRun: Record<string, boolean>
  declaredBlockedThisRun: string[]
  checkpoint: RouteCheckpoint | null
}

export type RouteCheckpoint = {
  at: string
  runCount: number
  totalSteers: number
  items: Record<string, ItemRouteState>
}

export type ImpossibleReport = {
  kind: "impossible-report"
  items: Array<{
    item_id: string
    tried_routes: TriedRoute[]
    blocker_class: UnlockContract["blocker_class"]
    unlock: UnlockContract["unlock"]
  }>
}

export function emptyRouteEngineState(): RouteEngineState {
  return {
    runCount: 0,
    totalSteers: 0,
    items: {},
    injectedThisRun: [],
    toolsThisRun: [],
    toolSuccessThisRun: {},
    declaredBlockedThisRun: [],
    checkpoint: null,
  }
}

export function ensureItem(state: RouteEngineState, itemId: string): ItemRouteState {
  const cur = state.items[itemId]
  if (!cur) {
    const created: ItemRouteState = {
      itemId,
      triedRoutes: [],
      crossClassCount: 0,
      steerCount: 0,
      ignoreCount: 0,
      staleRuns: 0,
      blocked: null,
      lastSteerTarget: null,
    }
    state.items[itemId] = created
    return created
  }
  const copy: ItemRouteState = { ...cur, triedRoutes: [...cur.triedRoutes] }
  state.items[itemId] = copy
  return copy
}

function noteTried(item: ItemRouteState, route: RouteClass, failure: string): void {
  const last = item.triedRoutes[item.triedRoutes.length - 1]
  if (last && last.route === route && last.failure === failure) return
  const prevClass = last?.route
  item.triedRoutes.push({ route, failure })
  if (prevClass && prevClass !== route) {
    item.crossClassCount += 1
  }
}

export function buildSteerText(p: {
  itemId: string
  itemText: string
  target: RouteClass
  cuArmed: boolean
}): string {
  const label = p.itemText ? `清单项 ${p.itemId}（${p.itemText}）` : `清单项 ${p.itemId}`
  if (p.target === "host_computer") {
    if (!p.cuArmed) {
      return (
        `${label}：CDP 已被机器封禁；host_computer 未武装，loop 不会偷偷打开 computer.use。` +
        `请调用 loop_declare_blocked，或等用户在设置中武装 CU 后再从 checkpoint 恢复。每次 host_computer 仍走既有 L2。`
      )
    }
    return (
      `${label}：CDP 已被机器封禁；本 run 必须改用 host_computer，或申报 blocked（loop_declare_blocked）。` +
      `禁止再点 CDP。host_computer 仍走既有 L2/巡航，计划批准 ≠ CU 授权。`
    )
  }
  if (p.target === "osascript") {
    return (
      `${label}：CDP 已被机器封禁且 CU 面不可用；本 run 必须改用 osascript_eval（仍 L2），或申报 blocked。`
    )
  }
  return `${label}：无法自动换路。请调用 loop_declare_blocked 申报受阻，不要再重试已封禁的 CDP。`
}

export type CloseRunInput = {
  runProgress: RunProgress | null | undefined
  originEscalated: boolean
  caps: RouteCapabilities
  /** Non-draft false→true ticks this run (L-1 Δ). */
  hadProgress: boolean
}

export type CloseRunResult = {
  state: RouteEngineState
  /** Steers to inject on the NEXT run. */
  pendingSteers: RouteSteer[]
  newlyBlocked: Array<{ itemId: string; contract: UnlockContract }>
  audits: Array<{ type: string; item_id?: string; target?: string; reason?: string }>
}

function liveItems(progress: RunProgress | null | undefined): { id: string; text: string; done: boolean }[] {
  return evidenceItems(progress).map((it) => ({
    id: it.id,
    text: it.text,
    done: it.done === true,
  }))
}

/**
 * Close one chatCreate run: count ignore, maybe block, maybe queue steers.
 * Pure: returns a new state (shallow-copied items).
 */
export function closeRouteRun(prev: RouteEngineState, input: CloseRunInput): CloseRunResult {
  const state: RouteEngineState = {
    ...prev,
    items: { ...prev.items },
    runCount: prev.runCount + 1,
    toolsThisRun: [...prev.toolsThisRun],
    toolSuccessThisRun: { ...prev.toolSuccessThisRun },
    declaredBlockedThisRun: [...prev.declaredBlockedThisRun],
    injectedThisRun: [...prev.injectedThisRun],
  }
  const audits: CloseRunResult["audits"] = []
  const newlyBlocked: CloseRunResult["newlyBlocked"] = []
  const routesUsed = new Set(
    state.toolsThisRun.map(classifyToolRoute).filter((r): r is RouteClass => r != null),
  )
  // #409-B: only a SUCCESSFUL host_computer/osascript counts as "已换路".
  // A FAILED one (COMPUTER_DISABLED / TAB_NOT_FOUND) must not clear staleRuns
  // — otherwise the r3-unarmed unlock never surfaces. routesUsed (name-based)
  // stays as-is for steer-obedience detection: trying and failing is still
  // obedience, it is just not progress.
  const succeededAltRoute: RouteClass | null = (() => {
    for (const t of state.toolsThisRun) {
      const r = classifyToolRoute(t)
      if ((r === "host_computer" || r === "osascript") && state.toolSuccessThisRun[t] === true) return r
    }
    return null
  })()
  const triedAlt = succeededAltRoute !== null
  const declared = new Set(state.declaredBlockedThisRun)
  const items = liveItems(input.runProgress)
  const undone = items.filter((it) => !it.done)
  const progressed = input.hadProgress === true

  for (const steer of state.injectedThisRun) {
    const item = ensureItem(state, steer.itemId)
    if (item.blocked) continue
    const obeyed =
      routesUsed.has(steer.target) ||
      declared.has(steer.itemId) ||
      (steer.target === "host_computer" && routesUsed.has("osascript"))
    if (obeyed) {
      item.ignoreCount = 0
      item.staleRuns = 0
      if (declared.has(steer.itemId)) {
        noteTried(item, "human", "declared-blocked")
      }
      continue
    }
    item.ignoreCount += 1
    audits.push({
      type: "task_loop.steer_ignored",
      item_id: steer.itemId,
      target: steer.target,
    })
    if (item.ignoreCount >= ROUTE_BUDGETS.steerPerItem) {
      const contract = buildUnlockContract({
        signal: { kind: "steer-ignored" },
        itemId: steer.itemId,
        triedRoutes: item.triedRoutes,
        detail:
          "The model ignored two route-directive steers; restate the goal or take over. Loop will not wage a steer war.",
      })
      item.blocked = contract
      newlyBlocked.push({ itemId: steer.itemId, contract })
      audits.push({ type: "task_loop.item_blocked", item_id: steer.itemId, reason: "steer-ignored" })
    }
  }

  const reminderSteers: RouteSteer[] = []
  for (const steer of state.injectedThisRun) {
    const item = state.items[steer.itemId]
    if (!item || item.blocked) continue
    if (item.ignoreCount === 1 && item.lastSteerTarget) {
      reminderSteers.push(steer)
    }
  }

  for (const id of declared) {
    const item = ensureItem(state, id)
    if (item.blocked) continue
    const contract = buildUnlockContract({
      signal: { kind: "origin-refused" },
      itemId: id,
      triedRoutes: item.triedRoutes,
      detail: "Declared blocked after CDP escalate. Unlock: arm CU or change the plan, then restore checkpoint.",
    })
    item.blocked = contract
    newlyBlocked.push({ itemId: id, contract })
    audits.push({ type: "task_loop.item_blocked", item_id: id, reason: "declared" })
  }

  const pendingSteers: RouteSteer[] = []
  if (input.originEscalated) {
    const target: RouteClass = "host_computer"
    for (const it of undone) {
      const item = ensureItem(state, it.id)
      if (item.blocked) continue
      if (triedAlt || progressed) {
        item.staleRuns = 0
        if (succeededAltRoute) noteTried(item, succeededAltRoute, "attempted")
        continue
      }
      item.staleRuns += 1
      noteTried(item, "cdp-dom", "originFails>=4 peek-refuse")
      if (item.staleRuns < 2) continue

      // Unarmed R3: do not steer into secretly enabling CU — block + unlock.
      if (!input.caps.cuArmed) {
        const tierCapped = input.caps.r3CapReason === "browser-tier"
        const contract = buildUnlockContract({
          signal: { kind: "origin-refused" },
          itemId: it.id,
          triedRoutes: item.triedRoutes,
          detail: tierCapped
            ? "巡航档=网页巡航（仅 L1 面）：跨类路线（host_computer/osascript）不进本档扇出。升档巡航至全自动巡航（设置）后从 checkpoint 恢复；loop 不会替你升档。"
            : "Enable computer.coordinateEnabled (Settings). Loop will never flip this flag. " +
              "Plan-approve is not CU authorize. Each host_computer call still uses existing L2/cruise.",
        })
        item.blocked = contract
        newlyBlocked.push({ itemId: it.id, contract })
        audits.push({
          type: "task_loop.item_blocked",
          item_id: it.id,
          reason: tierCapped ? "r3-tier-capped" : "r3-unarmed",
        })
        continue
      }
      if (item.crossClassCount >= ROUTE_BUDGETS.crossClassPerItem) {
        const contract = buildUnlockContract({
          signal: { kind: "route-budget-exhausted" },
          itemId: it.id,
          triedRoutes: item.triedRoutes,
        })
        item.blocked = contract
        newlyBlocked.push({ itemId: it.id, contract })
        audits.push({ type: "task_loop.item_blocked", item_id: it.id, reason: "cross-class-budget" })
        continue
      }
      if (item.lastSteerTarget) continue
      if (item.steerCount >= ROUTE_BUDGETS.steerPerItem) continue
      if (state.totalSteers >= maxTotalSteers(state.runCount)) continue

      const steer: RouteSteer = {
        itemId: it.id,
        itemText: it.text,
        target,
        text: buildSteerText({
          itemId: it.id,
          itemText: it.text,
          target,
          cuArmed: input.caps.cuArmed,
        }),
      }
      pendingSteers.push(steer)
      item.steerCount += 1
      item.lastSteerTarget = target
      state.totalSteers += 1
      audits.push({ type: "task_loop.route_steer", item_id: it.id, target })
    }
  }
  pendingSteers.push(...reminderSteers.filter((s) => !pendingSteers.some((p) => p.itemId === s.itemId)))

  state.injectedThisRun = []
  state.toolsThisRun = []
  state.toolSuccessThisRun = {}
  state.declaredBlockedThisRun = []
  return { state, pendingSteers, newlyBlocked, audits }
}

export function beginRouteRun(state: RouteEngineState, steers: RouteSteer[]): RouteEngineState {
  return {
    ...state,
    injectedThisRun: [...steers],
    toolsThisRun: [],
    toolSuccessThisRun: {},
    declaredBlockedThisRun: [],
  }
}

export function noteTool(state: RouteEngineState, toolName: string, success = true): RouteEngineState {
  return {
    ...state,
    toolsThisRun: [...state.toolsThisRun, toolName],
    toolSuccessThisRun: { ...state.toolSuccessThisRun, [toolName]: success },
  }
}

export function noteDeclaredBlocked(state: RouteEngineState, itemId: string): RouteEngineState {
  const id = String(itemId || "").trim()
  if (!id) return state
  if (state.declaredBlockedThisRun.includes(id)) return state
  return { ...state, declaredBlockedThisRun: [...state.declaredBlockedThisRun, id] }
}

/**
 * L-5: immediately mark an item blocked (confirm timeout / deny) without
 * waiting for closeRouteRun. Other items stay chaseable.
 */
export function applyItemBlocked(
  state: RouteEngineState,
  itemId: string,
  contract: UnlockContract,
): RouteEngineState {
  const id = String(itemId || "").trim()
  if (!id) return state
  const next: RouteEngineState = {
    ...state,
    items: { ...state.items },
    declaredBlockedThisRun: state.declaredBlockedThisRun.includes(id)
      ? state.declaredBlockedThisRun
      : [...state.declaredBlockedThisRun, id],
  }
  const item = ensureItem(next, id)
  item.blocked = contract
  item.triedRoutes = contract.tried_routes.length ? [...contract.tried_routes] : item.triedRoutes
  return next
}

export function formatSteerPrompt(steers: RouteSteer[]): string {
  if (!steers.length) return ""
  const body = steers.map((s) => `- ${s.text}`).join("\n")
  return (
    "## Route-directive (machine, L-3)\n" +
    "These are routing constraints from origin CDP escalate — not user goal changes.\n" +
    "Do not retry banned CDP. Do not enable computer.use or modules yourself.\n" +
    "If you will not take the directed route, you MUST call loop_declare_blocked.\n" +
    body
  )
}

export function buildImpossibleReport(state: RouteEngineState): ImpossibleReport {
  const items: ImpossibleReport["items"] = []
  for (const item of Object.values(state.items)) {
    if (!item.blocked) continue
    items.push({
      item_id: item.itemId,
      tried_routes: item.triedRoutes,
      blocker_class: item.blocked.blocker_class,
      unlock: item.blocked.unlock,
    })
  }
  return { kind: "impossible-report", items }
}

export function snapshotCheckpoint(state: RouteEngineState): RouteCheckpoint {
  return {
    at: new Date().toISOString(),
    runCount: state.runCount,
    totalSteers: state.totalSteers,
    items: JSON.parse(JSON.stringify(state.items)),
  }
}

/**
 * After the user performs the unlock action (e.g. arms CU), clear that item's
 * blocked flag and restore the checkpointed budgets/tried-routes.
 */
export function restoreAfterUnlock(
  state: RouteEngineState,
  p: { itemId: string; action: string },
): { ok: true; state: RouteEngineState } | { ok: false; error: string } {
  const item = state.items[p.itemId]
  if (!item?.blocked) {
    return { ok: false, error: `item ${p.itemId} is not blocked` }
  }
  if (item.blocked.unlock.action !== p.action) {
    return {
      ok: false,
      error: `unlock action mismatch: need ${item.blocked.unlock.action}, got ${p.action}`,
    }
  }
  const next: RouteEngineState = {
    ...state,
    items: { ...state.items },
    checkpoint: snapshotCheckpoint(state),
  }
  next.items[p.itemId] = {
    ...item,
    blocked: null,
    ignoreCount: 0,
    staleRuns: 0,
    lastSteerTarget: null,
  }
  return { ok: true, state: next }
}
