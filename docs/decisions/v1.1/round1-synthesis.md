# v1.1 Round 1 — 3-way Decision Synthesis

**Date**: 2026-07-15
**Voters**: Claude (main), Kimi, Pi-substitute
**Status**: ✅ Consensus on Q1-Q5; minor scope disagreement resolved in favor of Kimi's stricter cut.

## Verdict matrix

| Question | Claude lean | Kimi | Pi-sub | Decision |
|---|---|---|---|---|
| Q1 Import mechanism | A (DOM automation primary, CDP as v1.2 research) | A (DOM only) | A (DOM only) | **A — pure DOM automation** |
| Q2 Notebook mgmt | A (list only) | A (list only) | A (list only) | **A — list via wXbhsf, no create** |
| Q3 Selector drift | A first (MutationObserver) | A | A | **A — runtime self-heal; CI canary deferred** |
| Q4 AI chat extraction | B (generic) | B (generic) | B (generic) | **B — reuse v1 extractor; per-site + LLM as v1.2** |
| Q5 MD offline button | A (separate buttons) | A | A | **A — 📓 online import + 💾 offline MD** |
| Q6 Scope | P0 ship, P1 time-permitting, P2 defer | P0 ship, P1 notebook-picker only | P0 ship, P1 time-permitting | **P0 ship + P1 = notebook picker only (Kimi's stricter cut)** |

## Why Kimi's stricter P1 wins

- Pi-sub said "P1 time-permitting" implying AI chat extraction could fit
- Kimi said "AI chat extraction adds testing complexity even with generic extractor; defer to fast-follow"
- I (Claude) agree with Kimi: AI chat extraction at scale needs per-site testing which I can't do without a human in the loop. Notebook picker is mechanical (calls `listNotebooks` RPC, populates dropdown).

## Critical implementation requirements (consensus)

### Mandatory for ship

1. **Angular waiter — MutationObserver quiescence + rAF×2, NOT fixed setTimeout**
   - Reason: NotebookLM = Angular Material + zone.js. Click → element exists in DOM but ngModel not bound → setting value gets overwritten by Angular next CD cycle. Submit button `[disabled]` is Angular-controlled; clicking before enabled = silent no-op (worst kind of failure). Dialog enter-animation ~250ms; selector matches before `pointer-events:auto`.
   - Without this: ~30% flake on batches >10 (Pi-sub estimate).

2. **State persistence after EVERY source** (not at end of batch)
   - Reason: MV3 SW has 30s idle timeout + memory-pressure eviction. In-flight batch promise rejects with `Extension context invalidated` if SW dies mid-batch.
   - Use `chrome.storage.local.set` after each item, not at batch end.

3. **CSRF (SNlM0e) caching with retry-on-failure**
   - Rotates on: logout/login, account switch, long idle (hours, not minutes), server-side roll. **Not** per-request.
   - Cache in memory + `chrome.storage.local` with TTL.
   - Always re-extract on batch start.
   - Detect failure: redirect to `accounts.google.com` OR HTTP 200 with empty `wrb.fr` envelope (silent invalidation — most common).
   - 0-notebook response = "token maybe dead, refetch HTML and retry once."

4. **Multi-strategy selector resolution**
   - Try CSS, then text content, then aria-label, then role. Each strategy in the registry must have at least 2 fallbacks.

5. **Angular state assertions (not just selector existenceence)**
   - Before clicking submit: assert `[disabled]` is absent, `ng-pristine` is gone, etc.
   - Before declaring "source added": wait for `.single-source-container` count to increase AND CD to settle (MutationObserver quiescence).

6. **Two separate UI buttons** (no auto-fallback)
   - 📓 opens the NotebookLM Importer panel (online import)
   - 💾 downloads MD offline (preserves v1 behavior)
   - No silent fallback — explicit choice.

7. **world: 'MAIN' for executeScript when needed**
   - Default ISOLATED can't see Angular's window models. Use MAIN when we need to read Angular state.

8. **Tab-state dedupe**
   - Track (tabId, dialogPhase) to avoid re-injecting handlers on a tab already mid-dialog.

### Risk mitigations

- **Account flagging from 100+ imports**: add random delay (500-1500ms) between imports + hard cap at 50 per batch (warn user above)
- **Selector drift**: MutationObserver self-heal at runtime; surface failure as `error` in import report
- **React state desync**: see #1 and #5 above

## v1.1 final scope

### P0 — Ship tonight
- Selector registry (multi-strategy)
- DOM automation runner (URL + text paths)
- Angular-aware waiter (MutationObserver + rAF)
- batchexecute list-notebooks RPC (`wXbhsf`)
- CSRF token extraction + caching + retry
- Batch state machine with persistence after every item
- NotebookLM Importer side-panel UI:
  - Target notebook picker (dropdown)
  - URL list textarea (bulk paste)
  - "Add current tab" / "Add all tabs" buttons
  - Progress bar + per-item status
  - Import report with retry-failed
- Two header buttons: 📓 (online) + 💾 (offline MD)

### P1 — Fast-follow (next session)
- Notebook picker refinement (search, recent)
- AI chat extraction (Claude/ChatGPT/Gemini → generic extractor)

### P2 — Future
- CDP `Fetch` interception as opt-in accelerator (research PoC first)
- Notebook create via API (reverse-engineer `boVbkv` or DOM automation)
- Page link extractor, RSS/OPML, YouTube playlist
- Selector CI canary

## Advisor outputs (raw)

- `advisor-kimi-round1.txt`
- `advisor-pi-round1.txt`
- `research-phase0.txt` (Phase 0 reverse-engineering findings)

→ **Proceed to Phase 2: implement P0.**
