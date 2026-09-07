I'll read only that packet and follow its review instructions.**Independent incremental review — #464 (Grok 4.6)**
Packet-only. No other files, no edits.

## Scope of this delta

Two concrete corrections after a prior blocking-gate approve:

1. **PTY review submit:** persist receipt + history first; wrap **only** `sendToExtension` in a best-effort catch so a dead socket cannot recast a successful import as `CODE_REPORT_INVALID_OR_PERSIST_FAILED`.
2. **Extension `Thread`:** declare optional `execution_policy?: "default" | "plan_readonly" | null`. Type completeness for list/update payloads. No policy or UI change in this packet.

Machine claims in the packet are taken as given, not re-run.

## Handler

Order is now:

`preview` → L2 → re-check context → `receive()` → idempotent history (`code-review-${receipt.id}`) → try/catch push → `terminal.review.received`.

That is the right cut. `receive` / `addMessage` still sit in the outer catch. A throw from Chat after durability no longer poisons the RPC.

Inner catch is broad (`catch { /* … */ }`). For this path that is acceptable: delivery is defined as best-effort; reconnect is the restore channel. Not a permission or persist bypass.

T3 invariants in the same file are unchanged: `surface === "panel"`, `embedded_terminal.enabled !== true` deny, darwin-only, `user_gesture`, L2 never skipped, `plan_readonly` deny on open and on later ops, post-confirm re-check of peer/thread/cwd/review.

## Test

`#466 confirmed report returns to original task…` now forces `sendToExtension` to throw **after** persistence and still asserts:

- `terminal.review.received`
- identical retry result (`deepEqual`)
- history length `1`
- stored receipt id/origin
- `review_ready === false`
- different summary → `CODE_REPORT_ALREADY_RECEIVED`

That pins the regression the catch was written for. Negative paths (wrong identity, denied, close-during-confirm) still require `receipt == null` and zero history.

## Thread type

Optional union matches the server cap the handler already enforces (`=== "plan_readonly"`). `"default" | null | undefined` all remain allow. Comment correctly says server re-enforces. No UI expression in this packet; no client-side bypass surface.

## Remaining relevant P2

None that this increment still owes. Swallow-without-log is operational, not a product/security hole, given reconnect restore and the new contract test.

---

**VERDICT: APPROVE**
