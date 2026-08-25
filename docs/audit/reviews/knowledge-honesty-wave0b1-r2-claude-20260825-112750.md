# Dual external review — knowledge-honesty-wave0b1-r2

**Evidence levels:** `[executed]` = ran it; `[inspected]` = read code path.

## Patch freshness `[executed]`
Working tree clean; all changes staged on `feat/knowledge-honesty-wave0`. Code section of `knowledge-honesty-wave0b1-r2-diff-20260825-112750.patch` matches `git diff --cached` (file lists identical; byte-compare of `ws/validate.ts` hunk identical). Patch is not stale.

## r1 → r2 delta `[inspected]`
r2 fixed three real r1 gaps: `background/index.ts:1183` now forwards `knowledge.preview` (r1 had no case — preview never reached companion), the `chat.done` empty-content condition now keeps chips (`useWebSocket.ts:378`), and preview failures now surface in the modal (`useWebSocket.ts` `case "error"`).

## Machine gate `[executed]`
- `chrome-extension`: **817 pass / 0 fail**
- `companion tsc --noEmit`: clean
- `companion` full suite: **3528 pass / 1 FAIL** — deterministic (failed identically in two consecutive full runs)

## BLOCKING issue

**B1 — Full companion suite is red, introduced by this diff:** `P1 D8: pack whitelist constrains mcp__ tools` (`companion/tests/p1-deep-diagnosis-batch.test.ts:64`) fails with `ENOENT ... /cmspark-p1-*/.cmspark-agent/threads/index.json.tmp-*` at `ThreadManager.create → saveIndex → atomicWriteJSON`.
- Cause `[inspected]`: this diff changed `getConfigDir()` (`companion/src/config.ts:1388-1393`) to read `process.env.CMSPARK_DATA_DIR` live, but `initDataDir()` (`config.ts:537-552`) and every other consumer still use import-time `DATA_DIR` (`config.ts:19`). In that test file, the static import of `../src/security` (which imports `./config`) hoists before line 20 sets the env, so `initDataDir()` creates the **real** `~/.cmspark-agent` dirs while `ThreadManager` (`thread-manager.ts:432`, via live `getConfigDir()`) writes into the never-created temp dir → ENOENT.
- At HEAD this test only "passed" by writing thread fixtures into the developer's real home (dir verified present) — the change exposes pre-existing test-isolation breakage, but the branch as shipped fails its own machine gate. Per the locked confirmation order (`dual-review-capability-checklist.md`: "1. MACHINE green … REJECT must block merge"), this blocks merge.
- Fix direction (small): reconcile `initDataDir()` with `getConfigDir()` (or revert to static `DATA_DIR`), and/or fix the test to set the env before any module import (dynamic imports only — which also stops the real-home pollution).

## DoD verification (all pass)

**Wave 0b** `[inspected + executed via tests]`
- Preview-before-persist: `previewKnowledge` (skill-engine.ts:1358) is a pure string transform; test asserts no file written. All Side Panel paths (file/URL/chat-card「收入知识库」) open the confirm modal; only `ChatView.tsx:624` sends `knowledge.import`, with `user_gesture: true`; `pin_thread_id` honored (message-router.ts).
- F-S-4: `allowlistKnowledgeFrontmatter` (skill-engine.ts:1430) drops `entries` and unknown keys; `site` gated by `validateWildcardPattern`; test locks `*.com` rejection.
- `parseFile` reused in `loadKnowledgePayload` — single pipeline; URL path keeps SSRF check, redirect ban, size caps.
- Overlay: zero `knowledge.*` in `SUMMONER_WEB_DISPATCH_ALLOW` → **R2 pass**; `chat.done` already in event allowlist (zero ACL growth).

**Wave 1** `[inspected + executed]`
- Ledger built companion-side in `pushKnowledge`; heading is `## Knowledge: {title} [{id}]`; safety-guard skills stay out of the ledger; persisted on the final no-tool-call turn (`adapter.ts:1054` — `assistantMsg` is the tool_calls array) and echoed on `chat.done`.
- Chips render only from `msg.retrieved_sources` (ChatView.tsx:783); never parsed from model text → **R3 pass**. `retrieved_sources.every(s => prompt.includes(\`[${s.id}]\`))` locked by test.
- No `query_knowledge` tool anywhere `[executed grep]`.
- **R1/R4/R5 pass**: no false tests found; no Trust/auto_approve/originWs changes; no Project/graph/taxonomy entities. ADR-020 declaration present and consistent (L0 Surface, Compose=knowledge, no new confirm dialect, no new runtime).

## Non-blocking nits

1. `ChatView.tsx:791` — chip click dispatches `cmspark:open-knowledge`, but no listener exists anywhere in the extension; spec Wave 1 item 3's「点击打开知识面板该条」is a dead button.
2. `skill-engine.ts:1402-1405` — legacy same-name re-import `taken.delete(preferred)` silently overwrites the existing doc; F-I-5 tension (r1 nit 4, unfixed).
3. `ws/validate.ts:1056-1062` — validator accepts `path` for `knowledge.import` but the handler rejects path-only messages (r1 nit 1, unfixed).
4. `skill-engine.test.ts:784` — fake-filename assertion is vacuous; the real property is the line-783 subset check (r1 nit 6, unfixed).
5. No extension-side「芯片 ⊆ ledger」component test (spec §6 test row; r1 nit 3, unfixed).
6. `skill-engine.ts:657` — `chars: summary.length` includes the `\n... (truncated)` marker in the truncate path, slightly overstating injected chars vs F-I-3.
7. Preview-error routing matches `/knowledge|预览|parseFile|fetch knowledge/i` on generic error text — a `knowledge.delete` failure could overwrite an open preview modal.

B1 is a small, well-localized fix away from green; everything in the Wave 0b/1 DoD itself checks out.

VERDICT: REJECT
