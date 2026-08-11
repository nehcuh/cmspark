I have enough evidence to render a verdict. Tests pass (610/610), the diff is current, and I've inspected every Wave B acceptance surface.

## Verdict report — `thread-history-ia-wave-b-impl`

### Acceptance criteria — all met `[inspected]`

- **B-1** default-off + UI + nested/flat accept
  - `companion/src/config.ts:348-352` — `thread_digest: { enabled: false, on_idle_hours: 24, max_per_day: 20 }`
  - UI: `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx:2931-3001` (toggle + 0..720 h clamp + 0..100 quota clamp)
  - Nested accept: `companion/src/message-router/handlers/config.ts:192-206`
  - Flat accept: `companion/src/message-router/handlers/config.ts:207-227`
  - normalizeConfig flatten: `chrome-extension/src/sidepanel/hooks/useWebSocket.ts:191-197`

- **B-2** lazy extract, idle hours, daily quota, cap ≤ 20
  - `chrome-extension/src/sidepanel/components/ThreadList.tsx:429-468` — gated by `config?.thread_digest_enabled === true`; `max: Math.min(EXTRACT_DIGEST_MAX, remain)`; `countTowardQuota: true`
  - idle filter: `chrome-extension/src/sidepanel/utils/thread-timeline.ts:533-537`
  - busy + worker excluded by default: `thread-timeline.ts:531` (excludeWorkers defaults true), ThreadList call site passes `excludeWorkers: true`
  - per-batch cap double-protected: `ThreadList.tsx:383` (`ids.slice(0, EXTRACT_DIGEST_MAX)`)

- **B-3** stale badge non-today only / tags always
  - `thread-timeline.ts:549-563` (`showDigestStaleBadge`)
  - Call site: `ThreadList.tsx:638` — uses `view` and `now` correctly

- **B-4** cleanup 「仅提取要点」 no delete
  - `ThreadList.tsx:587-592` (`applyCleanupExtractOnly` — extract only, no batch_delete)
  - Button row: `ThreadList.tsx:1307-1315` (sibling to 「移入回收站」)

### Cost safety `[inspected]`
default off ✓ · daily quota via `localStorage` `cmspark.threadDigest.quota` ✓ · idle filter ✓ · busy + worker excluded ✓ · per-batch cap 20 (also sliced in `beginExtractBatch`) ✓ · invalid `thread_digest` objects fall through (no normalized mutation) ✓

### Rejection gates
- **R1** default off — clear ✓
- **R2** quota honored + cap 20 — clear ✓
- **R3** workers excluded by default — clear ✓ (`excludeWorkers !== false`)
- **R4** today group not flooded — clear (test `showDigestStaleBadge: time view only non-today`) ✓
- **R5** no Knowledge/Graph/L2 — clear (capability declaration lists none; diff only adds `config.thread_digest` metadata + UI) ✓
- **R6** tests pass + helpers tested — clear (`node_modules/.bin/tsm` 610/610; new tests for `parseDigestQuota`, `remainingDigestQuota`, `selectLazyDigestCandidates`, `showDigestStaleBadge`, plus Wave A helpers) ✓

### ADR-020 capability check `[inspected]`
Declaration present; axes fit (Surface L0 chat UX + companion config metadata; no Composition axis touched; no Autonomy change — workers explicitly excluded from lazy batch); trust monotonicity preserved (config.set only mutates `thread_digest` nested object; no security arm touched); no new runtime; no originWs change. Pass.

### Nits (non-blocking)

1. `chrome-extension/src/sidepanel/utils/thread-timeline.ts:526,542,544` — `selectLazyDigestCandidates` declares `let force = false`, writes it inside the loop and after the loop, but **the return uses `ids.length > 0`** — the local `force` is dead. Behavior is correct (non-empty → force=true matches docstring), but the dead writes mislead readers. Either drop the three lines or change the return to `{ ids, force }`.

2. `chrome-extension/src/sidepanel/components/ThreadList.tsx:412-422` — lazy quota is debited at dispatch time. If the WS round-trip drops (e.g., companion restart mid-batch), the day's quota is still consumed and the user sees no digests. Conservative (errs toward fewer extracts) but slightly surprising. Consider moving the `localStorage.setItem` into the `cmspark:extract_digest_completed` handler so only successful extracts count.

3. `chrome-extension/src/sidepanel/components/ThreadList.tsx:429-468` — lazy effect re-runs on every `threads` change until `lazyDigestRanRef.current` flips. The ref is set immediately before `beginExtractBatch`, so duplicate dispatch within one panel-open is prevented. But if `sel.ids.length === 0` (no candidates yet) the ref stays false; later thread arrivals in the same session can still trigger a lazy batch. This is arguably desirable (eventual coverage), just non-obvious — worth a one-line comment if not already implied by the existing `lazyDigestRanRef` comment.

### Must-answer
1. B-1..B-4 — all met with file:line above.
2. Cost safety — default off + daily quota + idle filter + busy/worker exclusion + per-batch cap; all present.
3. Proceed to Wave C — yes; capability is metadata-only, no new runtime, all guards in place.

VERDICT: APPROVE_WITH_NITS
