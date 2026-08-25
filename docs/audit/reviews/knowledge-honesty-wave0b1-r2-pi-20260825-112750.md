# Dual external review — Knowledge Honesty Wave 0b + Wave 1 (batch `knowledge-honesty-wave0b1-r2`)

## Verification performed (not rubber-stamped)

- **Patch currency**: The patch file's first copy (lines 84–8391) is **byte-identical** to live `git diff HEAD` (repo on `feat/knowledge-honesty-wave0` @ 5a38149, 33 files / 7378 insertions). The second copy in the file is a duplicate snapshot missing `skills.test.ts` — review subject is the live state. Patch is **not stale**.
- **Tests actually executed**: `doc-identity.test.ts` 7/7, `skill-engine.test.ts` 42/42, `skills.test.ts` 102/102, `packs-engine` + `ws-validate-strict` 34/34, message-router config/summary tests pass, `tsc --noEmit` clean.

## DoD checks

**Wave 0b**
- Preview before persist ✓ — `previewKnowledge` is pure (test locks "does not write a file"); UI paths (`KnowledgeSubPanel` file/URL, ChatView 入知识) all go `knowledge.preview` → modal → `knowledge.import` with `user_gesture: true`.
- Confirm modal ✓ — `KnowledgeImportModal` (ChatView.tsx:572) is mounted unconditionally (App.tsx always renders ChatView) at zIndex 80 > ContextPanelHost's 10, so it surfaces from the Knowledge panel too.
- Overlay does not import ✓ — `SUMMONER_WEB_DISPATCH_ALLOW` has zero `knowledge.*`; `knowledge.preview` was added only to the sidepanel background message switch; no overlay path writes knowledge.
- F-S-4 allowlist drops `*.com` ✓ — `allowlistKnowledgeFrontmatter` → `validateWildcardPattern("*.com")` rejects (public-suffix branch); test-locked.
- parseFile reused ✓ — `loadKnowledgePayload` keeps the same `parseFile` pipeline (no second parser).

**Wave 1**
- `retrieved_sources` on assistant message ✓ — adapter attaches to both the persisted message and `chat.done` SSE (both in the final no-tool-call branch, so SSE == disk); thread-manager `insertMessageAt` spreads the field so it survives reload; sidepanel hydrate preserves it.
- Chips ⊆ ledger ✓ — UI renders only `msg.retrieved_sources`; companion test locks "fake-invented.md" never enters the ledger.
- Heading `## Knowledge: {title} [{id}]` ✓; no `query_knowledge` tool anywhere ✓.

## REJECT gates — none triggered

- **R1 (false tests)**: all tests genuinely exercise the behavior (CJK distinct files, F-I-6 collision, RAG/entries/search sanitizer, `*.com` drop, ledger subset).
- **R2 (overlay ACL)**: summoner dispatch/event allowlists unchanged — no `knowledge.*`.
- **R3 (model-authored citations)**: chips source is the companion ledger only; the 入知识 button is an explicit user-triggered action behind the confirm modal.
- **R4 (Trust elevation)**: no auto_approve/L2 changes; `user_gesture` advisory-only matches the spec's "本 Wave 不强制 400".
- **R5 (Project/graph/taxonomy)**: none — no new SoT, no new entities.

## ADR-020 checklist

Declaration present in prompt + spec (Surface L0 / Compose knowledge / Trust no elevation / Channel unchanged). Axes fit; no bare "中层 Agent"; Pack-first respected (modal is a confirm dialog on an existing feature, no new resident chrome); no new confirm family / no `securityConfirmations.request` (originWs n/a); no new runtime; P1-1/2/4 untouched; P1-3 evaluate integrity out of scope.

## Nits (non-blocking)

1. **KnowledgeSubPanel.tsx:222** — multi-file import now previews only the first file (`queue.length = 0`); the status "完成：导入 1" (line ~222 flow) is misleading since nothing is persisted until the modal confirm. Remaining files dropped (status text does warn "其余请再次导入", but the completion copy should say "已预览 1 篇，待确认").
2. **skill-engine.ts:1404** — `taken.delete(preferred)` preserves same-ASCII-stem upsert: two distinct plain-body docs sharing a fallback stem (e.g. `report.docx`/`report.pdf`) still silently overwrite. The CJK `--.md` collapse (the 79→5 bug) is fixed, and this matches legacy import semantics, but it sits against F-I-5's letter — worth a follow-up.
3. **useWebSocket.ts:1815** — error-regex misses `Invalid URL` and the SSRF message from `assertOutboundFetchUrlAllowed`; the modal can stay stuck on "正在抓取…" for those failures.
4. **doc-identity.ts** — `writeRestrictedFile` checks only the leaf for symlinks (parent-dir traversal + TOCTOU remain); acceptable for the local single-user threat model (already flagged by the Wave 0 pi review).
5. No router-level test for the new `knowledge.preview` / refactored `knowledge.import` message flow (logic moved, not directly re-tested).
6. **ChatView.tsx:572** — modal has no focus trap/Escape handling (a11y regression vs native `confirm()`).
7. F-S-1 "硬分隔符 + 忽略祈使句" wrapper still not added around `## Knowledge:` sections (pre-existing; regex sanitizer is depth-only, and a title containing `\n` can still shape a fake heading).

VERDICT: APPROVE_WITH_NITS
