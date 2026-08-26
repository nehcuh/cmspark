# Knowledge CRUD Honesty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Side Panel can open, confirm-save, and Blob-download a knowledge doc; list shows clickable related≤3; overlay ACL does not grow; Honesty graph locks stay.

**Architecture:** SkillEngine in-place get/update/export (same `filenameStem`); thin `message-router/handlers/knowledge.ts` for new verbs + existing knowledge cases stay lockstep with `validate.ts`; Side Panel sheet reuses modal chrome (`<pre>`/`<textarea>`). Overlay list strips `related`.

**Tech Stack:** Companion TypeScript + node:test; Chrome extension React Side Panel; existing `writeRestrictedFile` / `redactSecrets` / `findRelatedKnowledge`.

**Spec:** `docs/superpowers/specs/2026-08-26-knowledge-crud-honesty-design.md`  
**Dual:** both AWN `knowledge-crud-honesty-verdict-20260826-111617` (nits folded)

---

### Task 1: Engine get / update / export / slim list

**Files:**
- Modify: `companion/src/skills/skill-engine.ts`
- Modify: `companion/src/skills/knowledge-related.ts` (`attachRelatedTitles`)
- Test: `companion/tests/knowledge-crud.test.ts`

- [ ] Failing tests: CJK title update keeps id; list has no `source_file`; exportSkill rejects knowledge; get truncates 512KiB; builtin update throws
- [ ] Implement `getKnowledge` / `updateKnowledge` / `exportKnowledge`; slim `listKnowledge`; `exportSkill` refuse knowledge
- [ ] `npm --prefix companion test -- tests/knowledge-crud.test.ts tests/skill-engine.test.ts tests/knowledge-related.test.ts`

### Task 2: Validate + router + ACL

**Files:**
- Create: `companion/src/message-router/handlers/knowledge.ts` (get/update/export + slim-list related attach)
- Modify: `companion/src/ws/validate.ts` (get/update/export; delete gesture; import_directory no path)
- Modify: `companion/src/message-router.ts` thin cases
- Modify: `companion/src/summoner-web.ts` strip related on list
- Modify: `companion/tests/summoner-web.test.ts` / `summoner-acl.test.ts`
- Test: `companion/tests/knowledge-crud-ws.test.ts`

- [ ] Tests: overlay deny get/update/export; delete requires id+gesture; set_active by id; summoner list has no related
- [ ] Implement handlers
- [ ] `npm --prefix companion test -- tests/knowledge-crud-ws.test.ts tests/ws-router-validator-lockstep.test.ts tests/summoner-web.test.ts tests/summoner-acl.test.ts`

### Task 3: Side Panel sheet + relay

**Files:**
- Modify: `chrome-extension/src/background/index.ts`
- Modify: `chrome-extension/src/sidepanel/hooks/useWebSocket.ts`
- Modify: `chrome-extension/src/sidepanel/types.ts`
- Modify: `chrome-extension/src/sidepanel/store/agentStore.tsx`
- Modify: `chrome-extension/src/sidepanel/components/KnowledgeSubPanel.tsx`
- Modify: `chrome-extension/src/sidepanel/components/ChatView.tsx` / `ContextPanelHost.tsx`

- [ ] Row click / 本轮附带 → `knowledge.get` sheet
- [ ] Save + `user_gesture`; 下载 .md Blob; tags + related chips; delete by id
- [ ] Copy scan: no 图谱/双链/Obsidian on this panel
- [ ] `npm --prefix chrome-extension test`

### Task 4: Copy + docs + eval card

- [ ] README knowledge 节补查看/下载（不叫图谱）
- [ ] Eval gate card in closeout comment; machine tests green
