## Review Summary

### Pi REJECT Blockers - FIXED

1. **`abortThreadChat` MULTI_AGENT_LLM_CAP leak** - ✅ FIXED
   - `message-router.ts:141` now calls `releaseMultiAgentLlmLoop(threadId)` after generation bump
   - Test `llm-supersede-generation.test.ts` asserts abort frees gate

2. **`file.upload` generation-gating** - ✅ FIXED
   - Uses `nextLlmGeneration(thread_id)` at line 941
   - `catch` block checks `llmLoopGeneration.get(thread_id) === uploadGeneration` (line 1006)
   - `finally` block uses CAS to delete controller only if generation current (lines 1014-1018)
   - Calls `drainThreadOnSupersede` on supersede (line 939)

### Security Patches Verified (SEC-A through SEC-F, VOICE-01, MCPO-01)

- **SEC-A**: `thread-manager.ts` path sanitization (`isSafeThreadId`, `assertSafeThreadId`, `threadFilePath` with containment check)
- **SEC-B**: `message-router.ts` MCP stdio spawn L2 gate (`requireMcpStdioSpawnConfirm`, `mcpStdioSpawnSurfaceChanged`)
- **SEC-C**: `llm/adapter.ts` tool payload redaction (`redactToolPayloadForPersistence`)
- **SEC-D**: `message-router.ts` LLM generation CAS (`llmLoopGeneration` map, CAS in finally blocks)
- **SEC-E**: `server.ts` pending tool originWs (`originWs` field, peer-scoped grace period)
- **SEC-F**: Darwin host `cuPidForWindow` fix (matches by window number, not `windows.first`)
- **VOICE-01**: Whisper PATH fallback requires `CMSPARK_WHISPER_PATH_FALLBACK=1` opt-in
- **MCPO-01**: `outbound_mcp.require_grant` defaults to `true`

### Test Results

- ✅ `llm-supersede-generation.test.ts` (1/1 pass)
- ✅ `pending-tool-origin-ws.test.ts` (2/2 pass)
- ✅ `mcp-stdio-l2-gate.test.ts` (8/8 pass)
- ✅ `thread-path-sanitize.test.ts` (4/4 pass)
- ✅ `tool-persistence-redact.test.ts` (4/4 pass)
- ✅ `outbound-mcp-grants.test.ts` (12/12 pass)
- ✅ `security/*.test.js` (20/20 pass)

Full suite: 2530/2612 pass. Failures are pre-existing Windows-specific issues (vault symlink/path tests) unrelated to this PR.

### ADR-020 Capability Declaration

**Nit**: Implementer prompt lacks Surface/Compose/Autonomy/Trust/Channel declaration. Not blocking since this diff contains security fixes to existing capabilities, not new tools/gates/UI entry points.

### DoD Verification

- ✅ 5 aborted workers do not exhaust permanent cap (test verifies gate released)
- ✅ file.upload finally only deletes controller if generation current
- ✅ SEC-E/F/VOICE/MCPO all verified present in code

VERDICT: APPROVE
