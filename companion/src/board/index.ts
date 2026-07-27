/**
 * MissionBoard module (ADR-016 P0 kernel).
 * Clean-room schema + single write path; no third-party AGPL imports.
 */

export * from "./schema"
export {
  readBoard,
  ensureBoard,
  ensureBoardDefaults,
  applyHandbackPayload,
  addHint,
  mutateMissionBoard,
  isBoardHostThread,
  resolveBoardHostThreadId,
  hostRequiresStructuredHandback,
  collectWorkerHandback,
  boardReadForTool,
  canComplete,
  completeBoard,
  abandonWorkerIntents,
  resolveToolCallFromThreadMessages,
  type BoardActorContext,
  type ToolCallResolver,
  type BoardResult,
  type BoardMutationError,
  type BoardMutationOk,
  type CollectHandbackResult,
  type CollectHandbackSuccess,
  type CollectHandbackFailure,
  type CompleteBoardParams,
  type CanCompleteResult,
} from "./service"
