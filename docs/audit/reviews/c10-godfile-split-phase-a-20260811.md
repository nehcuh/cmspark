# C10 God-file Split — Phase A (2026-08-11)

Branch: `fix/c10-godfile-split-a` (base multi-adv #162 tip `9ef1348`)

## Goal

Reduce `server.ts` / `message-router.ts` god-file size via **mechanical extractions** with **zero behavior change**. Public exports re-exported from old paths so tests keep working.

## LOC before / after

| File | Before | After | Δ |
|------|--------|-------|---|
| `companion/src/server.ts` | 7491 | 5004 | **−2487** |
| `companion/src/message-router.ts` | 3854 | 3526 | **−328** |
| `companion/src/ws/validate.ts` | — | 973 | new |
| `companion/src/tool/companion-dispatch.ts` | — | 1638 | new |
| `companion/src/message-router/handlers/config.ts` | — | 364 | new |

## What moved

### C10-A — WS validate
- **From** `server.ts` (`validateWsMessage` + `WsValidationResult`, ~957 LOC validators object)
- **To** `companion/src/ws/validate.ts`
- **Re-export** from `server.ts` (import + export) so tests keep `import { validateWsMessage } from "../src/server"`
- **Lockstep test** (`ws-router-validator-lockstep.test.ts`) reads `src/ws/validate.ts` when present

### C10-B — Companion tool dispatch
- **From** `server.ts` (`CompanionToolExecOptions` + `executeCompanionTool`, ~1524 LOC switch)
- **To** `companion/src/tool/companion-dispatch.ts`
- **Runtime binder** `bindCompanionDispatchRuntime` / `CompanionDispatchRuntime` injects:
  - `getThreadManager`, `getSkillEngine`
  - `getCachedTabUrl`, `getTabUrlCache`
  - `computerTaskAbort` (shared registry)
  - `computerRateLimiter` / `getComputerRateLimiterSingleton`
  - `securityConfirmations`
  - `getComputerEstopEnsureOverride`
  - `rejectPendingForThread` / `hasPendingForTab` / `rejectPendingForTab`
- Bound after `initServices` and `seedThreadManagerForTests`
- Direct imports kept for `securityPolicy`, `getConfig`, `logger`, `checkHighRiskExecution`, osascript/APP_TOKEN helpers
- **`createToolExecutor` L2 algebra remains in `server.ts`** (no L2 changes)

### C10-C — Config family handlers
- **From** `message-router.ts` contiguous cases:
  - `config.get` / `config.set` / `config.test` / `settings.test`
  - `config.testVision` / `settings.get` / `settings.set`
- **To** `companion/src/message-router/handlers/config.ts` as `handleConfigFamily`
- Thin multi-case arm remains in `handleMessage` (lockstep case labels preserved)
- `hasPrototypePollutionKey` moved with config handler; MCP paths import it from there

## Deferred (not in Phase A)

| Item | Why deferred |
|------|----------------|
| Full `createToolExecutor` split / L2 algebra extract | Intentionally frozen; high blast radius |
| Remaining companion tool cases further split into capability/* modules | Mechanical body already out of server; further modularization is Phase B+ |
| Full message-router family split (chat / thread / skill / pack / mcp / computer / …) | Only config family extracted; rest still in `handleMessage` |
| `broadcastToClients` extract | Config family was preferred; broadcast is fallback if config too tangled (not needed) |
| Moving `pendingToolCalls` reject helpers into a shared module | Still bound from server via dispatch runtime |

## Verification (executed)

```bash
cd companion
npx tsc -p tsconfig.test.json   # via local ./node_modules/.bin/tsc — clean
node --test .test-dist/tests/ws-router-validator-lockstep.test.js
node --test .test-dist/tests/ws-validate-strict.test.js
node --test .test-dist/tests/computer-unattended-grant.test.js
node --test .test-dist/tests/worker-hard-deny-runtime.test.js
node --test .test-dist/tests/capability-shell-netsec.test.js
node --test .test-dist/tests/integration/security-gates.test.js
```

All of the above **pass** (security-gates: 63; capability-shell-netsec: 13; lockstep+strict: 9; unattended + worker-deny suites green).

## Commits

1. `refactor(ws): extract validateWsMessage to ws/validate (C10-A)`
2. `refactor(tool): extract executeCompanionTool to companion-dispatch (C10-B)`
3. `refactor(router): extract config family handlers (C10-C)`
4. `docs(audit): C10 god-file split phase A notes` (this file + FREEZE comment updates)

## Constraints honored

- No intentional behavior change
- No L2 algebra changes
- Public exports from `server.ts` preserved (`validateWsMessage`, `executeCompanionTool`, types)
- No force-push / no remote push
