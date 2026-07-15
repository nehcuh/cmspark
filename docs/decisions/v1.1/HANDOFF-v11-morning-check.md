# v1.1 Handoff — Morning Check

**Branch**: `worktree-notebooklm-import` (same as v1)
**Base commit**: `cde73fe` (v1)
**New commit**: <to-be-filled-after-commit>
**Status**: ✅ Ready for review. Not pushed.

## What's new in v1.1

Online NotebookLM batch importer. Side panel 📓 button now opens an importer overlay; 💾 button preserves v1 offline MD.

### Features
- Pick target notebook (via `batchexecute` RPC `wXbhsf`)
- Bulk-paste URLs or "+当前 tab" / "+所有 tab"
- Batch import (50 source cap) with progress bar + per-item status
- Cancel batch (persists across SW restart)
- Auto-resume in-flight batch on SW restart (chrome.storage.local persistence)
- Random delay 500-1500ms between items (anti Google throttle)
- Retry failed items 2× with exponential backoff
- Tab-lost detection (auto re-acquire NotebookLM tab)

### Architecture (Round 1 consensus)
- Pure DOM automation (no fetch interception — Web Importer's is dead code)
- Angular-aware waiter (MutationObserver + rAF, no fixed setTimeout)
- list-only RPC (no create-notebook — boVbkv unverified)
- Two separate buttons (📓 online, 💾 offline — no silent fallback)
- Selector registry with multi-strategy fallback (CSS → text → aria → role)
- Defensive CSRF (SNlM0e) extraction with auth-fail detection

## Verification status

| Check | Status |
|---|---|
| 104/104 unit tests | ✅ |
| `tsc --noEmit` strict | ✅ |
| Plasmo build green | ✅ |
| Companion regression (untouched) | ✅ 912/912 |
| E2E in real Chrome | ⏳ Needs manual verification (see below) |

## Manual verification checklist (needs you)

### Setup
1. Load unpacked `chrome-extension/build/chrome-mv3-prod/`
2. Make sure you're logged into NotebookLM in Chrome (just open notebooklm.google.com once)

### Golden path
- [ ] Click 📓 in side panel header → importer overlay opens
- [ ] Notebook dropdown populates with your notebooks (if empty, see "Auth fail" below)
- [ ] Paste 2-3 URLs (one per line)
- [ ] Click "导入 N 个源"
- [ ] Progress bar advances; per-item status shows ✓ / ✗
- [ ] Open NotebookLM notebook → sources appear

### Tab recovery
- [ ] Start a batch of 5+ URLs
- [ ] Mid-batch, close the NotebookLM tab
- [ ] Watch logs: orchestrator detects tab-lost, re-opens tab, continues
- [ ] If repeated closures: batch aborts with clear error (not silent spiral)

### Cancel
- [ ] Start a batch
- [ ] Click "取消批次"
- [ ] Loop stops within ~5s (current item may finish)

### Auth fail
- [ ] Sign out of NotebookLM
- [ ] Click 📓 → "目标 Notebook" section shows red error "未登录 NotebookLM"
- [ ] Sign back in; click 🔄 → dropdown populates

### Notebook mismatch (Critical fix)
- [ ] Open NotebookLM tab on notebook A
- [ ] In importer, pick notebook B from dropdown
- [ ] Import 1 URL
- [ ] Verify: source lands in notebook B (not A). Tab should navigate to B if needed.

### Resume after SW restart
- [ ] Start batch of 10 URLs
- [ ] Open `chrome://extensions` → click "Service Worker" (under CMspark) → this kills the SW
- [ ] Wait 5s, reopen side panel → click 📓
- [ ] Batch state shows; orchestrator resumes from where it left off

## Known limitations (v1.2 candidates)

- No notebook create (would need RE of `boVbkv` or DOM click "New notebook")
- No AI chat extraction (Claude/ChatGPT/Gemini)
- No page-link extractor / RSS / YouTube playlist
- No selector CI canary
- Resume idempotency: if SW dies DURING a runOne, the same item may run twice on resume → duplicate source (user can manually delete; v1.2 fix needs source-URL dedup)

## Files added

**Source (8)**:
- `chrome-extension/src/notebooklm/types.ts`
- `chrome-extension/src/notebooklm/selectors.ts`
- `chrome-extension/src/notebooklm/notebook-api.ts`
- `chrome-extension/src/notebooklm/dom-automation.ts`
- `chrome-extension/src/background/notebooklm-import-orchestrator.ts`
- `chrome-extension/src/sidepanel/components/NotebooklmImporterPanel.tsx`

**Tests (1)**:
- `chrome-extension/tests/notebooklm-selectors.test.ts`

**Docs (3)**:
- `docs/adr/012-notebooklm-importer-online.md`
- `docs/decisions/v1.1/design-brief.md`
- `docs/decisions/v1.1/round1-synthesis.md`

**Modified (3)**:
- `chrome-extension/src/background/index.ts` (4 new message types)
- `chrome-extension/src/sidepanel/App.tsx` (📓 opens importer, 💾 = offline MD)
- `chrome-extension/tsconfig.test.json` (include new sources)

## Push (you in the morning)

```
! cd /Users/huchen/Projects/cmspark/.claude/worktrees/notebooklm-import && git push -u origin worktree-notebooklm-import
```

## v1.2 next steps (recommended order)

1. **Selector CI canary** (cheap insurance — copy jetpack's `check-selectors.mjs`)
2. **Resume idempotency** (URL dedup before import)
3. **AI chat extraction** (generic extractor first, per-site refinement)
4. **Notebook create** (DOM automation: click "New notebook" + type name)
5. **CDP `Fetch` interception** as opt-in accelerator (research PoC)
6. **Page link extractor / RSS / YouTube** (pathway expansion)
