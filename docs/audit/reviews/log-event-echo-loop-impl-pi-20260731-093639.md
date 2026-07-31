Now I have all the evidence I need. Let me compile the final review.

---

## Summary

The implementation correctly breaks the `log.event` echo loop with three layers of defense. **A.1** (loop-primary) replaces `logToCompanion` in `handleCompanionMessage`'s `.catch` with a policy-gated console path — the policy always returns `false`, so `log.event` never re-enters the WS. **B.1** (defense-in-depth) removes `ws.send(JSON.stringify(msg))` from the companion's inbound `log.event` handler. **Rate limit** (backstop) adds a per-connection token bucket of 10/s. RCA nits from the dual-review are properly folded: local fan-out via `chrome.runtime.sendMessage` in `logToCompanion` preserves live log, once-per-session `console.warn` addresses the security nit, and rate limit is aggressive (10/s, not 50-100). Tests cover policy, gate, and no-echo contracts.

No blocking issues. Two pre-existing nits and one implementation nit noted below.

---

## Implementation checklist

| Item | Pass/Fail | Evidence (file:line) |
|------|-----------|----------------------|
| A.1 loop break | **PASS** | `chrome-extension/src/background/index.ts:400-422` — catch invokes `shouldReportForwardFailureToCompanion(type)` (always `false`, `log-forward-policy.ts:47`) then `forwardFailureConsoleLevel()` → `console.warn`/`console.debug`. Zero `logToCompanion` calls for normal forward failures. |
| B.1 no echo | **PASS** | `companion/src/server.ts:5183-5188` — `ws.send` explicitly removed, replaced by comment. `rg -n 'ws\.send.*log\.event' companion/src/server.ts` returns zero matches. |
| Live log local fan-out | **PASS** | `chrome-extension/src/background/index.ts:174-179` — `chrome.runtime.sendMessage(payload)` inside `logToCompanion` before WS upload. Same payload shape as old companion echo, side panel handler unchanged. |
| Rate limit 10/s | **PASS** | `companion/src/log-event-gate.ts:16-40` — token bucket capacity=10, refill at 10/s, per-connection `WeakMap`. `server.ts:5173-5176` — silent `return` on drop (no throw, no re-entry). |
| Tests adequate | **PASS** (with nits) | Policy: `log-forward-policy.test.ts` covers always-false, payload shape, console levels, closed-panel simulation. Gate: `log-event-gate.test.ts` covers capacity, refill, per-ws independence, new-connection-full-bucket. No-echo: `log-event-no-echo.test.ts` covers accepted-but-not-echoed, flood + rate-limit + no-echo. Missing: full `startServer` integration test (acknowledged as optional by RCA nits). |

## A.1-only loop break confirmation

If B.1 were reverted (companion echoes again), A.1 still breaks the loop: `handleCompanionMessage` catch never calls `logToCompanion`, so the companion echo of `log.event` never produces a new `sidepanel_forward_failed` → no re-entry. **CONFIRMED.**

## ADR-020 capability checklist

| Check | Status |
|-------|--------|
| Capability declaration present | **PASS** — `Surface: n/a`, `Compose: none`, `Autonomy: n/a`, `Trust: n/a` — appropriate for bugfix-only diff |
| No new tools/gates/UI entry points | **PASS** — zero new surface area |
| P1 security watchlist (god-mode, originWs, evaluate, shell) | **PASS** — none touched |

## Blocking

*(none)*

## Nits

1. **Side-panel `log.event` handler reads wrong message field** (`chrome-extension/src/sidepanel/hooks/useWebSocket.ts:258`): The handler does `const log = msg.data`, but for `log.event` messages (both old echo and new local fan-out), the log envelope fields (`level`, `source`, `event`) are at `msg.level`/`msg.source`/`msg.event`, **not** inside `msg.data`. The handler falls through to defaults (`source: "unknown"`, `event: "unknown"`), effectively discarding the actual event name in the live log UI. This is **pre-existing** (not introduced by this PR) and the PR preserves the existing message shape, so it's non-blocking. Worth a follow-up: change `msg.data.level` → `msg.level`, etc.

2. **Dead code as loop-hazard guard** (`chrome-extension/src/background/index.ts:406-413`): The `if (shouldReportForwardFailureToCompanion(type))` block contains an unreachable `logToCompanion(...)` call (policy always returns `false`). The comment explains intent: "Kept so a future opt-in cannot forget the loop hazard without touching policy." Unconventional — dead code as documentation/safety — but well-commented and harmless. Non-blocking.

3. **No full-server integration test for no-echo contract** (RCA nit #4 from Claude, #6 from Pi): `log-event-no-echo.test.ts` tests a pure-function mirror of the handler logic, not the real `server.ts` handler with auth/WS stack. A test that starts `WebSocketServer`, authenticates a client, sends `log.event`, and asserts zero frames back to the same socket would be more robust. Acknowledged as optional by implementer prompt. Non-blocking.

## Recommended follow-ups (optional)

- Fix side-panel `log.event` handler to read `msg.level`/`msg.source`/`msg.event` directly (field-level nit).
- Add `companion/tests/integration/log-event-echo.test.ts` using the repo's existing `ws-roundtrip.test.ts` pattern.

VERDICT: APPROVE_WITH_NITS
