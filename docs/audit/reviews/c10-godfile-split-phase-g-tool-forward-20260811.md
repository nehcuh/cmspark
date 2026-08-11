# C10 God-file Split — Phase G (2026-08-11)

Branch: `fix/c10-godfile-split-a` (continues Phase A–F on same worktree)

## Goal

Extract **extension tool-forward plumbing** from `createToolExecutor` / `server.ts` into `companion/src/ws/tool-forward.ts` with **zero intentional behavior change**.

## LOC before / after

| File | Before (post Phase F) | After | Δ |
|------|----------------------|-------|---|
| `companion/src/server.ts` | 2635 | 2434 | **−201** |
| `companion/src/ws/tool-forward.ts` | — | 356 | new |
| `companion/tests/ws-tool-forward.test.ts` | — | 139 | new |

## What moved

1. **Timeouts**: `TOOL_EXECUTION_TIMEOUT_MS`, `BROWSER_DOWNLOAD_MAX_TIMEOUT_MS`, `resolveToolDispatchTimeoutMs`
2. **Pending map**: `pendingToolCalls` Map + `PendingToolCall` type
3. **Reject helpers**: `rejectPendingForThread`, `hasPendingForTab`, `rejectPendingForTab`
4. **Result correlation**: `handleToolResult` (SEC-E originWs peer check preserved)
5. **`dispatchToExtension`**: exported (image-fetch phase1/phase2 inject; fixed 15s timeout)
6. **Default forward path** → `forwardToolToExtension(ctx)`:
   - list_tabs → `refreshTabUrlCache` + `lockMetaForTab` enrichment
   - navigate / set_tab_url → tabUrlCache.set
   - create_tab → tabUrlCache + multi-agent `autoHoldCreatedTab`
   - close_tab → `releaseTabLease`
   - timeout via `resolveToolDispatchTimeoutMs` / send failure / not connected

## Not moved (remain in server.ts)

- `tabUrlCache`, `refreshTabUrlCache`, `getCachedTabUrl`, `applyTabNavigated` (L2 admission uses `getCachedTabUrl`)
- `applyConnectionCloseGracePeriod` (still mutates `pendingToolCalls` via import)
- createToolExecutor orchestration shell (pregate → cookie → browser_download → L2 → URL → image → companion → MCP → forward)

## Wiring

### Runtime bind

```ts
export type ToolForwardRuntime = {
  getTabUrlCache: () => Map<number, string>
  refreshTabUrlCache: (tabs: any[]) => void
  getThreadManager: () => ThreadManager | null | undefined
}

export function bindToolForwardRuntime(rt: ToolForwardRuntime): void
```

- **Bound** from `bindToolForwardFromServerLocals()` at:
  - `initServices`
  - `seedThreadManagerForTests`
  - eager module load (after `tabUrlCache` exists; same pattern as MCP bind)
- **`logToolFinish`**: per-call on `forwardToolToExtension` ctx (not bound)

### createToolExecutor terminal

```ts
return forwardToolToExtension({
  toolCallId, toolName, finalParams, ws, actingThreadId, startedAt, logToolFinish,
})
```

### image-fetch-admission

Continues to receive `dispatchToExtension` injected from createToolExecutor (now imported from `ws/tool-forward`).

### Re-exports (server.ts)

```ts
export {
  pendingToolCalls,
  handleToolResult,
  rejectPendingForThread,
  hasPendingForTab,
  rejectPendingForTab,
  dispatchToExtension,
  forwardToolToExtension,
  TOOL_EXECUTION_TIMEOUT_MS,
  BROWSER_DOWNLOAD_MAX_TIMEOUT_MS,
  resolveToolDispatchTimeoutMs,
  bindToolForwardRuntime,
} from "./ws/tool-forward"
```

Tab-lease hook registration and companion-dispatch bind still pass `hasPendingForTab` / `rejectPendingForTab` from the re-export surface.

## FREEZE update

`createToolExecutor` is the **pure orchestration shell**. Extension forward lives in `ws/tool-forward.ts`. Do not re-inflate server.ts with pending-map / send / timeout / tabUrlCache post-process bodies.

## Tests

New: `companion/tests/ws-tool-forward.test.ts`

- resolveToolDispatchTimeoutMs browser_download vs default
- dispatchToExtension not connected → error
- handleToolResult origin mismatch ignores wrong peer
- rejectPendingForThread / rejectPendingForTab counts
- bindToolForwardRuntime smoke

Must-pass (executed):

```
npx tsc -p tsconfig.test.json
node --test .test-dist/tests/ws-tool-forward.test.js
node --test .test-dist/tests/pending-tool-origin-ws.test.js
node --test .test-dist/tests/image-fetch-admission.test.js
node --test .test-dist/tests/orchestrator-tool-pregate.test.js
node --test .test-dist/tests/integration/security-gates.test.js
node --test .test-dist/tests/browser-download-schema.test.js
```

**Result**: all green (88 combined from first batch + 18 browser-download-schema).

## Behavior invariants (preserved)

| Invariant | Status |
|-----------|--------|
| `dispatchToExtension` uses fixed `TOOL_EXECUTION_TIMEOUT_MS` (not resolveToolDispatchTimeoutMs) | preserved |
| Default forward uses `resolveToolDispatchTimeoutMs` (browser_download extended) | preserved |
| SEC-E originWs on pending + handleToolResult mismatch ignore | preserved |
| pending map singleton identity via server re-export | same Map |
| tab-lease pending hooks still registered from server with same functions | preserved |

## Commit

`refactor(ws): extract extension tool-forward pending map (C10-G)`
