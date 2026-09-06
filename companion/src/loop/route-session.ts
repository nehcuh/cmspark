// Process-wide L-3 session: pending steers, run observations, audit, checkpoint.
// Adapter/dispatch call these. Does not start chatCreate (that's #388).

import { appendCapabilityAudit } from "../packs/audit-log"
import { snapshotOriginCdpFails, SITE_ORIGIN_FAIL_ESCALATE } from "../tool/site-op-memory"
import { computeRunDelta, type UnlockContract } from "./stall-classifier"
import { loopRouteCaps } from "./tier-bind"
import type { RunProgress } from "../threads/run-progress"
import {
  applyItemBlocked,
  beginRouteRun,
  buildImpossibleReport,
  closeRouteRun,
  emptyRouteEngineState,
  formatSteerPrompt,
  noteDeclaredBlocked,
  noteTool,
  restoreAfterUnlock,
  snapshotCheckpoint,
  type ImpossibleReport,
  type RouteCapabilities,
  type RouteCheckpoint,
  type RouteEngineState,
  type RouteSteer,
} from "./route-engine"

const sessions = new Map<string, { state: RouteEngineState; pendingSteers: RouteSteer[]; lastProgress: RunProgress | null }>()

function session(threadId: string) {
  let s = sessions.get(threadId)
  if (!s) {
    s = { state: emptyRouteEngineState(), pendingSteers: [], lastProgress: null }
    sessions.set(threadId, s)
  }
  return s
}

export function _resetRouteSessionsForTests(): void {
  sessions.clear()
}

export function isOriginEscalated(threadId: string): boolean {
  const snap = snapshotOriginCdpFails(threadId)
  return Object.values(snap).some((v) => v.fails >= SITE_ORIGIN_FAIL_ESCALATE)
}

export function routeCapsFromConfig(): RouteCapabilities {
  // L-4 (#390) 巡航档表帽路线扇出 — caps come from the cruise tier binding
  // (zero new enum; deriveDisplayTier reuse). off/full+/值守 keep the host
  // surface iff coordinateEnabled; browser（仅 L1 面）caps it.
  return loopRouteCaps()
}

/** Start of chatCreate: consume pending steers into this run (workers skip). */
export function onRouteChatBegin(threadId: string, agentRole?: string | null): string {
  if (agentRole === "worker") return ""
  const s = session(threadId)
  const prompt = formatSteerPrompt(s.pendingSteers)
  s.state = beginRouteRun(s.state, s.pendingSteers)
  s.pendingSteers = []
  return prompt
}

export function onRouteTool(threadId: string, toolName: string, success = true): void {
  const s = sessions.get(threadId)
  if (!s) return
  s.state = noteTool(s.state, toolName, success)
}

export function onRouteDeclaredBlocked(threadId: string, itemId: string): void {
  const s = session(threadId)
  s.state = noteDeclaredBlocked(s.state, itemId)
}

/** L-5: confirm timeout/deny blocks this item now so the loop can bypass it. */
export function blockRouteItem(threadId: string, itemId: string, contract: UnlockContract): void {
  const s = session(threadId)
  s.state = applyItemBlocked(s.state, itemId, contract)
  if (!s.state.checkpoint) s.state = { ...s.state, checkpoint: snapshotCheckpoint(s.state) }
}

/** End of chatCreate: ignore detection, maybe block, queue steers for next run. */
export function onRouteChatEnd(
  threadId: string,
  p: { runProgress?: RunProgress | null; agentRole?: string | null },
): { pendingSteers: RouteSteer[]; newlyBlocked: number } {
  if (p.agentRole === "worker") return { pendingSteers: [], newlyBlocked: 0 }
  const s = session(threadId)
  const hadProgress =
    computeRunDelta(s.lastProgress, p.runProgress, { runId: `r${s.state.runCount + 1}` }).newTickIds
      .length > 0
  const closed = closeRouteRun(s.state, {
    runProgress: p.runProgress,
    originEscalated: isOriginEscalated(threadId),
    caps: routeCapsFromConfig(),
    hadProgress,
  })
  s.state = closed.state
  s.pendingSteers = closed.pendingSteers
  s.lastProgress = p.runProgress ?? null
  if (closed.newlyBlocked.length) {
    s.state = { ...s.state, checkpoint: snapshotCheckpoint(s.state) }
  }
  for (const ev of closed.audits) {
    appendCapabilityAudit({
      type: ev.type,
      at: new Date().toISOString(),
      thread_id: threadId,
      item_id: ev.item_id,
      target: ev.target,
      reason: ev.reason,
    })
  }
  return { pendingSteers: closed.pendingSteers, newlyBlocked: closed.newlyBlocked.length }
}

export function getImpossibleReport(threadId: string): ImpossibleReport {
  return buildImpossibleReport(session(threadId).state)
}

export function getRouteCheckpoint(threadId: string): RouteCheckpoint | null {
  return session(threadId).state.checkpoint
}

export function unlockRouteItem(
  threadId: string,
  itemId: string,
  action: string,
): { ok: true } | { ok: false; error: string } {
  const s = session(threadId)
  const r = restoreAfterUnlock(s.state, { itemId, action })
  if (!r.ok) return r
  s.state = r.state
  appendCapabilityAudit({
    type: "task_loop.checkpoint_restore",
    at: new Date().toISOString(),
    thread_id: threadId,
    item_id: itemId,
    action,
  })
  return { ok: true }
}

export function peekPendingSteers(threadId: string): RouteSteer[] {
  return [...session(threadId).pendingSteers]
}

export function peekRouteState(threadId: string): RouteEngineState {
  return session(threadId).state
}
