I have enough evidence. Writing the verdict.

---

## Summary

The RCA is **correct**: a real echo loop exists between `companion/src/server.ts` (echoes every inbound `log.event` back to the sender) and `chrome-extension/src/background/index.ts` (forwards every companion message via `chrome.runtime.sendMessage`; on rejection, calls `logToCompanion`, which sends a new `log.event` back to the companion). When the Side Panel + Cockpit are closed, `chrome.runtime.sendMessage` rejects, the catch fires, and a tight localhost WS loop spins — matching the observed dual-end CPU + tens-of-GB traffic on the Chrome↔daemon socket (and the near-empty companion business logs). PR #4 (skill.list) and PR #64 (jailbreak scan) are correctly ruled out as concurrent causes. The proposed fix plan (Fix A1 + B + C) is sound in principle, with one clarification needed on Fix A2/B1's effect on the Side Panel's live log UI.

## RCA verdict

**CONFIRMED** — verified at:

- `companion/src/server.ts:5170-5179` — inbound `log.event` is logged AND echoed back to the same socket via `ws.send(JSON.stringify(msg))`. This is the only "echo to sender" pattern in `server.ts` besides legitimate id-tagged request/response at `server.ts:5300-5306`.
- `chrome-extension/src/background/index.ts:382-389` — fall-through path forwards every companion message via `chrome.runtime.sendMessage(msg)`; on rejection, calls `logToCompanion("debug", "extension.sidepanel_forward_failed", ...)`.
- `chrome-extension/src/background/index.ts:165-173` — `logToCompanion` calls `wsClient.send({ type: "log.event", ... })`, re-entering the companion echo path.
- `chrome-extension/src/background/index.ts:395-930` — the background's own `onMessage` listener returns `undefined` for unmatched types (e.g. `log.event`, `chat.token`); service-worker `sendMessage` does not deliver to the sender's own context, so with Side Panel + Cockpit + Popup closed there is no receiver → guaranteed rejection → loop fires.
- `chrome-extension/src/sidepanel/hooks/useWebSocket.ts:942,975` — Side Panel listener only registered while mounted; closed panel ⇒ no listener ⇒ rejection. Cockpit uses the same hook (`cockpit/CockpitApp.tsx:27`), same closure behavior.
- `companion/src/server.ts:4520-4523` — schema gate only checks `event` is a non-empty string, so the recursive `sidepanel_forward_failed` payload always passes validation and re-enters the echo.
- No `caffeinate` / `IOPM` / `PreventUserIdleSystemSleep` in `companion/src` (grep returned no matches) — "no sleep assertions from cmspark" claim verified.
- `companion/src/llm/adapter.ts:65,506` — jailbreak scan only runs in the streaming path; not an overnight trigger.
- `companion/src/server.ts:5254` (`tab.navigated`) is a separate non-echoing branch; not an alternative cause.

Tight localhost WS round-trips at ~10K/sec × ~200 B/cycle × 8 h ≈ tens of GB — consistent with the user's `nettop` observation.

## Alternative causes considered

- **PR #4 `skill.list` recurrence**: ruled out — `server.ts:5300-5306` now tags responses with `id` and only unicasts the response to the requesting socket; no blind broadcast. Tray socket traffic was small per the live sample.
- **PR #64 jailbreak O(N²)**: ruled out — only fires during streaming chat; no overnight chat per business logs.
- **`chat.token`/`tool.execute` storm**: ruled out — no business log volume overnight; only the Chrome↔daemon socket was hot, not a chat stream.
- **MCP reconnect / `tab.navigated` flood**: ruled out — `tab.navigated` doesn't echo to sender (line 5254), and MCP traffic wouldn't sustain tens of GB on the Chrome↔daemon socket specifically.
- **macOS Power Nap / coreaudiod / AddressBook**: contributing battery drain but cannot explain the dual-end CPU + Chrome↔daemon socket saturation. These are OS-side hygiene; correctly out of scope.

## Fix plan feedback

### Blocking

None. The RCA is correct and the proposed fix design (with Fix A1 as primary) is safe to implement.

### Nits

1. **Fix A2 / Fix B1 would regress the Side Panel's live log UI.** The companion is the *only* emitter of inbound `log.event` (grep found no other `type: "log.event"` origin in `companion/src`); the Side Panel consumes it at `useWebSocket.ts:256-271`. The extension's own log events bounce back via the echo to feed the live log panel — so "don't forward inbound log.event" or "broadcast to other clients only" (and there is exactly one extension WS client per `background/index.ts:225`, so "other clients" is the empty set) silently turns off the Side Panel log feed. Prefer **Fix A1** (stop calling `logToCompanion` for `sidepanel_forward_failed`; use `console.debug`) as the primary fix — it breaks the loop without touching the echo. If you additionally want a Side Panel log feed that doesn't depend on the echo, refactor it in a separate PR.
2. **Fix C2 rate-limit should be aggressive.** "N/sec per connection" at typical values (e.g. 50–100) still permits a multi-MB/s storm and sustained CPU; for an observability path that should never burst, a token-bucket of ~10/sec with hard drop is more appropriate. Treat this as the *backstop*, not the primary fix.
3. **Add a per-connection inbound `log.event` rate-limit at the companion** (`server.ts` near line 5170) regardless of the extension fix — defense in depth so that a future regression in any WS client cannot re-trigger the storm. Pair with Fix C2.
4. **Fix C3 regression test shape.** Repo already has the right pattern: `companion/tests/integration/ws-roundtrip.test.ts` (real `WebSocketServer` + `ws` client hitting `src/server.ts`). Add a sibling `log-event-echo.test.ts` that authenticates a client, sends `log.event`, and asserts the server does **not** write `log.event` back to the same socket within a short window. On the extension side, extend `chrome-extension/tests/background-notifications.test.ts` (or a new file) with a mock that makes `chrome.runtime.sendMessage` reject; inject a companion push; assert `wsClient.send` is never called with `type:"log.event"` for the failure path. Also cover the "Side Panel closed mid-streaming chat" fixture — the most common trigger in the wild.
5. **Security nit on Fix A1.** Silencing `sidepanel_forward_failed` does not hide real failures: the existing code comment ("side panel / cockpit may not be open — that's fine") already declares this an expected case, and the failure mode is identical whether the panel is closed or genuinely broken — neither is actionable from the companion side. `console.debug` is appropriate; consider keeping a once-per-session `console.warn` on the first occurrence so a totally broken SW listener is still observable in dev tools.
6. **`handleCompanionMessage` ordering nit (non-blocking).** Multiple `if (msg.type === ...)` blocks fall through; ensure whichever early-return is chosen for inbound `log.event` (Fix C1) is placed *before* the `chrome.runtime.sendMessage(msg)` call at line 383 to avoid accidental re-entry from a future refactor.

## Recommended implementation order

1. **Fix A1** — in `chrome-extension/src/background/index.ts:383-389`, replace `logToCompanion("debug", "extension.sidepanel_forward_failed", ...)` with `console.debug(...)`. Loop broken, zero regression to live log UI. Ship this alone if you need a fast patch.
2. **Fix B** — in `companion/src/server.ts:5170-5179`, stop echoing `log.event` back to the same `ws`. If a live feed for "other" clients is ever needed, scope the broadcast to `clients` excluding the sender — but per today's architecture that set is empty, so simple drop is correct.
3. **Fix C1** — extension `handleCompanionMessage` early-returns on inbound `msg.type === "log.event"` so it is never re-forwarded via `chrome.runtime.sendMessage` (placed *before* the catch-all at line 383).
4. **Fix C2 (backstop)** — per-connection inbound `log.event` rate-limit at the companion (token bucket ~10/sec) plus extension-side debounce on `logToCompanion`.
5. **Tests** — add `companion/tests/integration/log-event-echo.test.ts` and an extension-side `chrome-extension/tests/background-no-log-on-forward-failure.test.ts`; both must fail without the fix and pass with it.

VERDICT: APPROVE_WITH_NITS
