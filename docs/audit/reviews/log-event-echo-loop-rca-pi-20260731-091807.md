## Summary

The RCA is **correct**: a `log.event` echo loop exists between companion (`server.ts:5170-5181`) and extension (`background/index.ts:383-390`). When the side panel / Cockpit are closed, `chrome.runtime.sendMessage` rejects, the `.catch` calls `logToCompanion("debug", "extension.sidepanel_forward_failed", ...)`, companion echoes it back, and the loop self-sustains. The fix plan's direction is right, but the analysis is **narrower than the real attack surface** and the proposed Fix A.2 is counterproductive. Approved with nits.

---

## RCA verdict

**CONFIRMED** at exact file:line.

**Loop (companion):** `companion/src/server.ts:5170-5181`
```ts
if (msg.type === "log.event") {
  // ... logger.log(...)
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))       // ← echo to SENDER
  }
  return
}
```

**Loop (extension):** `chrome-extension/src/background/index.ts:383-390`
```ts
chrome.runtime.sendMessage(msg).catch((e: any) => {
  logToCompanion("debug", "extension.sidepanel_forward_failed", { ... })  // ← calls logToCompanion
})
```

**`logToCompanion`:** `chrome-extension/src/background/index.ts:166-172`
```ts
wsClient.send({ type: "log.event", source: "extension", level, event, data })
```

**No early-return for `log.event` in `handleCompanionMessage`:** confirmed at `background/index.ts:282-390`. The function handles `quickAction.start`, `security.config`, and `tool.execute` with early returns, but `log.event`, `config.updated`, `computer.task.event`, `security.confirmation.request`, `security.confirmation.resolved`, and `security.confirmation.expired` all **fall through** to the `chrome.runtime.sendMessage(msg).catch(...)` line.

**Initial trigger:** On every WS reconnect, `handleStateChange("connected")` calls `wsClient.send({ type: "config.get" })` (line 278). Companion responds with `config.updated`. This falls through `handleCompanionMessage` with no early return (line 326-328), hits `sendMessage`, fails when sidepanel is closed, and starts the loop. During macOS DarkWake with network reconnects, this would fire repeatedly.

**Volume estimate:** Each iteration is `log.event` (~150 bytes JSON) + WS framing. At ~5K-10K iterations/sec (bottlenecked by sync `fs.appendFileSync` in `logger.logEvent` — `logger.ts:121`), overnight (8h) yields ~20-60 GB. Matches "tens of GB cumulative rx/tx" on 127.0.0.1:23401 and `uv__io_poll → Writev` hot path (pure stream I/O, no business logic).

---

## Alternative causes considered

| Cause | Why ruled out |
|-------|--------------|
| tray `skill.list` loop (PR #4) | Fixed `3e60cc5`; tray WS traffic was small per live evidence |
| jailbreak O(N²) scan (PR #64) | Fixed `b0ad317`; no streaming chat overnight |
| `tab.navigated` flood | Extension→companion only (line 949); companion sends nothing back; cannot form a companion→extension→companion loop |
| MCP reconnect storm | No MCP server activity in companion business logs |
| `chat.token` streaming | No agent chat activity overnight |
| CMspark sleep assertion | `pmset -g assertions` shows none; zero `caffeinate`/IOPM in source |

---

## Fix plan feedback

### Blocking

*(none)*

### Nits

1. **Fix A.1 is the sufficient primary fix — not a co-equal "must."** The `.catch` on `chrome.runtime.sendMessage` (line 383-389) is the **only** injection point for `sidepanel_forward_failed`. Replacing `logToCompanion` with `console.debug` there breaks the loop entirely, regardless of whether Fix B is applied. Fix B is defense-in-depth, not co-required. Make Fix A.1 the primary.

2. **Fix A.2 ("do not forward `log.event` via `chrome.runtime.sendMessage`") is a bug disguised as defense-in-depth.** The side panel's live log display (`useWebSocket.ts:256-270`) receives `log.event` **exclusively** through the `chrome.runtime.onMessage` path — i.e., via the background's `sendMessage` forward. There is no alternative path (no direct WS in sidepanel, no `chrome.storage` sync). If you early-return `log.event` in `handleCompanionMessage`, the live log panel goes dark. The RCA speculates "sidepanel already gets logs via other paths if needed" but I verified: **it does not**. Drop Fix A.2 unless you also add a direct `chrome.runtime.sendMessage` call inside `logToCompanion` itself (so the extension forwards its own logs without waiting for the companion echo). If you do that, you must also drop the companion echo (Fix B.1) to avoid double-delivery.

3. **Fix B.2 ("broadcast to other authenticated clients only") misses the architecture.** The side panel does not connect directly to the companion WS. It receives all messages through the extension background's `chrome.runtime.sendMessage` relay. Even if the companion broadcasts `log.event` to the tray, the side panel won't see it. To preserve live log display after removing the echo, add a companion→extension WS message for logs that originates from the companion itself (e.g., `logger.log` events generated companion-side), and have the extension background forward those. For extension-originated logs, forward locally in `logToCompanion`.

4. **Six message types fall through to the triggering `.catch`**: `config.updated`, `computer.task.event`, `security.confirmation.request`, `security.confirmation.resolved`, `security.confirmation.expired`, and `log.event`. Fix A.1 neutralizes them all. But if you also add early returns for `security.confirmation.*` and `computer.task.event` (which don't need sidepanel forwarding when the Cockpit is the intended surface), you reduce noise. Worth a separate follow-up PR — not blocking this fix.

5. **The companion echo of `log.event` also affects the tray.** `server.ts:5170-5181` echoes to the **sender** WebSocket regardless of client type. When the tray sends a `log.event`, it receives its own echo. The tray presumably doesn't re-process echoes in a way that creates a loop (traffic was small), but this is latent tech debt. Fix B.1 cleans this up for both clients.

6. **Test plan gap:** The proposed regression test ("inject one companion push; assert log.event count ≤ 1") is good. Add a variant: simulate the **initial trigger** (companion sends `config.updated` while sidepanel closed), assert no `log.event` sent back. Also add: with sidepanel open, assert extension-originated `log.event` still reaches the sidepanel (covers nit #2).

---

## Recommended implementation order

1. **Fix A.1** (`background/index.ts:384`): `console.debug(...)` instead of `logToCompanion(...)` — one-line change, breaks the loop
2. **Fix B.1** (`server.ts:5177`): remove the `ws.send(JSON.stringify(msg))` echo — defense-in-depth
3. **Live log preservation** (`background/index.ts:166-172`): add `chrome.runtime.sendMessage({ type: "log.event", ... }).catch(() => {})` inside `logToCompanion` so extension-originated logs reach sidepanel without the companion round-trip
4. **Fix C (rate limit):** companion-side N/sec drop per connection — defense-in-depth
5. **Regression tests:** per revised test plan above

---

VERDICT: APPROVE_WITH_NITS
