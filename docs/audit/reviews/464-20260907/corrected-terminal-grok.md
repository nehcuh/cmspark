I'll read only the specified review file and follow its independent correction instructions.Independent correction review of the frozen checkpoint packet only. Prior findings checked against the included handler/session/cwd/env sources and #466 tests. Machine result taken as given: Companion 77/77, extension terminal 12/12, both `tsc` exit 0, isolated React/xterm Chrome UI pass.

**Prior defects**

1. **Stale review after L2 — CLOSED.** After approve, the handler re-`read`s the same `review_id`, rejects `JSON.stringify` mismatch or throw with `CODE_REVIEW_CONTEXT_CHANGED`, and only then spawns. Deleted or `assess`ed review cannot keep a stale `review_prompt`. Covered by `#466 changed review while open confirmation is pending`.

2. **Ack watermark not an invariant — CLOSED.** `resumePty` refuses when `unackedBytes > TERMINAL_LOW_WATER_UNACKED` (`terminal_waiting_for_ack`). `emitChunks` fail-closes at `TERMINAL_MAX_UNACKED` (256KiB) with `output_overflow` before enqueue. Pause at 64KiB remains a hint for later `onData`; growth is no longer unbounded. Covered by `#466 ack cannot be bypassed by resume…`.

3. **Dot-prefixed cwd false-deny — CLOSED.** Escape is `rel === ".."` / `rel.startsWith(".." + path.sep)` / absolute `rel`. In-workspace `..cache` is allowed. Covered by `#466 in-workspace dot-prefixed directory`.

4. **Missing `readyState` treated as connected — CLOSED.** Open requires `peer && peer.readyState === 1` (`TERMINAL_PEER_REQUIRED`); post-L2 recheck is `TERMINAL_PEER_CLOSED`. `getOwnedPtyContext` also requires `readyState === 1`. Covered by `#466 disconnected peer cannot finish a pending terminal open` and owner-frame tests.

5. **`receive()` does not enforce L2 — CLOSED (not a current bypass).** In this packet the only production caller is `terminal.review.submit` after `user_gesture`, bound preview, origin L2, then owner/thread recheck. Same payload retries without a second history row; distinct payload is `CODE_REPORT_ALREADY_RECEIVED`; wrong identity / deny / close-during-confirm never persist. Hypothetical other `receive` callers are out of scope.

**Fixes vs remaining bug**

Pending close sets `canceled` on the same pending object, then nulls the singleton; open still sees `pending.canceled` and does not spawn. UTF-8 split backs up to the lead byte so each frame is independently decodable; input is length/alphabet/padding plus canonical `toString("base64")` round-trip. Post-await open path to `spawnPtySession` is synchronous, so a second open cannot sneak through `pendingOpen` in Node.

**Residual NITs (not P1):** if L2 throws after tab-cancel, the catch returns `TERMINAL_CONFIRMATION_FAILED` rather than `TERMINAL_OPEN_CANCELED` (still no PTY). Review freshness uses `JSON.stringify` (fail-closed, key-order brittle).

No retained blocker/P1/MAJOR from the prior report. No new concrete bug in the shown fixes.

**VERDICT: APPROVE_WITH_NITS**
