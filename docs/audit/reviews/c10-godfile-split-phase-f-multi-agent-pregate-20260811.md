# C10 God-file Split — Phase F (2026-08-11)

Branch: `fix/c10-godfile-split-a` (continues Phase A–E on same worktree)

## Goal

Extract **ADR-015 multi-agent pre-gate** try/catch block from `createToolExecutor` into `companion/src/orchestrator/tool-pregate.ts` with **zero intentional behavior change**.

## LOC before / after

| File | Before (post Phase E) | After | Δ |
|------|----------------------|-------|---|
| `companion/src/server.ts` | 2765 | 2635 | **−130** |
| `companion/src/orchestrator/tool-pregate.ts` | — | 256 | new |
| `companion/tests/orchestrator-tool-pregate.test.ts` | — | 256 | new |
| `companion/src/orchestrator/index.ts` | 7 | 15 | +8 (named re-exports) |

## What moved

### Block — ADR-015 multi-agent pre-gate (try/catch)

- **From** `server.ts` `createToolExecutor`: try/catch from dynamic `import("./orchestrator")` through `ORCHESTRATOR_GATE_ERROR` fail-closed catch
- **To** `runMultiAgentToolPregate(ctx, deps?): Promise<ToolPregateResult>`
- **Behavior preserved**:
  - `sweepExpired({ hasPendingForTab })` on every tool invoke
  - ADR-022 L9 `sidePanelWinsReleaseOutboundLease` (best-effort) for non-outbound + TAB_LEASE_TOOLS + numeric tabId
  - `isOutboundMcpCall` skips multi-agent pack whitelist / paused path (synthetic `outbound_mcp:*` holder)
  - `actingThreadId` + ThreadManager: `paused` → `worker_paused:…`
  - `isToolAllowed` false → `tool_not_allowed` + `sceneToolNotAllowedError` + `security.tool_whitelist_blocked`
  - multi (`isMultiAgentThread(th) || anyTabLeaseHeld()`) + TAB_LEASE without numeric tabId → `TAB_ID_REQUIRED`
  - multi → stamp `__require_tab_id = true` on finalParams
  - multi + non-outbound + TAB_LEASE + numeric tabId → early HARD `acquireOrRenewTabLease(needsL2: false)`; lease fail → error_code from lease
  - `host_computer` + `anyTabLeaseHeld()` + chrome/chromium hint in params JSON → `HOST_CHROME_TAB_LEASE`
  - any exception → fail-closed `ORCHESTRATOR_GATE_ERROR` + `orchestrator.gate_error` warn + `logToolFinish`

### Not moved (remain in createToolExecutor before pregate)

- `actingThreadId` resolution (`__thread_id` / `_thread_id`)
- C7/C8 `shell_exec` / `netsec_port_scan` normalize
- `tool.start` WS notify + logger
- `isOutboundMcpCall` derivation from `finalParams.__outbound_mcp`

## Wiring

Order unchanged:

```
tool.start → multi-agent pregate → cookie → browser_download → L2 → URL → image → dispatch
```

```ts
const pregate = await runMultiAgentToolPregate({
  toolName,
  finalParams,
  toolCallId,
  startedAt,
  actingThreadId,
  isOutboundMcpCall,
  logToolFinish,
  getThreadManager: () => threadManager,
  hasPendingForTab,
  toolDisplayNameZh,
})
if (!pregate.ok) return pregate.result
finalParams = pregate.finalParams
```

## Module design

### Leaf imports (avoid circular barrel)

`tool-pregate.ts` imports:

- static: `./constants` (TAB_LEASE_TOOLS), `./tab-lease`, `./spawn` (`isMultiAgentThread`), `../logger`
- dynamic: `../outbound-mcp/dual-entry`, `../capability/user-gate-copy` (match prior lazy load)

Does **not** import `./index` (barrel re-exports pregate with named exports only).

### Optional `ToolPregateDeps` (tests only)

Production omits second arg. Tests may inject `forceThrow` for ORCHESTRATOR_GATE_ERROR, or override lease/whitelist helpers.

## Re-exports

```ts
// server.ts
export { runMultiAgentToolPregate } from "./orchestrator/tool-pregate"

// orchestrator/index.ts
export {
  runMultiAgentToolPregate,
  type ToolPregateResult,
  type ToolPregateCtx,
  type ToolPregateDeps,
} from "./tool-pregate"
```

## FREEZE update

`createToolExecutor` FREEZE documents:

- multi-agent pre-gate → `orchestrator/tool-pregate.ts`
- shell is pregate call + cookie + browser_download + L2 + URL + image + companion/MCP/extension

## Tests

| Suite | Result |
|-------|--------|
| `orchestrator-tool-pregate.test.ts` | 9/9 pass |
| `worker-hard-deny-runtime.test.js` | 3/3 pass |
| `integration/security-gates.test.js` | 63/63 pass |
| `orchestrator-tab-lease` + `orchestrator-l2-flight` + `outbound-mcp-dual-entry` | 45/45 pass |
| `npx tsc -p tsconfig.test.json` | clean |

Unit cases:

1. non-actingThreadId + no multi → ok pass-through
2. paused worker → `worker_paused`
3. `isToolAllowed` false → `tool_not_allowed`
4. multi + TAB_LEASE without tabId → `TAB_ID_REQUIRED`
5. multi + tabId → `__require_tab_id` + lease held
6. `host_computer` + chrome + lease held → `HOST_CHROME_TAB_LEASE`
7. `host_computer` without chrome hint passes with lease
8. gate exception → `ORCHESTRATOR_GATE_ERROR`
9. `isOutboundMcpCall` skips pack whitelist / paused

## Commit

`refactor(orchestrator): extract multi-agent tool pregate (C10-F)`
