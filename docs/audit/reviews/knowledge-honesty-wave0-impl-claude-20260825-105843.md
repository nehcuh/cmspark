All checks complete. Here's my review.

---

# Review: knowledge-honesty-wave0-impl

## Verification method

- Patch file confirmed current: byte-identical to staged `git diff` (the 269KB file = header + two identical copies of the HEAD-vs-index diff; second copy md5-matches the live staged diff).
- Read all code hunks in `doc-identity.ts`, `skill-engine.ts`, `skill-install.ts`, `pack-engine.ts`, `message-router.ts`, `config.ts`, and the four UI files.
- Executed tests: `doc-identity.test.ts` + `skill-engine.test.ts` → **46/46 pass**; `skills.test.ts` → **102/102 pass**; `knowledge-active-ids.test.ts` + `packs-engine.test.ts` → **35/35 pass**.
- Executed a probe confirming the 80-char-stem collision edge (see nit 1).

## Rejection gates — all clear

| # | Gate | Evidence |
|---|------|----------|
| R1 | No false claims / fake tests | New tests run real behavior (CJK import → distinct `k-<sha10>` files, no `--.md`; `get("产品甲") === undefined`; F-I-6 suffix; `loadContent(knowledge) === null`; RAG/search/entries sanitize). All executed green. |
| R2 | No `get(title)` / knowledge via use_skill | `get()` matches `name \|\| id` only (skill-engine.ts:349); `loadContent` nulls knowledge/ paths via `isUnderKnowledgeDir` (skill-engine.ts:407-411); `use_skill` dispatch goes through `loadContent` (companion-dispatch.ts:958-966). |
| R3 | Overlay ACL unchanged | `summoner-web.ts` not in diff; grep of staged code diff for `SUMMONER_WEB`/`config.set`/`knowledge.*` additions → zero matches. |
| R4 | No trust elevation | No `securityConfirmations`/`auto_approve`/`allow_all_schemes` additions in diff. |
| R5 | `../x` / CJK slugs | `asciiSlug` returns `""` for path-shaped (`/` `\` `..`) and CJK-only input (doc-identity.ts:43-52); falls to `hashedStem`; `isUnsafePathComponent` rejects `CON`/`..`/trailing dot-space; tests assert `../x` ↛ `x.md`. |
| R6 | No new runtime / Project | `doc-identity.ts` is a pure helper; no new entity, no citation chips, no taxonomy in UI diffs (title display + search bag only). |

## Wave 0 DoD — holds

- All six write paths (`saveSkillFile`, `importSkill`, zip extract, `importSkillFiles`, `importKnowledge`, `createExperienceSkill`) + `skill-install.ts` namer + `pack-engine.ts` namer route through `writeRestrictedFile`/`allocateDocIdentity` (verified by grep and per-hunk read).
- Sanitizers on all three retrieval paths: RAG (skill-engine.ts:732), full/truncate (739, sanitize-before-slice), entries (770), `searchKnowledge` (1497).
- Import walk fail-closed on lstat (`isSymlinkOrJunction` catch → true), skips dotfiles, caps files (message-router.ts:2650).
- Zip reserved-name check implemented (skill-engine.ts:1093-1097) — was flagged "if still missing" in the prompt; it's present.
- `getConfigDir()` live-env read (config.ts:1391-1393) is prod-safe (env unset post-start in prod) and follows existing precedent (crash-handlers.ts:17-19, mcp/transport.ts:229).

## ADR-020 checklist

Capability declaration present and accurate. Axes fit: Composition (knowledge identity) + L0 Surface (titles), no middle-agent runtime, no new confirm dialect, trust monotonicity *strengthened* (knowledge bodies now unreachable via `use_skill`), no new `securityConfirmations.request` so no originWs exposure. Pack-first N/A (no new scenario/chrome). No experimental layers on write paths. P1 watchlist: untouched.

## Nits (non-blocking)

1. **Suffix truncation breaks dedup at the 80-char cap** — `unique = \`${stem}-${n}\`.slice(0, FILENAME_STEM_MAX)` (doc-identity.ts:98): when `stem` is exactly 80 chars, the suffix is truncated away, so a colliding second doc loops to `Too many filename collisions` and throws. `[executed]` — confirmed by probe. Fails closed, but the slice should truncate the stem, not eat the suffix.
2. **Reverse-direction collision gap** — `importSkill`/`importSkillFiles`/`createExperienceSkill` take stems only from `listStemSet(this.skillsDir)` (skill-engine.ts:904, 1279, 1511), so a new *skill* name can still equal an existing *knowledge* id. Not a regression and the DoD only required the knowledge→skill direction (skills load first in cache, so `get()`/`loadContent` prefer the skill), but `collectTakenStems()` would close it symmetrically.
3. **Duplicate CJK experience-skill names no longer merge** — old code collapsed both to `---.md` and merged entries; `createExperienceSkill` now allocates `k-<hash>-2.md` with an identical frontmatter `name`, orphaning the second doc from `get()` (skill-engine.ts:1508-1523).
4. **Zip reserved-name check covers basename/stem only** — intermediate directory components (`con/SKILL.md`) escape the check (skill-engine.ts:1093-1097); matters only on Windows.
5. **0o600 only on create + lstat→write TOCTOU window** — `writeRestrictedFile` (doc-identity.ts:124-140): `writeFileSync` mode applies only at creation, and a symlink swap between `lstat` and `write` is still possible. Anticipated nit; acceptable posture.
6. **No dedicated truncate-path injection test** — large doc, no query, injection near the 2000-char boundary. The sanitize call (skill-engine.ts:739) is shared with the covered full-content path and runs before the slice, so the property holds by inspection, but a pinned test would guard the ordering.
7. **Prompt heading still `## Knowledge: {name}`** — title-bearing heading deferred to Wave 1 per spec §5; consistent with the plan, noted for completeness.

VERDICT: APPROVE_WITH_NITS
