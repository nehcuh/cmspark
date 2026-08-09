# Final dual-review — Health Fanout P0 optimization closeout

**Patch currency check:** Patch header base = `0de1760` = current HEAD; the patch's 12-file modified list matches `git diff --stat HEAD` exactly. Patch is current, not stale.

## Verification performed (code inspection + machine runs)

**Machine:** `tsc -p tsconfig.test.json --noEmit` → clean (exit 0). Ran all 6 new/updated test files: **31/31 pass** (`thread-path-sanitize` 4, `tool-persistence-redact` 4, `mcp-stdio-l2-gate` 7, `pending-tool-origin-ws` 2, `llm-supersede-generation` 1, `outbound-mcp-grants` rest). Confirms implementer's machine claim.

## High-by-High trace (criteria #1 — code-real, not claim-only)

- **SEC-A path escape — FIXED.** `ThreadManager.isSafeThreadId`/`assertSafeThreadId` (thread-manager.ts:336-370); `threadFilePath` asserts + `path.relative` containment (352-361). `getMessages`→`[]`, `addMessage`→throws (797), `updateMessage`/`deleteMessagesFrom`→skip, `delete`→FS skipped. `create()` still sanitizes (382-384). The `file.upload` error path (message-router.ts:760-771) passes raw client `thread_id` into `addMessage` but it is wrapped in try/catch (best-effort) — now fail-closed, no escape.
- **SEC-B mcp.add L2 — FIXED.** `requireMcpStdioSpawnConfirm` (message-router.ts:3507-3557): stdio-only, fail-closed without a `requestConfirmation` channel, `riskLevel:"high"`, `autoConfirmEligible:false`, `criticalApis:["mcp.stdio.spawn"]`. Confirmation is **origin-bound**: server.ts:7039-7047 passes `{ originWs: ws }` (checklist item 5 ✓). Ordering correct: validate → confirm → `replaceMcpServers`.
- **Prior Pi r1 blockers remain fixed:** enable-bypass → `mcp.toggle_server` gates stdio false→true (message-router.ts:1910-1922) + test "mcp.update enabled-only on disabled stdio requires L2" ✓; `***` clobber → `mergeMcpServerPreservingSecrets`/`restoreMaskedRecord` (3572-3583) + test "mcp.update preserves secrets when client sends ***" ✓.
- **SEC-C tool tape — FIXED.** New `security/tool-persistence-redact.ts`; `createToolResultMessage` (adapter.ts:138-156) redacts params/result and `content`. All 4 tool-persist call sites (adapter.ts:947, 982, 1140, 1277) route through it; benign tools pass through (tested).
- **SEC-D supersede CAS — FIXED.** `llmLoopGeneration` + `nextLlmGeneration`; chat.create (620-630, 744-749), file.upload (946-948, 1006-1019), chat.regenerate (1175-1181, 1226-1238) all CAS-gated; I grepped all 5 `abortControllers.delete` sites — all gated or intentional. **Abort gate leak (r1 blocker):** `abortThreadChat` bumps gen + `releaseMultiAgentLlmLoop` (131-141); `releaseMultiAgentLlmLoop` is idempotent (`holders.has` guard); traced supersede/abort/re-entrant interleavings — exactly-once release. Test asserts gate freed on abort ✓.
- **SEC-E originWs — FIXED.** `pendingToolCalls` binds `originWs` at both dispatch sites (server.ts:2837, 2917-2926); `handleToolResult(msg, ws)` origin check (2863-2883, called with ws at 6807); `applyConnectionCloseGracePeriod(closedWs)` scoped per-socket (3225-3247), legacy unscoped entries skipped on single-peer close (safe default).
- **SEC-F cuPidForWindow — FIXED (Swift, inspection-only; cannot execute on this host).** Both host.swift:797-806 and host-skylight.swift:648-679 now match `kCGWindowNumber` via `cuWindowInfoDict` instead of `windows.first`; lockstep. No runtime evidence available — matches the report's "not executed" honesty.
- **VOICE-01 — FIXED.** PATH fallback gated behind `CMSPARK_WHISPER_PATH_FALLBACK=1` (stt-session-service.ts:521-533, whisper-state.ts:106-114); grep confirms no other callers of `resolveWhisperCliOnPath`.
- **VOICE-02 — PARTIAL, honestly not overclaimed.** `whisper-binary-pins.ts` still pins only darwin-arm64; closeout table marks **PARTIAL** and lists pin matrix under intentionally-deferred P1. ✓ (criteria #4)
- **MCPO-01 — FIXED.** `config.ts:335` default `require_grant:true`; stdio-server enforces grant-when-true (77-84); companion-http explicit-false honored only via `opts` (tests/debug); test updated and passing.

## ADR-020 checklist

Declaration present (Surface L2 PID / L0 voice; Compose mcp-server; Autonomy gate CAS; Trust fail-closed+redact+originWs+require_grant; Channel community). Axes fit; **no new runtime**; **no new confirm family** (reuses existing `requestConfirmation` dialect with `criticalApis`/`riskLevel`); **trust monotonicity preserved** (no god-mode/auto-approve skip; stdio spawn now forces manual L2; production PATH fallback removed = fail-closed); **originWs bound** on the new mcp confirms and pending tools; Pack-first N/A (companion-only, no new Side Panel chrome). P1 watchlist: only P1-2 touched and improved.

## No new Critical/High regression found

Behavior changes are fail-safe: abort no longer broadcasts `chat.aborted` to other peers after supersede (gen mismatch — requesters still get acks); unscoped legacy pending tools survive a single peer close. Both acceptable.

## Nits (non-blocking)

1. `mcp.add` requests stdio L2 even when the server is added with `enabled:false` (no immediate spawn) — conservative over-gating, minor UX.
2. `llmLoopGeneration` map entries never pruned on normal completion (r2-flagged).
3. `file.upload` supersede-CAS branch has no dedicated test — verified by inspection only (r2-flagged).
4. host-skylight `cuWindowInfoDict` single-entry leniency branch (`raw.count == 1 && (num==0 || num==windowId)`) — acceptable edge tolerance.
5. TESTING.md L72/L163 still carry TinyClick/0.3.0 remnants (DOC-01 partial; only counts refreshed — closeout claims only the counts, so not overclaimed).
6. companion-http explicit `opts.requireGrant=false` override not directly unit-tested (legacy `ws_secret` path exercised via config toggle instead).

VERDICT: APPROVE_WITH_NITS
