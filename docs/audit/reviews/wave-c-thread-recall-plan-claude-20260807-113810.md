Now I have enough context to complete the review. Let me verify one more thing about the `redactMessagesForCompaction` behavior with orphaned tool messages.

Looking at `context-budget.ts:146-195`:

```typescript
export function redactMessagesForCompaction(messages: CanonicalChatMessage[]): CanonicalChatMessage[] {
  const idToName = new Map<string, string>()
  for (const m of messages) {
    if (m.role === "assistant" && m.tool_calls) {
      for (const tc of m.tool_calls) {
        if (tc.id) idToName.set(tc.id, tc.function?.name || "tool")
      }
    }
  }
  ...
  // tool
  const name = idToName.get(m.tool_call_id) || "tool"
  if (COMPACT_SENSITIVE_COOKIE_TOOLS.has(name)) { ... }    // cookies → name only
  if (COMPACT_SENSITIVE_CODE_TOOLS.has(name)) { ... }      // shell/host → name+length
  ...
```

The `idToName` map is built **from the input array's own assistant messages**. The plan's Task 1 step 2 says:

> For top hits, build `{role, content: excerptRaw}` messages, run `redactMessagesForCompaction`, re-serialize.

This shape drops both `tool_calls` (from assistant hits) and `tool_call_id` (from tool hits). With no `tool_call_id`, the lookup `idToName.get(undefined) || "tool"` returns `"tool"` — **every tool message bypasses all COMPACT_SENSITIVE_*_TOOLS guards**, and only gets `scrubSecretPatterns(content.slice(0,400))`, which catches `sk-…` / `Bearer` / PEM but **not** cookie JSON, shell dumps, or `host_read` mail bodies.

This trips R2. The plan's own test claim "redaction strips cookie tool shapes if present" would fail as designed.

---

## Dual review: Wave C `thread_recall` — **plan** (pre-code)

**Capability declaration:** ✅ present and correct — Surface L0 read-only, no L2, no Compose, no Autonomy, Trust not elevated, Channel unchanged. ADR-020 checklist satisfied.

**Patch freshness:** `git status` shows zero code diff against `06c05dc`; the only artifact is the untracked plan file `docs/superpowers/plans/2026-08-07-wave-c-thread-recall.md` plus this prompt. Plan-only review confirmed.

### Rejection gates

| # | Gate | Result |
|---|------|--------|
| R1 | Cross-thread / foreign thread id | ✅ PASS — C-D2 + C-D12: scope locked to `params.__thread_id`, no caller-supplied id accepted |
| R2 | Skips redact for tool payloads | ❌ **FAIL — see B1** |
| R3 | Requires L2 / elevates Trust | ✅ PASS — C-D8, read-only, no confirm |
| R4 | Embedding dependency | ✅ PASS — C-D3 |
| R5 | Logs full query or hit excerpts | ✅ PASS — C-D11 explicitly excludes query text/excerpts |

### Blocking issues

**B1. `redactMessagesForCompaction` lookup is broken by the locked excerpt shape — `companion/src/llm/context-budget.ts:147-154, 170-171` × plan Task 1 step 2 (`docs/superpowers/plans/2026-08-07-wave-c-thread-recall.md:85-91`)**

`redactMessagesForCompaction` builds `idToName` from `assistant.tool_calls[*].id` it sees in the *input array*, then resolves each tool message via `idToName.get(m.tool_call_id) || "tool"`. The plan's locked excerpt shape `{role, content: excerptRaw}`:

- drops `tool_calls` from any assistant hit → no id→name entries are registered,
- drops `tool_call_id` from any tool hit → lookup key is `undefined`.

Result: every tool message in the hits is redacted as `name = "tool"`, **bypassing** `COMPACT_SENSITIVE_COOKIE_TOOLS` (`get_cookies` / `list_all_cookies` / `set_cookie` / `delete_cookie`) **and** `COMPACT_SENSITIVE_CODE_TOOLS` (`evaluate` / `osascript_eval` / `host_read` / `host_write` / `host_app` / `host_computer` / `shell_exec` / `netsec_port_scan`) **and** the `mcp__*(read|file|secret|token|key|env|credential)` check. Only `scrubSecretPatterns(content.slice(0,400))` applies, which catches `sk-…` / `Bearer …` / PEM headers but **not** cookie JSON values, shell stdout containing secrets, or `host_read` mail bodies.

The plan's own test claim ("redaction strips cookie tool shapes if present", line 91) would fail as designed — proving the inconsistency.

**Concrete fix (any one):**
- (a) For each tool hit, include the **preceding assistant `tool_calls` message** in the mini-list passed to `redactMessagesForCompaction` so `idToName` is populated and `tool_call_id` is preserved.
- (b) Pre-resolve the tool name from the original stream *before* excerpting, gate against `COMPACT_SENSITIVE_COOKIE_TOOLS` ∪ `COMPACT_SENSITIVE_CODE_TOOLS` ∪ MCP-secret regex yourself, and only fall through to `redactMessagesForCompaction` for non-sensitive tool / user / assistant text.
- (c) Score and excerpt on a *window* of consecutive original messages around each hit (preserves `tool_call_id` linkage naturally).

`searchThreadMessages` signature in Task 1 (`plan:76-80`) also omits `tool_call_id` from the message type, so option (a) requires the signature to be widened — call this out before implementation.

### Must-answer

1. **Keyword vs BM25** — keyword is adequate for ≤1000 msgs/thread and v1 scope. **CJK caveat (N1)**.
2. **C-D9 whitelist stance** — ✅ OK; default-on when `tool_whitelist=null`, opt-in otherwise; no force-injection.
3. **Notice hint spam risk** — ✅ low; notices are de-duplicated (replace-not-stack) by `attachHandoffNoticeToMessages` / `attachRollingSummaryToMessages`. Copy/i18n nit (N4).
4. **Implementable without invention** — mostly yes (catalog format, COMPANION_TOOLS array, `executeCompanionTool` switch, `getMessages` all exist), **except B1**.

### Nits (non-blocking)

- **N1.** `plan:33` C-D4 — whitespace-only tokenizer yields one token for a Chinese query like "用户登录失败"; description advertises "Chinese or English", so recall on CJK is near-zero. Add per-char or bigram CJK split for matching only.
- **N2.** `plan:71-72` — `RECALL_MAX_HITS_CAP (12) × RECALL_PER_HIT_CHARS (600) = 7200 > RECALL_TOTAL_CHARS (4000)`; total clamp dominates at max_hits≥7. Test fixtures should pin this.
- **N3.** `plan:76-80` — signature omits `tool_call_id` (required for B1 fix) and `reasoning_content` (must be explicitly never-read; plan claims C-D7 "never return raw reasoning_content" but the type doesn't even surface it). Add `tool_call_id?: string` and a doc note.
- **N4.** `plan:39, 144` C-D10 / Task 3 — hint copy is English-only; other notices mix 中文/英文. Decide i18n policy.
- **N5.** `plan:147` Task 3 — "Keep under existing length caps" is loose; specify: append once per notice build, hint ~80 chars outside the 2000-char rolling-summary cap in `buildOmitNotice`/`buildHandoffNotice`. Confirm no downstream token-budget regression in `applyContextBudget`.
- **N6.** `plan:40, 129` C-D11 — query_len is fine; consider also not logging `terms_count` (leaks query shape). Minor.

VERDICT: REJECT
