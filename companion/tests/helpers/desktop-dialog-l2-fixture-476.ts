/** Owned hosted precondition: exercise L2, not the earlier run-progress refusal. */
import type { ThreadManager } from "../../src/threads/thread-manager"
export function prepareDialogL2Fixture(threads: ThreadManager, target: string) {
  threads.update(target, { tool_whitelist: ["evaluate"], skill_selection_mode: "manual", knowledge_selection_mode: "manual", run_progress: null })
}
