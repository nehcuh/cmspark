All 258 tests pass. The 7 blocking CSS-literal bugs from round 1 are fixed with proper template literals.

## Review summary

**Verified working**:
- **R1 cockpit persist** (`cockpit-window.ts:1-245`): `chrome.storage.session` persist + `reclaimCockpitWindowId()` + `hydrateCockpitWindowId()` chain correct. `isCockpitTabUrl` handles query/hash. In-flight dedup preserved. `onRemoved` listener persists null. `_resetCockpitWindowStateForTests` clears `hydrateInFlight`. Tests added (cockpit-window-logic.test.ts:22-33).
- **R2 ModeBadge pin**: `SET_MODE_PIN` reduced correctly (`agentStore.tsx:493`); `mode-controller.ts:105-109` honors pin only when `order[pin] > order[derived]` (auto-down allowed when task escalates — semantics consistent with label "阻止自动降级"). Single dispatch per toggle (App.tsx:202-211) — no toast spam.
- **R2 MinimalConfirm**: `useEffect` Esc handler early-returns when `!request` (no stray Esc capture when closed). `respond` is `useCallback`'d with `[request, activeThreadId, dispatch]` so Esc re-binds on queue head change. Focus-deny via `requestAnimationFrame` on `confirmation_id` change. Queue chrome `1/N` rendered, tail tool names capped.
- **R3 ComputerTaskBar**: deleted; no imports remain (only stale relocation comment at `App.tsx:160`).
- **R3 token migration**: All 7 previously-blocking literal-string bugs fixed with template literals (verified at AppsPanel.tsx:323, 329, 847; McpPanel.tsx:534; SkillCraftPanel.tsx:327, 349; SettingsSlideout.tsx:1083). `grep` confirms no remaining `"… tokens.accent"` literals.
- **R4 ChatView chips + fill-composer**: `window.dispatchEvent` soft-coupled to InputArea listener (`App.tsx:527-543`), cursor at end via `setSelectionRange`. L2 soft header tint at `App.tsx:321-323`. Discoverability copy added.
- **Tests**: 258/258 green.

## Nits (non-blocking)

A handful of pre-existing Material Design hexes survived the R3 sweep outside the lines the batch touched — these were present before the diff and were not regressions, but the R3 doc states the intent of "no quoted Material hex" across all secondary panels:
- `SettingsSlideout.tsx:233` — `#E8F5E9` / `#FFF3E0` (Material Green 50 / Orange 50 status pills)
- `SettingsSlideout.tsx:688, 807` — `#2E7D32` / `#E8F5E9` (Material Green 800/50 paired)
- `NotebooklmImporterPanel.tsx:630` — `#FFA726` (Material Orange 400 partial-fail indicator)
- `NotebooklmImporterPanel.tsx:700` — `#FFF3CD` / `#FFC107` (Material Amber 100/500 hint banner)

These could be folded into `tokens.success` / `tokens.warning` / `tokens.warningSoft` / `tokens.danger` in a follow-up tokenization pass.

VERDICT: APPROVE_WITH_NITS
