# Dual-review R2 — P0 lifecycle (Pi REJECT fixes)

## Prior Pi REJECT blockers

1. **abortThreadChat** bumped generation so finally skipped `releaseMultiAgentLlmLoop` → permanent MULTI_AGENT_LLM_CAP leak.
2. **file.upload** chat path not generation-gated (stale chat.aborted + delete successor controller).

## Fixes

1. `abortThreadChat` calls `releaseMultiAgentLlmLoop(threadId)` after generation bump.
2. `file.upload` uses `nextLlmGeneration` + CAS on catch/finally + drain on supersede.
3. Test: `llm-supersede-generation.test.ts` asserts abort frees gate.

## DoD re-check

- 5 aborted workers do not exhaust permanent cap (abort releases).
- file.upload finally only deletes controller if generation still current.
- Prior SEC-E/F/VOICE/MCPO still hold.

## Machine

```
node --test llm-supersede-generation + pending-tool-origin + prior P0 suites
```

End with VERDICT.
