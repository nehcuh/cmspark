All checks complete. The patch is confirmed current (3 new doc files, 383 insertions, matches HEAD `a64744b` — not stale; code untouched).

## Review findings

### Q1 — Factual claims: **all six CONFIRMED by grep/read**

| Claim | Evidence |
|---|---|
| (a) no `knowledge.get/update/export` today | Zero hits across `companion/src/` + `chrome-extension/src/` (src and tests). Router knowledge cases are only `related/list/set_active/preview/import/import_directory/delete` (`message-router.ts:2008,2613,2616,2632,2638,2661,2772`) |
| (b) `listKnowledge` ships no body but sends `source_file`/`entries`/`dir`/`resources` | `skill-engine.ts:1339-1353` — exactly as claimed |
| (c) delete UI sends `name`, validate requires `id` | `validate.ts:1094-1098` requires `id`; `KnowledgeSubPanel.tsx:98` sends `{type:"knowledge.delete", name}`; router also deletes by `rest.name` (`message-router.ts:2772-2774`). Today this is actually **broken** on the WS path (validation rejects the name-only payload) — the Wave 3 fix is necessary, not cosmetic |
| (d) overlay allowlist = list + set_active only | `summoner-acl.ts:41-42`, `summoner-web.ts:36-37`; HTML routes only `/api/knowledge` (GET→list) and `/api/knowledge/active` (POST). No get/update/export HTML route |
| (e) related click-gated, titles not buttons | `KnowledgeSubPanel.tsx:579-583` renders related as joined plain text; the query sits behind a per-row "相关" button (`:585-593`) |
| (f) `import_directory` validate requires `path`, UI omits it | `validate.ts:1088-1093`; `KnowledgeSubPanel.tsx:306` sends only `user_gesture:true` — also currently broken on WS path |

Supporting: `get()` matches id + legacy name (`skill-engine.ts:359`); `set_active` known-set includes both (`message-router.ts:2626`); `knowledge-related.ts` cap `KNOWLEDGE_RELATED_LIMIT=3` on title/description/tags only; `exportSkill` (`skill-engine.ts:855`), `writeRestrictedFile`/`nfc`/`isUnsafePathComponent`/`isSymlinkOrJunction` (`doc-identity.ts:23-144`), `redactSecrets` with `hits` (`distill.ts:24`) all exist; `cmspark:open-knowledge` dispatches from `ChatView.tsx:799` and today lands on `scrollIntoView` (`KnowledgeSubPanel.tsx:60`) — confirming "list focus today".

### Q2 — Honesty locks: **no smuggling.** R2/R3/R4/R5/R6/R8/R9 all clear
- Graph/embedding/Project/remote KB/ontology: explicit NO-GO in §0, §2.4 (F-E-3/10/11), and the "不在本 Wave" list; related stays query-time ≤3, no persisted edges.
- Overlay ACL: F-S-5/11 + F-UX-OVERLAY-1 + §3 lock get/update/export out of summoner/HTML/MCP/`getToolDefinitions` (which today has **zero** knowledge verbs — verified). New verbs follow the existing router extra-deny pattern (`message-router.ts:2640,2663`).
- Vault write / ADR-008: export is Blob-only, "不套 ADR-008 wikilinks" — consistent with ADR-008's own "companion 不写宿主" (`docs/adr/008-obsidian-export.md:16`).
- Wiki IDE: one sheet + `<pre>`/`<textarea>`, no split preview / mermaid / `dangerouslySetInnerHTML` (F-UX-SHEET-2).
- F-UX-NOUN-1: **strengthened**, not weakened — the forbidden list is expanded (类 Obsidian、导出到 Obsidian、孤立点、节点/边、相关网络); the ban is scoped to user-visible copy, so the design doc's own use of 图谱/双链 to *state* the ban is legitimate (same as the locked doc). Copy-scan is an explicit acceptance item (#10).

### Q3 — Empty-shell: **not repeated.** The design treats reader+get as P0 (Wave 3 item 5), makes the family indivisible ("同 PR 家族…不可只交一半"), and names the empty shell as a failure mode. ThreadDigest-Tags precedent is explicitly cited in the locked doc (`2026-08-25…:52`) and avoided.

### Q4 — Identity: **sound.** Banning `importKnowledge`/`allocateDocIdentity` on update is correct — `collectTakenStems` + `allocateDocIdentity` (`skill-engine.ts:1401-1415`) would reallocate a stem on a CJK title change (→ `notes-2` + dangling `active_knowledge_ids`). The acceptance criteria pin the outcome ("update 改 CJK title：id 与 filename 不变；active_knowledge_ids 仍 resolve"), and both `get()` and `set_active` resolve by id **or** name, so the preserved id stays resolvable.

### Q5 — Trust: **adequate.** Gesture at validate+router (F-S-3/13); allowlist + wildcard + builtin-reject on update (F-S-4/12); overlay deny incl. get (F-S-5/11); `redactSecrets` with `redacted_hits` on export + no silent body-strip on update (F-S-8/14); no HTML sink (F-S-15); 6MiB/512KiB caps (F-S-16). `get` returns raw body only to the user's own Side Panel, never model context — consistent with untrusted-data posture.

### Q6 — ADR-020: **clean.** Declaration present in both prompt and spec (L0 / no L2 / Compose knowledge+SkillEngine / Autonomy n/a / Trust no elevation / Channel unchanged). Correctly on the Composition axis (not "中层 Agent"); no new primary chrome (F-UX-SHEET-1 reuses Modal); no new confirm family; no new runtime; no `securityConfirmations.request` (originWs N/A — `user_gesture` follows the existing import pattern).

### Q7 — Implementability: **closed enough.** Full request/response protocol (§3), 10 enumerated Wave 3 items, machine-checkable acceptance, file touchpoints, no new schema/SoT. Open questions explicitly de-locked.

### Nits (non-blocking)
1. Spec §0 "GO as Wave 2 发现性" vs §5 "Wave 3" — family naming inconsistent (Wave 2 = related algorithm, already landed; this family is Wave 3). `…-design.md:18`
2. F-S-4/12 mentions update validating `site` wildcard, but F-I-8 + update protocol (`title?/tags?/description?/body?` only) forbid site changes in v1 — clarify "reject" vs "validate-and-drop" (safe either way). `…-design.md:59`
3. §3 update response "→ { id, title } + 随后 knowledge.list（瘦）" is ambiguous — server-emitted list vs client refetch. `…-design.md:87`
4. F-E-8 "原样 markdown Blob" vs F-S-8/14 redaction + acceptance "保留 id/title" — "原样" mildly contradicts redaction; pin export = raw file minus redacted secrets, frontmatter preserved. `…-design.md:72,90,133`
5. Open Q2 (overlay list carrying related titles) should be decided before impl; the fallback (get-only related) is already specified.
6. Spec §6 lists `ws/summoner-web.ts`; actual path is `companion/src/summoner-web.ts` (same imprecision in the review prompt). Cosmetic.
7. 512KiB export-refuse (open Q1, locked to refuse) — acceptable as flagged.

VERDICT: APPROVE_WITH_NITS
