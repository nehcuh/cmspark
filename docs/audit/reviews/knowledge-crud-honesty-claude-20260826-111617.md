Review complete. All spot-checks done against real code.

## Findings

### Factual claims — all six verified TRUE [inspected]

| Claim | Evidence |
|---|---|
| (a) No `knowledge.get/update/export` today | `companion/src/message-router.ts:2612-2774` — only `list/set_active/preview/import/import_directory/delete/related` |
| (b) `listKnowledge` no body, ships `source_file`/`entries` | `companion/src/skills/skill-engine.ts:1339-1357` — returns `entries`, `source_file`, `dir`, `resources`; no content |
| (c) Delete UI sends `name`, validate demands `id` | UI `KnowledgeSubPanel.tsx:98,138` sends `{name}`; `ws/validate.ts:1094-1098` requires `id`; router `message-router.ts:2773` reads `rest.name` — double mismatch, and validation is enforced (`ws/lifecycle.ts:918-919`), so delete is genuinely broken today |
| (d) Overlay allowlist = list + set_active only | `ws/summoner-acl.ts:41-42`; `summoner-web.ts:36-37,488-501` — HTML only `/api/knowledge` + `/api/knowledge/active` |
| (e) Related click-gated, titles not buttons | `KnowledgeSubPanel.tsx:581-595` — 「相关」button (title=“查询相关知识（最多 3 条）”) fires per-row `knowledge.related`; titles rendered as joined plain text |
| (f) `import_directory` validate wants `path`, UI omits it | `ws/validate.ts:1088-1092` vs `KnowledgeSubPanel.tsx:306` (`user_gesture` only) — also genuinely broken today |

Supporting claims also check out: `KNOWLEDGE_RELATED_LIMIT = 3` and title/description/tags-only scoring (`knowledge-related.ts:9,33`); `writeRestrictedFile`/`allocateDocIdentity` (`doc-identity.ts:72,125`); `redactSecrets` returns `{text, hits}` matching spec's `redacted_hits` (`threads/distill.ts:24`); `set_active` known-set today is `d.name || d.id` (`message-router.ts:2623`); `cmspark:open-knowledge` today = panel focus + list load, no reader (`ContextPanelHost.tsx:205-211`); `ChatView.tsx:799,811` 本轮附带 chip exists. One spec-relevant nuance: `exportSkill` (`skill-engine.ts:855`) does **not** today reject knowledge docs (only `loadContent` does, :417-421) — the spec correctly lists this as Wave 3 work (item 8), not as an existing fact. Patch file is fresh: matches staged content (3 files, 383 insertions, base a64744b = HEAD).

### Gates R1–R9 — none triggered

- **R1**: No false code facts found. **R2/R6/R9**: graph/embedding/Project/wiki-IDE/双链 all explicitly NEVER (spec §2.4, §5 “明确不在”； F-UX-NOUN-1 extends the locked 2026-08-25 ban list, doesn't weaken it). **R3**: overlay frozen at list+set_active; acceptance item 9 asserts `has(...)===false` + router summoner extra-deny (F-S-5/11). **R4**: Blob-only, no vault write, no ADR-008 wikilinks (F-E-8, F-UX-EXPORT-1). **R5**: `user_gesture` mandatory on update/export/delete in validate+router; no auto-inject; F-S-7 keeps draft tags out of related until user save. **R7**: `knowledge.get` + reader are P0 items 4-5 of the same PR family; related-without-reader explicitly rejected (§0). **R8**: F-I-1 forbids the `importKnowledge`/`allocateDocIdentity` path for update; in-place same-`filenameStem` write preserves id, and acceptance criteria cover CJK title change + no `notes-2` reallocation + `active_knowledge_ids` resolution. Locked-spec consistency: strengthens, never contradicts, 2026-08-25 F-E-3/F-UX-NOUN-1/F-S-5/F-I-1/2.

### ADR-020 checklist

Declaration present and accurate (L0 Surface, no L2, Compose on existing knowledge, no Trust elevation, overlay ACL frozen). Reuses existing modal chrome (F-UX-SHEET-1) — no new primary chrome/bottom tab; no new runtime; no confirmation-family proliferation (reuses existing confirm style); no originWs surface change (WS verbs, no `securityConfirmations.request` involved). Passes.

### Non-blocking nits

1. **`knowledge.related` verb retirement** — with list embedding related≤3 and get carrying related, the standalone verb (spec §3 “保留（兼容）”) is triredundant; add a deprecation note or drop it in a later wave.
2. **Overlay list exposing related titles** (spec §7 open question 2) — `/api/knowledge` (summoner-web.ts:488) serves the same list payload, so embedding related titles hands the overlay derived data it lacked. Not a verb growth; the spec's fallback (related only in get) is strictly safer.
3. **512KiB–6MiB dead zone** (F-S-16) — readable via truncated get but export refuses; coherent (export is the exfil boundary) but the reader should hint why download is disabled.
4. **Acceptance coverage gap** — set_active legacy-`name` acceptance is tested for `get` but not for `set_active`; and item 8 (exportSkill rejects knowledge id) has no explicit machine-check (only the indirect “export 不是 skill YAML” check).
5. **F-S-8/14 update-keeps-secrets** — defensible (user's own note; injection path still sanitizes; hit count surfaced in confirm copy) but worth a one-line rationale in the impl plan so a future reviewer doesn't flag it as an exfil regression.

The spec is implementable as written: payloads/responses fully specified (§3), machine-checkable acceptance (§5), real file map (§6), no schema invention required.

VERDICT: APPROVE_WITH_NITS
