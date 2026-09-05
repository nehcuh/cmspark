// L-5 (#391) unattended loop overlay — deny→blocked→bypass, deny-storm,
// evidence digest, blocked present (tray badge + Board, no focus steal).
// Design: FINAL-SYNTHESIS L-5. 45s fail-closed is NOT changed here.
//
// RED LINES:
// - NEVER auto-allow on confirm timeout
// - unattended default remains off (grant module)
// - loop does not extend grant TTL
// - unattended close is 「计划完成待复核」 + digest, never claim / 「任务完成」
// - blocked present does not steal cockpit focus (#326)

import { evidenceItems } from "./completion-predicate"
import { buildUnlockContract, type UnlockContract } from "./stall-classifier"
import {
  blockRouteItem,
  getImpossibleReport,
  peekRouteState,
} from "./route-session"
import { sanitizeLoopState } from "./loop-state"
import type { RunProgress, RunProgressItem } from "../threads/run-progress"
import type { ThreadManager } from "../threads/thread-manager"
import { appendCapabilityAudit } from "../packs/audit-log"
import { logger } from "../logger"

/** Consecutive NEVER-list deny/timeouts that pause an unattended loop. */
export const DENY_STORM_THRESHOLD = 3 as const

/** Unattended terminal copy — never 「任务完成」 (FINAL-SYNTHESIS 分歧 3). */
export const UNATTENDED_REVIEW_COPY = "计划完成待复核"

export const UNATTENDED_CONFIRM_DENIED = "UNATTENDED_CONFIRM_DENIED" as const

const denyStorm = new Map<string, number>()

export function _resetUnattendedOverlayForTests(): void {
  denyStorm.clear()
  trayBadgeSink = null
}

export function resetDenyStorm(threadId: string): void {
  denyStorm.delete(threadId)
}

export function peekDenyStorm(threadId: string): number {
  return denyStorm.get(threadId) ?? 0
}

export function recordConfirmApproved(threadId: string): void {
  if (threadId) denyStorm.delete(threadId)
}

function bumpDenyStorm(threadId: string): number {
  const n = (denyStorm.get(threadId) ?? 0) + 1
  denyStorm.set(threadId, n)
  return n
}

/** First unticked evidence item bound to this tool, else the first unticked. */
export function matchItemForDeniedTool(
  progress: RunProgress | null | undefined,
  toolName: string,
): RunProgressItem | null {
  const items = evidenceItems(progress).filter((it) => it.done !== true)
  if (items.length === 0) return null
  return items.find((it) => it.tool === toolName) ?? items[0] ?? null
}

export function getBlockedItemIds(threadId: string): string[] {
  const state = peekRouteState(threadId)
  const ids: string[] = []
  for (const item of Object.values(state.items)) {
    if (item.blocked) ids.push(item.itemId)
  }
  return ids
}

export function getBlockedContracts(threadId: string): UnlockContract[] {
  const state = peekRouteState(threadId)
  const out: UnlockContract[] = []
  for (const item of Object.values(state.items)) {
    if (item.blocked) out.push(item.blocked)
  }
  return out
}

export type KeyListEntry = {
  item_id: string
  blocker_class: UnlockContract["blocker_class"]
  unlock: UnlockContract["unlock"]
  tried_routes: UnlockContract["tried_routes"]
}

/** Terminal 钥匙清单 — machine-readable unlock contracts, no bodies. */
export function buildKeyList(threadId: string): KeyListEntry[] {
  const report = getImpossibleReport(threadId)
  return report.items.map((it) => ({
    item_id: it.item_id,
    blocker_class: it.blocker_class,
    unlock: it.unlock,
    tried_routes: it.tried_routes,
  }))
}

export type EvidenceDigest = {
  ticked_ids: string[]
  blocked_ids: string[]
  tools: string[]
  runs_used: number
  tokens_used: number
}

/** No claim, no tool-result bodies — audit-safe. */
export function buildEvidenceDigest(p: {
  runProgress: RunProgress | null | undefined
  blockedIds: string[]
  runsUsed: number
  tokensUsed: number
}): EvidenceDigest {
  const items = evidenceItems(p.runProgress)
  const ticked = items.filter((it) => it.done === true)
  const tools = [
    ...new Set(ticked.map((it) => it.tool).filter((t): t is string => typeof t === "string" && t.length > 0)),
  ]
  return {
    ticked_ids: ticked.map((it) => it.id),
    blocked_ids: [...p.blockedIds],
    tools,
    runs_used: p.runsUsed,
    tokens_used: p.tokensUsed,
  }
}

export type BlockedPresentResult = {
  stealFocus: false
  cockpitAction: "stay_background"
  trayBadge: { count: number; label: string }
  frame: {
    type: "task_loop.blocked_report"
    thread_id: string
    steal_focus: false
    copy: typeof UNATTENDED_REVIEW_COPY | "受阻待解锁"
    key_list: KeyListEntry[]
  }
}

let trayBadgeSink: ((badge: { count: number; label: string }) => void) | null = null

/** Test / tray adapter hook — never opens a window. */
export function setUnattendedTrayBadgeSink(
  sink: ((badge: { count: number; label: string }) => void) | null,
): void {
  trayBadgeSink = sink
}

/**
 * Present a blocked report without stealing cockpit focus (#326).
 * Tray badge + optional Board intent; cockpitAction is always stay_background.
 */
export function presentBlockedReport(p: {
  threadId: string
  keyList?: KeyListEntry[]
  sendToExtension?: (data: unknown) => void
  copy?: typeof UNATTENDED_REVIEW_COPY | "受阻待解锁"
}): BlockedPresentResult {
  const keyList = p.keyList ?? buildKeyList(p.threadId)
  const count = keyList.length
  const badge = { count, label: count > 0 ? `loop 受阻 ${count}` : "loop 受阻" }
  const result: BlockedPresentResult = {
    stealFocus: false,
    cockpitAction: "stay_background",
    trayBadge: badge,
    frame: {
      type: "task_loop.blocked_report",
      thread_id: p.threadId,
      steal_focus: false,
      copy: p.copy ?? "受阻待解锁",
      key_list: keyList,
    },
  }
  try {
    trayBadgeSink?.(badge)
  } catch {
    /* tray must never break present */
  }
  try {
    p.sendToExtension?.(result.frame)
  } catch {
    /* ws must never break present */
  }
  try {
    appendCapabilityAudit({
      type: "task_loop.blocked_present",
      at: new Date().toISOString(),
      thread_id: p.threadId,
      steal_focus: false,
      blocked_count: count,
    })
  } catch {
    /* audit must never break present */
  }
  return result
}

/**
 * Best-effort Board intent. No-op when board_mode is off. Never throws.
 * Description is the 钥匙清单, not a claim.
 */
export async function presentBlockedBoardIntent(p: {
  threadManager: ThreadManager
  threadId: string
  keyList: KeyListEntry[]
}): Promise<{ ok: boolean; intent_id?: string }> {
  if (p.keyList.length === 0) return { ok: false }
  try {
    const board = await import("../board")
    const hostId = board.resolveBoardHostThreadId(p.threadManager, p.threadId) || p.threadId
    const ensured = await board.ensureBoard(p.threadManager, hostId, { force: true })
    if (!ensured.ok) return { ok: false }
    const lines = p.keyList.map((k) => {
      const unlock = k.unlock.detail.slice(0, 180)
      return `${k.item_id}: ${k.blocker_class} — ${unlock}`
    })
    const description = `值守 loop 受阻钥匙清单（不抢焦点）\n${lines.join("\n")}`.slice(0, 2000)
    const added = await board.mutateMissionBoard(p.threadManager, hostId, (b) => {
      if (b.intents.length >= board.BOARD_CAPS.max_intents) {
        return {
          ok: false,
          error: "max_intents",
          error_code: "BOARD_CAP_INTENTS",
          recoverable: true,
        }
      }
      const now = new Date().toISOString()
      const intent = board.IntentSchema.parse({
        id: board.newBoardEntityId("intent"),
        description,
        status: "open",
        priority: "high",
        claimed_by_worker_id: null,
        heartbeat_at: null,
        parent_fact_ids: [],
        result_fact_ids: [],
        provenance: board.stampProvenance({
          actor_type: "system",
          thread_id: p.threadId,
          tool_name: "task_loop.blocked_report",
        }),
        created_at: now,
        updated_at: now,
      })
      return {
        ok: true,
        board: { ...b, intents: [...b.intents, intent], updated_at: now },
        added_intents: [intent],
      }
    })
    if (!added.ok) return { ok: false }
    const id = added.added_intents?.[0]?.id
    return { ok: true, intent_id: id }
  } catch (e: any) {
    logger.warn("task_loop.blocked_board_failed", {
      thread_id: p.threadId,
      error: e?.message || String(e),
    })
    return { ok: false }
  }
}

export type UnattendedConfirmDeniedInput = {
  threadId: string
  threadManager: ThreadManager
  toolName: string
  /** timeout = 45s fail-closed; denied = user (or re-L2) said no. */
  reason: "timeout" | "denied" | "disconnect" | "unavailable"
  sendToExtension?: (data: unknown) => void
}

export type UnattendedConfirmDeniedResult = {
  handled: boolean
  bypassHalt: boolean
  pause: boolean
  stormCount: number
  blockedItemId: string | null
  present: BlockedPresentResult | null
}

function isUnattendedActiveLoop(tm: ThreadManager, threadId: string): boolean {
  const thread = tm.get(threadId)
  if (!thread || thread.agent_role === "worker") return false
  const st = sanitizeLoopState(thread.loop_state)
  return st?.status === "active" && st.unattended === true
}

/**
 * NEVER-list confirm timed out / denied under an unattended loop:
 * that item is blocked, others continue, 45s fail-closed unchanged.
 * User-return re-L2 deny is the same path — item blocked, loop does not die
 * unless deny-storm ≥ 3, which pauses (recoverable), never HALT_SECURITY.
 */
export function onUnattendedConfirmDenied(
  input: UnattendedConfirmDeniedInput,
): UnattendedConfirmDeniedResult {
  const empty: UnattendedConfirmDeniedResult = {
    handled: false,
    bypassHalt: false,
    pause: false,
    stormCount: 0,
    blockedItemId: null,
    present: null,
  }
  const threadId = String(input.threadId || "")
  if (!threadId) return empty
  if (!isUnattendedActiveLoop(input.threadManager, threadId)) return empty

  const thread = input.threadManager.get(threadId)
  const item = matchItemForDeniedTool(thread?.run_progress as RunProgress | undefined, input.toolName)
  const timeout = input.reason === "timeout"
  const contract = buildUnlockContract({
    signal: { kind: "confirm-denied" },
    itemId: item?.id,
    triedRoutes: [{ route: input.toolName, failure: timeout ? "confirm-timeout-45s" : "confirm-denied" }],
    detail: timeout
      ? "NEVER-list confirmation timed out after 45s (fail-closed, not auto-allow). Be present to approve, or replan this item."
      : "Confirmation was denied. Replan this item or re-request with the user present. Loop did not die.",
  })
  if (item) {
    blockRouteItem(threadId, item.id, contract)
  }

  const stormCount = bumpDenyStorm(threadId)
  const pause = stormCount >= DENY_STORM_THRESHOLD
  const keyList = buildKeyList(threadId)
  const present = presentBlockedReport({
    threadId,
    keyList,
    sendToExtension: input.sendToExtension,
    copy: pause ? UNATTENDED_REVIEW_COPY : "受阻待解锁",
  })
  // Board is async; fire-and-forget so the deny path stays sync.
  void presentBlockedBoardIntent({
    threadManager: input.threadManager,
    threadId,
    keyList,
  })

  try {
    appendCapabilityAudit({
      type: "task_loop.item_blocked",
      at: new Date().toISOString(),
      thread_id: threadId,
      item_id: item?.id ?? null,
      reason: timeout ? "confirm-timeout" : "confirm-denied",
      deny_storm: stormCount,
      pause,
    })
  } catch {
    /* audit never gates */
  }

  return {
    handled: true,
    bypassHalt: true,
    pause,
    stormCount,
    blockedItemId: item?.id ?? null,
    present,
  }
}
