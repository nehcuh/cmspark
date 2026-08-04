# Final Goals — Download Probe · ELEMENT_AMBIGUOUS UX · Thread Titles

| Field | Value |
|-------|--------|
| Date | 2026-08-04 |
| Status | **IMPLEMENTATION LANDED** → Pi final gate pending |
| Plan Pi | **APPROVE_WITH_NITS** (`download-ambiguous-title-plan-pi-20260804.md`) |
| Trigger | User report + thread `#dagg58` + local diagnostics |
| Completion authority | **Pi re-review against THIS document**; disagreement → keep working |

---

## Final goal (one sentence)

Ship production fixes so that: (1) `downloads_find` / prefer_existing never fail solely due to MV3 dynamic-import chunk load, with clear Chinese recovery hints; (2) `ELEMENT_AMBIGUOUS` is understandable to users and actionable for the agent; (3) history threads almost never show a bare empty title—immediate fallback title + better list display + more reliable LLM title path.

---

## Acceptance criteria (Pi must check each)

### G1 — Downloads probe / local file detect (`#dagg58` class)

| ID | Criterion | Evidence |
|----|-----------|----------|
| G1.1 | `downloads_find` does **not** use SW dynamic `import()` that triggers `importScripts` failure | Code review: static import in `browser-bridge.ts` |
| G1.2 | `browser_download` prefer_existing path still uses same module (static) | Code: `browser-download-handler` import unchanged or static |
| G1.3 | On downloads API / permission failure: structured `error_code` + **`user_hint_zh`** | Code + unit test or fixture |
| G1.4 | Existing unit tests for downloads-find / browser-download still pass | `[executed]` test run |
| G1.5 | No regression: skill_install path docs still mention downloads_find fallback | Inspect tool description if touched |

### G2 — ELEMENT_AMBIGUOUS UX

| ID | Criterion | Evidence |
|----|-----------|----------|
| G2.1 | Error includes Chinese `user_hint_zh` explaining multi-match | Code |
| G2.2 | Error payload still includes `matches` (top-K tag/text) for agent | Code |
| G2.3 | Chat tool card surfaces `user_hint_zh` when present (existing path works) | Inspect ChatView already supports user_hint_zh |
| G2.4 | Unit tests updated for ambiguous classification messaging if pure helpers change | Tests pass |
| G2.5 | Optional: prefer interactive unique candidate when pool can be reduced without wrong-click risk — only if tests prove safe | Document choice |

### G3 — Thread titles / history list

| ID | Criterion | Evidence |
|----|-----------|----------|
| G3.1 | On first user message (or thread create+first user), set **provisional alias** from truncated user text if alias empty | Code: message-router / adapter / thread-manager |
| G3.2 | LLM `generateThreadTitle` still upgrades provisional title when final assistant text arrives | Code |
| G3.3 | Thread list UI: if alias empty, show human fallback (e.g. 「未命名」+ short id), not blank | ThreadList.tsx |
| G3.4 | generateThreadTitle failures logged (not silent void) at least `logger.warn` | Code |
| G3.5 | Companion tests or focused unit for provisional title helper | Tests pass |

### G4 — Process / ship

| ID | Criterion | Evidence |
|----|-----------|----------|
| G4.1 | Multi-path plan written; Pi reviewed plan | Artifacts |
| G4.2 | Important milestone: dual Pi+Claude on implementation | Artifacts |
| G4.3 | All acceptance G1–G3 green; Pi final gate **APPROVE** (or APPROVE_WITH_NITS with only deferred non-goals) against **this goals doc** | Pi transcript |
| G4.4 | Code committed and **pushed to remote** | git log / origin |

---

## Explicit non-goals (Pi must not require for APPROVE)

- Full GitHub-specific download automation rewrite  
- Guaranteeing 100% LLM title quality  
- Changing Chrome Downloads security segment allowlist semantics  
- UI redesign of entire thread panel  

---

## Multi-path adversarial plan (options → pick)

### Problem 1: downloads_find importScripts

| Path | Idea | Pros | Cons |
|------|------|------|------|
| **A** | Static import `downloads-find` in browser-bridge | Simple, eliminates dynamic chunk | Slightly larger SW bootstrap |
| B | Inline runDownloadsFind into browser-bridge | No separate module | Bloat, harder tests |
| C | Dynamic import + retry/reload message only | No structure change | Does not fix root cause |

**Lock: A** — static import; wrap failures with `user_hint_zh` for residual API errors.

### Problem 2: ELEMENT_AMBIGUOUS

| Path | Idea | Pros | Cons |
|------|------|------|------|
| **A** | Enrich error + zh hint + keep fail-closed multi-match | Safe, no wrong-click | Agent still must re-target |
| B | Auto-pick first interactive match | Fewer failures | Wrong-click risk on GitHub |
| C | Return matches only, no fail | Agent invents clicks | Unsafe |

**Lock: A** — fail-closed + Chinese + matches for agent; do **not** auto-click first of many.

### Problem 3: empty titles

| Path | Idea | Pros | Cons |
|------|------|------|------|
| **A** | Provisional title from first user message + LLM upgrade + list fallback | Covers most empty cases | Two-phase titles |
| B | LLM only, more retries | No provisional | Still fails offline/API |
| C | UI-only 「未命名」 | Easy | List still useless |

**Lock: A** — provisional + LLM upgrade + UI fallback + log title failures.

---

## Implementation order

1. Goals doc (this file) + plan  
2. Pi plan review  
3. G1 static import + hints + tests  
4. G2 ambiguous UX + tests  
5. G3 provisional title + UI + log + tests  
6. Dual external review (milestone)  
7. Fix dual nits if REJECT/blocking  
8. Pi final completion gate vs this document  
9. Commit + push remote  

---

## Pi final gate prompt (use when claiming done)

```
Read docs/superpowers/specs/2026-08-04-download-ambiguous-title-fix-goals.md
Verify G1.1–G1.5, G2.1–G2.5, G3.1–G3.5, G4.1–G4.4 against the actual repo.
If any G*.* FAIL, list blockers and VERDICT: REJECT.
If only non-goals remain, VERDICT: APPROVE or APPROVE_WITH_NITS.
End with exactly: VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT
```

---

*Author: Grok Build · multi-path adversarial plan locked to Path A for all three problems.*
