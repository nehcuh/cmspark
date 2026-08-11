All verification complete. The companion hard-caps at 20/request (message-router.ts:1309), confirming the end-to-end cap. Here's my full assessment:

---

## Dual review: Thread History IA — Wave B implementation

**Verification performed:**
- Patch base `bf25c0b` = current HEAD; patch body matches live `git diff` (only the header block differs) — **not stale**.
- Full extension typecheck (`tsc --noEmit`): clean, exit 0.
- Test suite: **610 pass / 0 fail** (`npm --prefix chrome-extension test`, includes `tsc -p tsconfig.test.json`).

### Acceptance B-1..B-4 (with file:line)

| ID | Status | Evidence |
|----|--------|----------|
| B-1 | ✅ | `companion/src/config.ts:229-237` `ThreadDigestConfig`, default `enabled:false, on_idle_hours:24, max_per_day:20` (config.ts:348-352). Settings UI 会话索引 at `SettingsSlideout.tsx:2932-3001`. config.set handles **both** nested `thread_digest` and flat `thread_digest_*` with clamping (on_idle_hours 0–720, max_per_day 0–100): `handlers/config.ts:191-228`. UI round-trip: `normalizeConfig` flattens nested → flat (`useWebSocket.ts:191-197`); `handleSave` (SettingsSlideout.tsx:425) sends full flat config; initial `config.updated` normalizes too (useWebSocket.ts:681-684). |
| B-2 | ✅ | Lazy effect `ThreadList.tsx:437-474`: fires on open only when `config.thread_digest_enabled === true`, once per open (`lazyDigestRanRef`), skips trash/in-flight batch. Idle filter in `selectLazyDigestCandidates` (thread-timeline.ts:505-541). Daily quota via `LS_DIGEST_QUOTA` + `parseDigestQuota`/`remainingDigestQuota`; decremented in `beginExtractBatch` `countTowardQuota` (ThreadList.tsx:415-423). Per-request cap: `EXTRACT_DIGEST_MAX=20`, lazy `max: Math.min(20, remain)`, re-slice in `beginExtractBatch`, and companion hard cap `message-router.ts:1309` ("max 20 threads per request"). |
| B-3 | ✅ | `showDigestStaleBadge` (thread-timeline.ts:550-560): tags view always; time view only when `localDayKey(updated) !== localDayKey(now)`. Wired at ThreadList.tsx:638 with `view`/`now` in scope. |
| B-4 | ✅ | `applyCleanupExtractOnly` (ThreadList.tsx:587-591) + 「仅提取要点（N）」button (ThreadList.tsx:1299) — extract only, no delete; trash path separately preserved. |

### Rejection gates R1–R6
- **R1** PASS — default `enabled:false`; lazy requires `=== true`; no silent full-library (cap + daily quota + idle filter + workers excluded).
- **R2** PASS — `max_per_day` honored via `remain`; never >20 per request (double-capped client + companion).
- **R3** PASS — `excludeWorkers` default true in both `selectUntaggedForExtract` and `selectLazyDigestCandidates`; lazy passes it explicitly.
- **R4** PASS — today-group stale badge suppressed in time view.
- **R5** PASS — diff contains no Knowledge dual-write / Graph / L2 classes; only mention in the diff is the session.md "out of scope" note.
- **R6** PASS — 610/610 tests green; quota (`parseDigestQuota`/`remainingDigestQuota`), lazy candidates, stale badge, force/worker/busy selection all unit-tested (thread-timeline.test.ts); `normalizeConfig` thread_digest flattening tested (sidepanel-state.test.ts).

### ADR-020 capability checklist
- Declaration present and accurate vs. diff: Surface L0 (chat UX + config metadata), no L2-classes, Compose none (no Knowledge/Pack dual-write), Autonomy n/a, Trust unchanged, Channel unchanged. ✅
- No new tools/gates/confirmation families/security arms; config.set touches only nested `thread_digest` (whitelisted, type-clamped — no prototype-pollution surface beyond the existing sanitizer). Trust monotonicity preserved; no `originWs` involvement (no new `securityConfirmations.request`). No new runtime. Pack-first not implicated (extends existing thread-list UI; no new scenario/Pack alternative needed).

### Nits (non-blocking)
1. **Settings placement** — 会话索引 is nested inside the "导出与集成" (Export & Integrations) `SettingsSection` (SettingsSlideout.tsx:2882), next to Obsidian export; semantically it belongs to thread-list IA. Cosmetic.
2. **"保存后生效" text vs behavior** — SET_CONFIG updates the shared store immediately, so toggling the switch activates lazy extract in the current sidepanel session even before 保存 (persists only until reload). Minor text/behavior mismatch, no safety impact.
3. **Quota charged at send time**, not on successful extraction — a failed batch still consumes daily quota. Conservative local budget; acceptable but worth a comment.
4. **B-4 spec wording** says checkbox option; implemented as a separate button next to 移入回收站 — semantically equivalent ("与删除分轨"), arguably clearer.

### Must-answer
1. B-1..B-4 all met with file:line above.
2. Cost safety: default off + daily local quota + idle-hour filter + worker/busy exclusion + ≤20/request (client & companion caps) — solid.
3. **Proceed to Wave C** — yes; Wave B is complete and gated correctly.

VERDICT: APPROVE_WITH_NITS
