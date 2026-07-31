Both typecheck clean. I have enough evidence to write the verdict.

## Summary

The diff lands a correct, layered fix for the `log.event` echo loop. A.1 (extension never re-logs forward failures to companion — verified at `background/index.ts:402-421` + policy always-false `shouldReportForwardFailureToCompanion` at `log-forward-policy.ts:43-45`) is sufficient on its own to break the loop, and is reinforced by B.1 (no `ws.send` echo at `server.ts:5171-5186`), a 10/s per-connection token-bucket backstop (`log-event-gate.ts`), and a local `chrome.runtime.sendMessage` fan-out inside `logToCompanion` (`background/index.ts:174-185`) that preserves the Side Panel live-log feed without needing the companion round-trip. RCA nits #1–#5 are all reflected in code. All 10 new tests pass; both projects typecheck clean.

## Implementation checklist

| Item | Pass/Fail | Evidence (file:line) |
|------|-----------|----------------------|
| A.1 loop break | Pass | `chrome-extension/src/background/index.ts:402-421` (catch only console-warns; the `logToCompanion` branch is gated by always-false `shouldReportForwardFailureToCompanion` from `log-forward-policy.ts:43-45`) |
| B.1 no echo | Pass | `companion/src/server.ts:5171-5186` — `ws.send(JSON.stringify(msg))` removed; comment documents rationale |
| Live log local fan-out | Pass | `chrome-extension/src/background/index.ts:178-184` — `chrome.runtime.sendMessage(payload).catch(()=>{})` before WS upload; payload shape unchanged from pre-fix (`buildLogEventPayload` returns same `{type,source,level,event,data}`) |
| Rate limit 10/s | Pass | `companion/src/log-event-gate.ts:11-38` — WeakMap-keyed per-`ws` bucket, capacity=10, refill 10/s, silent drop (`return`), no throw/re-entry |
| Tests adequate | Pass | 10/10 tests pass: `log-forward-policy.test.ts` (4), `log-event-gate.test.ts` (4), `log-event-no-echo.test.ts` (2) |

A.1-alone sufficiency confirmed: with B.1 reverted, the extension still never re-logs forward failures, so no new `log.event` is injected into the WS round-trip; the loop cannot sustain.

## Blocking

None.

## Nits

1. **Tests are "pure mirror" not integration.** `companion/tests/log-event-no-echo.test.ts:18-31` re-implements the handler locally with a `// REMOVED` comment, so it documents the contract but doesn't actually execute the `if (msg.type === "log.event")` branch in `server.ts`. Both RCA reviewers (Claude nit #4, Pi nit #6) explicitly asked for a `companion/tests/integration/log-event-echo.test.ts` driving a real `WebSocketServer` through `startServer`. Not blocking — the unit tests still lock the policy and gate — but the integration gap is real.
2. **Dead branch with policy-justification comment** at `background/index.ts:404-412`. `shouldReportForwardFailureToCompanion` is `() => false`; the `logToCompanion` call inside the branch is unreachable today. The comment ("Kept so a future opt-in cannot forget the loop hazard without touching policy") is reasonable but slightly over-engineered for a one-line bugfix; cheaper to delete the branch and add a sentinel comment.
3. **Pre-existing SidePanel consumer display bug** at `chrome-extension/src/sidepanel/hooks/useWebSocket.ts:256-270`: `const log = msg.data` then reads `log.level` / `log.event` / `log.source`, but the wire payload (both before and after this fix) keeps those fields at the top level (`msg.level`, `msg.event`, `msg.source`). So live-log entries likely render as `level:"info", source:"unknown", event:"unknown"`. **Not a regression of this fix** (old echo had the same shape), but the local fan-out now makes this the primary path — worth a follow-up PR.
4. **No early-return for `log.event` in `handleCompanionMessage`.** Per Claude RCA nit #6 / Pi nit #4, a defensive `if (msg.type === "log.event") return` placed *before* the `chrome.runtime.sendMessage(msg)` at line 402 would protect against future re-entry. The current A.1 catch handles it, so non-blocking.

## Recommended follow-ups (optional)

- Add `companion/tests/integration/log-event-echo.test.ts` with real `WebSocketServer` + authed client asserting no echo frame within ~200ms window.
- Fix SidePanel consumer at `useWebSocket.ts:256-270` to read `msg.level`/`msg.event`/`msg.source` directly (or change producer to nest them in `data`).
- Consider folding the six fall-through types (`config.updated`, `computer.task.event`, `security.confirmation.*`, `log.event`) into explicit early returns to reduce noise on the catch path (Pi nit #4).

## ADR-020 capability declaration

Capability declaration is `n/a` across all axes, consistent with a pure bugfix — no new tools, gates, UI surfaces, or agent runtime. No further ADR-020 surface checks apply.

## Security / hygiene

Silencing `forward_failed` to `console.warn` (once) + `console.debug` (subsequent) does not hide actionable security failures: the original comment ("side panel / cockpit may not be open — that's fine") already declared this expected, and the failure mode is identical whether the panel is closed vs. genuinely broken — neither is companion-actionable. No secret leakage change in the payload (`buildLogEventPayload` returns the same fields as the prior inline `{type, source, level, event, data}`).

VERDICT: APPROVE_WITH_NITS
