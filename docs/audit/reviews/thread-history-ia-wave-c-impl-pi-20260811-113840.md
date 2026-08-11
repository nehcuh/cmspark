## Dual external review — Thread History IA Wave C implementation

### Method
Read the full 1912-line patch, the Wave C spec (§Wave C, pins GAP-16/17, rejection gates), both new `related.ts` implementations, both test files, and verified against the live repo (`git status` matches patch file list; patch not stale). Ran tests myself.

### Test evidence
- `chrome-extension`: **614/614 pass** (incl. `thread-related` 4 tests + `thread-timeline` 25 tests) — matches claim.
- `companion`: `thread-related.test.ts` **2/2 pass**. Full suite shows 14 failures in `computer-uia-watch`/`executor` — I verified via `git stash` that **all 14 fail identically on clean HEAD (bf25c0b)**, i.e. pre-existing, unrelated to this diff.

### Acceptance gates
| Gate | Result | Evidence |
|---|---|---|
| R1 graph ≠ default nav | ✅ | Graph reachable only via `⋯ → 🕸 关联图谱` → modal portal (ThreadList.tsx:1430+); time axis untouched; header explicitly says "不改默认时间轴导航" |
| R2 no embedding/graph-DB/llm_wiki pages | ✅ | Pure local co-tag Jaccard + TF cosine + time proximity; no new runtime (companion/src/threads/related.ts) |
| R3 no `@` edges | ✅ | No @-edge signal anywhere; C.1b deferred per spec |
| R4 no Knowledge dual-write | ✅ | Edges are ephemeral scores only |
| R5 no L2 / new confirm | ✅ | No new confirmations, no tools, no `securityConfirmations.request` (no originWs concern) |
| R6 tests / scoring | ✅ | Scoring covered both sides; deterministic tie-break by id |
| C-1..C-4, S9 | ✅ | companion API + client mirror (C-1), 🔗 top-3 clickable panel (C-2), popup with digest edges + empty state (C-3), lint stats untagged/stale/isolated read-only (C-4), weights are code constants (S9) |

### ADR-020 checklist
Capability declaration present and accurate: **L0 / (none) / none / n/a / unchanged / community|enterprise**. No tools/gates/primary chrome added; Pack-first not challenged (L0 metadata exploration); no new confirm family; trust monotonicity untouched. Pass.

### Nits (non-blocking)
1. **Dead companion path + mirror drift**: `thread.related` has a background forwarder (background/index.ts:825-834), companion handler (message-router.ts:1379-1403) and ws validator (validate.ts:111-118), but **no sidepanel caller** — the UI computes related exclusively client-side (ThreadList.tsx:296). The client tokenizer (thread-related.ts:28-48) omits the STOP_WORDS + kana ranges that companion `semantic-match.ts:31-58` has, so the two paths would produce divergent scores if ever wired; no e2e test exercises the companion path. Suggest wiring one path or adding an e2e test + a note documenting divergence.
2. **Eager O(n²) lint stats**: `digestLintStats` (isolated = `findRelatedThreads` per thread) runs in an ungated `useMemo` on every `filtered` change (ThreadList.tsx:306-308), even with the cleanup panel closed — jank risk during extract on large lists. Gate on `cleanupOpen`.
3. `relatedSeedId` is never cleared when the seed thread is trashed/deleted → stale "暂无相关会话" panel until manual close (ThreadList.tsx:1164-1180). Minor.
4. Settings number inputs coerce a cleared/empty value to `0` (SettingsSlideout.tsx) instead of reverting to default — minor UX.

Full A→B→C pipeline is shippable; nothing blocking.

VERDICT: APPROVE_WITH_NITS
