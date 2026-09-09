## Review

### Concrete defects

**1. `meeting.updated` transcript sync drops remote lines after local close confirmation — `MeetingPanel.tsx:699-716`**

In `onMsg`, `meeting.updated` only replaces transcript when `!transcriptDirtyRef.current && !live`. After a live capture finalizes, `finalizeCapture` (line 426+) sets `phase` to `idle` and the `live` guard is false, so later `meeting.updated` events sync normally. But during `confirmMeetingClose`, `expectedText` is read from `liveTextRef`, not `transcriptRef`. If any `meeting.updated` containing transcript arrives *after* the final local append but *before* close completes, `transcriptRef` is set to the server transcript. `confirmMeetingClose` then compares `liveTextRef.join("\n")` against persisted text — the extra remote lines cause `endsWith` to still pass (server transcript ends with the same final line). So no false rejection here, but a practical issue remains: `liveTextRef` is appended in `appendLocalAndRemote` even when `id` is null (import path, line 318) and when local append succeeds while `sendViaRuntime` fires without receiving any `meeting.updated` receipt. **Not reproduced as a failure with synthetic transport**, but the actual contract promises “persisted transcript confirms final segment”; if the server transcript contains *additional* remote updates beyond what the panel saw, close may pass while the panel-local transcript is stale relative to memory. Severity: low–moderate.

**2. `ContextPanelHostProvider` settings-open race force-closes a recording panel — `ContextPanelHost.tsx:205-216`**

When `state.settingsOpen` becomes true and a `beforeClose` guard exists, the effect does:
```
dispatch({ type: "SET_SETTINGS_OPEN", open: false })
const pending = requestPanelChange(null)
...
void pending.then(allowed => {
  if (allowed) dispatch({ type: "SET_SETTINGS_OPEN", open: true })
})
```
If `allowed` is `false`, the panel remains but `settingsOpen` has already been set to false. The user clicked Settings, it flashed closed, and there is no retry affordance tied to it. The meeting panel remains with `error` set, while the user’s original navigation intent is silently dropped. Reproducible in the synthetic fixture by causing a close failure (e.g. `window.failRead`) after clicking `打开设置`: settings never opens and the click appears dead. This violates the declared DoD “failures/timeouts retain panel” but also drops the user action rather than restoring the attempt. Severity: moderate, UI-only.

**3. Meeting close button falls back to losing the entire final segment when `props.registerBeforeClose` is absent — `MeetingPanel.tsx:1339-1340`**

`ContextPanelHost` always passes `registerBeforeClose` (line 350) so the branch is safe in the production workbench. However, any existing alternative mount (older previews, panel reuse in `render-meeting-close-fixture` paths, or a future host without the provider) silently goes down the old `props.onClose()` path without persistence. The component’s contract is `registerBeforeClose?`, and the fallback was intended to be the *safe* path; instead the new safer `requestCloseRef()` path is only taken when the prop is missing, which is inverted. Severity: low, latent contract mismatch.

**4. Empty-tag “全部对话” selection boundary can exceed what the user is viewing — `ThreadList.tsx:513-519, 1241-1258`**

`selectableIds` uses `tagIndex.get(activeTag)` when `activeTag !== null`, but `renderTagsView` at line 1251 uses `filtered` when `activeTag === null`. This is consistent — no bug there. However, the tag cloud itself is built from `filtered`, which applies the current search query. So if the user searches for “对话”, then clicks the `#支付 2` tag, the tag index contains only two threads, and the visible list label “全部对话 · 2” is correct. But after clearing search, `selectableIds` changes and an effect (lines 522-527) removes selections outside the new boundary without clearing `selectMode` or notifying the user; the batch bar may show “已选 0” while still in select mode. Minor UX nit, not a functional deletion risk. Severity: nits.

**5. Thread mutator timeout after a successful server result is reported as “结果未确认” even when `ok` was persisted — `thread-mutations.ts:124-126, 64-93`**

In `batch`, the timeout is armed *before* the server response is received (line 96). If the server reply arrives after the timeout but contains a valid `thread.batch_deleted` payload, it is ignored because `settled` is already true. The mutator then classifies all `ids` as `unknown_timeout`, and the UI copies this as “部分操作可能已完成”. This is deliberately cautious and not a data-loss bug; the rows are not optimistically removed, and the user is told to refresh. Pass.

**6. Meeting close `captureFinishedRef` can be set twice without idempotence across sequential close attempts — `MeetingPanel.tsx:827-834, 1040-1058`**

On the second attempt after a previous timeout, `finalizeCapture` already set `finalizedRef.current = true` and `finalizingRef.current = false`, so the line `captureFinishedRef.current?.(false)` is not reached because `captureFinishedRef.current` was nulled. OK. But the `stopLiveCapture` path in `requestCloseRef` sets `captureFinishedRef.current = resolve` and then calls `stopLiveCapture(false)`. If the panel was already `phase === "idle"` with `finalizingRef.current === false`, the condition `if (phaseRef.current !== "idle" || finalizingRef.current)` is false, so no new resolver is registered. Subsequent checks fall through to `needsClosePersistenceRef.current`, where `refineQueueRef.current.drain()` may pass, then `confirmMeetingClose` awaits independent subscription. No deadlock. Severity: none observed.

**7. `composeSectionsInGroup` grouping with `SECTION_SCOPE` — `ComposeDrawer.tsx:38-44`**

`SECTION_SCOPE` is keyed by `ComposeSectionId` and covers `skills/ knowledge/ packs/ mcp/ apps/ history`. `meta-slash` export at line 15 includes `ComposeSectionId`; if `COMPOSE_SECTIONS` contains `board` (not an id in `SECTION_SCOPE`), this would be `undefined` in the row. `handleSection` already drops `panelId === "board"` before clicking, but the row still renders with `undefined` attachLine. Severity: nits, no crash (`undefined` renders nothing).

**8. Background `thread.delete` single-row handler returns `ok: sent` but does not verify persistence; single-row UI still optimistic — `background/index.ts:1006-1031`, `ThreadList.tsx:568-582`**

`handleDeleteOne` opens `pendingDelete` with `source: "row"`; `executePendingDelete` sends it through `runMutation` with `mode = "trash" | "hard"`. But the background `thread.delete` branch (`case "thread.delete"`) sends a legacy single delete without the `require_connected` guard and without waiting for a correlated `thread.deleted` reply. `thread-mutations.ts` only generates a `batch_delete` request for the trash/hard path (line 107-115), so the single-row flow actually dispatches to `thread.delete` and gets only a transport ACK. The UI treats that ACK as persistence. This violates the DoD claim “delete and restore wait for real receipts” for single-row deletion. The synthetic UI test only exercises batch paths, so this was missed. Severity: high for consistency, though single-row deletion is still user-confirmed.

### Verdict

The patch substantially improves safety for destructive operations, but single-row delete still bypasses server-confirmed persistence and the final-segment preservation relies on a host-managed guard that can be absent in alternative mounts. Those are concrete contract violations. **REJECT** until single-row delete is routed through the correlated mutator and the settings-open retry path restores the panel without dropping user intent.