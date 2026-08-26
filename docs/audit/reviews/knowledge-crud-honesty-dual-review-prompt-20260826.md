# Dual external review: Knowledge CRUD Honesty (design SoT)

**Batch:** `knowledge-crud-honesty`  
**Stage:** Design SoT — **pre-implementation**; dual-review of the **post-adversary spec**, not a code PR  
**Date:** 2026-08-26  
**Blast tier:** T0 docs today; Wave 3 impl would be T2 Compose / L0 Surface

## Capability declaration (if later landed)

```text
Surface:      L0 Side Panel knowledge sheet (reader + card/body save + Blob download)
L2-classes:   (none)
Compose:      existing knowledge markdown + SkillEngine; no new SoT
Autonomy:     n/a
Trust:        no elevation; knowledge remains untrusted retrieved data;
              overlay ACL does not grow (including knowledge.get)
Channel:      community | enterprise unchanged
```

## Required reading (order)

1. **Primary SoT (under review)** — `docs/superpowers/specs/2026-08-26-knowledge-crud-honesty-design.md`
2. **Adversary merge** — `docs/audit/reviews/knowledge-crud-honesty-adversary-synthesis-20260826.md`
3. **Must not contradict without explicit override**
   - `docs/superpowers/specs/2026-08-25-daily-assistant-knowledge-honesty-design.md` (LOCKED; F-E-3, F-UX-NOUN-1, F-S-5, F-I-1/2)
   - `docs/adr/020-capability-model-three-axes.md`
   - `docs/adr/008-obsidian-export.md` (Blob; companion does not write vault)
   - `docs/archive/2026-07/proposals/knowledge-mgmt-proposal/final-design.md` (conservative won; graph lost)
   - `docs/superpowers/specs/2026-08-11-thread-history-ia-gap-optimization-adversarial.md` (empty-shell; E1–E3 no llm_wiki)
   - `docs/superpowers/specs/2026-08-11-thread-graph-obsidian-view-design.md` (SESSION graph ≠ knowledge)
4. **Spot-check code claims**
   - `companion/src/skills/skill-engine.ts` `listKnowledge` (no body; currently ships `source_file`/`entries`)
   - `companion/src/message-router.ts` knowledge cases (no get/update/export today)
   - `companion/src/ws/validate.ts` `knowledge.delete` requires `id`; `knowledge.import_directory` requires `path`
   - `chrome-extension/src/sidepanel/components/KnowledgeSubPanel.tsx` delete sends `name`; import_directory sends `user_gesture` only; related behind a button
   - `companion/src/ws/summoner-acl.ts` / `summoner-web.ts` — only `knowledge.list` + `knowledge.set_active`
   - `companion/src/skills/knowledge-related.ts` cap 3; title/description/tags only
   - `chrome-extension/src/sidepanel/components/ChatView.tsx` 本轮附带 → `cmspark:open-knowledge` (list focus today)
5. ADR-020 checklist — `docs/audit/reviews/_templates/dual-review-capability-checklist.md`

## Premise (must not weaken without REJECT)

```text
1. KEEP Honesty NEVER: no knowledge graph UI, no 双链, no persisted related edges,
   no embedding/graph DB, no Project, no overlay knowledge admin, no auto-ingest.
2. F-S-5 is not “no write verbs”: knowledge.get (full body) is also denied on overlay.
3. Update is in-place (same id/filenameStem), not delete+import / importKnowledge.
4. Export is browser Blob markdown, not Obsidian vault write, not ADR-008 wikilinks.
5. Wave 3 is one family: reader + clickable related≤3 + confirm save + download
   + fix delete id / import_directory validate / set_active key. Shipping related
   chrome without a reader is an empty shell (REJECT).
6. Editor chrome is one sheet + textarea/pre, not a wiki IDE.
7. Code-fact claims in spec/synthesis must survive Read/Grep. Over-claim → REJECT.
```

## Your job

Independent **product + architecture + security + factual accuracy** review of the **design document**. Confirm or reject the **adversary synthesis**, not the original strawman.

### Must answer

1. **Factual**: Are these true? (a) no `knowledge.get/update/export` today; (b) `listKnowledge` has no body; (c) delete UI sends `name` while validate requires `id`; (d) overlay allowlist is list+set_active only; (e) related is click-gated and titles are not buttons; (f) `import_directory` validate requires `path` but UI does not send it.
2. **Honesty locks**: Did Wave 3 smuggle graph / ontology / overlay get / vault write / live-preview wiki, including via copy?
3. **Empty-shell**: If related chips ship without get+reader, would that repeat ThreadDigest Tags?
4. **Identity**: Does in-place update actually preserve `active_knowledge_ids` for CJK `k-*` ids?
5. **Trust**: Are F-S-11..16 adequate (gesture, allowlist, overlay get deny, redact on export, no HTML sink)?
6. **ADR-020**: New primary chrome / runtime / Trust elevation?
7. **Implementability**: Closed enough to open a Wave 3 impl plan without inventing schema?

### Rejection gates (any → VERDICT: REJECT)

| # | Gate |
|---|------|
| R1 | Spec/synthesis claims code facts that are **false** on spot-check (major) |
| R2 | Re-introduces knowledge graph DB/UI, default embedding, Project, or remote KB as in-scope |
| R3 | Overlay ACL grows (`knowledge.get/update/export/related` or HTML `/api/knowledge/get`) |
| R4 | Companion writes vault/host path, or knowledge export reuses ADR-008 wikilinks as product |
| R5 | Knowledge update elevates Trust / auto_approve / auto-injects without mode rules |
| R6 | Wiki IDE: split-pane preview, mermaid-in-editor, `[[wikilink]]` product, entity pages |
| R7 | Wave 3 omits reader/`knowledge.get` while claiming to fix “看不到关联” via related chrome only |
| R8 | Auto-ingest chats; or update reallocates id via `importKnowledge` as the specified path |
| R9 | Weakens F-UX-NOUN-1 (图谱/双链 in this panel) |

### Non-blocking nits (examples)

- 512KiB export refuse vs truncate  
- Whether overlay list includes related titles  
- last-write-wins vs if-match  
- Effort estimates  
- Whether to keep `knowledge.related` after list embeds related  

### Output

Findings with file:line. Then **exactly one** final line:

VERDICT: APPROVE  
or  
VERDICT: APPROVE_WITH_NITS  
or  
VERDICT: REJECT
