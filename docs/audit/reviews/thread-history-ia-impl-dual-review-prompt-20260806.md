# Dual external review: Thread History IA **implementation** (P0 → P1.5)

**Batch:** `thread-history-ia-impl`  
**Stage:** Implementation review after design dual-approve (`thread-history-ia` APPROVE_WITH_NITS, 2026-08-06)  
**Date:** 2026-08-06  

## Capability declaration

```text
Surface:      L0 chat UX / thread navigation metadata only
L2-classes:   (none)
Compose:      none new — digest/tags are Thread index metadata, NOT Skill/Knowledge/Pack
Autonomy:     worker flat+badge; cleanup excludes workers by default
Trust:        batch_delete / trash / hard-delete must releaseTrustBeforeThreadGone per id
Channel:      community | enterprise unchanged
```

## Scope (review ONLY these — ignore unrelated branch noise)

### Spec / prior review

1. `docs/superpowers/specs/2026-08-06-thread-history-ia-product-design.md` (esp. §7.1 Pre-dev pins)
2. `docs/audit/reviews/thread-history-ia-dual-synthesis-20260806.md`

### Companion (new + modified)

- `companion/src/threads/thread-manager.ts` — trash/restore/list filters/previews/digest field
- `companion/src/threads/digest.ts` — extract + normalize + fingerprint + sensitive tags
- `companion/src/threads/cleanup-rules.ts` — pure rules engine
- `companion/src/threads/context-refs.ts` — summary_card injection builder
- `companion/src/message-router.ts` — batch_delete/trash/restore/list/auto_title/extract_digest/suggest_cleanup/context_refs on chat.create
- `companion/src/llm/adapter.ts` — `contextRefsSegment` injection
- `companion/src/server.ts` — WS validation for new types
- tests: `companion/tests/thread-batch-delete.test.ts`, `thread-digest.test.ts`, `thread-cleanup-context.test.ts`

### Extension

- `chrome-extension/src/sidepanel/utils/thread-timeline.ts` + tests
- `chrome-extension/src/sidepanel/components/ThreadList.tsx`
- `chrome-extension/src/sidepanel/components/AtThreadPopover.tsx`
- `chrome-extension/src/sidepanel/App.tsx` (@ detect + chips + context_refs send)
- `chrome-extension/src/sidepanel/hooks/useWebSocket.ts`
- `chrome-extension/src/sidepanel/store/agentStore.tsx` (REMOVE_THREADS)
- `chrome-extension/src/sidepanel/types.ts`
- `chrome-extension/src/background/index.ts`

**Ignore:** PacksPanel / pack-engine / s46 trust branch files / unrelated `.grok/` / images / other audit patches unless they collide with this feature.

## What shipped (claimed)

| Phase | Claim |
|-------|--------|
| P0 | Timeline today + month→day; multi-select; `batch_delete`; first_user_preview; local search |
| P0.5 | Yesterday group; rule batch auto-title |
| P1 | ThreadDigest extract; Tags view; tag pills |
| P1.5 | Soft trash + restore + 30d lazy purge; `@` summary_card inject; rules cleanup UI |

Pre-dev pins from design review should hold (busy reject, trust release, trash default, fallback-first @, etc.).

## Your job

Independent senior **implementation** review. Read real code with tools. Do **not** rubber-stamp.

### Check

1. **Spec fidelity** — §7.1 pins actually implemented? gaps vs product design?
2. **Correctness** — race on batch_delete/trash; list include_trashed replacing UI state; trashView + SET_THREADS; active thread deleted/trashed; busy check only LLM abort map?
3. **Security** — `@` injection fence; full mode blocked; digest tags secret regex; trust release on trash AND hard; history.db still not purged (intentional)?
4. **ADR-020** — no Composition leak; no L2 tools; no new confirm dialect abuse
5. **UX / narrow panel** — multi-select height; trash/cleanup discoverability; @ + / conflict
6. **Tests** — coverage holes (restore WS, context_refs path, soft vs hard delete, purge)
7. **Regressions** — single `thread.delete` now soft by default — callers expecting hard unlink?
8. **Cost** — extract_digest / listWithPreviews reading all message files; async on_at_ref thrash

### Adversarial personas

- User with 200+ threads opens list (perf / listWithPreviews)
- User soft-deletes active busy thread
- User @-refs 8 threads with no digests
- Second Side Panel open during batch trash
- Worker threads in cleanup scan

## Output format (strict)

```markdown
## Summary
## What holds
## Spec / pin gaps
## Bugs / correctness
## Security / ADR-020
## UX
## Tests
## Blocking (must fix before merge)
## Nits
VERDICT: APPROVE|APPROVE_WITH_NITS|REJECT
```

End with exactly one line: `VERDICT: …`
