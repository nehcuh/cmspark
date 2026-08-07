Review complete. I read the plan, the parent analysis §Wave A + §9, and grounded every claim against the current code (`thread-manager.ts`, `skill-engine.ts`, `pack-engine.ts`, `types.ts`, `validator.ts`, `message-router.ts`, `agentStore.tsx`, `KnowledgeSubPanel.tsx`, `PacksPanel.tsx`). The patch file confirms this is a pre-code plan gate (untracked docs, HEAD `5a401f1`, no code diff).

## Blocking issue

**1. The plan mis-states the UI→thread wiring and omits the router fix — the exact orphan it exists to fix will survive end-to-end.**
- `message-router.ts:1618-1630` — the `thread.update` handler builds `allowedUpdates` from a **hard-coded allowlist** of 10 keys. `active_knowledge_ids` is **not** in it. The UI's toggle (`KnowledgeSubPanel.tsx:484`) is silently dropped before it ever reaches `threadManager.update`. That is why the orphan exists today.
- Plan Task 4 step 2 asserts: *"Confirm thread.update already Object.assign's active_knowledge_ids once field validated"* — **false about current code**. `threadManager.update` does Object.assign (thread-manager.ts:612), but the router allowlist strips the key first, so adding validation alone fixes nothing.
- The plan's Task 4 file map lists `message-router.ts` only for `pack.save_user`; no step adds `active_knowledge_ids` to the allowlist.
- Consequence: Task 1's unit tests call `ThreadManager`/resolve directly and pass; the UI toggle stays dead; success criterion 1 (manual toggle persists + injects) fails silently. An implementer must invent the router change — violating Q6 ("closed enough to implement without invention") and R5 (false claim about current code).

Everything else checked out. Verified correct:
- D1 independent field — right call; `active_skill_ids` feeds `resolveSkillIdsForThread` (isSkillDoc-filtered) and `getActiveForThread` (`["browse"]` fallback); overloading it would pollute both resolvers.
- D2 back-compat union — necessary (legacy knowledge-typed names in `active_skill_ids` are the only current path) and harmless (skills resolver already excludes knowledge docs; union dedupes + verifies via `get()`).
- `installAssetsFromValidated` signature change — low risk: 3 call sites (pack-engine.ts:1106, 1117, 1424), only applyPack consumes the return.
- Empty-knowledge preservation — correct per the length-check pseudo-code; satisfies R3. (Nit below re: explicit-clear asymmetry.)
- Trust / ADR-020 — clean. No Trust changes (D7), thread-local activation, no new `request()`/confirmations/originWs surface, no second runtime (thread field + pack refs; R4 satisfied), pack-first (scene editor within existing PacksPanel), and the capability declaration (Surface L0 / Compose knowledge+pack / Autonomy n/a / Trust no elevation / Channel unchanged) is present and fits the axes.

## Nits (non-blocking)

- `skill-engine.ts` plan sketch, Task 1 Step 3: the `active_knowledge_ids` loop maps `this.get(n)` without an `isKnowledgeDoc` filter (the D2 loop has one) — a stale/renamed id pointing at a non-knowledge doc would resolve as "knowledge". Add a type filter on the final map.
- Task 2 Step 3: length-check fallback means a pack can never explicitly clear knowledge (asymmetric with `skill_refs` undefined-check semantics). Intentional per R3, but document the asymmetry so an implementer doesn't "fix" it to match skills.
- No test covers the router path; suggest a message-router test asserting `thread.update` passes `active_knowledge_ids` through the allowlist — this is what would have caught the blocking issue.
- D2 union is a one-release window with no scheduled cleanup task; acceptable, but note it.

**Verdict: REJECT** — one blocking issue (missing `active_knowledge_ids` in the `thread.update` allowlist at `message-router.ts:1618-1630`, hidden behind the plan's false "already Object.assign's" claim at Task 4 step 2). Fix = add an explicit Task-4 step + file-map entry for the router allowlist; then re-gate.

VERDICT: REJECT
