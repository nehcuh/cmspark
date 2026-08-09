# Deep Diagnosis P1 Optimization Closeout — 2026-08-09

**Branch:** `fix/deep-diagnosis-p0` (continues P0 batch branch)  
**Source:** [deep-diagnosis-fanout-2026-08-09.md](./deep-diagnosis-fanout-2026-08-09.md) P1 action plan  
**Scope:** Phase 2 P1 batch (8 items)

## Status

| # | P1 item | Status | Notes |
|---|---------|--------|-------|
| 1 | Pack apply ↔ SkillEngine map | **done** | `setActiveSkillsForThread` / invalidate; apply/unapply/uninstall sync |
| 2 | Cookie tool contract | **done** | zod + catalog: set/delete require `url`+`name`; get requires `domain` |
| 3 | screenshot / SELECTOR_REQUIRED | **done** | captureVisibleTab only if active tab matches tabId; no 300,300 default |
| 4 | tool-result truncate + abort | **done** | `truncateToolResultContent` shared live/rebuild; H1/M2/vision pass signal |
| 5 | Confirm / Cockpit stop | **done** | Cockpit uses `resolveStopTargetId` deny-safe; SW blank-create 2s single-flight |
| 6 | stream fail-closed | **done** | missing `thread_id` no longer paints active thread |
| 7 | Shared SSRF helper | **done** | `assertOutboundFetchUrlAllowed` on skill/knowledge import + config.test base_url |
| 8 | CU vault + shell/netsec bind | **done** | expanded MAC vault bundle IDs; shell binds cwd; netsec binds ports |

## Verification [executed]

- companion `tsc --noEmit` — pass  
- chrome-extension `tsc --noEmit` — pass  
- `tests/integration/security-gates.test.ts` — 63 pass  
- `tests/packs-engine.test.ts` — 27 pass  
- `tests/orchestrator-tab-lease.test.ts` + apps-cli — pass  
- chrome-extension `npm test` — **597 pass / 0 fail**

## Residual / not in this batch

- Full dual review / PR / merge  
- Whisper multi-arch pin (still backlog)  
- Confirm-mirror “success before gone” race (partially mitigated by blank single-flight only)  
- P2 god-file split / protocol negotiate  

## Next

1. Commit P0+P1 + open PR (user authorize)  
2. Or continue P2 maintenance items  
