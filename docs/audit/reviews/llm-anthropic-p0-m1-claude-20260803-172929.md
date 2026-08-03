All tests pass: 62 new P0 tests + 2274 existing tests + 15 settings tests, zero regressions, TypeScript clean. Let me consolidate findings.

## Review summary

**Verified claims (all PASS):**

1. **createProvider + adapter/extract wired; default openai unchanged** — `provider.ts:131-137` factory defaults to `OpenAIProvider` when `protocol` omitted; `adapter.ts`, `llm-extract.ts`, `generateThreadTitle` all migrated. Default DeepSeek path verified by 2274 passing tests including `model-probe.test.ts` openai regression test.

2. **L7 first-party host union deny (profile + extra_headers)** — `headers.ts:152-175` `assertHeaderPolicy` throws `HeaderPolicyError` on first-party + (profile ≠ none OR any extra). Suffix match uses `.anthropic.com`/`.claude.ai` with leading dot — `evilanthropic.com` correctly returns false (`isAnthropicFirstPartyHost` test). Trailing-dot FQDN bypass closed (`api.anthropic.com.` → first-party). CRLF/Host/Cookie/Auth all rejected in extras. Hard refuse (not warn) confirmed.

3. **Anthropic convert/SSE/tool id/max_tokens deterministic; fixtures present** — `anthropic-convert.ts:56-59` `computeMaxTokens = min(8192, max(256, floor(cw/8)))`. `sanitizeToolCallId` regex `[^a-zA-Z0-9_-]→_` deterministic for tool_use↔tool_result pairing. SSE parser handles `message_start`/`content_block_*`/`message_delta`/`message_stop`/`thinking`. Multi-turn tool mock + cross-protocol resume fixtures pass.

4. **No OAuth/Max; no system-prompt CC identity injection** — confirmed via grep, no OAuth code, no "You are Claude Code" injection.

5. **No UI scope creep** — `settings-web.ts` only adds anthropic soft-skip; no new fields surface in UI.

6. **Header values not logged** — `anthropic.ts:45-60` `logRequestMeta` logs only `base_host`, `profile`, `header_names[]`, `path`. `headerNamesForLog` returns sorted names only.

7. **Vision still OpenAI-only** — `vision-pipeline.ts` and `server.ts:5430` visionClient unchanged; `llm-extract.ts:4-5` documents "Vision stays on vision-pipeline (OpenAI-only, L10)".

**Non-blocking nits:**

- **ADR-020 capability declaration missing** from implementer prompt. Correct declaration would be: `Surface: n/a` (no host_computer/read/write/app/shell/netsec), `Compose: none`, `Autonomy: n/a`, `Trust: existing-static-refuse` (L7 is a refuse-only gate, no confirmation UI), `Channel: n/a`. Process nit only — no new tools/gates-with-user-surface/UI/runtime added.

- **`skill-craft.ts:124` and `skill-engine.ts:385` still call `new OpenAI()` directly**, bypassing `createProvider`. Under global `protocol=anthropic`, these auxiliary LLM paths (skill crafting, semantic re-rank) would hit a wrong-protocol endpoint. SoT §7 lists "统一经 llm-extract" as v1, not P0 — defensible but worth tracking.

- **`message-router.ts:312` `config.test` WS handler inconsistent with `settings-web.ts` handleTestProxy** — the HTTP test endpoint was updated to soft-skip anthropic (line 459-466), but the WS test endpoint still calls `client.models.list()` against the user's base_url. Under `protocol=anthropic`, the WS test path 404s while the HTTP path returns `ok:true, skipped`. P0 defers protocol-aware test to P1, so non-blocking.

- **Dead defense-in-depth at `headers.ts:283-287`** — the `SPOOF_CLASS_HEADER_NAMES` re-check inside the merge loop is unreachable: `assertHeaderPolicy` already threw on first-party + any extras. Harmless.

VERDICT: APPROVE_WITH_NITS
