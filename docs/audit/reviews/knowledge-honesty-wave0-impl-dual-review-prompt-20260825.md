# Dual external review: Knowledge Honesty Wave 0 **implementation**

**Batch:** `knowledge-honesty-wave0-impl`  
**Stage:** Wave 0 code on `feat/knowledge-honesty-wave0` (uncommitted / staged)  
**Date:** 2026-08-25  
**Blast tier:** T2 Compose / L0 — identity + sanitizer; no overlay ACL growth

## Capability declaration

```text
Surface:      L0 (knowledge list titles)
L2-classes:   (none)
Compose:      knowledge identity + retrieve sanitizer
Autonomy:     n/a
Trust:        no elevation; knowledge/ files are not use_skill; overlay ACL unchanged
Channel:      community | enterprise unchanged
```

## Required reading

1. Spec Wave 0: `docs/superpowers/specs/2026-08-25-daily-assistant-knowledge-honesty-design.md` §5 Wave 0 + F-I-1/5/6/7 + F-S-2
2. New: `companion/src/skills/doc-identity.ts`
3. `companion/src/skills/skill-engine.ts` (get, loadContent, importKnowledge, sanitize paths, zip reserved names)
4. `companion/src/message-router.ts` directory walk
5. Tests: `companion/tests/doc-identity.test.ts`, `skill-engine.test.ts` (CJK, F-I-6, RAG/search/entries sanitizer)

## Wave 0 DoD (must hold)

- CJK titles import; `产品甲`/`产品乙` distinct files, not `--.md`; UI `title`
- `get()` matches **id or name only** (not title)
- New knowledge id cannot equal an existing skill name (suffix); `loadContent` of `knowledge/` path returns null
- `../x` does **not** slug to `x.md` (hash)
- RAG + truncate + entries + `searchKnowledge` sanitize
- write refuses symlink targets; import walk fail-closed on lstat
- Overlay `SUMMONER_WEB_DISPATCH_ALLOW` still has no `knowledge.*`
- No Project / citation chips / category taxonomy in this diff

## Rejection gates

| # | REJECT if |
|---|-----------|
| R1 | False code claims in the diff description / tests that don't run the behavior |
| R2 | `get(title)` or `use_skill`/`loadContent` serving `knowledge/` bodies |
| R3 | Overlay ACL grew (`knowledge.*` / `config.set`) |
| R4 | Trust elevation / auto_approve |
| R5 | `../x` still becomes `x.md` or CJK still `--.md` |
| R6 | New runtime / Project entity |

Nits: zip inner reserved (if still missing), 0o600 only on create, Wave 0b gesture, prompt still `## Knowledge: {id}` (Wave 1).

End with exactly:
VERDICT: APPROVE
or
VERDICT: APPROVE_WITH_NITS
or
VERDICT: REJECT
