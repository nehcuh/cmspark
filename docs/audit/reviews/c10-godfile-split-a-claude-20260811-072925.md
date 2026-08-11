## Independent senior review — C10 god-file split Phase A

### Verification performed (all `[executed]`)

- **Patch freshness**: `git diff origin/fix/multi-adv-deep-wave012...HEAD` matches `docs/audit/reviews/c10-godfile-split-a-diff-20260811-072925.patch` byte-for-byte after preamble (7399 vs 7419 lines; 20-line preamble). Not stale.
- **C10-A** (`ws/validate.ts`): old `server.ts` lines 5523–6486 vs new `ws/validate.ts` lines 10+ — `diff` reports **IDENTICAL** (964 lines each).
- **C10-B** (`tool/companion-dispatch.ts`): old `server.ts` switch body (lines 3366–6486) vs new file body. After normalizing only (a) relative import paths `./…` → `../…` (file moved one dir deeper) and (b) closure ref `computerRateLimiterSingleton` → runtime accessor `getComputerRateLimiterSingleton()`, the bodies are byte-identical (1523 lines). The 11-field `CompanionDispatchRuntime` matches `bindCompanionDispatchFromServerLocals()`’s 11-field argument; `tsc -p tsconfig.json --noEmit` clean.
- **C10-C** (`message-router/handlers/config.ts`): 7 case labels (`config.get/set/test/testVision`, `settings.get/set/test`) preserved as thin fall-through arms in `message-router.ts:225-235` delegating to `handleConfigFamily`. `hasPrototypePollutionKey` + `sanitizeConfig` moved cleanly; `hasPrototypePollutionKey` still imported by message-router for the MCP paths that need it (lines 1644, 3434).
- **Runtime bind order**: `bindCompanionDispatchFromServerLocals()` is the last statement of `initServices()` (server.ts:616) and is also re-run inside `seedThreadManagerForTests()` (server.ts:628) for tests that skip full init. `initServices()` is awaited at boot (server.ts:4219) before WS server listens. Fail-closed: `requireRt()` throws if any path calls `executeCompanionTool` before bind.
- **Public API**: `validateWsMessage`, `WsValidationResult`, `executeCompanionTool`, `bindCompanionDispatchRuntime`, `CompanionToolExecOptions`, `CompanionDispatchRuntime` all re-exported from `server.ts` (3997-3998, 3341-3342).
- **Lockstep test** picks `src/ws/validate.ts` when present (`ws-router-validator-lockstep.test.ts:25-28`); `extractValidatorKeys` still finds `const validators:` (line 26) and `export function validateWsMessage` (line 17).

### Tests executed (all green)
- `ws-router-validator-lockstep`: 3/3 pass
- `ws-validate-strict` + `computer-model-handlers` + `voice-stt-handlers` + `voice-whisper-handlers`: 44/44 pass
- `integration/security-gates`: 63/63 pass
- `computer-unattended-grant` + `worker-hard-deny-runtime` + `capability-shell-netsec`: 46/46 pass
- `tsc -p tsconfig.json --noEmit`: clean; `tsc -p tsconfig.test.json --noEmit`: clean

### ADR-020 capability / security
- Pure mechanical extract — no Surface/Compose/Autonomy/Trust/Channel change. No new tool, gate, confirm family, or UI entry. Capability declaration omitted from the prompt is a non-issue for pure refactor per checklist rule (`treat as **nit** at minimum` only when not pure docs/test/refactor).
- No L2 algebra, `forceConfirm`, `originWs`, `security_token`, or full-autonomy-cruise logic touched (verified by body diff). Trust monotonicity preserved.
- No new runtime framework (just module split + dependency injection).

### Nits (non-blocking, listed for completeness only)
1. `server.ts` places `import { ... } from "./tool/companion-dispatch"` (line 3335) and `import { validateWsMessage, ... } from "./ws/validate"` (line 3997) mid-file rather than with the other top-of-file imports. ESM hoist makes this legal; stylistic only.
2. The unified config switch arm in `message-router.ts:231-235` has a defensive `return { type: "error", error: "Unhandled config type: …" }` fallback. Unreachable today (case labels match `handleConfigFamily` exactly); harmless guard against future drift.

VERDICT: APPROVE
