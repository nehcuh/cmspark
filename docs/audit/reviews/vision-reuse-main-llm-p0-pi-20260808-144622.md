All checks complete. Review summary:

## DoD verification (all met, with file:line)

1. **Pure helpers unit-tested, fail-closed, anthropic hard-block** — `vision-reuse-logic.ts` (`likelyMultimodal` unknown→false, `shouldOfferVisionReuse` protocol gate at L~150) + 12 tests pass (reproduced). `vision-reuse-inherit.ts` (`resolveInheritedVisionApiKey` fail-closed) + 6 tests pass.
2. **Companion key inherit on save** — `companion/src/config.ts:1060-1072` (match + placeholder → copy `llm.api_key`, no new field); 2 new integration tests in `config.test.ts` pass (46 total).
3. **Fail-closed before POST** — `companion/src/llm/vision-pipeline.ts:119-128` gates on `shouldBlockVisionRequest` (non-loopback + placeholder → metadata fallback, no POST). Verified `analyzeImage` is the only image-POST path (adapter.ts:1045, message-router.ts:844 both route through it); `config.testVision` uses `models.list()` only, no image bytes.
4. **Copy honesty** — "需要 Ollama" removed (grep confirms no residual); `VISION_COPY.sectionHelp` states pre-analyze→text; hostname disclosed in banner (`bannerBodyForHost`) and reuse chip.
5. **Explicit button only** — reuse fires solely on「使用主模型」; banner only on false→true; `overwriteConfirm` when vision is custom; no bare-checkbox copy.
6. **No tool/gate changes** — diff touches only the 5 listed files + new logic/test files; no `analyze_image`/IMAGE_FETCH/tool defs.
7. **No new schema fields** — reuses existing `vision.api_key`.

## ADR-020 checklist

Declaration present and accurate: Surface L0 (settings UX), L2-classes none, Compose existing vision side-pipeline, Autonomy single, Trust unchanged (HITL gates untouched; privacy = hostname disclosed), Channel community. No new `securityConfirmations.request` → no originWs concern. Trust monotonicity holds: masked keys are stripped on the wire (`message-router.ts:338`, `settings-web.ts:388`) and a real dedicated vision key is never overwritten (resolveApiKey + placeholder guard). No new runtime / no "中层 Agent" / no new Side Panel chrome beyond an in-place banner.

## Residuals hunted — findings

- **Silent key overwrite**: not present; real dedicated keys survive by design (Q2 monotonicity).
- **Anthropic false offer**: blocked in both UI (block message) and offer gate.
- **Dark pattern**: none — confirm-before-overwrite, hostname disclosure, dismissible.

## Nits (non-blocking)

1. **Masked-key copy overclaim** (`SettingsSlideout.tsx` reuse button + `VISION_COPY.overwriteConfirm` "覆盖…Key"): when the main key is masked `"***"` (the common case), the copied mask is stripped by the router, and if the vision config had a *real dedicated key*, that old key survives and is then sent to the new (main) endpoint — URL/Model are overwritten but Key is not, contradicting the confirm text. Suggest: "将覆盖 Base URL / Model；Key 仅在视觉 Key 未配置/占位时继承主 Key".
2. **Masks are not placeholder for the fail-closed gate**: `VISION_PLACEHOLDER_KEYS`/`isVisionKeyPlaceholder` = `{"", "ollama"}` — a `"***"`/`sk-****xyz` mask would pass `shouldBlockVisionRequest` and skip inherit. Unreachable via normal paths (both save paths strip masks), but adding mask patterns would be cheap defense-in-depth.
3. **Server inherit not protocol-gated**: manually matching an Anthropic main endpoint inherits the Anthropic key into the OpenAI-only vision rail — harmless (key stays on its own host, call 404s→fallback) but inconsistent with Q1's spirit.

## Scores

- **Outcome 4/5** — DoD fully verified, machine evidence reproduced exactly (12/6/46 pass), scope locked to P0.
- **Trajectory 4/5** — all adversary-locked decisions honored; no schema/tool creep.
- **Component 4/5** — clean pure-function split, good test coverage, clear privacy model.

VERDICT: APPROVE_WITH_NITS
