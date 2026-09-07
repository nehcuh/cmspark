PRIOR FINDINGS — DISPOSITION

**P0 (session binding) — CLOSED.** `attachTerminalPort` now rejects senders whose `sender.id !== chrome.runtime.id` or whose URL fails exact protocol/host/path match against `embeddedTerminalUrl()`, plus non-top-frame senders (`frameId !== 0`). Client frames pass a type whitelist; `terminal.open` records the session id only once (re-open while bound is dropped, so the id is immutable) and every non-open type requires `m.id === sessionId`. A second context that could spoof `sender.url` (web content script) fails the origin gate; a second legitimate tab gets `busy` + disconnect from the global relay gate. Predictability of `term.<ts>.<seq>` no longer matters: the id is a secret shared only with the single top frame that passed the gate. Prior failure mode (cross-context typing / kill PTY) is not reachable on the evidence in this packet. [inspected]

**P1 (TerminalApp error routing) — CLOSED.** The `opened === true` branch now handles `code === "disconnected"` explicitly: `sessionEnded`, ping timer cleared, status → `closed`, `subData.dispose()`. Pre-open `terminal.error` stops the watchdog and disposes `subData`. `port.onDisconnect` now clears the ping timer, disposes `subData`, resets submitting, and maps connecting→error / running→closed. Both concrete leaks from the prior report (typing into a dead PTY; ping after transport loss) are gone. Ordering is safe: `subData` is initialized before `open()` runs, so no TDZ in the async listener. [inspected]

**P1 (wire fail-closed) — CLOSED.** `terminal.data` now try/catches `atob`, enforces decoded length ≤ `TERMINAL_FRAME_PAYLOAD_MAX` (the constant is live again), and enforces canonical encoding (`btoa(bytes) === b64`). The 18KiB-valid-but-over-contract and corrupt-b64 cases both return null; nothing throws in the message listener. Double-decoding is a minor cost, not a defect. [inspected]

**P2 (client union) — CLOSED.** `terminal.review.submit` is in `TerminalClientFrame`. [inspected]

**P2 (test gap) — CLOSED.** Relay tests cover id-mismatch drop on input and re-open, no-id error delivery, other-session server-frame filtering, and `wsSend=false` → `disconnected` feedback. The Chrome UI test covers the disconnected frame end-to-end: submit disabled, no generated terminal input after keyboard focus. The remaining `react/xterm` assertions (prompt visible, explicit JSON receipt, both panes) match the scope claim. [executed evidence accepted per packet]

NEW-OBSERVATION NITS (do not block)

- **Relay whitelist** (`background/terminal.ts`) admits client-side `terminal.pause`/`terminal.resume`, which `TerminalClientFrame` does not emit; harmless (still session-bound) but the whitelist is wider than the wire contract. P2.
- **`TerminalApp.tsx`** — a post-open `terminal.error` with a code other than `disconnected` still writes into `reportStatus` (cosmetic mixing of terminal and report status channels). No concrete post-open non-`disconnected` frame source is evident in this packet; note only.

VERDICT: APPROVE_WITH_NITS
