# Dual review: log.event echo-loop **implementation** (post-code)

**Batch ID:** `log-event-echo-loop-impl`  
**Stage:** Implementation review (code is staged / in working tree)  
**Date:** 2026-07-31  
**Prior gate:** RCA dual-review both `APPROVE_WITH_NITS`  
  - `docs/audit/reviews/log-event-echo-loop-rca-claude-20260731-091807.md`  
  - `docs/audit/reviews/log-event-echo-loop-rca-pi-20260731-091807.md`  
  - `docs/audit/reviews/log-event-echo-loop-rca-verdict-20260731-091807.json`

**Capability declaration**

```text
Surface:      n/a
L2-classes:   (none)
Compose:      none
Autonomy:     n/a
Trust:        n/a
Channel:      n/a
```

Bugfix only — no new tools/gates/UI entry points.

---

## Your job

Independent senior review of the **diff** (read `git diff` / staged patch file; open real sources with tools).

1. Confirm the closed loop is actually broken in code.
2. Confirm dual-review RCA nits were folded correctly (especially live-log preservation).
3. Hunt regressions, incomplete fixes, missing tests, wrong file:line.
4. End with exactly one of:
   - `VERDICT: APPROVE`
   - `VERDICT: APPROVE_WITH_NITS`
   - `VERDICT: REJECT`

---

## Bug (recap)

When Side Panel / Cockpit closed:

```text
companion → extension message
  → chrome.runtime.sendMessage fails
  → logToCompanion("sidepanel_forward_failed")
  → companion log.event echo to sender
  → sendMessage fails again
  → tight loop (tens of GB, dual-end CPU, Thermal Emergency Sleep)
```

---

## What implementer claims landed

| # | Change | Files |
|---|--------|--------|
| A.1 | Forward-failure **never** goes back over WS; console warn once then debug | `chrome-extension/src/background/index.ts` + `log-forward-policy.ts` |
| B.1 | Companion **does not** `ws.send` log.event to sender | `companion/src/server.ts` |
| Live log | `logToCompanion` local `chrome.runtime.sendMessage` before WS upload | `background/index.ts` via `buildLogEventPayload` |
| Rate limit | Per-connection token bucket 10/s on inbound log.event | `companion/src/log-event-gate.ts` |
| Tests | Policy + gate + no-echo contracts | `*-policy.test.ts`, `log-event-gate.test.ts`, `log-event-no-echo.test.ts` |

### RCA nits that must be reflected

From Claude + Pi RCA review (both APPROVE_WITH_NITS):

1. **A.1 is primary** — sufficient alone to break loop.
2. **Do not** early-return drop inbound `log.event` without local fan-out (would black out live log).
3. If B.1 removes echo, extension must fan out own logs locally.
4. Rate limit ~10/s as backstop.
5. Tests: closed-panel must not produce companion log.event; rate limit; no echo.

---

## Review checklist (answer each)

### Loop break

- [ ] `handleCompanionMessage` catch does **not** call `logToCompanion` for normal forward failures (policy / code).
- [ ] `server.ts` log.event path has **no** `ws.send` echo to sender.
- [ ] A.1 alone would break loop even if B.1 were reverted? (confirm)

### Live log UI

- [ ] Side Panel still receives extension-originated logs when panel open (local sendMessage path).
- [ ] No double-delivery of the same log when panel open (local + accidental echo)?

### Rate limit

- [ ] Token bucket correct (capacity, refill, per-ws independence).
- [ ] Drop is silent / safe (no throw, no re-entry).

### Tests

- [ ] Fail without fix / pass with fix character for policy + gate.
- [ ] Gaps vs RCA (e.g. full `startServer` integration optional nit).

### Security / hygiene

- [ ] Silencing forward_failed does not hide actionable security failures.
- [ ] No secret leakage change in log payload.

---

## Required output format

```markdown
## Summary
...

## Implementation checklist
| Item | Pass/Fail | Evidence (file:line) |
|------|-----------|----------------------|
| A.1 loop break | | |
| B.1 no echo | | |
| Live log local fan-out | | |
| Rate limit 10/s | | |
| Tests adequate | | |

## Blocking
- ...

## Nits
- ...

## Recommended follow-ups (optional)
- ...

VERDICT: APPROVE|APPROVE_WITH_NITS|REJECT
```
