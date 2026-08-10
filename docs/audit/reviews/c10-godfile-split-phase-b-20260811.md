# C10 God-file Split — Phase B (2026-08-11)

Branch: `fix/c10-godfile-split-a` (continues Phase A on same worktree)

## Goal

Extract the **L2 security admission block** from `createToolExecutor` into `companion/src/tool/l2-admission.ts` with **zero intentional behavior change**.

## LOC before / after

| File | Before (post Phase A) | After | Δ |
|------|----------------------|-------|---|
| `companion/src/server.ts` | 5004 | 3640 | **−1364** |
| `companion/src/tool/l2-admission.ts` | — | ~1510 | new |
| `companion/src/tool/companion-dispatch.ts` | (Phase A) | FREEZE note only | — |

## What moved

### C10 Phase B — L2 admission

- **From** `server.ts` `createToolExecutor`: L2 confirmation gate block
  - `L2_GATE_TOOLS` list + host_app / host_cli / host_computer platform gates
  - osascript macOS-only prefilter
  - full L2 confirmation / forceConfirm / three-flag / unattended / G1 / enterprise skip algebra
  - `securityConfirmations.request` + tray race + token issue
  - evaluate pre-existing `security_token` validation + critical replay audit
  - `winL2NonceChallenge` / `hostAppTier` issuance (returned to caller)
- **To** `companion/src/tool/l2-admission.ts` as `runL2ToolAdmission`
- **Public API**
  - `runL2ToolAdmission(ctx) → L2AdmissionResult`
  - `L2_GATE_TOOLS` (readonly list)
  - pure helpers: `isFullAutonomyCruise`, `isHostComputerPlatformGated`, `isHostAppPlatformGated`, `isHostCliPlatformGated`
- **Re-export** from `server.ts` so external imports stay stable
- **Context injection** (avoids circular `server ↔ l2-admission`):
  - `securityConfirmations`, `getThreadManager`, `getCachedTabUrl`, `getDomainFromUrl`
  - `computerRateLimiter`, `activeTrayConfirmsByWs`, `clients`, `wsAuthGet`
  - `logToolFinish` + per-call tool identity
- **`resolveHostUseApp`** moved with the block (was only used by L2)
- **`computerTaskAbort`** via `getComputerTaskAbortRegistry()` (shared registry)

### Wiring in `createToolExecutor`

```ts
const l2Outcome = await runL2ToolAdmission({ ... })
if (!l2Outcome.ok) return l2Outcome.result
finalParams = l2Outcome.finalParams
const winL2NonceChallenge = l2Outcome.winL2NonceChallenge
const hostAppTier = l2Outcome.hostAppTier
// URL gate / cookie gate / dispatch unchanged
```

### FREEZE update

`createToolExecutor` is now the **orchestration shell** (multi-agent → cookie → L2 call → URL → companion dispatch → extension). L2 algebra lives in `tool/l2-admission.ts`.

## Not moved (deferred)

| Item | Why |
|------|-----|
| URL gate (`navigate` / `create_tab` / `set_tab_url`) | Explicit Phase B scope exclusion |
| Cookie trust gate | Explicit Phase B scope exclusion |
| Image fetch gate | Separate gate family |
| forceConfirm algebra changes | Zero behavior change constraint |
| Dual-review of extracted module | Pending (this note flags it) |

## Dual-review status

**Pending.** Mechanical extract + pure-helper tests + existing security-gates suite green. Recommend dual-model review of `l2-admission.ts` algebra surface before further splits.

## Verification (executed)

```bash
cd companion
npx tsc -p tsconfig.test.json
node --test .test-dist/tests/l2-admission-pure.test.js          # 5 pass
node --test .test-dist/tests/integration/security-gates.test.js # 63 pass
node --test .test-dist/tests/ws-router-validator-lockstep.test.js \
            .test-dist/tests/worker-hard-deny-runtime.test.js \
            .test-dist/tests/computer-unattended-grant.test.js   # 36 pass
```

All of the above **pass**.

## Constraints honored

- No intentional behavior change
- forceConfirm / three-flag / enterprise-skip / G1 semantics preserved
- URL gate + cookie gate left in `server.ts`
- No push
