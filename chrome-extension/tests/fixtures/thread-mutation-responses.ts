// Captured 2026-09-09 from companion/src/message-router.ts handleMessage using
// a temporary real ThreadManager: fixture-a / fixture-b / fixture-missing.
// Capture recipe: create A/B; batch_delete trash; restore; batch_delete hard.
// Wire lifecycle adds {id: request.id} at companion/src/ws/lifecycle.ts.
export const recordedThreadMutationResponses = {
  capabilities: { type: "thread.batch_delete.capabilities", only_empty: true },
  trash: {
    type: "thread.batch_deleted",
    ok: ["fixture-a", "fixture-b"],
    failed: [{ id: "fixture-missing", reason: "not_found" }],
    deleted_ids: ["fixture-a", "fixture-b"],
    deleted_count: 2,
    mode: "trash",
  },
  restore: {
    type: "thread.restored",
    restored: ["fixture-a", "fixture-b"],
    failed: [{ id: "fixture-missing", reason: "not_found" }],
    restored_count: 2,
  },
  hard: {
    type: "thread.batch_deleted",
    ok: ["fixture-a", "fixture-b"],
    failed: [{ id: "fixture-missing", reason: "not_found" }],
    deleted_ids: ["fixture-a", "fixture-b"],
    deleted_count: 2,
    mode: "hard",
  },
}
