Review complete. All verification done against real code (patch reconstructed in an isolated worktree, tests actually executed).

## Findings

**Patch integrity**: The patch's code section is byte-identical to the staged diff at capture time (`diff` exact match). It is not stale *as captured* — but the live repo tree moved during review (see Nit 2).

**Wave 0 DoD — all verified, machine-checked:**
- **CJK identity**: `allocateDocIdentity` hashes CJK titles to stable `k-<sha256[:10]>`; `产品甲`/`产品乙` write distinct files, never `--.md`; UI (KnowledgeSubPanel, PacksPanel) shows `title || name`; `listKnowledge` carries `id`/`title`. Test-locked (`doc-identity.test.ts`, CJK test in `skill-engine.test.ts`).
- **`get()`**: matches `s.name === name || s.id === name` only — never title; test asserts `get("产品甲") === undefined`.
- **F-I-6 + loadContent**: `collectTakenStems()` spans skills+buitlin+knowledge dirs so a new knowledge id can't steal a skill name (suffix `-2`); `loadContent` returns null for `knowledge/` bodies via `isUnderKnowledgeDir`. Both test-locked.
- **`../x`**: `asciiSlug` returns `""` on `..`/path chars → `hashedStem`; never `x.md`. Test-locked.
- **Sanitizer sweep**: all 4 retrieval returns sanitized — `getKnowledgeSummary` RAG + truncate, `getEntriesSummary`, `searchKnowledge` (`skill-engine.ts:729,767,1497`); tests assert `[FILTERED]` on injected chunks/entries.
- **Write/walk hardening**: `writeRestrictedFile` lstat-rejects symlink targets; `isSymlinkOrJunction` fail-closed on lstat in both the vault/import walk (`message-router.ts:2650`) and `readDirectoryFiles`; zip inner reserved-name check present (`skill-engine.ts:1096`); 0o600 on create.
- **Overlay ACL**: `SUMMONER_WEB_DISPATCH_ALLOW` has zero `knowledge` hits — unchanged.
- **Scope**: only title display UI deltas; no Project / chips / taxonomy.

**ADR-020**: capability declaration present and accurate (Surface L0 / Compose identity+sanitizer / Trust no elevation / Channel unchanged); no "中层 Agent" framing; no new runtime; no new confirm family; no `securityConfirmations.request` (no originWs surface needed); Pack-first respected.

**Tests (isolated patch-only worktree, real runs)**: doc-identity 7/7, skill-engine 39/39, skills 102/102, packs-engine 28/28, `tsc --noEmit` clean. **Rejection gates R1–R6: none triggered.**

## Nits (non-blocking)

1. **Live-tree drift — do not commit the working tree as-is.** During this review the repo moved: `skill-engine.ts` was unstaged and now carries in-flight Wave 1 edits (`buildSystemPromptWithSources`/`retrieved_sources`/`## Knowledge: {title} [{id}]`/searchChunks bag, plus unused `validateWildcardPattern` import), and new unstaged files appeared (`llm/adapter.ts`, `threads/thread-manager.ts`, `ws/validate.ts`, `useWebSocket.ts`). That intermediate state currently has a tsc error (`skill-engine.ts:727`) and breaks the `site_knowledge` label test. It is a separate Wave 1 concern — keep it out of the Wave 0 commit.
2. Prompt label still `## Knowledge: {id}` — Wave 1 item as specced; new-doc titles aren't visible to the model yet.
3. `writeRestrictedFile` checks only the final path component for symlinks; parent-dir traversal (mkdirSync recursive) and check→write TOCTOU remain — acceptable for the local single-user threat model, but worth a follow-up if the config dir ever becomes attacker-writable.
4. Minor asymmetry: `importSkill`/zip/`createExperienceSkill` check taken stems only in `skillsDir`, while `importKnowledge` uses the fuller `collectTakenStems()` (incl. builtin). Pre-existing shadowing behavior, not a regression.
5. `k-<sha256[:10]>` ids give ~40 bits of entropy — theoretical cross-dir (global vs sites) collision → `get()` ambiguity; already tracked as the spec's slug-vs-uuid open question.

VERDICT: APPROVE_WITH_NITS
