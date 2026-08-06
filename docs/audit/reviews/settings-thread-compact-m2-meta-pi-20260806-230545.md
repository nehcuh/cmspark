# Pi re-review: settings-thread-compact M2 meta + defaults

I read the design SoT, adversary synthesis, the full diff, and the live code (`context-budget.ts`, `context-budget-m2.ts`, `runtime-context-budget.ts`, `adapter.ts` runContextBudgetPass, `thread-manager.ts` update path, `config.ts`, `ChatView.tsx`, `SettingsSlideout.tsx`, `settings-sections.ts`, `useWebSocket.ts`, `agentStore.tsx`, `message-router.ts`, `settings-web.ts`, `anthropic-convert.ts`), and ran the test suites.

## Rejection gates — all clear

- **R1** (summary into digest/export/other threads): `rolling_summary` / `runtime_context_budget` appear only in adapter (write), thread-manager (sanitize/store), ChatView (UI), useWebSocket (dispatch), types. Zero references in `markdown-export.ts`, `digest.ts`, or any cross-thread injection path. ✓
- **R2** (unredacted cookie/shell bodies into M2): `get_cookies/list_all_cookies/set_cookie/delete_cookie` → `[name: redacted]`; `shell_exec/evaluate/osascript_eval/host_*/netsec_port_scan` → `[name: outcome redacted len=N]`; MCP secret-shaped tools redacted; plus sk-/Bearer/PEM scrub. Test `redactMessagesForCompaction: cookies and shell_exec stripped` confirms. ✓
- **R3** (disk mutated with omit/summary): compaction operates on request-local copies; `OMIT_PREFIX`/`SUMMARY_PREFIX` appear nowhere outside `context-budget.ts`; adapter only rebuilds the in-memory request array. Persisted messages unchanged. ✓
- **R4** (armed trust buried / elevation): `isSectionEffectivelyOpen` force-opens 安全与信任 under elevatedTrust; badge「有开关已开」always visible; StatusRail right-click / connection-pill / menu deep-links (F-UX7); D-S8 children stay mounted. Compaction touches no trust flags. ✓
- **R5** (1e6 auto-compress claim without honesty): Settings help text shows「当前 128000 偏大，自动压缩较难触发。推荐 128000」when ≥200k. No false claim anywhere. ✓

## Must-answers

1. **F-S4/F-S5/F-S8 with rolling_summary on index**: held. M1 omit stays metadata-only; M2 summary is the documented redacted deviation (revision log). Audit (`thread.context_compacted`) logs `summary_bytes`+`summary_sha256` only — no full text (F-S7). F-S8 verified (see R1).
2. **M2 default-on safety**: safe under the gate — pre_loop-only, ≥3 dropped msgs OR ≥500 tokens, redacted input, fails closed to M1 omit, meta/audit bounded (2000-char cap, 0o600 index). Existing 1e6 installs get `context_compaction_m2: true` via deepMerge but compaction virtually never triggers at 1e6, so M2 rarely runs.
3. **128k default**: correct. `defaultConfig` 128000 (new installs); `deepMerge` preserves on-disk 1e6; extension store + ThreadList + settings-web fallback all 128000 but real values win after sync.
4. **查看摘要 leak**: no new exposure class. The summary is LLM-generated from redacted input, rendered as escaped text, persisted 0o600 (same scope as the full message history already on disk), shown only on the user's own active thread. Residual non-sensitive tool bodies (page text / workspace files) reach the summary provider pattern-scrubbed — same provider as the main path, no new party.
5. **REJECT-level holes**: none found.

## Nits (non-blocking)

1. **mid_loop overwrites the M2 summary meta** (`adapter.ts:1162` → `533`/`565`). When mid_loop drops again after a pre_loop M2 pass, `shouldRunM2(..., "mid_loop")` returns false, so the meta write at line 565 stores `mode:"m1"` with no `rolling_summary` — sanitize drops the field, so the thread-index summary and the「查看摘要」button vanish after the first tool round in tool-heavy compacted conversations (the request notice is likewise reverted to a plain M1 omit). Fails closed (no security impact), but the durable-摘要 claim only holds until the next mid_loop drop. Suggest carrying the pre_loop summary forward.
2. **M2 default-on flips the adversary-locked "M2 默认 off" (Q3/D-C3)** — documented in the revision log and safe under the gate, but since 128k now makes compaction (and therefore an extra serialized LLM call per compaction event, ≤45s) actually reachable for new installs, this deserves an explicit product sign-off.
3. **prompt-mode warning is session-scoped**: `thread.context_compact_prompt` writes no meta, so the「仅提示，可能超预算」banner disappears on reload (auto mode's banner is durable via meta). Minor F-UX4 durability gap.
4. **Pre-sync save race** (`SettingsSlideout.tsx:234`): `handleSave` sends the full extension config state; a save before the companion's `config.updated` hydrates `state.config` would write the extension's 128000 over a stored 1e6. Very narrow, fails toward the safer 128k, and is a pre-existing pattern (previously defaulted 1e6 the other way) — worth a guard eventually.
5. No integration test for `runContextBudgetPass` orchestration (meta write, m1/m2 selection, mid_loop behavior) — would have caught nit #1. Pure-function coverage is good.

**Verification**: 12/12 new companion context-budget tests pass; 25/25 anthropic-convert; 469/469 extension tests via `npm test`; companion suite 2419 pass / 15 fail — all 15 failures are in computer-executor/uia-watch/model-download suites that import none of the changed modules (pre-existing, environment-dependent).

VERDICT: APPROVE_WITH_NITS
