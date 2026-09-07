# Actual model: deepseek-v4-pro

**Plan/Pack authority (cont.)** — both Packs: `kind: mission`, `requires_modules: []`, `board_mode: false`, `workspace: type none`, allowlist mode with `draft_*` + browser reads only; deny list covers `shell_exec`, `osascript_eval`, `evaluate`, `host_*`, `netsec_port_scan`, `spawn_*`, `acp_*`. Pack-engine test asserts allowed six are `true` and `shell_exec/host_computer/evaluate/spawn_worker/acp_start_session/mcp__remote__write` are `false`, and unapply succeeds (part2 L99–113). **PASS.**

**Both Missions** — change-material and development-trace install/apply through the existing Pack engine with no host/ACP/worker authority (tested part2 L78–119); guides correctly forbid self-authorization, N/A padding, and external-platform writes; docs status table correctly marks #453–#457 as in-review, not merged, and names cross-scope citation as an acceptance negative. Criteria-catalog test verifies empty-until-supported → populated (part1 L286–315) and `mutation_result` absent from read. Example loader asserts 7/7/8 counts, `runtime_ms: 900000`, `pass_values ["passed"]`, `criteria_cases.from.kind` (part2 L90–96). **PASS.**

**Core and MCP remain separate gates** — packet does not touch the Core checker, says so in the header; MCP modules absent, MCP profile allowlists unchanged, `executeDraftTool` rejects MCP scope, capture excludes `trustedOutbound`. **PASS** (one doc-comment NIT below).

## Findings — NIT (0 BLOCK, 0 MAJOR)

1. **NIT — `executor.ts` (part1 L333–355) / dispatch (part1 L178–183): draft writes have no completion-side plan_readonly re-check.** `executeDraftTool` never reads `execution_policy`, unlike the capture path R2 hardened. Failure mode: a plan_readonly flip landing between the dispatch gate and the store write lets one local draft write land in plan mode. Window is small (local store I/O, same-turn sync gate/write), blast radius bounded (session draft, no external write), and it matches the platform's dispatch-time gate semantics for all tools — hence not MAJOR — but symmetry is cheap to add.
2. **NIT — test data-dir safety (part1 L289–314, L229–283):** outbound-mcp tests write `pilot-contract.json` and evidence stores into `getConfigDir()` and `rmSync` the pilot file. Safety rests entirely on the pre-existing `_security-gates-setup` env. Failure mode if that import is ever reordered/removed: real `~/.cmspark-agent/pilot-contract.json` overwritten then deleted. Suggest an explicit assert that `CMSPARK_DATA_DIR` points at a temp root before these tests run.
3. **NIT — `captureLocalPageResult` (part1 L371):** `store.capture(toolCallId, tool, result)` receives the raw result with caller-forged `observation_id`/`evidence_capture` still inside `result.data`; only the return value is proven sanitized. Whether forged fields can be persisted depends on the store's extraction (out of packet). Recommend passing `pageData`/sanitized fields, or asserting stored records lack caller-authored ids.
4. **NIT — flip/delete WS test robustness (part1 L264–284):** both assertions would trivially pass if the fixture's `provenance.channel` were `"dom"` (skip for a different reason). Assert the fixture channel is `"cdp"` so the plan/deletion logic is actually exercised.
5. **NIT — scope validation split (server L118–121 vs `executeDraftTool` L334):** dispatch trusts any `kind:"chat"` scope without thread-existence re-validation; only the server path validates. Safe with the single production caller today; a future direct dispatch caller bypasses it. Consider moving validation into dispatch or passing a validated token.
6. **NIT — doc/comment mismatch (part1 L109–110 vs L118):** `ToolExecuteInvokeOpts.evidenceScope` says "or authenticated outbound runner," but `createToolExecutor` drops the scope whenever `trustedOutbound` is true. Misleading for the future #456 MCP module.
7. **NIT — `rest.thread_id` trust (part1 L65/74/83):** packet doesn't show validation that the message's thread_id is session-owned before binding. If the session is derived from it (pre-existing behavior), trusted by construction; verify when outbound paths land.
8. **NIT — ordinary-chat capture is default-on durable retention of page text for every chat** (server L147–149 + docs L341). Deliberate and documented with hard limits (64 obs / 64 KiB / 4 MiB), so not a defect; flagging as a privacy-surface decision to keep opt-in/gating under review.
9. **NIT — `channel: community`** on both enterprise mission packs (part2 L130, L240); deliberate product-entry placement should be confirmed.
10. **NIT — service-layer invariants out of packet:** read-only derived fields rejected server-side (`story_requirement`/`criteria_cases`), cross-scope citation ownership, `start < end`, atomic store append, snapshot lock. The packet's "remaining deliberate choices" depend on these; docs list cross-scope citation as an acceptance negative. Recommend end-to-end tests when the service lands.
11. **NIT — cosmetic:** trailing blank-line removal at `message-router.ts` EOF (part1 L87–91); `DRAFT_SCHEMAS[data.draft.kind]` can yield `undefined` schema silently (part1 L347); packs test doesn't re-assert disallow after unapply; `mutation_result` absence is asserted but nothing sets it.

## Summary of R2 claims vs packet

All eleven R2 claim lines verified `[inspected]`: wrapper composition + siteContextTabId compose test, both-ends plan checks for capture, WS flip/delete mid-read, text+HTML forge/DOM/abort/plan/error coverage, PLAN_READONLY_BLOCKED producer assert, criteria_catalog empty→populated, no historical mutation_result, example-loader counts/freshness/kinds, docs ordinary-chat capture statement, harness env isolation claim (partially corroborated; NIT 2 above). "Deliberate choices" list is internally consistent with the code.

## Verdict

- **BLOCK: 0 — MAJOR: 0 — NIT: 11**
- **VERDICT: NOT BLOCKED (APPROVE for merge).** Trusted invocation, capture policy, mid-flight lifecycle, plan/Pack authority, and both Missions all check out against the packet; remaining items are hardening/coverage NITs and out-of-packet service-layer invariants already tracked as acceptance items. Core checker and MCP remain separate gates, as required — this review does not approve either.

Model usage metadata:
```json
{
  "deepseek-v4-pro": {
    "inputTokens": 22711,
    "outputTokens": 34131,
    "cacheReadInputTokens": 69120,
    "cacheCreationInputTokens": 0,
    "webSearchRequests": 0,
    "costUSD": 1.00139,
    "contextWindow": 200000,
    "maxOutputTokens": 32000
  }
}
```
