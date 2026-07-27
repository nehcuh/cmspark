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
  type BoardActorContext,
  type ToolCallResolver,
  type BoardResult,
  type BoardMutationError,
  type BoardMutationOk,
} from "./service"
