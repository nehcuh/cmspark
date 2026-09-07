Gate: #466/#467 return-ui checkpoint — terminal tab, review prompt/report handback, WS relay, schema checks. Static inspection only; no commands run per gate constraints.

**P0 — `background/terminal.ts` (`attachTerminalPort`, `port.onMessage`): client→companion frames are not bound to the owning session.** Only `terminal.open` records `sessionId`; `terminal.input` / `terminal.resize` / `terminal.ack` / `terminal.ping` / `terminal.close` / `terminal.review.submit` are forwarded with whatever `m.id` the sender provides, and no `port.sender.url` check exists inside this function. Session ids are predictable (`term.<Date.now().toString(36)>.<module seq>`), so any second context that can open the named port can send `terminal.input` with the active id — typing into the user's confirmed full shell — or send `terminal.close` to kill the PTY. This violates the single-session/authenticated-panel boundary. Fix: reject every non-open client frame unless `m.id === sessionId`, and verify the port belongs to the terminal tab.

**P1 — `TerminalApp.tsx` (error branch, pre/post-`opened`): post-open `terminal.error` is misrouted to the report-submit path.** Once `opened === true`, *every* `terminal.error` — including the extension-level `disconnected` frame the relay synthesizes when `wsSend` fails on the 25s ping or on user input — becomes `setReportStatus(frame.error); setSubmitting(false)`. The terminal keeps status `running`, the ping timer keeps firing, and `subData` is not disposed, so the user keeps typing into a dead PTY. `port.onDisconnect` has the same gap: it flips status but never disposes `subData`. Fix: distinguish transport/session errors from report-submission errors and make both close the terminal path.

**P1 — `wire.ts` (`parseTerminalServerFrame`, `terminal.data`): fail-closed claim incomplete.** Only `b64.length ≤ TERMINAL_FRAME_B64_MAX` is checked; base64 validity and decoded byte length are not, and `TERMINAL_FRAME_PAYLOAD_MAX` is dead. A corrupt 24KiB frame passes parsing and throws inside `atob` in the message listener; a valid 18KiB payload also violates the 16KiB contract. Validate decode (try/catch) and decoded length before accepting.

**P2 — `wire.ts` (`TerminalClientFrame`): omits `terminal.review.submit`.** `TerminalApp` actually emits this frame, so the client wire contract doesn't describe real traffic; any future client-frame parser built from the union would silently drop report submission.

**P2 — Test gap:** `terminal-relay.test.ts` covers pre-session server-frame filtering but not post-open `wsSend=false` error routing or client-frame id mismatch — the two paths above.

No concrete defects found in `report.ts` / `context.ts` identity, file/line, or citation checks; they throw or gap-fill as stated.

VERDICT: /blocked: 1×P0/ (plus 2×P1, 2×P2)
