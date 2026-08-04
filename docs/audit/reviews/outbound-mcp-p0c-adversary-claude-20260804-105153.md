# Independent Adversary Review — Outbound MCP P0c

## 1. Executive summary

- **MACHINE: 18/18 pass verified** `[executed]` (this session; fresh compile + `node --test`).
- **M7 (not default-on): solid.** `[inspected]` Only the explicit `mcp-outbound` subcommand launches the stdio server (`companion/src/index.ts:346-352`). `start`/`daemon` paths never touch it.
- **Auth + loopback bind: correct.** `[inspected]` `httpServer.listen(port, "127.0.0.1")` at `server.ts:5587`. Bearer = `ws_secret`, 32-byte hex, mode 0600, validated via `timingSafeEqual` (`companion-http.ts:62-89`, `ws-auth.ts:55-77`).
- **M2/M3 (forbidden + exfil gates): real.** `[inspected]` Profile is fail-closed; `disclosure_accepted` from caller is ignored; server session is the truth (`facade.ts:79-95`). Defense-in-depth re-check in BOTH `bridge.ts:99` and `companion-http.ts:157` before dispatch.
- **M6 (synthetic origin) is "implemented" but NOT wired.** `[inspected]` The origin object is created in `bridge.ts:62` and `companion-http.ts:177`, but production runner is `createToolExecutor(ws)` whose closure binds the **Extension WS** as `originWs` for `securityConfirmations.request` (e.g. `server.ts:1690, 2076, 2272, 4416`). Synthetic MCP origin never reaches the confirm stack. This is the biggest gap between DoD wording and runtime reality.
- **No integration test exercises the actual HTTP wiring** (`handleLoopbackHttp` → `handleOutboundMcpHttp` → `executeTool`). M4 ("real dispatch path") is *wired* but only verified via mocked runner unit tests.

## 2. Blocking issues

None — the security invariants (loopback-only, Bearer auth, fail-closed profile, server-side disclosure, no default-on) all hold. L8/L9 are documented opens per prompt non-goals.

## 3. Nits (file:line)

1. **M6 wiring gap** — `companion/src/outbound-mcp/origin.ts:19` + `server.ts:216-219`. Synthetic origin is dead metadata in the production path. Either tighten the M6 DoD ("origin object created" → "origin bound in `securityConfirmations.request`"), or wire `executeTool` to accept an origin override before L8 lands. Risk: Extension confirm UX cannot distinguish an MCP-driven confirm from an agent-loop confirm.
2. **Default `caller_id = "stdio-default"`** — `stdio-server.ts:31-33`. Multiple MCP clients that omit `CMSPARK_OUTBOUND_CALLER_ID` share a single disclosure session on the companion. Default should be `stdio-${process.pid}` or a startup-time UUID so sessions don't bleed. (Documented in `mcp.md`, but the default is permissive.)
3. **`safeEqualStr` length early-return** — `companion-http.ts:65`. `if (ba.length !== bb.length) return false` leaks length. Practical impact ~zero (secret length is fixed at 64 hex), but padding to fixed length before `timingSafeEqual` would be cleaner.
4. **INTERNAL_NAME_MISSING audit skip in companion-http** — `companion-http.ts:173-174`. The same error code IS audited in `bridge.ts:65-70`; the HTTP variant skips audit. Path is essentially unreachable (gate sets `internal_tool` when allowed), but inconsistent.
5. **No HTTP-layer integration test** — only `tests/outbound-mcp-{facade,companion-http}.test.ts` exist, both pure-function. No coverage for: actual HTTP request → handler → runner end-to-end; `ensureOutboundToolRunnerWired` rebind on WS `close`; concurrency between refresh hook and invoke.
6. **Health endpoint leaks runner state, unauthenticated** — `companion-http.ts:260-267`. Loopback-only, no secrets, but a loopback process can probe `wired|none` to time attacks. Acceptable for P0c.
7. **First-run ws_secret race** — `ws-auth.ts:55-77`. Read-then-write is not cross-process atomic; if `mcp-outbound` and companion start simultaneously with no secret file, they could each generate different secrets. Doc says "companion first"; acceptable for P0c.

## 4. Trajectory / component checks

- **Trajectory**: clean. No allowlist expansion, no god-mode/auto-approve wiring, no L2/cooks/evaluate/shell added. Inbound `mcp/` and outbound stay separate (no double-write drift). Documentation bulk (ADR-022, eval-gate skill, daily-content-loop brief) doesn't change runtime.
- **Component audit**:
  - Profile/gate: `companion/src/outbound-mcp/{profile,facade}.ts` — fail-closed ✓
  - Disclosure session: `disclosure-session.ts:29-43` — server-side Map, 8h TTL, caller-keyed ✓
  - Bridge: `bridge.ts:53-155` — gate → defense-in-depth → dispatch ✓
  - HTTP server: `companion-http.ts:139-304` — pure logic, Bearer auth, body limit 1MB ✓
  - HTTP client: `http-client.ts:23-72` — always `host || "127.0.0.1"`, never user-overridable ✓
  - Stdio server: `stdio-server.ts` — opt-in only, two meta-tools (`accept_data_disclosure`, `list_outbound_profile`) added to `tools/list` (Note: DoD M1 says "only allowlist names" — these meta tools are technically added; they don't expand the L1 *executable* surface, but they do expand `tools/list`. Acceptable since neither dispatches to CDP.)
  - `server.ts:161-186` — `handleLoopbackHttp` wrapper + 500 on internal error ✓
  - `server.ts:204-222` — `ensureOutboundToolRunnerWired` synchronous rebind ✓
  - `server.ts:2807-2819` — WS-close 5s grace cleanup of pending tool calls ✓
  - `server.ts:5509-5514` — refresh hook wired in `startServer` ✓
  - `server.ts:5767-5772` — wire on auth.ok ✓
  - `server.ts:6043-6048` — rebind/clear on WS close ✓

## 5. Residual risk for production bake-off

- **L8 tray/global confirm**: every interactive/confirm path still routes to the Side Panel WS. IDE agent without focused Side Panel will hit fail-closed `EXTENSION_UNAVAILABLE` or 45s confirm timeout. Bake-off metric "≥90% <45s" cannot be met without L8.
- **L9 tab lease**: Side Panel agent loop + MCP caller can drive the same Extension WS → CDP without coordination. Conflicts manifest as flaky tab behavior, not security breach.
- **Per-caller grant (L4+)**: currently `ws_secret` is process-level; any loopback process with the secret gets the full curated L1. P1 grant model is the real fix.
- **Audit sink**: `appendOutboundMcpAudit` delegates to `appendCapabilityAudit` (`audit.ts:18`); ensure the underlying writer handles concurrent writes from HTTP-handler concurrency (single-threaded JS makes this fine, but worth noting for any future worker-thread fan-out).

VERDICT: APPROVE_WITH_NITS
