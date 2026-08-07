# Wave A: Scene Knowledge + active_knowledge_ids — Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax.  
> **Parent SoT:** `docs/superpowers/specs/2026-08-07-context-memory-thinking-knowledge-adversarial-analysis.md` Wave A  
> **Workflow gates:** Plan dual → implement → impl dual → only then Wave B  
> **Adversarial lock (pre-plan):** use independent `active_knowledge_ids` (not overload `active_skill_ids`)

**Goal:** User scenes can select global/site knowledge docs; apply/unapply persists activation; fix orphaned UI `active_knowledge_ids` so manual knowledge selection actually drives LLM injection.

**Architecture:** Knowledge activation becomes a first-class thread field `active_knowledge_ids` (UI already sends it; companion resolve currently ignores it). User packs store `knowledge_refs: string[]` parallel to `skill_refs`. Pack-local knowledge files keep installing under `knowledge/global` with namespaced names; apply unions installed knowledge ids + refs into `active_knowledge_ids` and sets `knowledge_selection_mode: manual` (default). Trust untouched.

**Tech Stack:** companion TypeScript, chrome-extension React PacksPanel, node:test

---

## Capability declaration

```text
Surface:      L0 (scene editor UI only)
L2-classes:   (none)
Compose:      knowledge + pack
Autonomy:     n/a
Trust:        no elevation
Channel:      community | enterprise unchanged
```

## Locked decisions

| ID | Decision |
|----|----------|
| D1 | **`active_knowledge_ids: string[]`** on Thread (independent of skills) |
| D2 | Back-compat: resolve = `active_knowledge_ids` ∪ (knowledge-typed names still in `active_skill_ids`); **one release**; mark `// TODO(wave-a-d2): remove skill-path knowledge union after 1 release` |
| D3 | User pack: **`knowledge_refs: string[]`** (global names); not file paths in `knowledge:` |
| D4 | Builtin/file `knowledge:` still installs files; apply activates **namespaced** knowledge ids |
| D5 | apply default mode: `knowledge_selection_mode: manual` (thread_defaults or default) |
| D6 | Snapshot/restore includes `active_knowledge_ids` |
| D7 | No Trust / no auto_approve changes |
| D8 | **Apply replace (not union with pre-apply user selection)** when pack has non-empty knowledge_refs ∪ installed knowledge — **symmetric with skill_refs** (`pack-engine.ts` skill path). Parent analysis §4.4 "∪ 用户已选" **superseded** for apply; unapply restores snapshot. Empty pack knowledge → **preserve** baseSnap (asymmetric with "explicit clear"; packs cannot clear knowledge via empty refs — intentional, document in code comment). |
| D9 | `thread.update` WS allowlist **must** include `active_knowledge_ids` (`message-router.ts`) — without this, UI toggle is dead |

---

## File map

| File | Change |
|------|--------|
| `companion/src/threads/thread-manager.ts` | Thread field + validation + create default `[]` |
| `companion/src/skills/skill-engine.ts` | `getActiveKnowledgeForThread` / resolve use new field |
| `companion/src/packs/types.ts` | `knowledge_refs`, snapshot, UserPackSaveInput, PackDetail |
| `companion/src/packs/validator.ts` | optional parse knowledge_refs (string[]) |
| `companion/src/packs/pack-engine.ts` | install return knowledge ids; apply; saveUserPack; getPack; snapshot |
| `companion/src/packs/suggest-scene.ts` | optional recommend knowledge_ids (nice-to-have) |
| **`companion/src/message-router.ts`** | **`thread.update` allowlist + `active_knowledge_ids`**（G1 dual B1 — 今日 orphan 根因） |
| `chrome-extension/.../PacksPanel.tsx` | multi-select knowledge |
| `chrome-extension/.../agentStore.tsx` | hydrate activeKnowledgeIds from thread |
| `chrome-extension/src/sidepanel/types.ts` | Thread.`active_knowledge_ids?: string[]` |
| `companion/tests/packs-engine.test.ts` | apply knowledge activation + restore |
| `companion/tests/knowledge-active-ids.test.ts` | resolve + D2 back-compat + auto mode |
| Router test (extend existing or packs) | thread.update allowlist passes knowledge ids |

---

### Task 1: Thread + resolve (TDD)

**Files:**
- Modify: `companion/src/threads/thread-manager.ts`
- Modify: `companion/src/skills/skill-engine.ts`
- Test: `companion/tests/knowledge-active-ids.test.ts` (create)

- [ ] **Step 1: Failing test** — resolve manual returns `active_knowledge_ids` only (not skills)

```typescript
// knowledge-active-ids.test.ts sketch
test("resolveKnowledgeIdsForThread manual uses active_knowledge_ids", () => {
  // seed a knowledge doc on disk under knowledge/global
  // thread.active_knowledge_ids = [docName]
  // mode manual → resolve includes docName
  // empty active_knowledge_ids → []
})
```

- [ ] **Step 2: Implement Thread field**

```typescript
// Thread interface
active_knowledge_ids?: string[]  // default [] on create

// create():
active_knowledge_ids: [],

// update() validate:
if (updates.active_knowledge_ids !== undefined) {
  if (!Array.isArray(updates.active_knowledge_ids) ||
      !updates.active_knowledge_ids.every((s: any) => typeof s === "string")) {
    throw new Error("active_knowledge_ids must be an array of strings")
  }
}
```

- [ ] **Step 3: skill-engine resolve**

```typescript
getActiveKnowledgeForThread(threadId: string): Skill[] {
  this.ensureFresh()
  let ids: string[] = []
  try {
    const tm = new ThreadManager()
    const thread = tm.get(threadId)
    ids = Array.isArray(thread?.active_knowledge_ids) ? [...thread.active_knowledge_ids] : []
    // TODO(wave-a-d2): remove skill-path knowledge union after 1 release
    const skillActive = thread?.active_skill_ids || []
    for (const name of skillActive) {
      const s = this.get(name)
      if (s && this.isKnowledgeDoc(s) && !ids.includes(name)) ids.push(name)
    }
  } catch { /* empty */ }
  // Final map: only knowledge docs (stale id → skill name must not inject as knowledge)
  return ids
    .map((n) => this.get(n))
    .filter((s): s is Skill => !!s && this.isKnowledgeDoc(s))
}
```

- [ ] **Step 4: Tests** — manual; auto (+ site); D2 legacy in active_skill_ids  
- [ ] **Step 5: Tests pass**

---

### Task 2: Pack snapshot + apply knowledge activation

**Files:**
- Modify: `companion/src/packs/types.ts`
- Modify: `companion/src/packs/pack-engine.ts`
- Modify: `companion/src/packs/validator.ts` (knowledge_refs optional)
- Modify: `companion/src/threads/thread-manager.ts` applyPackPatch
- Test: extend `companion/tests/packs-engine.test.ts`

- [ ] **Step 1: Types**

```typescript
// PackManifest
knowledge_refs?: string[]  // global knowledge names

// ThreadPackSnapshot + PackApplyPatch
active_knowledge_ids: string[]

// UserPackSaveInput
knowledge_ids?: string[]

// PackDetail
knowledge_refs?: string[]
installed_knowledge_ids?: string[]
```

- [ ] **Step 2: installAssetsFromValidated returns knowledge ids**

```typescript
function installAssetsFromValidated(...): { skillIds: string[]; knowledgeIds: string[] } {
  const knowledgeIds: string[] = []
  // ... existing skill loop ...
  for (const abs of knowledgeAbs) {
    const orig = extractFrontmatterName(abs)
    const ns = skillId(manifest.id, orig)
    // copy...
    knowledgeIds.push(ns)
  }
  return { skillIds, knowledgeIds }
}
```

Update all call sites (installPack, applyPack).

- [ ] **Step 3: applyPack sets active_knowledge_ids**

```typescript
const knownK = new Set(skillEngine.listKnowledge().map((k) => k.name))
const refs = (result.manifest.knowledge_refs || []).filter((id) => knownK.has(id))
const packKnowledge = [...new Set([...knowledgeIds, ...refs])]
// D8: non-empty pack knowledge → REPLACE (like skill_refs). Empty → preserve baseSnap
// (cannot explicit-clear via empty knowledge_refs; intentional asymmetry with skills).
const activeKnowledgeIds =
  packKnowledge.length > 0
    ? packKnowledge
    : Array.isArray(baseSnap.active_knowledge_ids)
      ? [...baseSnap.active_knowledge_ids]
      : []

threadManager.applyPackPatch(threadId, {
  // ...existing...
  active_skill_ids: activeSkillIds,
  active_knowledge_ids: activeKnowledgeIds,
  knowledge_selection_mode: td.knowledge_selection_mode || "manual",
})
```

Note: `installAssetsFromValidated` shape change is **load-bearing only for applyPack**. installPack call sites (`:1106`, `:1117`) may ignore return; only applyPack consumes `{ skillIds, knowledgeIds }`.

- [ ] **Step 4: snapshotFromThread / restoreSnapshot include active_knowledge_ids**

- [ ] **Step 5: saveUserPack**

```typescript
const knowledgeIds = Array.isArray(input.knowledge_ids)
  ? input.knowledge_ids.filter(...).map(trim)
  : []
// manifestDoc:
knowledge: [],
knowledge_refs: knowledgeIds,
```

Preserve knowledge_refs on update when input.knowledge_ids omitted (mirror skill_ids behavior if skills use omit=preserve — check skill_ids: currently always rewrite from input array). Match skill_ids: always write provided array (UI always sends).

- [ ] **Step 6: getPackDetail** expose knowledge_refs + installed_knowledge_ids (scan installed ns knowledge files)

- [ ] **Step 7: Tests**

```typescript
test("apply pack with knowledge file activates active_knowledge_ids", () => {
  // mini pack with knowledge md
  // apply → thread.active_knowledge_ids includes pack--id--name
  // resolve manual includes it
  // unapply → restored
})
```

---

### Task 3: PacksPanel UI

**Files:**
- Modify: `chrome-extension/src/sidepanel/components/PacksPanel.tsx`
- Modify: `chrome-extension/src/sidepanel/store/agentStore.tsx` (hydrate)
- Modify: `chrome-extension/src/sidepanel/types.ts` if Thread type lacks field

- [ ] **Step 1: Editor state** `knowledge_ids: string[]`
- [ ] **Step 2: On pack.get / clone** load knowledge_refs ∪ installed_knowledge_ids
- [ ] **Step 3: Multi-select** from `state.knowledgeDocs` (or fetch knowledge.list)
- [ ] **Step 4: save payload** `knowledge_ids: editor.knowledge_ids`
- [ ] **Step 5: agentStore** on SET_THREADS / SET_ACTIVE_THREAD:

```typescript
activeKnowledgeIds: activeThread?.active_knowledge_ids || []
```

Ensure Thread type includes `active_knowledge_ids?: string[]`.

- [ ] **Step 6: Copy** PacksPanel zone text: 「用户场景可配置 system prompt、技能、知识库与 MCP」

---

### Task 4: message-router allowlist + save_user wire (**G1 dual B1 — blocking**)

**Files:**
- Modify: `companion/src/message-router.ts` (~1617–1630 `thread.update` allowlist)
- Modify: `companion/src/message-router.ts` `pack.save_user` / `saveUserPack` input
- Test: assert allowlist passes `active_knowledge_ids` (unit or integration)

**Root cause (verified dual REJECT):**  
`KnowledgeSubPanel` sends `thread.update` with `active_knowledge_ids`, but the WS handler **hard-coded allowlist** drops unknown keys **before** `threadManager.update`. Adding Thread validation alone is **not enough**.

- [ ] **Step 1: Add to allowlist**

```typescript
// message-router.ts thread.update allowed keys — ADD:
"active_knowledge_ids",
// existing includes active_skill_ids, knowledge_selection_mode, ...
```

- [ ] **Step 2: saveUserPack RPC** — pass `knowledge_ids` from client body into `saveUserPack({ ..., knowledge_ids })`

- [ ] **Step 3: Test** — simulate/filter allowlist or call handler path: updates with `active_knowledge_ids: ["doc-a"]` persist on thread after update

- [ ] **Step 4: Manual criterion** — KnowledgeSubPanel toggle → reload thread.list → id still present → chat resolve manual includes id

---

### Task 5: Verify + dual gate

- [ ] `npm --prefix companion test` (or targeted packs + knowledge tests)
- [ ] Typecheck if project uses it
- [ ] Write dual-review prompt for Wave A impl
- [ ] `scripts/dual-external-review.sh wave-a-scene-knowledge <prompt> HEAD`
- [ ] Fold nits or fix REJECT; only then Wave B

---

## Explicit non-goals (Wave A)

- H1 ThreadHandoff / M2 changes
- Embedding / thread_recall
- Changing Trust recipes
- Auto-writing knowledge from chat
- AI suggest knowledge_ids (optional stretch; skip if time)

---

## Success criteria

1. Manual toggle in KnowledgeSubPanel persists and injects on next chat  
2. User scene can select knowledge → save → apply → `active_knowledge_ids` set → chat injects  
3. Unapply restores prior knowledge ids  
4. Builtin pack with knowledge files activates namespaced ids on apply  
5. dual APPROVE*

---

## Workflow log

| Gate | What | Status |
|------|------|--------|
| G0 | Analysis dual | DONE APPROVE_WITH_NITS |
| G1 | **This plan** dual | **REJECT×2** then **r2 both APPROVE_WITH_NITS** (`wave-a-scene-knowledge-plan-r2-verdict-20260807-102424`) |
| G2 | Wave A implementation dual | **both APPROVE_WITH_NITS** (`wave-a-scene-knowledge-impl-verdict-20260807-103512`) · tests 6+33 green |
| G3 | Wave B plan dual | **ready to start** |

## G1 dual nits absorbed

| Source | Item | Disposition |
|--------|------|-------------|
| Claude+Pi B1 | message-router allowlist missing | **Task 4 explicit** |
| Claude N1 | install return only load-bearing on apply | noted |
| Claude N2 / Pi | D2 one-release | TODO comment + D2 |
| Claude N3 | tests for auto + D2 | Task 1 Step 4 |
| Claude N4 | union vs replace | **D8 replace** (skill-symmetric); analysis wording superseded |
| Claude N5 | Thread type file | `types.ts` pinned |
| Pi | isKnowledgeDoc on final map | in resolve sketch |
| Pi | empty cannot clear | D8 comment |
| Pi | router test | Task 4 Step 3 |
