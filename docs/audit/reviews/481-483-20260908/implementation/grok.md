## Independent implementation review — #481 / #482 / #483

Frozen vs `abd9995b`. Reviewed from the supplied diff + full ACL / STT-adapter context only. Machine companion + extension tests reported green; browser harness is synthetic HTTP/audio. This is **not** native-desktop, Project-entity, real-ASR, or Windows-runtime acceptance.

Delivery vs claims is honest: overlay `thread.update` ACL is a real narrow expansion; Project / native workbench / resource CRUD are docs-only.

---

### P2 — Overlay dictation is not torn down on `pagehide`

**Trigger:** Start summoner dictation (local/system), close or hide the overlay before stop/cancel.

**What happens:** Meeting capture still does `if (sttLive) stopStt(true)` on `pagehide`. The new `summonerVoice` controller is not cancelled there. Mic tracks, AudioContext, and an in-flight `voice.stt.*` session can outlive the document until idle/infer timeout (end budget is now 305s).

**Why it matters:** The batch’s own contract is privacy + resource cleanup and “取消后丢弃旧结果”. Meeting already had this hook; the new path forgot it. Chromium *may* drop gUM on destroy, but Companion can still hold the STT slot.

**Fix:** `companion/src/summoner-web.ts` `pagehide` / `visibilitychange` — also `summonerVoice.cancel()`. Add a unit case next to the existing start-pending abort test.

---

### P2 — Extension classic+preview reports listening before capture is ready

**Trigger:** Local dictation with `realtimeStreaming` (the path this batch turns on for ordinary classic).

**What happens:** `createLocalSttAdapter` now routes `mode === "classic" && streamPartial` into `runStreamingContinuous`, which calls `handlers.onStart()` **before** `beginPcmStream` / gUM. Old `runClassic` only called `onStart` after capture succeeded. DESIGN / #482: listening starts only when capture is ready; preparing is a distinct state.

**Fix:** `chrome-extension/src/sidepanel/voice/local-stt-adapter.ts` — move `onStart()` to after PCM capture resolves (same as the gUM-success branch in summoner `startLocal`). Keep interim vs `finalChunk` as they are (adapter test correctly emits one final).

---

### P2 — New `thread_id` display filters fail closed on mixed companion/extension versions

**Trigger:** New sidepanel + older Companion (or the reverse) for `coding.git_status` / `acp.apply_diff.result` / `acp.ui_start.*`.

**What happens:** Client now requires `codingMessageTargetsThread` (`thread_id` string === active thread). Git status also requires `d.thread_id === threadId` and exact `workspace_root`. Same-batch Companion stamps `thread_id`. An old binary that omits it yields a blank git line and swallowed apply/start status — even on the owning thread.

**Fix:** Ship companion+extension together. If skew is supported, treat missing `thread_id` as “unknown” only when `session_id` matches the selected session; never treat missing owner as the active thread (current “missing ≠ active” rule is the right default).

---

### P2 — Dismissed coding sessions remain in `codingSessionsById` forever

**Trigger:** Many A/B coding runs in one sidepanel lifetime.

**What happens:** `CLEAR_CODING_SESSION` drops selection only, by design, so a late event cannot resurrect a chip. The record is never pruned. Harmless for this slice; unbounded growth later.

**Fix:** Cap or GC non-selected, non-live, aged records (e.g. same 12s chip window, or on thread delete). Do not re-bind `codingSessionIdByThread` on late events.

---

### NIT — A11y / focus / chrome

- Summoner **分类** uses `.icon-mini` height 28px; DESIGN asks 32px for essential controls (`summoner-web.ts` + `.trow .icon-mini`).
- Successful metadata save focuses the first `.thread-classify`, not the trigger (`thread-management.ts`).
- Alias is not NFC-normalized; tags/folders are (`metadata-patch.ts`). Rename vs 分类 can diverge on composed characters.
- Extension `#482` draft assembly is only proven at the adapter (`voice-classic-preview.test.ts`), not through `useVoiceInput` interim→final. Adapter itself does not double-emit finals.

---

### ACL (#481 T3) — no reject

Shared `summonerThreadMetadata` is an **exact** allowlist (`alias` | `user_tags` | `topic_folder`). Empty object, unknown keys, `__proto__` / `constructor`, `workspace_root`, `config_override`, `tool_whitelist`, mixed `alias`+policy all reject the **whole** patch (no silent strip). HTTP PATCH validates **before** `dispatchAllowed`; WS `applySummonerPayloadPolicy` uses the same function. Unspecified fields are not sent (分类 omits `alias`). No new WS methods, no confirm/approve surface, no overlay terminal/MCP-write/workspace bind via this path. Tray remains ungated (pre-existing, documented).

This **is** an ACL change vs alias-only; it matches the stated low-risk metadata subset.

---

### #483 ownership — holds

Sessions are keyed by `session_id`, owner frozen at first `thread_id`, sparse events cannot borrow the foreground, owner reassignment is ignored. `selectCodingSession` is the single display rule (FocusBand/App/panel). Thread switch closes the panel and does not auto-open B for A’s events; commands send `session_id`+`thread_id` and no-op if `!codingSessionBelongsToThread`. Companion rejects **explicit** mismatch (including `parent_session_id` followup, empty/null owner) **before** confirm/cancel/prompt/apply; omit `thread_id` with empty ctx still operates on the stored owner. Git/pick replies are ignored unless they name this thread; basename matching is gone (correct).

`CLEAR_CODING_SESSION` not resurrecting is covered by tests. Panel `key={activeThreadId}` avoids stale closures. Tests + App harness cover A→B→A, late handback, prompt/cancel/apply targeting B then A.

Legacy omit + **mismatched** `ctx.threadId` would now deny; that is tighter than “omit always works”, but UI send sites in this batch always pass `thread_id`. Acceptable if extension+companion ship together.

---

### #482 voice — holds for the claimed machine bar

Summoner engine comes from **config** (`local` | `system` | `browser`), not a page-promoted engine on the dispatched start payload. Chunks are serialized; `end` waits; HTTP `voice.stt.result` is the only dictation commit; SSE duplicates are swallowed; owner is pinned and polled; switch/cancel drop late finals. Overlay end timeout is 305s (not 8s); classic extension stop uses infer budget, not meeting `stopGraceMs`. Preparing vs listening vs processing copy exists on summoner. Privacy ack, meeting mutex, and ordered upload are tested (synthetic).

Do **not** treat this as measured ASR speedup or Windows SAPI UX.

---

### Scope honesty

`DESIGN.md` + audit + plan correctly separate this batch from Project / #476 native / merged code+terminal / resource editors. CHANGELOG matches. Navigation order and “浏览器标签页” / “资料与工具” are implemented; confirmation DOM/handlers are not rewritten.

---

VERDICT: APPROVE_WITH_NITS
