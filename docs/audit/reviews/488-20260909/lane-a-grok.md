# Independent review — `947532a8` vs `4a63de56` (#488)

Lens: correctness, concurrency, data ownership, request vs persisted ack, filter-scoped selection. Other agents’ approvals are ignored. No new permissions. New defects vs pre-existing debt are separated.

---

## Outcome

Honesty lockstep (0.6.7, Capture size, knowledge wording, meeting copy, CLI `--version` / `stop` / `status`, assistant-args redaction) is largely coherent.

The owned thread-management rewrite is not. Delete/restore still treat a local store mutation as success, and the new 全选 / batch-delete control flow can operate on the wrong set. That fails the stated bar: existing thread actions need a persisted, correlated result; failures must not look like success.

---

## P1 — Delete executes locally and hides transport failure (new in this rewrite)

`executePendingDelete` updates the extension store first, then fires `thread.delete` / `thread.batch_delete` with a callback that only swallows `chrome.runtime.lastError`. There is no correlated companion result, no id check, no rollback.

```777:812:chrome-extension/src/sidepanel/components/ThreadList.tsx
  const executePendingDelete = () => {
    if (!pendingDelete || pendingDelete.ids.length === 0) return
    const { ids, hard, source } = pendingDelete
    const mode = hard ? "hard" : "trash"
    if (ids.length === 1) {
      dispatch({ type: "REMOVE_THREAD", threadId: ids[0] })
      chrome.runtime.sendMessage({ type: "thread.delete", thread_id: ids[0], mode }, () => {
        void chrome.runtime.lastError
      })
    } else {
      dispatch({ type: "REMOVE_THREADS", threadIds: ids })
      chrome.runtime.sendMessage({ type: "thread.batch_delete", thread_ids: ids, mode }, () => {
        void chrome.runtime.lastError
      })
    }
    setPendingDelete(null)
    ...
  }
```

Contrast with the existing metadata path, which waits for `thread.updated` with matching `id` and verifies persisted tags/folder (`chrome-extension/src/sidepanel/utils/thread-management.ts`, `saveThreadMetadata`).

**Repro (Mac, Side Panel):** disconnect Companion or kill the SW, open 对话管理, delete one row, confirm 「移入回收站」. The row disappears immediately. Disk/`thread.list` still has it (or the request never left). Reload list from a live Companion and it returns. The in-panel confirm is an improvement over swallowed `window.confirm`; the **outcome** is still a fake success.

Pre-existing debt: old code was already optimistic. **New:** this commit owns the new persistence gate and **actively suppresses** `lastError`. That is a regression in failure visibility.

Restore is the same ownership bug, slightly softer because it also requests a list:

```847:853:chrome-extension/src/sidepanel/components/ThreadList.tsx
  const handleRestore = (ids: string[]) => {
    if (ids.length === 0) return
    chrome.runtime.sendMessage({ type: "thread.restore", thread_ids: ids })
    dispatch({ type: "REMOVE_THREADS", threadIds: ids })
    chrome.runtime.sendMessage({ type: "thread.list", include_trashed: true })
    exitSelectMode()
  }
```

If both messages fail, trash rows vanish and do not reappear in the live list. Classify restore’s missing ack as **existing debt**; the rewritten delete path is in scope.

---

## P1 — Batch delete can confirm the wrong set

```765:775:chrome-extension/src/sidepanel/components/ThreadList.tsx
  const handleBatchDelete = () => {
    let ids = [...selected].filter((id) => selectableIds.has(id))
    if (ids.length === 0) {
      ids = [...selectableIds]
      if (ids.length === 0) return
      setSelected(new Set(ids))
      setSelectMode(true)
    }
    setPendingDelete({ ids, hard: trashView, source: "batch" })
  }
```

The danger button is `disabled={selected.size === 0}`, so this is reachable when `selected.size > 0` but **none** of those ids are still selectable.

**Repro:** 选择 one thread → that thread becomes busy (run starts) or the search filter drops it → `selected.size === 1`, button stays enabled → 回收站. Intersection is empty, so `ids` becomes **every** non-busy thread in `filtered`. Confirm copy says 「将 N 个会话移入回收站」 for the whole library, not the thread the user picked.

`applyCleanupTrash` (864–873) has the same empty → all-suggestions fallback; the cleanup button is disabled on `cleanupSelected.size === 0`, so it is latent unless selection and the current scan diverge.

---

## P1 — 「全选」 is not scoped to the list the user is looking at

`selectableIds` is all non-busy threads in `filtered` (search + trash), not the rendered view.

Header 全选 (1476–1488) always uses that set. Actions-bar 全选 (1599–1616) switches to cleanup ids only when `cleanupOpen && cleanupSuggestions.length > 0`. Header 全选 never does.

`handleSelectAllVisible` (801–821) then force-opens every month/day.

**Repro A (tags):** 标签 view, no tag selected (list is the cloud only), or one tag selected. Click header 「全选」. All matching threads in the library are selected, including other tags / collapsed time groups. Title says 「全选当前列表中可删除的会话」.

**Repro B (cleanup):** 整理助手 has results. Click header 「全选」 (not the actions-bar one). Thread `selectMode` turns on and live threads are selected while the cleanup checkboxes are a different set. Bottom-bar 回收站 then targets live threads.

This is new control-flow, not old debt.

---

## P2 — Incomplete confirm migration

`pendingDelete` exists because 「Side Panel often swallows `window.confirm`」. `handleCleanupEmpty` still uses `confirm(...)` for a **hard** delete that skips trash. Same panel, same failure mode the rewrite set out to fix. Existing capability, not hidden, but still looks dead in the Side Panel.

Duplicate 「全选」 in header, actions bar, cleanup panel, and select-mode bottom bar. When cleanup is open, two visible 「全选」 controls bind different collections. Works against “intuitive, clean” without adding capability.

---

## P2 — Host close copy vs capture ownership

```274:310:chrome-extension/src/sidepanel/components/ContextPanelHost.tsx
  const meetingCaptureActive = useAgentStore().state.meetingCaptureActive
  const closeEndsMeeting = activePanel === "meeting" && meetingCaptureActive
  // … label 「结束并收起」 but onClick={closePanel}
```

Live recording: unmount still sends `meeting.end` (MeetingPanel cleanup). Copy is honest for that path. Esc still closes with no extra prompt (`ContextPanelHostProvider` keydown).

Audio import also sets `SET_MEETING_CAPTURE_ACTIVE` while `capturePhase` stays `idle`. Host then shows 「结束并收起」, but unmount only ends the server session when `phase !== idle`, and it does not set `importAbortRef`. Misleading during import. Import-unmount races are older; the **new** Host label makes them look like a deliberate stop.

MeetingPanel already has its own 「结束并收起」 that calls `finalizeCapture`. Two identical labels, different drain behavior (Host unmount skips refine drain). Acceptable if Host stays a hard unmount; the import case is not.

Settings path 「输入与语音」 is consistent in the touched copy/tests.

---

## Args redaction — pass (owned L4)

`persistAssistantDraft` now persists `redactAssistantToolCallsForPersistence(assistantMsg)` (`companion/src/llm/adapter.ts` ~1175). Helper clones, folds cookie/exec/computer/evaluate args through the existing tool-role rules, and replaces invalid JSON with `{ _redacted: "invalid_json", len }` — not the raw fragment (`companion/src/security/tool-persistence-redact.ts` 273–312).

Tests cover cookie/shell/host_computer/evaluate/invalid JSON and a ThreadManager disk assert (`companion/tests/assistant-tool-args-redact.test.ts`). The `persistAssistantDraft` case is a source-order grep, not a runtime call through `persistAssistantDraft` itself. **NIT**, not a leak if the adapter hunk is the only disk gate (no second persist path in this diff).

In-flight rows stay raw, as documented.

---

## CLI / version lockstep — pass

`--version` / `-V` / `version` print one line and exit 0; `stop`/`status` call daemon handlers (`companion/src/index.ts` 334–337, 473–477). Fallback `0.6.7` matches package.json (`companion/src/cli-version.ts`). ACP/outbound `serverInfo` and NSIS fallback bumped. Extension lockfile 0.6.3→0.6.7 is a real honesty fix.

`status` now exits 1 when the daemon is down (was stub exit 0). That is the intended honesty change. Foreground `start` still will not look like a daemon; help text says so.

`cli-version.test.ts` spawns `src/index.js`. That is a compile-layout assumption, not a product bug.

`js-yaml` 4.3.1→4.3.2 is outside the honesty/thread scope; no permission change.

---

## Public capability wording — pass (docs-only in this diff)

Capture default 1040×760 / compact 360×420, knowledge top-k, PTY Darwin-only, CU still experimental, #258–#260 off remaining, embedding experimental: living docs and CHANGELOG `[0.6.7]` agree with the stated 0.6.7 cut. Knowledge inject implementation is not in this diff; wording is not treated as a new endpoint.

UI hierarchy CSS (`.cm-history-panel` column flex, list `flex:1; min-height:0`, cleanup/confirm `flex-shrink:0`) is the right structure: confirm and 整理助手 stay on screen while the list scrolls. That part is good. Group checkboxes in tags/topics add selection, they do not hide actions.

---

## Existing debt (not blocking by themselves)

- Optimistic `thread.restore` / `thread.create` / `thread.cleanup_empty` without correlated ack.
- `window.confirm` on 清理空白 and skill delete in `ContextPanelHost`.
- Meeting import continues after unmount unless `importAbortRef` is set.
- `saveThreadMetadata` already meets the ack bar; delete/restore were never brought up to it until this rewrite claimed the delete UX.

---

## What would clear a re-review

1. Delete/restore: send with a correlation id; apply `REMOVE_*` only on a matching persisted result; on `lastError` / `error` / timeout, keep the rows and show failure. Do not invent new endpoints — use the existing `thread.delete` / `thread.batch_delete` / `thread.restore` replies the way metadata uses `thread.updated`.
2. Batch delete: if the selectable intersection is empty, no-op; never expand to all `selectableIds`.
3. 全选: operate on the rendered collection (time rows after expand, or the active tag/topic group, or cleanup ids). One control, one set. Header must not select live threads while 整理助手 is the visible target.

Redaction, CLI version, and docs honesty do not need another pass unless those land with the thread fixes.

---

VERDICT: REJECT
