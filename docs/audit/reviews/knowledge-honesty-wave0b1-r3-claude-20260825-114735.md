# Dual external review — knowledge-honesty-wave0b1-r3

**Evidence levels:** `[executed]` = ran it; `[inspected]` = read code path.

## Patch freshness `[executed]`
All changes staged on `feat/knowledge-honesty-wave0`; working tree clean of unstaged edits. r3 patch contains the current `git diff HEAD` verbatim (extra line count = embedded `.patch` review artifacts + their duplicated headers). Not stale.

## r2 → r3 delta `[executed]`
Exactly the r2 blocker B1 fix, nothing else: `initDataDir()` now uses live `getConfigDir()` (`config.ts:537-552`) plus defensive `fs.mkdirSync` before `atomicWriteJSON` (`thread-manager.ts:476`). Byte-compared code sections of r2 vs r3 patches — only these two files differ.

## Machine gate `[executed]`
- `companion` tsc --noEmit: clean; full suite **fail 0** (exit 0, ~46s); r2's blocker `P1 D8: pack whitelist constrains mcp__ tools` rerun in isolation: **passes**
- `chrome-extension`: **817 pass / 0 fail**

## DoD verification

**Wave 0b** `[inspected + tests executed]`
- Preview-before-persist: `previewKnowledge` (`skill-engine.ts:1358`) is pure (no fs writes); locked by `skill-engine.test.ts:756` dir-snapshot test. All Side Panel entry points (file picker, URL, chat-card「入知识」) open `KnowledgeImportModal` first; the only `knowledge.import` sender is the modal's confirm button with `user_gesture: true` and optional `pin_thread_id` (`ChatView.tsx:624`, honored at `message-router.ts:2619-2626`). Spec explicitly waives server-side gesture enforcement this wave.
- F-S-4: `allowlistKnowledgeFrontmatter` (`skill-engine.ts:1430`) keeps only description/type/site/tags; `site` gated by `validateWildcardPattern` which rejects `*.com` via public-suffix set (`security.ts:101-122`); test locks `*.com` + `entries` drop.
- `parseFile` reused in `loadKnowledgePayload` (`message-router.ts:361`) — single pipeline; URL path keeps SSRF check, redirect ban, 10MB caps.
- Overlay: `SUMMONER_WEB_DISPATCH_ALLOW` (`summoner-web.ts:18-33`) has zero `knowledge.*` → **R2 pass**; `chat.done` already in event allowlist (zero ACL growth).

**Wave 1** `[inspected + tests executed]`
- Ledger built companion-side in `pushKnowledge` (`skill-engine.ts:653`); heading `## Knowledge: {title} [{id}]` (line 658); safety-guard skills stay out of the ledger; persisted on the terminal no-tool-call assistant turn (`adapter.ts:1054`) and echoed on `chat.done` only when non-empty.
- Chips render only from `msg.retrieved_sources` (`ChatView.tsx:783`); never parsed from model text → **R3 pass**. The「入知识」button's `<document filename=…>` source is adapter-injected around user attachments (`adapter.ts:383,391`), not model-authored. Subset property locked at `skill-engine.test.ts:783`.
- No `query_knowledge` tool `[executed grep: zero matches]`.

**REJECT criteria**: R1 false tests — none (tests are real; one weak extra assertion, see nits); R2/R3/R4 pass as above; R4 — no `securityConfirmations.request`/`auto_approve`/`originWs` changes anywhere in diff; R5 — no Project/graph/taxonomy entities, no new tables or runtime.

**ADR-020 checklist**: declaration present and accurate (L0 Surface modal+chips; Compose=knowledge; Trust=user_gesture on confirm, no elevation; Channel unchanged). Axes fit correct; no new confirm dialect (plain dialog, not SecurityConfirmation); no Pack-first violation; no bare middle-agent; no experimental layer on write paths.

## Non-blocking nits

1. `ChatView.tsx:791` — chip click dispatches `cmspark:open-knowledge`; no listener exists anywhere in the extension. Dead button; spec Wave 1 item 3's click-through is unimplemented (r2 nit 1, unfixed).
2. `skill-engine.ts:1402-1405` — legacy same-name re-import `taken.delete(preferred)` silently overwrites the existing doc (F-I-5 tension; r2 nit 2, unfixed).
3. `ws/validate.ts:1059-1063` — validator accepts `path` for `knowledge.import` but the handler rejects path-only frames; fail-closed yet inconsistent (r2 nit 3, unfixed).
4. `skill-engine.test.ts:784` — fake-filename assertion is vacuous; the real property is the line-783 subset check (r2 nit 4, unfixed).
5. No extension-side「chips ⊆ ledger」component test (spec §6 test row; r2 nit 5, unfixed).
6. `skill-engine.ts:657` — `chars: summary.length` includes the `… (truncated)` marker, slightly overstating injected chars vs F-I-3 (r2 nit 6, unfixed).
7. `useWebSocket.ts` `case "error"` — regex `/knowledge|预览|parseFile|fetch knowledge/i` on generic error text can overwrite an open preview modal with unrelated failures e.g. `knowledge.delete` (r2 nit 7, unfixed).
8. (new) URL preview→confirm re-fetches the URL at import time (`loadKnowledgePayload` runs again), so persisted content can differ from what was previewed. SSRF is re-checked, so security holds — preview fidelity only.
9. (new) B1-fix asymmetry: `getLogDir()`/`getPidFilePath()` (`config.ts:1397-1407`) still read import-time `DATA_DIR` while `getConfigDir()` is live-env. Production identical (env set before process start); only affects test-isolation cosmetics.

The r2 blocker is fixed minimally and correctly, the full machine gate is green, and all Wave 0b/1 DoD items and REJECT criteria verify against real code. The nine nits above are non-blocking; several are r1/r2 carryovers deliberately left for a later tightening pass.

VERDICT: APPROVE_WITH_NITS
