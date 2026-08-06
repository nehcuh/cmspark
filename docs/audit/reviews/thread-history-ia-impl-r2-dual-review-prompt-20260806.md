# Dual external review R2: Thread History IA impl — B1–B3 + perf hotfixes

**Batch:** `thread-history-ia-impl-r2`  
**Stage:** Confirmation review after REJECT on R1  
**Date:** 2026-08-06  

## Prior verdicts

| Round | Claude | Pi | Synthesis |
|-------|--------|-----|-----------|
| Design | APPROVE_WITH_NITS | APPROVE_WITH_NITS | both_ok |
| Impl R1 | **REJECT** | **REJECT** | B1–B3 blocking |

R1 artifacts:
- `docs/audit/reviews/thread-history-ia-impl-dual-synthesis-20260806.md`
- `docs/audit/reviews/thread-history-ia-impl-claude-20260806-134044.md`
- `docs/audit/reviews/thread-history-ia-impl-pi-20260806-134044.md`

## Capability declaration (unchanged)

```text
Surface:      L0 chat UX / thread navigation metadata only
L2-classes:   (none)
Compose:      digest/tags = Thread index metadata only
Autonomy:     worker flat+badge; cleanup excludes workers by default
Trust:        trash + hard delete releaseTrust per id
Channel:      unchanged
```

## Your job — verify R1 blocking fixes + perf nits

**Primary:** Confirm each B1–B3 is actually fixed in code (not just claimed).  
**Secondary:** Confirm perf nits landed.  
**Tertiary:** Any new regressions introduced by the hotfixes.

### B1 — `thread.delete` default hard (Claude)

**Claimed fix:**
- Single `thread.delete` defaults to **hard** unless `mode:"trash"`
- UI passes `mode:"trash"` for soft delete / recycle bin
- Single delete also rejects busy (`listLlmActiveThreadIds`)
- Tray listens for `thread.trashed` / `thread.restored`

**Verify in:**
- `companion/src/message-router.ts` — `case "thread.delete"`
- `chrome-extension/src/sidepanel/components/ThreadList.tsx` — delete handlers pass mode
- `chrome-extension/src/background/index.ts` — forwards mode
- `companion/src/tray/companion-client.ts` — refresh triggers
- `companion/tests/single/files.test.ts` — still expects `thread.deleted` + gone (if present)

### B2 — Trash list does not corrupt main UI (Pi)

**Claimed fix:**
- `thread.list` response includes `list_scope` / `include_trashed` / `only_trashed`
- Extension: `list_scope === "trash"` → ignore (no SET_THREADS)
- Extension: `list_scope === "all"` (include_trashed) → SET_THREADS but **no** auto-create blank thread, **no** auto-select first
- `SET_THREADS` preserves active when possible

**Verify in:**
- `companion/src/message-router.ts` — `case "thread.list"` response fields
- `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` — `case "thread.list"`
- `chrome-extension/src/sidepanel/store/agentStore.tsx` — `SET_THREADS`
- ThreadList opens trash with `include_trashed: true` (not only_trashed)

### B3 — `@` popover Enter parity with `/` (Pi)

**Claimed fix:**
- `handleKeyDown` returns early when `atVisible` for ArrowDown/Up/Escape/Enter (same as `slashVisible`)

**Verify in:**
- `chrome-extension/src/sidepanel/App.tsx` — `handleKeyDown`

### Perf nits (post-R1)

| Nit | Claimed fix | Verify |
|-----|-------------|--------|
| Double message-file read on list | `listWithPreviews` single-pass: preview + stale | `thread-manager.ts` listWithPreviews; router list has no second getMessages |
| @ digest 8 concurrent LLM | `extractThreadDigestQueued` max 2 + per-id dedupe | `digest.ts`; message-router context_refs uses queued |
| purge N× saveIndex | batch filter + one saveIndex + unlink | `purgeExpiredTrash` |

## Scope (review these files)

```
companion/src/threads/thread-manager.ts
companion/src/threads/digest.ts
companion/src/threads/context-refs.ts
companion/src/threads/cleanup-rules.ts
companion/src/message-router.ts
companion/src/llm/adapter.ts
companion/src/server.ts
companion/src/tray/companion-client.ts
companion/tests/thread-*.test.ts
chrome-extension/src/sidepanel/App.tsx
chrome-extension/src/sidepanel/hooks/useWebSocket.ts
chrome-extension/src/sidepanel/store/agentStore.tsx
chrome-extension/src/sidepanel/components/ThreadList.tsx
chrome-extension/src/sidepanel/components/AtThreadPopover.tsx
chrome-extension/src/background/index.ts
```

Ignore unrelated s46/pack/trust branch noise unless it collides.

## Output format (strict)

```markdown
## Summary
## B1 verdict (FIXED / PARTIAL / STILL_BROKEN) + evidence
## B2 verdict (FIXED / PARTIAL / STILL_BROKEN) + evidence
## B3 verdict (FIXED / PARTIAL / STILL_BROKEN) + evidence
## Perf nits verdict
## New regressions / residual risks
## Blocking
## Nits
VERDICT: APPROVE|APPROVE_WITH_NITS|REJECT
```

### Verdict guidance

- **APPROVE** — B1–B3 all FIXED; no new blocking issues  
- **APPROVE_WITH_NITS** — B1–B3 FIXED; residual non-blocking nits only  
- **REJECT** — any of B1–B3 still broken, or new blocking regression  

End with exactly one line: `VERDICT: …`
