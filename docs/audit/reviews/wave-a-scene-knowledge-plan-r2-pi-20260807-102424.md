## Review: Wave A Scene Knowledge plan (R2)

### Diff status

The patch file contains only the batch context header — no code diff, because the plan (`docs/superpowers/plans/2026-08-07-wave-a-scene-knowledge.md`) is untracked against HEAD `5a401f1` and `git diff` produced nothing. `git status` confirms this is a pre-code plan gate (all review artifacts untracked, no staged/committed code). The plan file itself is the artifact under review, so I grounded every claim in it against the live repo.

### B1 fix — VERIFIED (R1 clear)

- `message-router.ts:1618–1629` still hard-codes the 10-key `thread.update` allowlist; `active_knowledge_ids` is **absent** today, and `KnowledgeSubPanel.tsx:484` sends exactly that key — the orphan root cause is real.
- The patched plan fixes it: locked decision **D9** ("`thread.update` WS allowlist **must** include `active_knowledge_ids`"), file-map row for `message-router.ts` (**"thread.update allowlist + active_knowledge_ids（G1 dual B1 — 今日 orphan 根因）"**), and **Task 4 Step 1** adds the key with Step 3 (router test) + Step 4 (manual end-to-end criterion: toggle → reload → id persists → resolve manual includes it). The prior false claim ("already Object.assign's") is gone, replaced by a correct root-cause statement ("allowlist drops unknown keys **before** `threadManager.update`").
- **R2 clear:** Task 4 Step 4 closes the manual KnowledgeSubPanel path end-to-end.

### Code-grounding — all file:line claims check out (R4 clear)

| Plan claim | Verified |
|---|---|
| No `active_knowledge_ids` on Thread; `applyPackPatch` validates skill ids only | `thread-manager.ts:17–19, 605–695` |
| `getActiveKnowledgeForThread` / `resolveKnowledgeIdsForThread` exist | `skill-engine.ts:496, 505`; manual/auto/all modes at 508–525 |
| `installAssetsFromValidated` returns skill ids only, drops knowledge names; call sites 1106/1117/1424, only applyPack consumes | `pack-engine.ts:642–666, 1106, 1117, 1424` |
| `saveUserPack` writes `knowledge: []`, no `knowledge_refs` | `pack-engine.ts:951–952` |
| Snapshot/restore lack `active_knowledge_ids` | `pack-engine.ts:1229–1261` |
| `pack.save_user` handler doesn't pass `knowledge_ids` | `message-router.ts:2516–2532` |
| UI sends `active_knowledge_ids` via `thread.update` | `KnowledgeSubPanel.tsx:484` |
| agentStore declares field but never hydrates from thread; sidepanel Thread type lacks field | `agentStore.tsx:41,275,603`; `types.ts` grep empty |
| PacksPanel has no knowledge selector; validator parses `skill_refs` only | grep results |
| `listKnowledge()` / `isKnowledgeDoc()` exist | `skill-engine.ts:175, 1092` |

### D8 coherence (must-confirm 3)

Knowledge path `packKnowledge.length > 0 ? packKnowledge : baseSnap.active_knowledge_ids` mirrors the skill fallback at `pack-engine.ts:1457–1464` (`skill_refs === undefined && skillIds.length === 0 → baseSnap`). The explicit-clear asymmetry (empty pack knowledge cannot clear) is documented as intentional in D8 with a code-comment instruction — coherent, not a silent deviation.

### ADR-020 / Trust (R3 clear, checklist applied)

Capability declaration present and accurate: Surface L0, L2-classes none, Compose knowledge+pack, Autonomy n/a, Trust no elevation, Channel unchanged. No new runtime, no `request()`/`originWs` surface, no Trust or auto_approve touch (D7), pack-first via existing PacksPanel editor, no "中层 Agent" language, trust monotonicity intact. Checklist passes.

### Nits (non-blocking)

1. **Task 4 Step 3 test wording is loose** — "simulate/filter allowlist or call handler path" should be pinned to a concrete form (e.g., invoke the `thread.update` case with a stub `threadManager` and assert the key survives into `allowedUpdates`). This is the exact regression that REJECTed twice; the test deserves a precise shape.
2. **D2 one-release union has a TODO marker but no scheduled cleanup task** in any later wave — acceptable for Wave A, but Wave B/C should carry the removal test so it isn't forgotten.
3. **Task 2 Step 5 defers a check** ("check skill_ids: currently always rewrite from input array") — I verified `saveUserPack` always writes `skill_refs` from the input array (`pack-engine.ts:951`); state it as fact so the implementer doesn't invent an omit=preserve branch.
4. **Task 2 Step 6 `getPackDetail` installed_knowledge_ids scan is underspecified** (glob target / namespacing) — implementable, mildly open.

**No rejection gates triggered.** The single blocking issue from both prior REJECTs (B1 allowlist) is now explicit, tested, and end-to-end closed; no Trust elevation; D8 replace/preserve is coherent and skill-symmetric; every code claim verified against the repo — implementable without invention.

VERDICT: APPROVE_WITH_NITS
