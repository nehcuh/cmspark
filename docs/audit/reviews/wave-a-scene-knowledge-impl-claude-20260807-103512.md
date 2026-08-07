I've completed an independent review. Let me record the verdict.

## Review summary

**Capability declaration:** present and accurate (Surface=L0, Compose=knowledge+pack, Trust=no elevation, no new autonomy/runtime). Aligns with the plan.

**Rejection gates:**
- **R1 (allowlist)** — `companion/src/message-router.ts:1623` includes `"active_knowledge_ids"` in the `thread.update` allowlist. Static-contract test in `knowledge-active-ids.test.ts:82-103` pins it. ✅
- **R2 (manual path live)** — end-to-end wired: `KnowledgeSubPanel.tsx:481-485` sends `thread.update` → `background/index.ts:748` forwards → `message-router.ts:1623` allowlist passes → `thread-manager.ts:578-584` validates → `pack-engine.ts` + `skill-engine.ts:501-522` reads. LLM injection at `message-router.ts:605/903/1124` calls `resolveKnowledgeIdsForThread` which now reads `thread.active_knowledge_ids` first. ✅
- **R3 (trust elevation)** — none. D7 honored. ✅
- **R4 (D8 preserve)** — `pack-engine.ts:1508-1513` REPLACE-when-non-empty + preserve-when-empty correctly implements D8. Test at `knowledge-active-ids.test.ts:158-159` confirms REPLACE semantics (`pre-user-doc` wiped when pack brings knowledge). ✅
- **R5 (tests)** — `node --test` ran clean: 6/6 knowledge-active-ids, 30/30 packs-engine+validator, 3/3 thread-pack-patch. ✅

**Other checks:**
- `installAssetsFromValidated` return-shape change is safe — only `applyPack` consumes the new `{skillIds, knowledgeIds}`; the two `installPack` call sites at `pack-engine.ts:1136,1147` ignore the return.
- `validator.ts:177-183` rejects path-traversal in `knowledge_refs` (mirrors skill_refs guards in `saveUserPack` at `pack-engine.ts:883-892`).
- Snapshot/restore (`pack-engine.ts:1263, 1285`) and `unapplyPack`/`uninstallPack` filters (1587, 1640) all carry `active_knowledge_ids` symmetrically with skills.
- D2 back-compat has explicit `TODO(wave-a-d2)` marker.

**Nits (non-blocking):**

1. `agentStore.tsx:559-562` UPSERT_THREAD falls back to `[]` for `activeKnowledgeIds` but `state.activeSkillIds` for `activeSkillIds`. Asymmetric, but safe in practice because the companion always emits `active_knowledge_ids` (create defaults to `[]` at `thread-manager.ts:358`). Worth aligning to `state.activeKnowledgeIds` for paranoia.
2. D8 empty-pack path (`knowledge_refs: []` + no pack-local knowledge → preserve `baseSnap.active_knowledge_ids`) is not exercised by a test — only the REPLACE branch is. The plan's "auto (+ site)" test step is also unimplemented, but auto behavior is unchanged from prior code.

Neither nit blocks merge.

VERDICT: APPROVE_WITH_NITS
