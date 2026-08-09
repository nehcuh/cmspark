# Deep Diagnosis P0 Optimization Closeout — 2026-08-09

**Branch:** `fix/deep-diagnosis-p0`  
**Source:** [deep-diagnosis-fanout-2026-08-09.md](./deep-diagnosis-fanout-2026-08-09.md)  
**Scope:** Phase 2 P0 batch (10 items) — implement + tests; no merge yet.

## Status

| # | P0 item | Status | Notes |
|---|---------|--------|-------|
| 1 | config 红action SoT | **done** | `companion/src/config-redact.ts`; `config.get`/`config.set` + broadcast use `redactConfigForWire` |
| 2 | trusted_domains Cookie-only | **done** | URL gate + image fetch no longer skip on cookie trust |
| 3 | evaluate/osascript forceConfirm | **done** | always L2 unless three-flag full autonomy; risk preview keeps detectCriticalApis |
| 4 | host_cli in COMPANION_TOOLS | **done** | routing list includes `host_cli` |
| 5 | MCP active selection at dispatch | **done** | `executeMcpTool` checks `mcp_selection_mode=manual` + `active_mcp_server_ids` |
| 6 | spawn whitelist / no nesting | **done** | expanded `WORKER_HARD_DENY`; worker parent denied; orch parent not inherited as capability base |
| 7 | LLM gate + paused | **done** | `file.upload` / `chat.regenerate` acquire multi-agent cap + release; paused rejects create/upload/regen |
| 8 | board.get contract | **done** | BoardPanel listens `chrome.runtime.onMessage` (PacksPanel pattern) |
| 9 | WS maxPayload + unauth cap | **done** | `maxPayload: MAX_WS_MESSAGE_SIZE`; max 8 unauth handshake sockets |
| 10 | Windows release SoT | **done** | README clarifies CI `package.sh` vs optional SEA |

## Verification [executed]

- `npx tsc --noEmit` (companion) — pass  
- `npx tsc --noEmit` (chrome-extension) — pass  
- `node --import tsx --test tests/config-broadcast-redact.test.ts tests/orchestrator-tab-lease.test.ts tests/single/files.test.ts` — 83 pass  
- `tests/apps-cli-phase2.test.ts` — 13 pass  
- `tests/integration/security-gates.test.ts` — 63 pass (tests updated for ADR-007 Cookie-only + evaluate always L2)

## Not in this batch

- P1/P2 from fanout report  
- Dual review (Pi/Claude) / PR / merge  
- kimi review (Windows path not assumed)  
- Full `npm test` suite  

## Next

1. Optional dual review + PR  
2. P1 batch (skill cache, cookie schema, stream fail-closed, SSRF, Whisper pins, …)
