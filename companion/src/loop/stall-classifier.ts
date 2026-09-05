// L-1 (#387) stall classifier — blocker five-class, machine-readable unlock
// contract, repeat-progress (Δ=0) ledger, and the stall card data structure.
// Design basis: .omx/artifacts/loop-rethink-20260906/FINAL-SYNTHESIS.md §L-1
// and §1 (every safety gate must have a completion path: blocked ≠ failed,
// blocked = recoverable + machine-readable unlock contract).
//
// RED LINES: pure functions, zero auto-execution. This module only produces
// signals and data structures — intervention (route-directive steer, re-plan,
// resume) belongs to L-2/L-3 (#388/#389); rendering belongs to L-4 (#390).
//
// Wiring pins for later tickets (PR #394 review):
// - #389 owns the「stall 后再 2 个 run 仍 Δ=0 → emit stall-persistent → 该项
//   blocked」counter; this module only defines the signal kind (#387 NIT-3).
// - The stall signal must drive route-directive intervention JOINTLY with
//   #389's steering, never act alone (#387 pi NIT-4).
// - Unlock detail strings are English machine-readable defaults; user-facing
//   rendering / localization belongs to #390 (detail is overridable).

import type { RunProgress } from "../threads/run-progress"
import { evidenceItems } from "./completion-predicate"

/** The five blocker classes (受阻五分类). */
export type BlockerClass =
  | "needs-human-confirm" // a confirm/nonce/L2 decision is waiting on the user
  | "needs-credential" // login / grant / authorization missing or expired
  | "external-wall" // the far side refuses (origin peek-refuse, site wall, …)
  | "route-exhausted" // route budget spent / no progress after intervention
  | "model-noncompliance" // route-directive steer ignored twice

/**
 * Structured blocker signal. Machine-checkable input only — never classify
 * from model prose.
 */
export type BlockerSignal =
  | { kind: "confirm-pending" } // unresolved confirm/nonce awaiting gesture
  | { kind: "confirm-denied" } // L2/cruise-tier deny
  | { kind: "credential-missing" } // needs login / authorization
  | { kind: "grant-expired" } // unattended grant TTL expired
  | { kind: "origin-refused" } // e.g. #357 originFails≥4 peek-refuse
  | { kind: "route-budget-exhausted" } // cross-class / steer budget spent
  | { kind: "stall-persistent" } // still Δ=0 for 2 runs after intervention
  | { kind: "steer-ignored" } // route-directive steer ignored ≥2 times

/** Map a machine blocker signal to its blocker class. */
export function classifyBlocker(signal: BlockerSignal): BlockerClass {
  switch (signal.kind) {
    case "confirm-pending":
    case "confirm-denied":
      return "needs-human-confirm"
    case "credential-missing":
    case "grant-expired":
      return "needs-credential"
    case "origin-refused":
      return "external-wall"
    case "route-budget-exhausted":
    case "stall-persistent":
      return "route-exhausted"
    case "steer-ignored":
      return "model-noncompliance"
  }
}

/** Machine-readable unlock action — the completion path for a blocked item. */
export type UnlockAction =
  | "approve-confirm" // user must resolve the pending confirm/nonce
  | "provide-credential" // user must log in / authorize / re-arm grant
  | "external-wait" // external wall: wait or work around by hand
  | "replan" // routes exhausted: human must change the plan
  | "restate-directive" // model ignored directives: user restates the goal

export type TriedRoute = {
  /** Route identifier, e.g. "cdp-dom" / "host_computer" / "osascript". */
  route: string
  /** Why it failed (machine reason or short fact, not model prose). */
  failure: string
}

/**
 * Machine-readable unlock contract. One per blocked item: tried routes with
 * failure causes, plus the unlock condition. Answers 「给出最高授权后任务还
 * 能不能继续」 for every safety-gate stop.
 */
export type UnlockContract = {
  blocker_class: BlockerClass
  /** run_progress item this contract blocks; null = run-level blocker. */
  item_id: string | null
  tried_routes: TriedRoute[]
  unlock: { action: UnlockAction; detail: string }
}

const DEFAULT_UNLOCK: Record<BlockerClass, { action: UnlockAction; detail: string }> = {
  "needs-human-confirm": {
    action: "approve-confirm",
    detail: "Resolve the pending confirm/nonce prompt (approve or deny).",
  },
  "needs-credential": {
    action: "provide-credential",
    detail: "Log in / authorize the required account, or re-arm the expired grant.",
  },
  "external-wall": {
    action: "external-wait",
    detail: "The target site/origin is refusing automated access; wait or perform this step manually.",
  },
  "route-exhausted": {
    action: "replan",
    detail: "All budgeted routes failed; revise the plan or unlock a new capability surface.",
  },
  "model-noncompliance": {
    action: "restate-directive",
    detail: "The model ignored route directives; restate the goal or take over manually.",
  },
}

export function buildUnlockContract(p: {
  signal: BlockerSignal
  itemId?: string
  triedRoutes?: TriedRoute[]
  /** Override the default unlock detail text. */
  detail?: string
}): UnlockContract {
  const blockerClass = classifyBlocker(p.signal)
  // confirm-denied: the user already said no — asking them to "approve or
  // deny" again is dishonest; the honest default is re-plan (PR #394 NIT-4).
  const def =
    p.signal.kind === "confirm-denied"
      ? {
          action: "replan" as const,
          detail:
            "The user denied the confirmation; revise the plan or re-request with changes.",
        }
      : DEFAULT_UNLOCK[blockerClass]
  return {
    blocker_class: blockerClass,
    item_id: typeof p.itemId === "string" && p.itemId ? p.itemId : null,
    tried_routes: (p.triedRoutes ?? []).map((r) => ({
      route: String(r.route ?? "").slice(0, 64),
      failure: String(r.failure ?? "").slice(0, 200),
    })),
    unlock: { action: def.action, detail: p.detail ?? def.detail },
  }
}

// ---------------------------------------------------------------------------
// Progress ledger — repeat-progress detection (连续 K 个 run Δ=0 → stalled).
// ---------------------------------------------------------------------------

/** Consecutive zero-delta runs that raise the stall signal. */
export const STALL_K = 3 as const

export type RunDelta = {
  runId: string
  /** Non-draft item ids that gained an evidence tick during this run. */
  newTickIds: string[]
  /** Failed tool_result count in this run (recorded for the stall card). */
  failedCount: number
}

export type ProgressLedger = {
  runs: RunDelta[]
  /** Ring cap; oldest runs are dropped. */
  maxRuns: number
}

export function createLedger(maxRuns = 8): ProgressLedger {
  return { runs: [], maxRuns: Math.max(1, maxRuns) }
}

/**
 * Δ of one run = non-draft items that flipped done=false→true between the
 * run's before/after run_progress snapshots. model_draft rows never count.
 */
export function computeRunDelta(
  before: RunProgress | null | undefined,
  after: RunProgress | null | undefined,
  p: { runId: string; failedCount?: number },
): RunDelta {
  const beforeDone = new Set(
    evidenceItems(before)
      .filter((it) => it.done === true)
      .map((it) => it.id),
  )
  const newTickIds = evidenceItems(after)
    .filter((it) => it.done === true && !beforeDone.has(it.id))
    .map((it) => it.id)
  return {
    runId: String(p.runId ?? ""),
    newTickIds,
    failedCount: Math.max(0, p.failedCount ?? 0),
  }
}

/** Append a run delta (pure; returns a new ledger, capped at maxRuns). */
export function recordRun(ledger: ProgressLedger, delta: RunDelta): ProgressLedger {
  const runs = [...ledger.runs, delta]
  while (runs.length > ledger.maxRuns) runs.shift()
  return { runs, maxRuns: ledger.maxRuns }
}

/** Trailing runs with Δ=0 (no new evidence tick). */
export function countTrailingZeroDelta(ledger: ProgressLedger): number {
  let n = 0
  for (let i = ledger.runs.length - 1; i >= 0; i--) {
    if (ledger.runs[i]!.newTickIds.length > 0) break
    n++
  }
  return n
}

/**
 * Stall signal: the last K runs all had Δ=0. Signal only — intervention is
 * #389's job; an item becoming blocked after further zero-delta runs is
 * surfaced via the "stall-persistent" BlockerSignal, not decided here.
 */
export function detectStall(
  ledger: ProgressLedger,
  k: number = STALL_K,
): { stalled: boolean; consecutiveZeroDelta: number } {
  const consecutiveZeroDelta = countTrailingZeroDelta(ledger)
  return { stalled: consecutiveZeroDelta >= k, consecutiveZeroDelta }
}

// ---------------------------------------------------------------------------
// Stall card — 已试路线 / 剩计划项 / 缺什么. Data only; rendering is #390.
// ---------------------------------------------------------------------------

export type StallCard = {
  kind: "stall-card"
  consecutive_zero_delta: number
  /** 已试路线 + 败因. */
  tried_routes: TriedRoute[]
  /** 剩计划项: unticked non-draft items. */
  remaining_items: { id: string; text: string }[]
  /** 缺什么: machine-readable unlock contracts. */
  missing: UnlockContract[]
}

export function buildStallCard(p: {
  runProgress: RunProgress | null | undefined
  ledger: ProgressLedger
  triedRoutes?: TriedRoute[]
  unlocks?: UnlockContract[]
}): StallCard {
  return {
    kind: "stall-card",
    consecutive_zero_delta: countTrailingZeroDelta(p.ledger),
    tried_routes: p.triedRoutes ?? [],
    remaining_items: evidenceItems(p.runProgress)
      .filter((it) => it.done !== true)
      .map((it) => ({ id: it.id, text: it.text })),
    missing: p.unlocks ?? [],
  }
}
