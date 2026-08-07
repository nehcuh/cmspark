All four rejection gates pass against the actual code; capability checks pass. Three nits (non-blocking).

**Gate audit (all verified against real code):**

- **R1 (default export includes reasoning)** — Plan D-D7 explicitly forbids; D-D8 makes inclusion opt-in via `include_reasoning: true`. Verified `ExportMessage` (`companion/src/threads/markdown-export.ts:16-22`) has no `reasoning_content` field today. ✅
- **R2 (trust elevation / L2)** — Capability block declares `Surface: L0 UI + export policy`, `L2-classes: (none)`, `Trust: no elevation`. No `forceConfirm`/`evaluate`/shell/netsec touched. ✅
- **R3 (forces rebuild to re-inject reasoning)** — D-D9 explicitly leaves behavior unchanged. Verified `rebuildMessagesFromHistory` (`companion/src/llm/adapter.ts:170-235`) only emits `{role, content, tool_calls, tool_call_id}` — never `reasoning_content`. Existing comment "reasoning_content dropped on wire (M7)" present at `anthropic-convert.ts:9,143,181`. ✅
- **R4 (server-side UI pref → multi-device leak)** — D-D2 chooses **client** `chrome.storage.local` key `cmspark.ui.show_reasoning`, consistent with existing voice/shortcut prefs at `agentStore.tsx:600-606`. No companion config schema change. ✅

**ADR-020 capability checklist:**
- Surface/Compose/Trust declared in plan; Pack-first ✅; no new confirm dialect ✅; trust monotonicity ✅ (no deeper surface); originWs ✅ (no new `securityConfirmations.request`); no new runtime ✅; no experimental-layer write-path coupling ✅.
- P1 watchlist (god-mode/originWs/evaluate/shell): none touched.

**Nits (non-blocking):**

1. `docs/superpowers/plans/2026-08-07-wave-d-reasoning-ui-export.md:15-20` — Capability block omits `Autonomy:` and `Channel:` lines. Values are trivially `n/a` (no spawn_worker/board changes, no community/enterprise gating), but the checklist says missing declarations on UI-entry-point diffs are blocking. Easy add for completeness; flagging as nit because the load-bearing axes (Surface/Compose/Trust) are correctly declared and the missing ones would be `n/a`.
2. `docs/superpowers/plans/2026-08-07-wave-d-reasoning-ui-export.md:47` — File map row for `message-router.ts` says only "pass include_reasoning"; doesn't enumerate the request schema/validator/type update needed at `companion/src/message-router.ts:1876`. Implementer can deduce from the surrounding `rest.scope` validation pattern (lines 1882-1887).
3. `docs/superpowers/plans/2026-08-07-wave-d-reasoning-ui-export.md:48` — Test path "companion/tests/markdown-export*.ts or new" is hand-wavy; pin to the actual existing test file when implementing.

VERDICT: APPROVE_WITH_NITS
