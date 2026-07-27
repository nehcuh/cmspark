# Multi-agent ship (scratch) — 2026-07-27

- **Branch / HEAD**: `feat/multi-agent-p0` @ `32d46f6`
- **ADR**: ADR-015 (orchestrator + tab exclusive lease)

## Delivered
- **P0**: tab lease SM (SOFT 互斥 / HELD_PENDING_L2 / HARD / FORCE_RELEASING), `isToolAllowed`, spawn HITL + whitelist (pre-promote parent), caps (5 workers / 5 LLM loops), cancel drain + `POST_CONFIRM_CANCELLED`, evaluate always exclusive
- **P1**: FleetStrip, Confirm Center identity + stop_thread, L2 FIFO admission, shell/netsec single-flight pre-L2, llm-loop gate, ask_user binary
- **P2-lite**: extension TabQueue + tests; shared-observer / auto-spawn **deferred**

## Deferred
- shared-observer, auto-spawn, full Dashboard, wait barrier, CDP tool.abort, WS multi-worker E2E

## Gates
- **GATE1**: Claude APPROVE_WITH_CHANGES / Pi BLOCK → must_fix in `48a84c4` → **HOLD**
- **GATE2**: Claude no-ship / Pi BLOCK @ `13b6822` → must_fix in `32d46f6` (unit green); formal re-pass optional

## Test quick
```bash
npm --prefix companion test
npm --prefix chrome-extension test
# manual: spawn L2 → FleetStrip count → dual workers same tabId → TAB_LOCKED; stop-all closes L2
```

Full writeup: `docs/decisions/v1.3/multi-agent-ship-summary-2026-07-27.md`
