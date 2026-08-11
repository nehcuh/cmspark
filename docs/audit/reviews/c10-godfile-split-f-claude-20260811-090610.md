All verification checks pass. Let me consolidate findings.

**Verified claims:**

| Claim | Status |
|------|--------|
| `tool-pregate.ts` is 256 LOC, leaf imports only | ✅ matches |
| `orchestrator/index.ts` named re-exports (no `export *`) to avoid cycle | ✅ `index.ts:10-15` |
| `server.ts` 2765 → 2635 (-130 LOC) | ✅ exact match |
| Order: `tool.start → pregate → cookie → browser_download → L2 → …` | ✅ `server.ts:761-818` |
| Pre-pregate keeps: actingThreadId, shell/netsec normalize, tool.start, isOutboundMcpCall | ✅ `server.ts:739-775` |
| Tests 9/9 pregate | ✅ ran, 9 pass |
| Tests 3/3 worker-hard-deny | ✅ ran, 3 pass |
| Tests 63/63 security-gates | ✅ ran, 63 pass |
| `npx tsc -p tsconfig.test.json` clean | ✅ no errors |

**Algebra diff (original vs extracted):**

| Gate | Original (server.ts) | New (tool-pregate.ts) | Behavior |
|------|----------------------|------------------------|----------|
| `sweepExpired` | via `await import("./orchestrator")` | static leaf import | same |
| `sidePanelWinsReleaseOutboundLease` | dynamic import + best-effort catch | deps-inject OR dynamic import + same catch | same |
| `paused` worker → `worker_paused` | inline | inline | same |
| `isToolAllowed` false → `tool_not_allowed` | inline + `sceneToolNotAllowedError` via dynamic import | inline + deps-inject OR dynamic import | same |
| TAB_ID_REQUIRED | inline | inline | same |
| `__require_tab_id` stamp (multi) | inline mutation | inline mutation (same ref) | same |
| Early HARD lease | inline `acquireOrRenewTabLease` | inline `acquire` (aliased) | same |
| `host_computer` + Chrome + anyHeld | inline (outside actingThreadId block, runs always) | inline (same scope) | same |
| `catch gateErr` → `ORCHESTRATOR_GATE_ERROR` | inline | inline | same |

`isOutboundMcpCall` correctly skips: sidePanelWins, paused, isToolAllowed, TAB_ID_REQUIRED, `__require_tab_id`, HARD acquire — but does NOT skip `host_computer` Chrome check (matches original).

**ADR-020 checklist:**
- Axes fit: ✓ (no new axis logic — pure refactor)
- Pack-first / Confirm dialects / Trust monotonicity / originWs / No new runtime / Experimental layers: ✓ none touched
- P1 watchlist (god-mode/originWs/evaluate/shell): none touched (shell cwd normalize stays pre-pregate in createToolExecutor)
- Missing Surface/Compose/Autonomy/Trust/Channel declaration: acceptable for pure refactor (per checklist, blocking only when adding tools/gates/UI).

**Non-blocking nits:**

1. Phase F doc (line 888-890) lists test files as `worker-hard-deny-runtime.test.js` and `integration/security-gates.test.js` — actual files are `.test.ts`. Cosmetic doc inaccuracy.
2. Implementer prompt omits ADR-020 Surface/Compose/Autonomy/Trust/Channel declaration. Per checklist, pure refactor → nit only (not blocking).
3. `tool-pregate.ts:89` uses `let finalParams = ctx.finalParams` but never reassigns it; could be `const` for clarity.
4. `ToolPregateDeps.forceThrow` (line 60) is a slight misnomer — the function is invoked but only fails-closed if the injected callback actually throws. The one test that uses it does throw, so behavior is correct; naming could be `injectGateSideEffect` or documented as "may throw".

No security regressions, no missing test coverage for the extracted gates, no wrong file:line refs in the FREEZE block, no over-claiming.

VERDICT: APPROVE_WITH_NITS
