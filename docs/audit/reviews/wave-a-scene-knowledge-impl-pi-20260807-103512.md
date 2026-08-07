All checks complete. Full verification summary:

## Verification performed (real code + reproduced tests)

**Machine evidence reproduced** — `.test-dist` fresh (no source newer than compiled output):
- `knowledge-active-ids.test.ts` → **6/6 pass**
- `packs-engine` + `packs-validator` + `thread-pack-patch` → **33/33 pass**

**Rejection gates:**
- **R1** ✅ `thread.update` allowlist includes `active_knowledge_ids` — `companion/src/message-router.ts:1623` (verified in live file, not just patch)
- **R2** ✅ Manual path alive end-to-end: `KnowledgeSubPanel.tsx:484` sends `thread.update {active_knowledge_ids}` → allowlist passes → `ThreadManager.update` validates + persists → `resolveKnowledgeIdsForThread` (skill-engine.ts:528) reads the field → resolved ids flow into chat payloads (message-router.ts:670, 927, 1146)
- **R3** ✅ No trust elevation — zero trust/auto_approve/god-mode changes in diff; `mission_pack_trust_snapshot` path is pre-existing
- **R4** ✅ D8 preserve implemented correctly: `pack-engine.ts:1512-1518` — `packKnowledge.length > 0 ? packKnowledge : [...baseSnap.active_knowledge_ids]`; test asserts apply-replace AND unapply-restore (`["pre-user-doc"]` restored)
- **R5** ✅ Core contracts tested: allowlist (static contract test), apply activate (tests 5–6), saveUserPack `knowledge_refs` (test 6)

**ADR-020 checklist:** capability declaration present in prompt and matches diff (Surface L0 scene editor + thread field; Compose knowledge + pack; Trust no elevation; Channel unchanged). Extends existing pack editor — no new primary chrome, no new confirm dialect, no `securityConfirmations.request` (originWs N/A), no new runtime, no P1 watchlist touch.

**Non-blocking nits:**

1. `agentStore.tsx:557-558` — UPSERT_THREAD asymmetry: `activeKnowledgeIds` falls back to `[]` when the payload lacks the field, whereas `activeSkillIds` (line 553) preserves prior state (`|| state.activeSkillIds`). All companion-created threads now carry the field so impact is minimal, but `|| state.activeKnowledgeIds` would match the skill convention and be safer for partial payloads / pre-change legacy threads.

2. D8 empty-preserve branch (R4's exact concern) has no dedicated regression test — non-empty replace and unapply-restore are covered, but "apply pack with no knowledge keeps user's `active_knowledge_ids`" isn't asserted. Code is correct; one test would lock the contract.

3. The allowlist test (`knowledge-active-ids.test.ts` test 4) is a static source-scan regex on `message-router.ts` — brittle if the key array is ever extracted/refactored. An integration assertion (thread.update → thread persists field) would be stronger.

4. Untracked `.grok/` (config.toml, hooks/, rules/) at repo root shows in `git status` — unrelated tooling artifact; should be gitignored.

VERDICT: APPROVE_WITH_NITS
