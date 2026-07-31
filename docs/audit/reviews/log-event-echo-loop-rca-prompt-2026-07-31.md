# Dual review: log.event echo loop RCA + proposed fix (pre-implementation)

**Batch ID:** `log-event-echo-loop-rca`  
**Stage:** Root-cause diagnosis + fix design (NO code landed yet)  
**Date:** 2026-07-31  
**Surface:** n/a (bugfix; no new capability)  
**L2-classes:** (none)  
**Compose:** none  
**Autonomy:** n/a  
**Trust:** n/a (loop is observability path, not a gate)  
**Channel:** n/a  

---

## Your job

You are an **independent** senior reviewer. Challenge the RCA and proposed fix **against the real repo code**. Do **not** rubber-stamp.

1. Read the cited files with tools (`Read` / `Grep` / `Bash`).
2. Confirm or refute the closed loop.
3. Check for **alternative / concurrent** root causes that better explain overnight battery drain.
4. Critique the proposed fix for incompleteness, regressions, and missing tests.
5. End with exactly one line: `VERDICT: APPROVE` | `VERDICT: APPROVE_WITH_NITS` | `VERDICT: REJECT`.

**APPROVE** = RCA correct enough to implement as proposed.  
**APPROVE_WITH_NITS** = RCA accepted; fix plan needs non-blocking adjustments listed before verdict.  
**REJECT** = RCA wrong / incomplete / fix plan dangerous — list **blocking** issues with `file:line` before verdict.

---

## Context (what happened on the user's Mac)

1. Laptop lid closed overnight; morning battery ~1%.
2. Power log: `Thermal Emergency Sleep` at 01:27 with `Charge:1%`, then DarkWake thrashing (Wi‑Fi/BT), then long sleep; lid open 08:54 still 1%.
3. Live while awake (same day, before processes stopped):
   - `cmspark-agent.js daemon` ~30–38% CPU continuous; sample hot path `uv__io_poll` → `OnUvRead` → JS → `Writev`.
   - Google Chrome (extension process + network helper) multi-core high CPU.
   - **Local TCP 127.0.0.1:23401** between **Chrome Helper** and daemon: tens of GB cumulative rx/tx.
   - **Tray** WS peer on same port: small traffic (orders of magnitude lower).
4. Companion business logs overnight: almost empty (no agent task storm).
5. CMspark holds **no** IOPM sleep assertions / no caffeinate in companion code.

Historical related incidents (project memory):

| ID | Issue | Status |
|----|--------|--------|
| S3 / PR #4 | tray↔daemon `skill.list` request/response loop (~29MB/s, ~108GB) | Fixed `3e60cc5` |
| S10 / PR #64 | streaming jailbreak scan O(N²) main-thread spin | Fixed `b0ad317` |
| **This** | alleged **log.event echo + sidepanel_forward_failed** loop | **Unfixed** |

---

## Claimed root cause (closed loop)

### Companion echoes every `log.event` back to the **same** WS client

**File:** `companion/src/server.ts` (search `if (msg.type === "log.event")`)

```ts
if (msg.type === "log.event") {
  // ... logger.log(...)
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))  // echo to sender
  }
  return
}
```

### Extension: any companion → extension message is forwarded via `chrome.runtime.sendMessage`; on failure, logs back to companion

**File:** `chrome-extension/src/background/index.ts` — end of `handleCompanionMessage`:

```ts
chrome.runtime.sendMessage(msg).catch((e) => {
  logToCompanion("debug", "extension.sidepanel_forward_failed", {
    message_type: msg?.type || "unknown",
    error: e?.message || String(e),
  })
})
```

**File:** same file — `logToCompanion`:

```ts
wsClient.send({ type: "log.event", source: "extension", level, event, data })
```

### When Side Panel / Cockpit have no runtime listeners

`chrome.runtime.sendMessage` rejects with “Receiving end does not exist” → `sidepanel_forward_failed` → companion echoes `log.event` → handleCompanionMessage tries sendMessage again → **tight loop**.

**Trigger condition (common):** Extension authenticated to companion, Side Panel and Cockpit closed (typical overnight / lid-closed).

**Why this matches live evidence:** storm on **Chrome↔daemon** socket, not tray; pure stream I/O sample; no business log volume; high dual-end CPU.

---

## Claimed non-causes (for you to verify)

1. PR #4 tray `skill.list` loop — source + packaged bundle treat only `skill.activated`/`skill.deactivated` as push; tray socket traffic was small.
2. PR #64 jailbreak O(N²) — `jailbreakScanWindow` exists; overnight no streaming chat.
3. CMspark intentionally preventing sleep — no assertions in `pmset -g assertions` from cmspark; no IOPM/caffeinate in companion src.

Contributing (not primary loop) may still matter for drain: coreaudiod long PreventUserIdleSystemSleep, AddressBookSourceSync, Wi‑Fi DarkWake.

---

## Proposed fix (design only — not implemented)

### Fix A — Extension (must)

1. **Never** call `logToCompanion` for `sidepanel_forward_failed` (or any “no receiver” failure). Use `console.debug` only.
2. Prefer: if `msg.type === "log.event"`, do **not** forward via `chrome.runtime.sendMessage` at all (sidepanel already gets logs via other paths if needed — verify), OR skip the failure log for `log.event` only (weaker).

### Fix B — Companion (must)

1. Do **not** echo `log.event` back to the **sender** socket.
2. If live log UI is still required: broadcast to **other** authenticated clients only, or drop echo entirely if sidepanel reads logs another way.

### Fix C — Defense in depth (should)

1. Extension: early-return on inbound `log.event` (ignore) so even if companion still echoes, no re-log.
2. Companion: rate-limit / drop flood of `log.event` per connection (e.g. N/sec).
3. Regression test: simulate extension connection with no sidepanel listener; inject one companion push; assert `log.event` count on wire is bounded (≤1 or 0 echoes) within a short window.

### Out of scope for this fix

- Tray skill.list (already fixed).
- Jailbreak scan (already fixed).
- macOS Power Nap / AddressBook / coreaudiod (OS-side hygiene for user).

---

## Review checklist (answer each)

### RCA validity

- [ ] Confirm loop exists by reading current `server.ts` + `background/index.ts` (file:line).
- [ ] Confirm Side Panel closed ⇒ `sendMessage` failure path is real in MV3.
- [ ] Confirm no early-return for `log.event` in `handleCompanionMessage` that would break the loop.
- [ ] Is echo-to-sender intentional product behavior, or accidental?
- [ ] Could another path better explain tens-of-GB Chrome↔daemon traffic? (e.g. chat.token full content, tool.execute storm, MCP reconnect, tab.navigated flood)

### Fix plan quality

- [ ] Does Fix A alone break the loop? Fix B alone? Both needed?
- [ ] Does dropping echo break live log UI in Side Panel? Trace how sidepanel shows logs today (`useWebSocket` `log.event` case).
- [ ] Race / ordering: multiple WS clients (tray + extension + sidepanel ports)?
- [ ] Security: any risk that silencing forward_failed hides real failures?
- [ ] Test plan sufficient? What integration test shape fits this repo (node:test / extension mock)?

### Overnight narrative

- [ ] Does this RCA + OS factors adequately explain Thermal Emergency + 1% battery?
- [ ] Any missing measurement you would require before approving implementation?

---

## Required output format

```markdown
## Summary
(2–5 sentences)

## RCA verdict
CONFIRMED | PARTIAL | REFUTED
(with evidence file:line)

## Alternative causes considered
...

## Fix plan feedback
### Blocking
- ...
### Nits
- ...

## Recommended implementation order
1. ...

VERDICT: APPROVE|APPROVE_WITH_NITS|REJECT
```
