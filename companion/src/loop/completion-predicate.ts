// L-1 (#387) completion predicate — machine-checked two-layer verdict.
// Design basis: .omx/artifacts/loop-rethink-20260906/FINAL-SYNTHESIS.md §分歧 3.
//
// Machine layer: all evidence-tick (non-draft run_progress items done, ticked
// only by bound tool_result / user gesture) ∧ closing turn has no tool_calls
// ∧ no pending confirm/nonce.
// Semantic layer (default tier): claim ⊆ tick cross-check — the model's
// completion claim may only reference already-ticked item ids. Rejected claims
// get a steer pointing straight at the unticked items; all-ticked without a
// claim yields a request-claim verdict (one extra statement round).
//
// RED LINES (do not relax here):
// - Pure functions, zero auto-execution: no adapter hooks, no re-run triggers
//   (wiring is L-2/#388). These verdicts are signals only.
// - run_progress tick semantics are NOT modified (see threads/run-progress.ts);
//   model_draft rows are never evidence and are excluded here.
// - Model prose self-assessment NEVER constitutes completion on its own: a
//   claim with no evidence-ticked item references is rejected.
// - execution_contract stays shadow and is NOT consulted as a completion gate
//   (graduation tracked in #328).

import type { RunProgress, RunProgressItem } from "../threads/run-progress"

/** Model completion claim: ids of run_progress items the claim rests on. */
export type CompletionClaim = { itemIds: string[] }

export type CompletionInput = {
  runProgress: RunProgress | null | undefined
  /** tool_calls issued in the closing turn; must be 0 for completion. */
  closingTurnToolCalls: number
  /** unresolved confirm/nonce count; must be 0 for completion. */
  pendingConfirms: number
  /** Model's completion claim, if it made one this turn. */
  claim?: CompletionClaim | null
}

export type CompletionRejectionReason =
  | "no-evidence-items" // zero non-draft items: nothing to tick against
  | "unticked-items" // non-draft items without evidence tick remain
  | "closing-turn-tool-calls" // closing turn still issued tool_calls
  | "pending-confirm" // unresolved confirm/nonce outstanding

export type CompletionVerdict =
  | { kind: "complete"; tickedIds: string[] }
  | {
      kind: "claim-rejected"
      reasons: CompletionRejectionReason[]
      /** Claim-referenced ids that have no evidence tick (incl. unknown ids). */
      invalidClaimIds: string[]
      steer: string
    }
  | { kind: "request-claim"; tickedIds: string[]; steer: string }
  | {
      kind: "incomplete"
      reasons: CompletionRejectionReason[]
      untickedIds: string[]
    }

/** Evidence-bearing rows: everything except model_draft (never tickable). */
export function evidenceItems(progress: RunProgress | null | undefined): RunProgressItem[] {
  if (!progress || !Array.isArray(progress.items)) return []
  return progress.items.filter((it) => it && it.source !== "model_draft")
}

function machineReasons(
  input: CompletionInput,
  items: RunProgressItem[],
): CompletionRejectionReason[] {
  const reasons: CompletionRejectionReason[] = []
  if (items.length === 0) reasons.push("no-evidence-items")
  if (items.some((it) => it.done !== true)) reasons.push("unticked-items")
  if (input.closingTurnToolCalls > 0) reasons.push("closing-turn-tool-calls")
  if (input.pendingConfirms > 0) reasons.push("pending-confirm")
  return reasons
}

function formatItem(it: RunProgressItem): string {
  return `${it.id} ("${it.text}")`
}

/** Steer for a rejected claim: points straight at the unticked items. */
export function buildClaimRejectionSteer(p: {
  unticked: RunProgressItem[]
  invalidClaimIds: string[]
  reasons: CompletionRejectionReason[]
}): string {
  const parts: string[] = ["Completion claim rejected."]
  if (p.invalidClaimIds.length > 0) {
    parts.push(
      `Claim references item ids with no evidence tick: ${p.invalidClaimIds.join(", ")}.`,
    )
  }
  if (p.unticked.length > 0) {
    parts.push(
      `Unticked checklist items: ${p.unticked.map(formatItem).join("; ")}.`,
    )
  }
  if (p.reasons.includes("closing-turn-tool-calls")) {
    parts.push("The closing turn still issued tool_calls; finish them first.")
  }
  if (p.reasons.includes("pending-confirm")) {
    parts.push("There are unresolved confirm/nonce prompts outstanding.")
  }
  parts.push(
    "Each item must be evidence-ticked by its bound tool_result (or ticked by the user) before you claim completion; acting like it is done (e.g. clicking submit) is not evidence that it succeeded.",
  )
  return parts.join(" ")
}

/** Steer for the all-ticked-no-claim case: ask for one claim statement. */
export function buildRequestClaimSteer(ticked: RunProgressItem[]): string {
  const ids = ticked.map((it) => it.id).join(", ")
  return (
    `All checklist items are evidence-ticked (${ids}). ` +
    "Provide a completion statement that references the ticked item ids it rests on " +
    "(claim ⊆ tick) so the user can review it."
  )
}

/**
 * Two-layer completion predicate. Pure; emits a verdict signal only.
 *
 * - claim present ∧ (machine layer fails ∨ claim ⊄ tick ∨ claim cites nothing)
 *   → claim-rejected (steer at unticked/invalid ids). An empty-itemIds claim is
 *   prose self-assessment and is always rejected.
 * - claim absent ∧ machine layer fails → incomplete.
 * - claim absent ∧ machine layer passes → request-claim (solicit one round).
 * - claim present ∧ machine layer passes ∧ claim ⊆ tick → complete.
 */
export function evaluateCompletion(input: CompletionInput): CompletionVerdict {
  const items = evidenceItems(input.runProgress)
  const ticked = items.filter((it) => it.done === true)
  const unticked = items.filter((it) => it.done !== true)
  const tickedIds = ticked.map((it) => it.id)
  const reasons = machineReasons(input, items)

  const claim = input.claim
  if (claim) {
    const tickedSet = new Set(tickedIds)
    const claimIds = Array.isArray(claim.itemIds) ? claim.itemIds : []
    const invalidClaimIds = [...new Set(claimIds.filter((id) => !tickedSet.has(id)))]
    if (reasons.length > 0 || invalidClaimIds.length > 0 || claimIds.length === 0) {
      return {
        kind: "claim-rejected",
        reasons,
        invalidClaimIds,
        steer: buildClaimRejectionSteer({ unticked, invalidClaimIds, reasons }),
      }
    }
    return { kind: "complete", tickedIds }
  }

  if (reasons.length > 0) {
    return { kind: "incomplete", reasons, untickedIds: unticked.map((it) => it.id) }
  }
  return { kind: "request-claim", tickedIds, steer: buildRequestClaimSteer(ticked) }
}
