All verification complete. Summary of findings:

**Verified fixes (all present and correct):**
- `gui-action-parse.ts` — comma AND space box separators → center (`start_box='(10,20,30,40)'` → (20,30)); tests green (16/16 in this file)
- `qwen-vl-worker.py` — mirror regex (identical semantics, verified by eye since no Python on this box); clamp-only `_normalize`, no 0–1000 rescale
- `qwen-vl-locator.ts` — `parseGuiClickPoint` wired via recover + prefer-from-raw branches (no longer dead code)
- `locate-chain.ts`/`executor.ts` — `experimentalRaw` (500-char slice) → `extractGuiThought` → `formatExperimentalSuggestionCaption`, sanitized twice, never inject authority
- `llm/adapter.ts` rule 12b playbook; user guide §6.1/6.2/6.3 + architecture §9.4, honest (explicit "不引入第二套 GUIAgent runtime", "产品身份不同" table, no parity claim); referenced research/decision docs exist
- parse/thought/locator + session-trust/coords/worker-path tests: 90/90 green; `tsc --noEmit` clean

**Security (review focus 1–3):**
- G4 force-interactive confirmed: `FORCE_INTERACTIVE_DANGEROUS` (executor.ts:95-100) + `PROMPT_ALWAYS_TAGS` (session-trust.ts) both contain `computer.experimental_suggestion`; cruise check sits *after* force check. `computer.experimental_suggestion` re-L2 prompts even under the dev's local full-autonomy config (verified: this box's `~/.cmspark-agent/config.json` has `auto_approve_dangerous/allow_all_schemes/auto_approve_enterprise_tools` all true — G4 tests still pass)
- No L2 bypass: refresh chain hard-sets `experimental: null` (executor.ts:1227, P7 regression test locks it); denial → honest ELEMENT_NOT_FOUND zero-injection; approval → A1 region stability gate; no prompt loop
- Caption spoof resistance: `sanitizeComputerCaption` (controls/line-separators→space, `\p{Cf}` deleted) applied to target and thought; 160-char cap; attributed as 模型思考; re-L2 `fullText` re-sanitized
- No rescale regression: `normalizeQwenVlPoint`/`_normalize` clamp-only; tests assert absolute JSON on 1920px and clamp for OOB

**Nits:**

1. **Integration test gap for the new wiring.** `computer-qwen-vl-locator.test.ts` never exercises the new recover/prefer-from-raw branches (only empty/collapse/hit paths), and `fakeExperimentalLocator` in `computer-executor.test.ts` never returns `raw` — so `experimentalRaw → 模型思考 caption` is tested only at the pure-function level, not end-to-end through locate-chain/executor.

2. **Locator prefer-branch is convoluted** (qwen-vl-locator.ts:90-101): the `/, \s*\d/` + `nums.length >= 4` condition is fragile — space-separated 4-number boxes skip the prefer path (harmless today because the worker's DSL regex returns center itself), and the "recover when worker returns no point" branch is effectively unreachable (worker `ok:false` → runtime rejects → locator error path), i.e. defensive dead code. Consider simplifying to "worker point is not the center of a 4-number start_box → reparse from raw".

3. **Rule 12b is appended to the system prompt unconditionally** (adapter.ts), even when coordinate CU is disabled — it self-gates with "(when coordinate CU is enabled and required)" so risk is low, but a conditional insert would be cleaner.

4. **Pre-existing, not from this diff:** 12 failures in `computer-executor.test.ts` (budget/uncross/dialog/foreground + 2 M1 experimental-budget tests) — identical on HEAD (verified via `git stash`), caused by the local config's full-autonomy triple-flag auto-approving non-force re-L2s. Recommend running the suite with a clean config before merge so the M1 budget-accounting tests are confirmed green in CI; the G4 force-interactive property itself passes in all configurations.

VERDICT: APPROVE_WITH_NITS
