# Pi 独立复审 · CMspark #752/#753/#754

**Reviewer identity**: Pi coding agent, provider `deepseek`, model id `deepseek-v4-flash` (from `PI_MODEL`/`PI_PROVIDER`), session `01a15ef4-0172-7601-a500-afe5e6abd920`. Read-only: no product file edited, no live provider/capture/notification/live-config touched; probes ran against compiled current source in throwaway `mkdtemp` dirs (deleted).

**Target**: base `a3ecd5f2`, branch `codex/chat-action-workspace-752`, staged diff 46 files (+3366/−184). `git diff --cached --check` exit 0.

**Freeze integrity (one audit delta worth recording)**: R2 froze `SHA-256 e3ee2924…` over 45 files. Current 45-file subset hashes to `65b7a528…`, because `docs/audit/reviews/2026-10-21-chat-action-workspace-machine.md` was rewritten at 14:53:30 UTC — **after** R2's 14:51:53 UTC freeze. No product/test file has a post-freeze mtime (newest: `WorkspaceFrame.tsx` 14:49:17 UTC), so R2's code conclusions still cover the current code; only the machine report text moved. I reviewed the current machine report text and all other inputs in full.

## Independently re-run (not inherited)
- `companion` (`nvm use 22.23.2`): `tsc -p tsconfig.test.json` exit 0, then project runner on the three families → **39 PASS / 0 FAIL / 0 SKIP** (activity 28 + settings-assistant 9 + transport 2) — matches R2's claim exactly.
- `chrome-extension`: fresh `tsc -p tsconfig.test.json`, `node --test` on the three new families → **14 PASS / 0 FAIL / 0 SKIP**; `scripts/check-sidepanel-raw-colors.mjs` exit 0.
- Own wire-level probe (real `ActivityService`/`ActivityStore`, injected deps, temp dir):

```
afterFirstTick {deliveries:1, status:"submitted"}
wireA ordinary full-form save w/o dates -> {ok:true, deliveries:1, status:"submitted"}          // F1 core
wireB same instant as +08:00            -> {ok:true, deliveries:1, status:"submitted"}          // normalization
wireC truncated minute same instant     -> {deliveries:2, status:"submitted"}                   // see N1
paused + unsupported win32 startup      -> {enabled:false, sources:0, png exists:false}         // F2
retention during paused tick (30d old)  -> sources removed                                      // F2
cap probe: 15KB OCR x1099 sources       -> QUOTA_EXCEEDED at addSource; todo.update ok, reminders still fired, activity.delete recovered  // see N4
```

## Verdict on the three prior P2s — all three actually fixed
- **F1** `companion/src/activity/store.ts:132-139` (canonical prior instant, rearm only on real change) + `chrome-extension/src/sidepanel/components/personal-workspace/activity-request.ts:69-72` and `PersonalWorkspace.tsx:116,128` (unchanged dates omitted). Confirmed at wire level, not only by unit call. Original negative control (edit during in-flight notify must not be overwritten) still holds: `store.ts:205` matches `status==='attempting' && attempted_at`.
- **F2** `service.ts:54-60` maintenance runs before the enabled/platform gate, `:142` prunes on config change, `store.ts:174-197` one atomic batch delete, `store.ts:75-76` canonical source+sha+OCR re-validation before admitting late model output. `prune` returns before `mutate` when nothing expires, so it does not clone OCR every minute — the machine claim holds.
- **F3** `RecentActivitySources.tsx:5` keeps backend newest-first and slices 30, `PersonalWorkspace.tsx:161` uses the real component; the regression test renders the actual component with 31 sources and invokes the real newest button callback. Not an array-mirror test.

## Trajectory / scope / components
Scope matches the approved contract (only wiring files touched; no `package.json`, no new deps). Trust boundary verified in code, not just tests: WS gate `ws/lifecycle.ts:1048` → `ws/validate.ts` new validators → `message-router.ts:1118-1131` → `handlers/personal-workspace.ts:15` requires `surface==="panel"` (server-derived only, `handshake-surface.ts:34`) + chrome-extension origin + `panelId` + `isCurrentSession`; summoner/tray denied twice (`summoner-acl.ts` has no new type). Extension side `workspace-sender.ts:2-9` admits only the two owned top-level documents, so a content script (`sender.url` = web URL) is refused; `require_connected` is stripped before the WS frame so the strict schema still matches. `activity.state` wire omits `ocr_text`; screenshots/OCR leave the machine only through the separately opted-in `ocr_ai_enabled` path and only as OCR text + title/time context (no image), matching `docs/personal-workspace.md:9`. Model output cannot name config keys (`catalog.ts` closed set, `validSettingValue`), applied only through `handleConfigFamily("config.set")` with stale/owner/single-use fences and readback. No injection/chat-API/auto-send path exists in the new code (only integrity-checked host bin + a static `osascript` notification string).

## Findings
**Blocking: none.** No P0/P1; no consent bypass, no data exposure beyond the panel transport the product already uses, no auto-message path.

Nits (non-blocking):
- **N1** `store.ts:138` — any *changed instant* rearms, including a **truncated re-encode of the same intended instant** (my probe: 09:59:44.5Z → 09:59:00Z rearms, 2 deliveries). Unreachable from the shipped UI now (it omits unchanged fields), so residual only for another client; the F1 acceptance is met by the UI-side omission + same-instant guard.
- **N2** `chrome-extension/src/background/site-counter-settings.ts:9-16` — the sender gate for an *unrelated* family was widened from sidepanel-only to `workspaceSenderAllowed` (adds `/tabs/workspace.html`). In the workspace tab `getActiveTabContext()` resolves an extension URL, so requests get an honest `{ok:false}`; sidepanel behavior is unchanged (still stricter: port/userinfo rejected). Benign, but it is a permission-surface change riding along with this feature.
- **N3** Dead code kept by the refactor: `SettingsSlideout.tsx:360+` still contains the `set_*` mutation branches, reachable only via `SettingsIntentBar`'s `canNavigateRule` (open_meeting/open_packs), and `utils/settings-intent.ts:95 SETTINGS_INTENT_HELP` is now unexported-but-unused; `types.ts:20 deleted?: boolean` is read but never written.
- **N4** Metadata cap is a soft cap, not a lockout (measured): `store.ts:48` caps `state.json` at 16 MB, reachable before the 2000-source/512 MB documented caps when OCR is large (≈1100 sources × 15 KB). At the boundary `addSource` fails with an honest `QUOTA_EXCEEDED`; `todo.update`, reminders and `activity.delete` recovery still worked in my probe. Worth one line in `ActivityPanel`'s retention copy; nothing here blocks.
- **N5** UX: `WorkspaceFrame.tsx:80` silently drops `cmspark:open-workspace-destination` when a security confirmation/computer task is active, while the settings slideout has already closed — no toast (the nav buttons do toast). Also each poll clones the full OCR state (`store.ts:34` via `service.state()`), a minor cost the scheduler path already avoids.

## Honesty of claims
Machine/plan wording matches what I could verify: ADR-020 capability, off-by-default capture, separate OCR consent, human confirmation, `submitted != seen`, aarch64 full-suite figure explicitly labelled a pre-delta snapshot, and the initial three P2s attributed to implementation with no environment blaming. Native gaps stay explicit (no live TCC/ScreenCaptureKit/Vision, no real model accuracy, no OS notification display, Windows/Linux capture unsupported). My approval is code-review of the feature branch only, not proof of live capture accuracy, model quality or notification delivery. Note `docs/audit/reviews/2026-10-21-chat-action-workspace-pi.md` exists as a 0-byte untracked placeholder and is outside the diff.

VERDICT: APPROVE_WITH_NITS
