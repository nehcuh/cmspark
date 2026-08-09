## Review Summary

I have thoroughly reviewed the P0 persistence security fix (SEC-A + SEC-C). All DoD items have been verified:

### DoD Verification

**1. SEC-A (Path Traversal Protection)** ✓**
- `isSafeThreadId()`: Regex `/^[a-zA-Z0-9_-]{1,64}$/` rejects path separators and `..`
- `assertSafeThreadId()`: Throws on unsafe IDs before any filesystem access
- `threadFilePath()`: Defensive `path.relative()` check catches any remaining escape attempts
- All methods (`addMessage`, `delete`, `getMessages`, `updateMessage`, `deleteMessagesFrom`) are guarded
- `cleanupEmpty()` protected indirectly via `delete()`; `purgeExpiredTrash()` relies on `threadFilePath()`'s built-in throw-on-escape

**2. SEC-C (Tool Persistence Redaction)** ✓
- `createToolResultMessage()` calls `redactToolPayloadForPersistence()` before disk write
- Redaction policy mirrors `history/store.ts`: cookies (value→hash), evaluate/shell/host_* (code→hash), MCP (file/secret tools collapse result)
- `SENSITIVE_COOKIE_TOOLS`, `SENSITIVE_CODE_TOOLS`, `MCP_SENSITIVE_RESULT_RE` all present
- `thread_recall` special handling: query hashed, result collapsed
- `get_page_text` and other benign tools preserve text content (test confirms)

**3. Tests** ✓
- 9/9 tests pass (4 SEC-A + 5 SEC-C)
- Covers path traversal, cookie redaction, evaluate redaction, MCP collapse, and benign tool pass-through

**4. In-flight LLM tool loop** ✓
- `adapter.ts` line 1261: `toolResults.push()` uses `resultContent` from `JSON.stringify(toolResult)` (raw)
- Line 1140: `createToolResultMessage()` separately persists redacted version via `addMessage()`

### ADR-020 Capability Check
- Declaration present and appropriate: `Surface: n/a`, `L2-classes: (none new)`, `Compose: none`, `Autonomy: single`, `Trust: fail-closed`, `Channel: community`
- No new tools/gates/UI entry points → checklist items N/A or satisfied

### Implementation Quality
- Defense-in-depth: regex whitelist + `path.relative()` containment check
- Consistent with `history/store.ts` redaction patterns (same SHA-256 truncation, same key regexes)
- `purgeExpiredTrash()` safe catch is appropriate (failed ID = no-op, not crash)

VERDICT: APPROVE
