I've independently verified the diff and tests. Here's my review.

## Capability declaration (ADR-020)
Surface=L0, Compose=existing pipeline, Autonomy=single, Trust=HITL unchanged, Channel=community — present in prompt. ✅ No new tools/gates/UI entry points beyond the existing vision section. Pack-first / no-bare-middle-agent / trust-monotonicity / originWs all N/A.

## DoD verification (tool-checked)
1. **Pure helpers unit-tested, fail-closed on unknown, anthropic hard-block** — `vision-reuse-logic.ts:75-110` (`likelyMultimodal` returns false on unknown; `shouldOfferVisionReuse` returns false for `protocol==="anthropic"`). Tests: extension 12/12 pass `[executed]`.
2. **Companion inherits llm key on url+model match + placeholder vision key** — `vision-reuse-inherit.ts:35-59` + `config.ts:1060-1073`. Tests: companion 6/6 + config inherit 2/2 pass `[executed]`.
3. **Fail-closed before POST** — `vision-pipeline.ts:119-128` calls `shouldBlockVisionRequest` *before* constructing OpenAI client. Non-loopback + placeholder/`"ollama"` → blocked, returns fallback, logs `vision.blocked_placeholder_key`. `[inspected]`
4. **Settings copy honesty** — old `"需要 Ollama 等本地推理服务"` removed; new `VISION_COPY.sectionHelp` says "可使用本地 VLM… 也可使用云端 OpenAI 兼容多模态 API（与主模型相同亦可）"; `settings-web.ts:668` now states "pre-analyzed by a vision model into text before the main chat". Hostname disclosure on banner (`bannerBodyForHost`) + reuse chip (`extractHostname(config.vision_base_url || config.base_url)`). `[inspected]`
5. **Reuse only on explicit button** — banner CTA (`onClick` "使用主模型"), not the bare checkbox. `[inspected]`
6. **No analyze_image / IMAGE_FETCH / tool-definition changes** — `git diff` confirms `companion/src/bridge/tool-definitions-catalog.json` untouched. `[executed]`
7. **No new config schema fields** — `resolveInheritedVisionApiKey` is schema-free; vision struct unchanged. `[inspected]`

## Residuals hunted
- **Silent key overwrite**: `resolveInheritedVisionApiKey` returns `undefined` when vision already has a real key (`!isPlaceholderVisionKey` check), and ignores masked llm keys (`"***"`/`/^\*+$/`). Test "does not overwrite a real dedicated vision key" covers it. ✅
- **Anthropic false offer**: `shouldOfferVisionReuse` hard-blocks `protocol==="anthropic"`; UI shows dedicated `anthropicBlocked` warning panel. ✅
- **Masked-key round-trip**: when extension's `config.api_key` is the masked `"***"` (broadcast redact), `applyVisionReuseFromMain` still copies it into the patch; companion's `resolveApiKey` correctly treats `"***"` as no-change and the new inherit path then copies the real llm key. Net behavior correct. `[inspected + traced]`
- **Dark pattern**: `isCustomVisionConfig` triggers `window.confirm(VISION_COPY.overwriteConfirm)` before overwriting non-default vision config. ✅
- **Patch freshness**: `git status` matches the patch file exactly (5 modified, 4 new vision-reuse files). `[executed]`

## Nits (non-blocking)
1. `chrome-extension/src/sidepanel/components/vision-reuse-logic.ts:152-166` — `needsKeyPaste = !apiKey` doesn't recognize masked keys (`"***"`, `"sk-1****5678"`). When the extension's `config.api_key` is the broadcast-masked form, the inline `needsKeyPaste` hint is silently suppressed, though the persistent help text below the field still covers the inherit behavior. Consider mirroring `isMaskedApiKey` and adding a test for the masked-`api_key` case (currently no coverage).
2. `companion/src/llm/vision-reuse-inherit.ts:35-59` — Anthropic protocol hard-block lives only at the extension's `shouldOfferVisionReuse`. If a future caller invokes `resolveInheritedVisionApiKey` from a different surface, an Anthropic llm key could be inherited into the OpenAI-SDK vision pipeline (POST would 404 + metadata fallback — no security impact, but defense-in-depth gap). A one-line comment locking this boundary, or an explicit `protocol` arg, would prevent drift.
3. `SettingsSlideout.tsx:1739` — `value={config.vision_api_key || ""}` can transiently render the literal `"***"` between dispatch and broadcast refresh. Cosmetic only.

Well-designed, well-tested change. Lock constraints honored, fail-closed gate is in the right place (pre-POST), copy is honest about the pre-analyze→text pipeline and the cloud option. The nits are UX-polish / defense-in-depth only.

VERDICT: APPROVE_WITH_NITS
