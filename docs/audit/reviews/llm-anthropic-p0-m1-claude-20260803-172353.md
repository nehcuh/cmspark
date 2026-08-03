All checks complete. Let me compile the verdict.

## Review summary — `llm-anthropic-p0-m1`

Inspected real diff vs `8c70c3a` (working tree matches patch context; not stale). All 62 new contract tests pass; existing adapter/adapter-recovery/adapter-usage (34 tests) still green → no DeepSeek regression. TypeScript compiles clean.

**Must-verify matrix:**

1. **createProvider + adapter/extract wired; default openai unchanged** ✅
   - `companion/src/llm/provider.ts:131-137` factory switches on `protocol ?? "openai"`.
   - `adapter.ts:438` `createProvider(config)`, `:316` consumes `provider.streamChat`, `:1128` uses `provider.complete`.
   - `llm-extract.ts:57` routes through `createProvider(toLlmConfig(...))`; `generateThreadTitle` likewise.
   - `defaultConfig` pins `protocol: "openai"` (config.ts:259); legacy `LlmConfig` shape preserves DeepSeek path; `model-probe.test.ts:156` regression test green.

2. **L7 first-party host union deny** ✅
   - `headers.ts:152-175` `assertHeaderPolicy` throws when first-party AND (`profile !== "none"` OR `extras` non-empty) — Pi M1 union implemented.
   - `isAnthropicFirstPartyHost` uses exact + `.anthropic.com`/`.claude.ai` leading-dot suffix (NOT bare `endsWith`) — M2; `evilanthropic.com` test green.
   - Trailing-FQDN-dot (`api.anthropic.com.`) normalization in both `isAnthropicFirstPartyHost` and `hostnameFromBaseUrl` — novel bypass closed.
   - `buildRequestHeaders:231` calls `assertHeaderPolicy` before any header emit; provider test asserts `fetched === false` on L7 denial.

3. **Anthropic convert/SSE/tool id/max_tokens deterministic** ✅
   - `computeMaxTokens` = `min(8192, max(256, floor(cw/8)))` (M4).
   - `sanitizeToolCallId` regex `[^a-zA-Z0-9_-]→_`, deterministic for tool_use↔tool_result pairing.
   - SSE parser: text_delta→token, input_json_delta→tool_call_delta.arguments, thinking_delta→reasoning (M6), message_delta usage→usage, stop_reason→done.finish_reason; sequential 0-based tool index among tool_use blocks.
   - Multi-turn mock test + cross-protocol resume fixture (openai→anthropic with bad id sanitize) both pass (M5, M7).
   - `reasoning_content` dropped on Anthropic wire (M7) — verified by JSON scan test.

4. **No OAuth/Max; no system-prompt CC identity injection** ✅
   - No OAuth/cookie code. `claude_code_compat` only injects `user-agent`/`x-app`/`anthropic-version` (+ optional beta); no system-prompt prefix.

5. **No UI scope creep** ✅
   - `settings.get` (`message-router.ts:344-354`) returns only legacy fields; new `protocol`/`auth_style`/`client_header_profile`/`extra_headers` not surfaced.
   - `settings-web.ts` handleTestProxy adds backend-only anthropic soft-skip (returns ok+message) — not a UI field.

6. **Header values not logged** ✅ (with nit below)
   - `anthropic.ts:45-60` `logRequestMeta` emits only `base_host`, `profile`, `header_names[]`, `path`. `headerNamesForLog` returns sorted names only.

7. **Vision still OpenAI-only** ✅
   - `vision-pipeline.ts:118` retains `new OpenAI()` directly; not routed through `createProvider` (L10).

**ADR-020 capability:** implementer prompt lacks explicit Surface/Compose/Autonomy/Trust/Channel declaration, but synthesis doc declares this transport-only ("Composition/infra, not Surface / not new runtime"), no new tools/gates/UI entry points added (UI deferred to P1). Per checklist, missing declaration is blocking only when tools/gates/UI are added → nit only.

**Non-blocking nits:**

- N1: No explicit log-payload assertion that header *values* are excluded (synthesis nit lists "still add assert"). Existing `headerNamesForLog` test only checks the helper, not the live `llm.anthropic_request` payload.
- N2: `message-router.ts:312 config.test` still uses `client.models.list()` (OpenAI SDK) without protocol awareness — same gap class as the now-soft-skipped `settings-web` handleTestProxy. Synthesis explicitly defers settings test protocol-awareness to P1, so acceptable.
- N3: `assistantContentFromMessage` (anthropic-convert.ts:132) falls back to `[{type:"text", text:""}]` on empty content + no tool_calls; comment notes Anthropic may reject empty text. Documented edge; not on the success path.
- N4: ADR-020 declaration missing from implementer task body (covered by synthesis doc instead).

No must-fix blockers; DeepSeek path green; L7 robust; P0 contract coverage meets §9 acceptance criteria.

VERDICT: APPROVE_WITH_NITS
