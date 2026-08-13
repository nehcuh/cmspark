# Dual review: 编程接力 live session UI (S71)

## Scope

Branch `feat/coding-handoff` adds **minimal real-time** ACP session surface in Chrome Side Panel:

### Companion
- `acp.session.event` broadcast (throttled stdout/stderr tail)
- WS: `acp.list`, `acp.ui_start` (origin-bound L2 confirm then start), `acp.session.cancel`
- `ensureAcpBroadcast` on server start

### Extension
- store `codingSession` / `acpAgents`
- FocusBand primary `coding_session` (below confirm & CU L2, above fleet)
- `CodingSessionChip` with **停止编程会话** (not 急停)
- Modal: when `acp.enabled` + agents configured → **启动 · 只读审查**

### Explicit non-goals (still)
- Full multi-turn interactive ACP IDE
- Side Panel apply/write
- Auto-spawn without confirm

## Capability declaration

```text
Surface:      L0/L1 evidence; live view is Composition status only
L2-classes:   acp.ui_start / acp_start_session HITL (never cruise-skip)
Compose:      acp client + task package
Autonomy:     single session global cap
Trust:        originWs confirm; stop is cancel not estop
Channel:      community
```

## Verify

1. forceConfirm never waived for ACP under god-mode (prior B1)
2. FocusBand priority: confirm > l2_safety > coding_session > fleet
3. Stop sends acp.session.cancel only
4. No free-exec from Phase A copy path
5. acp.enabled default still false

## Output

Findings + VERDICT line.
