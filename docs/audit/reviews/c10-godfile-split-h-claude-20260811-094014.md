I have enough evidence to render the verdict.

## Review Summary — C10 Phase H (commits 4034495 + 0da75cd)

**H1 — confirm-response extraction**:
- `security/confirm-response.ts:37-320` body is byte-equivalent to the original `server.ts` handler (modulo `./` → `../` dynamic import paths and `threadManager` → `getThreadManager() as ThreadManager` via DI).
- `server.ts:837-851` keeps a thin wrapper preserving the public signature `handleSecurityConfirmationResponse(ws, msg, sessionId?)` so integration tests (security-gates, app-launch-gate) need no changes.
- All anti-injection algebra preserved: `relevantDomains` whitelist validation (`confirm-response.ts:70-92`), origin-bound `respondFrom` (line 133), `effectiveApproved = stopThread ? false : approved` (line 132), `host_write` never thread-trusted (line 310-317).

**H2 — WS lifecycle extraction**:
- `ws/lifecycle.ts` owns `wss / clients / wsAuth / outboundRunnerWs` state + `MAX_UNAUTHENTICATED_WS=8` cap + `startServer` body.
- **No circular import** — `lifecycle.ts` has zero `from ".*/server"` or `require(".*/server")` imports (verified). Wiring flows server→lifecycle via `bindWsLifecycle({...})` at `server.ts:1006-1022`.
- Origin gate preserved at `lifecycle.ts:191-204` (`chrome-extension://` + `cmspark-tray://local`).
- Pre-auth gate preserved at `lifecycle.ts:796-799` (only `auth.handshake` allowed pre-auth, else terminate).
- `AUTH_TIMEOUT_MS` timer at `lifecycle.ts:694-700` terminates on timeout.
- `applyConnectionCloseGracePeriod` at `lifecycle.ts:312-334` still filters by `pending.originWs !== closedWs`.
- Outbound runner rewired on `auth.handshake` success (`lifecycle.ts:881`) and on `ws.close` (`lifecycle.ts:1225`).
- `originWs: ws` binding preserved at both new-confirmation callsites: `history.export` (`lifecycle.ts:1031`) and `requestConfirmation` for `handleMessage` (`lifecycle.ts:1166`).
- `getWsClients()` / `getWsAuthState()` accessors used by `createToolExecutor`'s L2/URL admission (server.ts:644-645, 664-665); both consumers only iterate read-only.

**LOC**: server.ts 2434 → 1022 (−1412), verified via `git show <sha>:companion/src/server.ts | wc -l`.

**Tests**: `npm test` → 2712 pass / 0 fail.

**ADR-020 checklist**: Pure refactor — no Surface/Compose/Autonomy/Trust/Channel declaration required. No new tools, gates, or UI entry points. No bare "中层 Agent" framing. Pack-first / confirm-dialect / trust-monotonicity / originWs all preserved.

**Nits** (non-blocking):
- The inline local-broadcast `for (const client of clients)` loop at `lifecycle.ts:1168-1179` (handleMessage `broadcast` opt) duplicates `broadcastToClients`. This was the original behavior — not a regression, just pre-existing duplication preserved faithfully.
- Internal type signature changed from `sessionId?: string` to `sessionId: string | undefined` + mandatory `deps`. The public wrapper in `server.ts:837-851` preserves the optional signature, so external callers see no change.

VERDICT: APPROVE
