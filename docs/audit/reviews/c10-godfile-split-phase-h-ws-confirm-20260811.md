# C10 God-file Split — Phase H (2026-08-11)

Branch: `fix/c10-godfile-split-a` (continues Phase A–G on same worktree)

## Goal

Zero intentional behavior change. Two extractions from `companion/src/server.ts`:

1. **H1** — `handleSecurityConfirmationResponse` → `security/confirm-response.ts`
2. **H2** — WS lifecycle / `startServer` → `ws/lifecycle.ts`

## LOC before / after

| File | Before (post Phase G) | After H1 | After H2 | Δ (H total) |
|------|----------------------|----------|----------|-------------|
| `companion/src/server.ts` | 2434 | 2183 | **1022** | **−1412** |
| `companion/src/security/confirm-response.ts` | — | 320 | 320 | new (H1) |
| `companion/src/ws/lifecycle.ts` | — | — | 1327 | new (H2) |

Phase G baseline: server.ts 2434 LOC.  
After Phase H: server.ts ~1022 LOC (orchestration shell + services + createToolExecutor).

---

## H1 — Confirm response

### What moved

`handleSecurityConfirmationResponse` body into `companion/src/security/confirm-response.ts`:

- Origin-bound `respondFrom` resolution
- `add_to_whitelist` pattern validation vs `relevantDomains`
- Domain whitelist persist (`auto_approved_domains`) after authoritative approve
- Thread whitelist (`host_read` / `host_app` / reject `host_write`)
- `stop_thread` path: abandon intents, reject worker confirms, reject pending tools, release leases, abort chat, abort shell

### Wiring

```ts
export type ConfirmResponseDeps = {
  securityConfirmations: SecurityConfirmationManager
  getConfig: () => { auto_approved_domains?: string[] }
  saveConfig: (partial: { auto_approved_domains: string[] }) => unknown
  getThreadManager: () => ThreadManager | null | undefined
  rejectPendingForThread: (threadId: string, reason: string) => number
  hasPendingForTab: (tabId: number, holderThreadId: string) => boolean
  rejectPendingForTab: (tabId: number, holderThreadId: string, reason: string) => number
}

export async function handleSecurityConfirmationResponse(
  ws, msg, sessionId, deps: ConfirmResponseDeps,
): Promise<void>
```

`server.ts` keeps a thin public wrapper (same signature for integration tests):

```ts
export async function handleSecurityConfirmationResponse(ws, msg, sessionId?) {
  return handleSecurityConfirmationResponseImpl(ws, msg, sessionId, {
    securityConfirmations,
    getConfig,
    saveConfig,
    getThreadManager: () => threadManager,
    rejectPendingForThread,
    hasPendingForTab,
    rejectPendingForTab,
  })
}
```

`getThreadApprovals` imported inside confirm-response (leaf module).

### Commit

`refactor(security): extract handleSecurityConfirmationResponse (C10-H1)`

---

## H2 — WS lifecycle

### What moved

Into `companion/src/ws/lifecycle.ts`:

1. **`isAllowedWsOrigin`**
2. **`handleHealthzRequest` / `handleLoopbackHttp`**
3. **`pickAuthenticatedClientWs`**
4. **`ensureOutboundToolRunnerWired`** (uses bound `createToolExecutor`)
5. **`applyConnectionCloseGracePeriod`**
6. **`broadcastToClients`**
7. **`setupBroadcastAuthForTests`**
8. **`startServer`** (full connection/auth/message/close/shutdown)

### Module state moved

| State | Location |
|-------|----------|
| `wss`, `clients`, `wsAuth`, `outboundRunnerWs` | `ws/lifecycle.ts` |
| `PORT`, `MAX_WS_MESSAGE_SIZE`, `MAX_UNAUTHENTICATED_WS`, `WS_DISCONNECT_GRACE_MS` | `ws/lifecycle.ts` |
| `mcpSessionByWs`, `activeTrayConfirmsByWs` | **remain on server** (createToolExecutor) |
| `securityConfirmations`, services, `createToolExecutor` | **remain on server** |

### Wiring

```ts
export type WsLifecycleDeps = {
  createToolExecutor: (ws: WebSocket) => ToolExecutorFn
  handleSecurityConfirmationResponse: (...) => Promise<void>
  initServices: () => Promise<void>
  getThreadManager / getSkillEngine / getHistoryStore
  securityConfirmations: SecurityConfirmationManager
  handleComputerTaskAbort / flipAllComputerTaskAborts
  applyTabNavigated / probeChatModel
  getMcpSessionId / clearMcpSession / getActiveMcpSessions
  activeTrayConfirmsByWs: WeakMap<WebSocket, Set<string>>
}

export function bindWsLifecycle(deps: WsLifecycleDeps): void
export async function startServer(options?: { onShutdown?: () => void }): Promise<void>
export function getWsClients(): Set<WebSocket>
export function getWsAuthState(ws: WebSocket): WsAuthState | undefined
```

`server.ts`:

- Imports `broadcastToClients`, `bindWsLifecycle`, `getWsClients`, `getWsAuthState` for local use
- Re-exports public surface (`startServer`, `isAllowedWsOrigin`, …) from `./ws/lifecycle`
- `createToolExecutor` L2/URL gates use `getWsClients()` / `getWsAuthState(w)`
- Calls `bindWsLifecycle({...})` at module load after createToolExecutor exists

**Circular deps:** lifecycle does **not** import `server.ts`. Server imports lifecycle and binds deps.

### Re-export surface (unchanged for tests / index)

| Export | From |
|--------|------|
| `startServer` | lifecycle (re-export server) |
| `isAllowedWsOrigin` | lifecycle |
| `handleHealthzRequest` | lifecycle |
| `pickAuthenticatedClientWs` | lifecycle |
| `ensureOutboundToolRunnerWired` | lifecycle |
| `applyConnectionCloseGracePeriod` | lifecycle |
| `setupBroadcastAuthForTests` | lifecycle |
| `broadcastToClients` | lifecycle |
| `handleSecurityConfirmationResponse` | server wrapper → confirm-response |
| `getSessionIdForTests` | server (`mcpSessionByWs`) |

`companion/src/index.ts` still `import { startServer } from "./server"`.

### Commit

`refactor(ws): extract startServer lifecycle (C10-H2)`

---

## Remaining `server.ts` responsibilities (~1022 LOC)

- Service singletons: `threadManager`, `skillEngine`, `historyStore`, `securityConfirmations`
- `tabUrlCache` + `applyTabNavigated`
- `createToolExecutor` orchestration shell (pregate → cookie → browser_download → L2 → URL → image → companion → MCP → forward)
- `mcpSessionByWs` / `activeTrayConfirmsByWs`
- Computer task abort registry accessors + `handleComputerTaskAbort`
- `initServices` / `seedThreadManagerForTests`
- `probeChatModel`
- Bind helpers for companion / MCP / tool-forward / lifecycle
- Re-exports of prior C10 extractions (tool-*, mcp/dispatch, ws/tool-forward, ws/validate)

---

## FREEZE update

Do **not** re-inflate `server.ts` with:

- confirmation-response algebra → `security/confirm-response.ts`
- WS origin / auth.handshake / healthz / broadcast / grace / `startServer` → `ws/lifecycle.ts`

---

## Tests (executed)

```
npx tsc -p tsconfig.test.json   # clean
node --test .test-dist/tests/integration/security-gates.test.js
node --test .test-dist/tests/integration/app-launch-gate.test.js
node --test .test-dist/tests/ws-origin.test.js
node --test .test-dist/tests/healthz.test.js
node --test .test-dist/tests/integration/computer-broadcast-auth.test.js
node --test .test-dist/tests/pending-tool-origin-ws.test.js
node --test .test-dist/tests/integration/ws-roundtrip.test.js
node --test .test-dist/tests/security-confirmation-origin.test.js
node --test .test-dist/tests/ws-tool-forward.test.js
node --test .test-dist/tests/integration/ws-auth-handshake.test.js
```

**Result**: all green (89 pass / 10 skipped on combined security+ws batch; 28/28 on broadcast+auth+tool-forward batch).

Runtime surface check:

```
startServer, isAllowedWsOrigin, handleSecurityConfirmationResponse,
applyConnectionCloseGracePeriod, setupBroadcastAuthForTests,
broadcastToClients, pickAuthenticatedClientWs  → all typeof function
```

## Behavior invariants (preserved)

| Invariant | Status |
|-----------|--------|
| Origin-bound confirm respond + whitelist persist only on authoritative approve | preserved (H1 body copy) |
| stop_thread drain (leases/pending/chat/shell) | preserved |
| isAllowedWsOrigin scheme gate | preserved |
| broadcastToClients auth filter (X3) | preserved |
| applyConnectionCloseGracePeriod originWs scoping (SEC-E) | preserved |
| auth.handshake + outbound runner wire | preserved |
| index.ts `startServer` import path | re-export via server |

## Not done (out of scope)

- Dual-review external agents
- Push to remote
- Further split of createToolExecutor remaining shell
