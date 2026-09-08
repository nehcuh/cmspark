VERDICT: APPROVE_WITH_NITS

Reviewing only the frozen packet. All five mandated gate criteria are addressed by design + implementation + actual test evidence. No P0, no P1.

## Gate criteria

**1. Save matching id+field confirmation — PASS.** `saveThreadMetadata` registers a runtime listener that accepts only `message.id === envelopeId` AND `message.thread.id === threadId`, then verifies echoed classification fields via `threadTags` normalize-compare (lowercase, dedup) and exact `topic_folder` match. Transport ACK alone can never resolve (promise only settles on `thread.updated`/`error`/abort/timeout). The ws transport stamps the request `id` onto responses (`...response, id: msg?.id`), and companion returns `thread.updated` from the real `handleMessage` route, so the id chain works end-to-end. Old-companion echo missing `user_tags` fails field verification and shows the "请确认 Companion 已更新" error — not success. Timeout is honestly worded ("尚未收到保存确认") and does not claim cancellation; late replies are dropped because `finish()` removed the listener. One defensible edge: clearing all tags+folder against an old companion that ignores `user_tags` produces desired-state-equivalent echoes (no field ≈ empty) and shows success — acceptable, since persisted state matches the requested state. The ack-only fixture mode and mismatch/error/abort branches are unit-tested in `thread-management.test.ts`; the 15s timeout path itself is not exercised (NIT).

**2. AI grouping vs manual folder — PASS.** `aiThreadGroup` reads only `digest.tags`, takes the first non-empty string in original order, trims/lowercases (consistent with existing normalization), and never touches `topic_folder` or `user_tags`. Re-extraction may move a thread; UI help text states this. "待 AI 整理" bucket sorts last. The UI test asserts zero `thread.update` messages sent merely by opening the AI view. Manual groups remain a separate view over `topic_folder`; the editor builds only `{user_tags, topic_folder}` — no permission/tool fields are constructible or in the server allowlist change. Companion `sanitizeUserTags` enforces ≤20×≤40/NFC/control-strip/whitespace/dedup server-side with throw-on-invalid that aborts before `Object.assign`, so malformed input cannot overwrite existing labels (tested). Digest replacement preserves `user_tags` through reload (tested via a fresh `ThreadManager`).

**3. Label-in-name — PASS.** Trigger aria-label is "对话管理（历史对话）" with visible text "对话管理"; the dialog keeps accessible name "历史对话列表"; the one in-repo exact-match dependency (`test-workspace-ui.py`) was updated. The manager row button uses `title="编辑标签与分组"` with visible "分类"; the row test locators are consistent.

**4. Narrow running Stop/confirmation priority — PASS.** The backdrop was deleted; outside `mousedown` closes the panel without preventing the click, so Stop stays directly clickable. Panel maxHeight is clamped against the composer dock top plus ResizeObserver on dock/rail, so the panel cannot extend over the input/stop area. `panelBox.maxHeight = Math.max(0, Math.min(..., composerTop - top - 8))` is structurally sound. The trigger is `disabled` while `pendingSecurityConfirmations.length > 0`, the panel force-closes on confirmation arrival, and the wide-nav open event handler refuses when a confirmation is pending. The actual 320×480 test does elementFromPoint hit-checks on Stop/risk/"+" with manager and more-menu open, clicks Stop (asserting `chat.abort` sent), and verifies Allow/Deny/Stop unobstructed with no confirmation submit. The more-menu portal is clamped to `panelBox.top + panelBox.maxHeight - menuPos.top`. Real test exit 0 (`browser-priority` PASS log).

**5. Graph manual/AI provenance — PASS with one MAJOR observation.** `ThreadGraphSlim` gains a root-level `user_tags` field (filtered/sliced 20×40) kept separate from `digest.tags`; the slim-row test verifies `user_tags: ["人工"]` survives and unknown keys/message bodies are dropped. Detail view lists "人工标签：…" as its own row above digest tags. Search/scoring (`threadTags`, related TF) merge both tag sets, which the gate explicitly permits. MAJOR (non-blocking): `isUntaggedSlim` now uses merged `threadTags`, so a thread with only manual labels loses the graph's "untagged" badge even though it has no AI digest — the graph's untagged-badge semantics (a signal for extraction candidacy) drift from digest-only to merged provenance in exactly one place. Node color hashing code is not in the shown diff, so it appears unchanged/digest-derived, but this one categorization site should either be digest-only or explicitly documented.

## Other items

- "+" header button: shown ≤759px, `aria-label="新对话"`, calls the existing `createBlankThread` owner; wide screens keep navigation-owned creation. 320-short-screen hit-test covers it.
- AI extraction batch: `EXTRACT_DIGEST_MAX` ≤20 maintained via `handleExtractUntagged`; busy/worker/trash exclusions unchanged; repeatable. Test asserts ≤20 ids.
- Editor drafts survive AI digest UPSERT (keyed by thread id, no re-init), matching the gate. Focus restore to the row's 分类 button with search-box fallback is implemented via `closeMetadataEditor`.
- Cancel/close while saving is blocked; abort signals clear listeners.
- 整理助手 name kept as rule scan, distinct from AI 提取标签; both are separate action row buttons.
- Late `thread.updated` broadcasts are consumed by the global store normally, not by the settled promise.

NITs:
1. Wide-nav "管理对话" during pending confirmation silently no-ops (handler guard) — consider disabling the nav button for parity with the disabled trigger.
2. 15s timeout branch untested (would add 15s to suites); a fake-timer unit test would close that gap.
3. Manual-grouping empty-state hint condition (`keys[0] === "未分组"`) is now manual-view-only; the AI view relies on the help paragraph — fine, but slightly asymmetric.
4. Tags-view "未标注" semantics: manual-tag-only threads are no longer "未标注" in the merged view while remaining AI-extraction-eligible; consistent with "汇总两类标签" but worth a doc line.

## Machine evidence

Extension: build clean, 1283 pass/0 fail. Companion: 5021 tests, 4998 pass/23 skip/0 fail, plus 20 pass/0 fail. `test-thread-management-ui.py` PASS (all five widths, 320×480 priority check); `test-workspace-ui.py` PASS with the updated accessible name. No decorative-styling claims inferred from tests.

None of the findings touch permission defaults, tool execution grants, or real user data. Gate criteria met; MAJOR item is a provenance-semantics clarification, not a correctness defect.
