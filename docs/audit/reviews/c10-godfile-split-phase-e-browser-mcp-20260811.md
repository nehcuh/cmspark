# C10 God-file Split — Phase E (2026-08-11)

Branch: `fix/c10-godfile-split-a` (continues Phase A–D on same worktree)

## Goal

Two extractions from `createToolExecutor` / MCP bodies in `server.ts` with **zero intentional behavior change**:

1. **E1** — `browser_download` path sandbox → `tool/browser-download-admission.ts`
2. **E2** — `executeMcpTool` / `executeMcpMetaTool` (+ helpers) → `mcp/dispatch.ts`

## LOC before / after

| File | Before (post Phase D) | After | Δ |
|------|----------------------|-------|---|
| `companion/src/server.ts` | 3334 | 2765 | **−569** |
| `companion/src/tool/browser-download-admission.ts` | — | 93 | new |
| `companion/src/mcp/dispatch.ts` | — | 623 | new |
| `companion/tests/browser-download-admission.test.ts` | — | 131 | new |

*(server.ts measured after both E1+E2 wiring.)*

## E1 — browser_download admission

### What moved

- **From** `server.ts` `createToolExecutor`: inline `if (toolName === "browser_download")` block (worker role lookup + `prepareBrowserDownloadParams` + warn/info logs)
- **To** `runBrowserDownloadAdmission(ctx): BrowserDownloadAdmissionResult`
- **Behavior preserved**:
  - Non-`browser_download` → `{ ok: true, finalParams, isWorker: false }` pass-through
  - Worker custom path → `WORKER_PATH_DENIED` + `logToolFinish` + early return
  - Path outside Downloads roots → `PATH_ESCAPE` + event `browser_download.path_escape`
  - Success → rewritten `finalParams` (sandboxed absolute `downloadPath`) + `browser_download.start` info log
  - `auto_approve_dangerous` still does **not** relax roots (unchanged `prepareBrowserDownloadParams`)

### Wiring

```
multi-agent → cookie → browser_download → L2 → URL → image → companion/MCP/extension
```

```ts
const bdOutcome = runBrowserDownloadAdmission({
  toolName, finalParams, toolCallId, startedAt, actingThreadId,
  logToolFinish,
  getThreadManager: () => threadManager,
})
if (!bdOutcome.ok) return bdOutcome.result
finalParams = bdOutcome.finalParams
```

### Re-export

```ts
export { runBrowserDownloadAdmission } from "./tool/browser-download-admission"
```

## E2 — MCP dispatch

### What moved

| Symbol | Notes |
|--------|--------|
| `DESTRUCTIVE_MCP_TOOL_PATTERN` | exported from `mcp/dispatch.ts` |
| `executeMcpTool` | exported async |
| `executeMcpMetaTool` | exported async |
| `tryExpandFilesystemAllowDirOnDenial` | exported (tests may use) |
| `enhanceMcpError` | exported; **re-exported from `server.ts`** for existing tests |
| `safeJsonStringify` | moved with MCP (only MCP used it) |
| `extractMcpError` | moved with MCP |

### Runtime injection (avoid circular imports)

```ts
export type McpDispatchRuntime = {
  getThreadManager: () => ThreadManager | null | undefined
  securityConfirmations: SecurityConfirmationManager
  broadcastToClients: (data: any) => void
}
export function bindMcpDispatchRuntime(rt: McpDispatchRuntime): void
```

Bound from the same places as companion dispatch:

- `initServices` → `bindMcpDispatchFromServerLocals()`
- `seedThreadManagerForTests` → re-bind
- **Eager** bind once after `broadcastToClients` is defined so MCP integration tests that skip `initServices` still work

### Cruise waive

Three-flag full-autonomy cruise uses `isFullAutonomyCruise` from `tool/l2-admission` (no re-inlined AND).

### Package barrel

`mcp/index.ts` re-exports:

`bindMcpDispatchRuntime`, `executeMcpTool`, `executeMcpMetaTool`, `enhanceMcpError`, `DESTRUCTIVE_MCP_TOOL_PATTERN`, `McpDispatchRuntime`.

### server.ts re-exports (compat)

```ts
export {
  bindMcpDispatchRuntime,
  executeMcpTool,
  executeMcpMetaTool,
  enhanceMcpError,
} from "./mcp/dispatch"
```

`createToolExecutor` MCP branches unchanged structurally:

```ts
import { executeMcpTool, executeMcpMetaTool } from "./mcp/dispatch"
// mcp_list_resources | mcp_read_resource | mcp_get_prompt → executeMcpMetaTool
// isMcpNamespaced → executeMcpTool
```

## FREEZE update

`createToolExecutor` FREEZE (phase-A..E) lists:

- L2 → `tool/l2-admission.ts`
- Cookie/URL → `tool/url-cookie-admission.ts`
- IMAGE_FETCH → `tool/image-fetch-admission.ts`
- browser_download → `tool/browser-download-admission.ts`
- MCP → `mcp/dispatch.ts`

## Not moved

| Item | Why |
|------|-----|
| `dispatchToExtension` / pending map | Ownership stays in `server.ts` |
| `broadcastToClients` body | Injected into MCP runtime |
| `mcpSessionByWs` | Session cleanup stays on server WS close path |
| Dual-review of extracted modules | Pending (this note flags it) |

## Verification (executed)

```bash
cd companion
npx tsc -p tsconfig.test.json
node --test .test-dist/tests/browser-download-admission.test.js   # 5 pass
node --test .test-dist/tests/mcp-error-hints.test.js              # 11 pass (enhanceMcpError via server re-export)
node --test .test-dist/tests/image-fetch-admission.test.js \
            .test-dist/tests/url-cookie-admission.test.js \
            .test-dist/tests/l2-admission-pure.test.js            # 25 pass
node --test .test-dist/tests/integration/security-gates.test.js  # 63 pass
node --test .test-dist/tests/integration/mcp-capability-gate.test.js \
            .test-dist/tests/integration/mcp-meta-tool-gate.test.js # 49 pass
```

All of the above **pass**.

## Constraints honored

- No intentional behavior change
- Worktree only (`cmspark-wt-c10-godfile`); no push
- MCP critical confirm / cruise waive / god-mode-unaware gates preserved
- browser_download path sandbox + worker deny preserved
