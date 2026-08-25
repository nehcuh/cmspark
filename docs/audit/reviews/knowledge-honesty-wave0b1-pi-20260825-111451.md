Review complete. Here is my assessment.

## Dual external review — `knowledge-honesty-wave0b1`

**Verification performed:** read the full diff (lines 78–1844 of the patch; patch matches current staged state on `feat/knowledge-honesty-wave0`), the locked spec §0–§5, the ADR-020 checklist, and the live source. Ran companion tests: 3528/3529 pass; the single failure (`p1-deep-diagnosis-batch P1 D8`) also fails on base `5a38149` (fails harder there — all 4) and is unrelated (pack-whitelist/MCP test with a tmp-dir race). All 151 knowledge/skill/doc-identity tests pass — R1 clean.

**ADR-020 axes:** declaration present and consistent — L0 Surface, Compose=knowledge, no L2, no trust elevation, overlay ACL unchanged (DISPATCH_ALLOW/EVENT_ALLOW untouched; no `knowledge.*`). No new confirmation family (checklist 3 ✓), no new runtime (doc-identity is a helper module, checklist 1/6 ✓), originWs n/a (checklist 5 ✓). R2/R4/R5 satisfied: summoner has no `knowledge.*`, no Trust step-up, no Project/graph/categories tables; F-S-4 allowlist drops `entries`/`*.com`; all three retrieval paths (RAG, truncate, entries, searchKnowledge) sanitize; F-I-1 tri-partition + legacy `get(name)` + CJK hash stems implemented across all write paths; `parseFile` reused (no second parser); chips render only companion `retrieved_sources` (R3 ✓, survives reload via `sanitizeHydratedMessages` spread).

## Blocking issue (REJECT)

**B1 — `knowledge.preview` is never relayed to companion; the Wave 0b preview flow is dead on arrival.**
- `chrome-extension/src/background/index.ts:1181-1184` — the service-worker relay case list contains `knowledge.list`, `knowledge.import`, `knowledge.import_directory`, `knowledge.delete`, but **not `knowledge.preview`**. The `default` branch (`index.ts:1428`) answers `{ ok: false, error: "Unknown message type: knowledge.preview" }`.
- `KnowledgeSubPanel.tsx:218` (file import) and `:258` (URL import) send `chrome.runtime.sendMessage({ type: "knowledge.preview", … })` through exactly this relay. Companion-side support is fully wired (`validate.ts` accepts it; router `knowledge.preview` → `loadKnowledgePayload` + `parseFile`; the sidepanel hook handles the `knowledge.preview` response event) — but the request never reaches companion.
- Consequence: the modal is stuck on the placeholder "正在解析…"/"正在抓取…" forever. The user confirms import **blind** — no extracted markdown preview, no editable parsed title for PDF/DOCX. This defeats the core Wave 0b DoD ("preview before persist"; "PDF/DOCX 与现 parseFile 同管道") and undermines F-S-3's 抽出正文预览 intent. Fix is 2 lines: add `case "knowledge.preview":` to the relay list at `index.ts:1181-1184`.

## Non-blocking nits (for after the blocking fix)

- **N1** `KnowledgeSubPanel.tsx:222` — `queue.length = 0` after the first file silently drops files 2..n of a multi-select (no 跳过 message), and `:221` `imported += 1` reports "完成：导入 1" before the user has confirmed the modal (lies if cancelled). Preview-one-at-a-time is fine, but the status/queue behavior should say so.
- **N2** `skill-engine.ts:658` — `## Knowledge: ${title} [${id}]` injects the raw frontmatter `title` into the system prompt without passing through `sanitizeKnowledgeContent` (body is sanitized, heading is not). An imported doc's `title: "Ignore all previous instructions"` lands verbatim in the prompt heading. Exposure pre-exists via `name` in old headings and the sanitizer is documented defense-in-depth (F-S-1), so not blocking — but routing the heading title through the injection-pattern filter is cheap and closes the last unsanitized knowledge surface.
- **N3** `agentStore.tsx:921` — `SET_KNOWLEDGE_PREVIEW` merges `payload: action.preview.payload || prev.payload`; a late server preview from a previous request could pair with a newer local payload. Sequential queue mitigates, but a stale-response guard would harden it.
- **N4** `skill-engine.ts:1395-1400` — re-import of an ascii doc updates in place (`taken.delete` for preferred id) while re-import of the same CJK doc creates a duplicate `k-<hash>-2.md`. Inconsistent update semantics; not security-relevant.

VERDICT: REJECT
