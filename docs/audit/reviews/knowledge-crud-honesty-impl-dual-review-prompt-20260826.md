# Dual external review: Knowledge CRUD Honesty (Wave 3 **implementation**)

**Batch:** `knowledge-crud-honesty-impl`  
**Stage:** Implementation — dual-review of **staged Wave 3 code**, not the design strawman  
**Date:** 2026-08-26  
**Blast tier:** T2 (L0 Compose; no new L2; overlay ACL must not grow)

## Capability declaration

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

1. **Locked spec** — `docs/superpowers/specs/2026-08-26-knowledge-crud-honesty-design.md`
2. **Design dual (already both AWN)** — `docs/audit/reviews/knowledge-crud-honesty-verdict-20260826-111617.json`
3. **This diff** (staged) — engine get/update/export, handlers, validate, Side Panel sheet
4. Spot-check:
   - `companion/src/skills/skill-engine.ts` `getKnowledge` / `updateKnowledge` / `exportKnowledge` / slim `listKnowledge`
   - `companion/src/message-router/handlers/knowledge.ts`
   - `companion/src/ws/validate.ts` get/update/export/delete/import_directory
   - `companion/src/ws/summoner-acl.ts` / `summoner-web.ts` (must still list+set_active only)
   - `chrome-extension/src/sidepanel/components/KnowledgeSubPanel.tsx`
   - `companion/tests/knowledge-crud.test.ts` · `knowledge-crud-ws.test.ts` · `summoner-web.test.ts`

## Independent adversary (must read)

`docs/audit/reviews/knowledge-crud-honesty-impl-adversary-20260826.md`

Initial **REJECT** (README 禁词、update 塌缩 legacy name、router 无 `user_gesture` belt). All three folded + tests added. Remaining nits listed in that file.

## Machine (this session)

- companion: `tsc -p tsconfig.test.json` + targeted node --test knowledge-crud / knowledge-related / summoner-acl / lockstep / files.test — pass (87 after fold)
- chrome-extension: `npx tsc --noEmit` pass; `npm test` 819/819 pass (pre-fold UI; save confirm is a one-liner)

Re-run anything you doubt. False green in the prompt → REJECT.

## Premise (any break → REJECT)

```text
1. No knowledge graph UI / 双链 / persisted edges / embedding.
2. Overlay ACL does not gain knowledge.get/update/export (F-S-5 includes GET).
3. update is in-place (same id/filenameStem), not importKnowledge/allocateDocIdentity.
4. Export is Blob markdown + redactSecrets; companion does not write vault.
5. Editor is one sheet + textarea/pre; no HTML sink / mermaid / live preview.
6. knowledge.delete UI+validate+router use id + user_gesture.
7. import_directory validate does not require client path.
8. summoner knowledge.list has no related[]; Side Panel list may.
9. Copy in KnowledgeSubPanel must not add 图谱/双链/会话关系图.
```

## Must answer

1. Do overlay allowlists still exclude get/update/export? Tests lock `has(...)===false`?
2. CJK title update keeps id (test exists and implementation matches)?
3. `exportSkill` rejects knowledge ids and vice versa?
4. Get body is raw (editor) and not injected to the model from this verb?
5. Any XSS (`dangerouslySetInnerHTML` on knowledge body)?
6. Diff scope — drive-by outside knowledge CRUD?

## Rejection gates

| # | Gate |
|---|------|
| R1 | Overlay ACL grows (get/update/export on SUMMONER_ALLOW or HTML dispatch) |
| R2 | Graph/ontology/Project/embedding/vault write introduced |
| R3 | update reallocates id via importKnowledge |
| R4 | HTML-rendered untrusted knowledge body |
| R5 | Companion writes host/vault path on export |
| R6 | Major false code claims vs this diff |
| R7 | Related-only chrome without reader (empty shell) |

Nits: leftover `knowledge.related` button (should be gone), 512KiB UX, last-write-wins.

## Output

Findings with file:line. Final line exactly:

VERDICT: APPROVE  
or  
VERDICT: APPROVE_WITH_NITS  
or  
VERDICT: REJECT
