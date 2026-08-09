# Dual-review prompt — P0-persistence (SEC-A + SEC-C)

## Capability declaration (ADR-020)

```text
Surface:      n/a (persistence / trust root under DATA_DIR)
L2-classes:   (none new)
Compose:      none
Autonomy:     single
Trust:        fail-closed path ops; durable tool tape redaction mirrors history.db
Channel:      community
```

## Blast tier

**T3 Trust / security** — path escape can destroy config; unredacted thread JSON is durable secret tape.

## Source audit

- `docs/audit/health-fanout-2026-08-09.md` — SEC-A, SEC-C High
- Prior: PERS-1 / LLM-2 from 2026-07-25 deep fanout

## DoD (external observables)

1. **SEC-A**: `ThreadManager.threadFilePath` / `addMessage` / `delete` / `getMessages` reject or no-op unsafe ids (`../config`, path seps). Cannot overwrite or delete `config.json` via crafted `thread_id`.
2. **SEC-C**: `createToolResultMessage` redacts cookies values, evaluate code/token, sensitive MCP results before disk. Benign tools (e.g. `get_page_text`) still persist text.
3. Tests: `companion/tests/thread-path-sanitize.test.ts`, `companion/tests/tool-persistence-redact.test.ts` pass (machine green in implementer session).
4. In-flight LLM tool loop still uses raw results (adapter builds `toolResults` from raw `toolResult`, not from createToolResultMessage).

## Files to inspect

- `companion/src/threads/thread-manager.ts` — `isSafeThreadId`, `assertSafeThreadId`, `threadFilePath`, delete/get/add/update/deleteMessagesFrom
- `companion/src/security/tool-persistence-redact.ts` — new
- `companion/src/llm/adapter.ts` — `createToolResultMessage`
- New tests under `companion/tests/`

## Review focus

1. Incomplete fix? Any remaining `path.join(..., threadId)` without sanitize?
2. Redaction weaker than history.db for cookies/shell?
3. Does redaction break multi-turn rebuild for non-sensitive tools?
4. Missing tests or wrong claims?
5. ADR-020 / originWs N/A here — do not invent scope creep.

## Machine evidence (implementer)

```
npx tsc -p tsconfig.test.json
node --test .test-dist/tests/thread-path-sanitize.test.js \
  .test-dist/tests/tool-persistence-redact.test.js \
  .test-dist/tests/security-thread.test.js
→ 38 pass, 0 fail
```

End with exactly one line:
VERDICT: APPROVE
or VERDICT: APPROVE_WITH_NITS
or VERDICT: REJECT
