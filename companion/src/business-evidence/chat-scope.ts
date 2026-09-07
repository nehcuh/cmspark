import type { ToolExecutorFn } from "../server"

/** A router-owned thread identity must travel outside model-controlled args. */
export function bindChatEvidenceScope(execute: ToolExecutorFn, threadId: string): ToolExecutorFn {
  return (id, name, params, signal, invokeOpts) =>
    execute(id, name, params, signal, { ...invokeOpts, evidenceScope: { kind: "chat", threadId } })
}
