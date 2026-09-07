I'll read only that review file and follow its independent correction-review instructions.**Independent correction review of prior return-ui checkpoint.** Frozen packet only. Machine claims (Companion 77/77, extension 12/12, tsc 0, isolated Chrome UI pass) taken as stated, not re-run.

**D1 — post-open `terminal.error` — CLOSE.** After `opened`, `code === "disconnected"` now ends the session: `sessionEnded`, ping cleared, `status` `"closed"`, `subData.dispose()`. Submit is `disabled` unless `status === "running"`. Port `onDisconnect` also stops input/ping, marks closed, clears submitting. Isolated UI test pushes a disconnected error, asserts the send button disabled and no `terminal.input` after typing. Other post-open codes stay `running` with `reportStatus` (retryable import reject). That is the requested split.

**D2 — wire vs UI — CLOSE (nit remains).** `TerminalClientFrame` now has `review_id` on open and `terminal.review.submit`. Server parse accepts `review_prompt` (capped 512KiB, both id+prompt required) and `terminal.review.received`. SW allowlists `terminal.review.submit` and binds non-open frames to the sole session id. UI test covers prompt visible, copy without generated input, submit, receipt text. Residual: SW still forwards raw client objects (type allowlist + session id, no client schema parse). Handback is a one-line `ADD_MESSAGE` with no test in this dump.

**D3 — second Port / `attachTerminalPort` null — CLOSE.** Illegal sender (id/protocol/host/path, non-top frame when `frameId` is set) throws → error + disconnect → `null` (tested). `background/index.ts` rejects a second Port with `busy` before attach; detach clears `terminalRelay` only on object identity.

**D4 — plan-readonly false affordance — CLOSE.** Chat button is `disabled` when `execution_policy === "plan_readonly"`, with title copy. Packet states the server independently denies open/import; companion deny path is not in these files.

**D5 — `user_gesture` from `useEffect` — CLOSE as P1, retain nit.** Open still stamps `user_gesture: true` after tab load, not in the Chat click turn. Packet contract: the flag is not auth and not an L2 skip; a fresh origin-bound L2 always follows; Chat click is the existing gesture; submit is a real click. Companion L2 path is not in this dump. Residual: the flag on open remains a misnomer.

**D6 — missing `checkReport` / citation / handback tests in dump — not a product P1; coverage gap retained.** Core receive/persist/idempotent receipt/PTY-kill/auth-panel/scope injection still not shown here. Machine 77/77 is not a substitute for those files.

**Rename `old_path`/`new_path` — CLOSE as out of v1**, per packet (parser unsupported).

No prior must-fix (1–4) still blocks. Residuals are SW client-frame allowlist-not-schema, open `user_gesture` naming, companion/handback tests absent from this dump, and `send()` catch closing status without disposing `onData` (gated by `sessionEnded`).

**VERDICT: APPROVE_WITH_NITS**
