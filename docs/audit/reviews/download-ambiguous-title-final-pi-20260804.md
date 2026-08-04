# Pi Final Completion Gate — Download Probe · ELEMENT_AMBIGUOUS UX · Thread Titles

| Field | Value |
|-------|--------|
| Date | 2026-08-04 |
| Reviewer | Pi (final completion gate) |
| Spec | `docs/superpowers/specs/2026-08-04-download-ambiguous-title-fix-goals.md` |
| Branch (worktree) | `fix/download-ambiguous-thread-title` @ `4b8a711` (same tip as `main` / `origin/main`) |
| Plan Pi | `download-ambiguous-title-plan-pi-20260804.md` → **APPROVE_WITH_NITS** |
| Impl Claude | `download-ambiguous-title-impl-claude-20260804-232018.md` → **APPROVE** |
| Impl Pi (dual) | `download-ambiguous-title-impl-pi-20260804-232018.md` → connection error (not a substantive review) |
| Evidence levels | `[inspected]` code/artifact read · `[prior-executed]` Claude dual gate claimed test pass · `[git]` refs/logs |

---

## Executive summary

**G1–G3 product criteria are implemented correctly in the working tree** (static `downloads_find` import, Chinese hints + matches on ambiguous download targeting, provisional titles + list fallback + title-fail logging). **G4.4 is FAIL**: implementation is **not committed** and **not pushed** — branch tip equals pre-change `main` (`4b8a711`); dual-review patch listed files as unstaged `M` / `??`.

Per goals doc: any G*.* FAIL → **REJECT**.

---

## G1 — Downloads probe / local file detect

| ID | Result | Evidence |
|----|--------|----------|
| **G1.1** | **PASS** | `[inspected]` `chrome-extension/src/background/browser-bridge.ts` L11–14: static `import { runDownloadsFind } from "./downloads-find"` with explicit comment that MV3 dynamic import caused `importScripts` chunk failure (`#dagg58`). Grep of `background/`: no remaining `await import("./downloads-find")`. |
| **G1.2** | **PASS** | `[inspected]` `browser-download-handler.ts` L12–16: static import of `findPreferredExistingDownload` / `redactDownloadUrl` from `./downloads-find`. prefer_existing path shares same module (no dynamic chunk). |
| **G1.3** | **PASS** (nit) | `[inspected]` Bridge catch (`browser-bridge.ts` ~1262–1276): `error_code` (`DOWNLOADS_FIND_CHUNK_LOAD` / `DOWNLOADS_FIND_FAILED`) + `user_hint_zh`. `downloads-find.ts` catch (~218–234): `DOWNLOADS_SEARCH_FAILED` / chunk load + `user_hint_zh` (+ dual `recovery_zh`). **Nit:** early returns `HINT_REQUIRED` and `DOWNLOADS_API_UNAVAILABLE` still lack `user_hint_zh` (plan Pi M2 residual). ChatView only surfaces `data.user_hint_zh`, so those two soft failures stay English-only. Non-blocking relative to production `#dagg58` / search-throw paths. |
| **G1.4** | **PASS** | `[inspected]` Tests present: `chrome-extension/tests/downloads-find.test.ts`, `browser-download-handler.test.ts` (ambiguous asserts). `[prior-executed]` Claude impl review: extension tests green. This gate did not re-spawn the test runner in-process. |
| **G1.5** | **PASS** | `[inspected]` `companion/src/bridge/_browser_download_tool_snippet.ts` still documents `downloads_find` → fallback `browser_download` → `skill_install({ zip_path })`. skill_install path not regressed. |

**G1 overall: PASS** (one non-blocking hint-normalization nit)

---

## G2 — ELEMENT_AMBIGUOUS UX

| ID | Result | Evidence |
|----|--------|----------|
| **G2.1** | **PASS** | `[inspected]` `browser-download-handler.ts` L162–179: `user_hint_zh` explains multi-match count, lists candidate preview, asks for exact text / selector / evaluate; “防止点错”. |
| **G2.2** | **PASS** | `[inspected]` Same block: `matches: match?.matches?.slice(0, 5)` plus `count` / `error_code: ELEMENT_AMBIGUOUS`. |
| **G2.3** | **PASS** | `[inspected]` `ChatView.tsx` `toolResultUserHint` (~460–466): prefers `result.data.user_hint_zh` when `success === false`. Tool card path uses `userHint` (~501). |
| **G2.4** | **PASS** | `[inspected]` `browser-download-handler.test.ts` L174–201: multi-match asserts `ELEMENT_AMBIGUOUS`, `user_hint_zh` `/匹配/`, `matches.length >= 2`, busy released. |
| **G2.5** | **PASS** (documented skip) | Path A fail-closed retained: multi-match returns error; no auto-pick of first interactive candidate. Correct choice per goals lock. |

**G2 overall: PASS**

---

## G3 — Thread titles / history list

| ID | Result | Evidence |
|----|--------|----------|
| **G3.1** | **PASS** | `[inspected]` `companion/src/llm/adapter.ts`: `provisionalTitleFromUserText` (~1119–1128); `ensureProvisionalThreadTitle` (~1134–1149); called from `chatCreate` on first real user message (~275–282) before LLM/tools. Empty alias only; non-empty preserved. |
| **G3.2** | **PASS** | `[inspected]` `generateThreadTitle` (~1164–1173): `hasOnlyProvisional` compares alias to provisional derived from first user message (incl. ellipsis-strip); allows upgrade when only provisional. Called after assistant done (~636). |
| **G3.3** | **PASS** | `[inspected]` `ThreadList.tsx` L133–135: empty/whitespace alias → ``未命名 · ${id.slice(0, 8)}``; not blank. |
| **G3.4** | **PASS** | `[inspected]` `generateThreadTitle` catch (~1222–1228): `logger.warn("thread.title_generate_failed", { thread_id, error })` — not silent void. |
| **G3.5** | **PASS** | `[inspected]` `companion/tests/thread-provisional-title.test.ts` exists (trim/truncate/empty/CJK). `[prior-executed]` Claude: 3/3 pass. |

**G3 overall: PASS**

---

## G4 — Process / ship

| ID | Result | Evidence |
|----|--------|----------|
| **G4.1** | **PASS** | `[inspected]` Goals + multi-path plan in goals doc; Pi plan review `docs/audit/reviews/download-ambiguous-title-plan-pi-20260804.md` → **APPROVE_WITH_NITS**. |
| **G4.2** | **PASS** (nit) | Claude impl **APPROVE** present: `download-ambiguous-title-impl-claude-20260804-232018.md`. Dual Pi file exists but content is “Connection error” / verdict UNKNOWN in `download-ambiguous-title-impl-verdict-20260804-232018.json` (`both_approve: false`). **This final gate** is the substantive Pi implementation review. Process nit: dual Pi did not complete at milestone. |
| **G4.3** | **FAIL** | G1–G3 green in worktree; **G4.4 red** → cannot APPROVE final gate. |
| **G4.4** | **FAIL** | `[git]` HEAD branch `fix/download-ambiguous-thread-title` → `4b8a711` = `main` = `origin/main`. Branch log: created from HEAD only — **no commit** of fix. No `refs/remotes/origin/fix/download-ambiguous-thread-title`. Dual patch header listed implementation files as unstaged modifications. **Not committed; not pushed.** |

**G4 overall: FAIL** (blocker G4.4)

---

## Blockers (must fix before re-gate)

1. **G4.4 — Commit implementation + review artifacts on `fix/download-ambiguous-thread-title` (or equivalent), then push to remote.**
   - Code: `browser-bridge.ts`, `browser-download-handler.ts`, `downloads-find.ts`, `ThreadList.tsx`, `browser-download-handler.test.ts`, `adapter.ts`, `thread-provisional-title.test.ts`
   - Docs already present: goals, plan Pi, impl Claude/diff, this final report after re-run
2. Re-run focused tests after commit (extension download tests + `thread-provisional-title`) and record `[executed]` on re-gate.

## Non-blocking nits (do not alone force REJECT after G4.4 fixed)

| Nit | Detail |
|-----|--------|
| N1 | Add `user_hint_zh` to `HINT_REQUIRED` and `DOWNLOADS_API_UNAVAILABLE` early returns in `downloads-find.ts` (plan M2 completeness; ChatView visibility). |
| N2 | Optional unit test asserting catch-path `user_hint_zh` when injectable API throws. |
| N3 | Dual Pi milestone left a dead “Connection error” artifact — optional re-dual or mark superseded by this final gate. |

## Explicit non-goals (not required)

- Full GitHub download automation rewrite — not claimed  
- 100% LLM title quality — not claimed  
- Downloads security segment allowlist semantics — unchanged  
- Full thread panel redesign — only empty-alias fallback  

## ADR-020 / capability axes

No new Surface / Composition / Autonomy / trust-weaken / confirm-skip. L1 browser messaging + companion title UX only. Community channel. **OK.**

---

## Criterion matrix (compact)

| Criterion | Status |
|-----------|--------|
| G1.1 | PASS |
| G1.2 | PASS |
| G1.3 | PASS (+nit) |
| G1.4 | PASS |
| G1.5 | PASS |
| G2.1 | PASS |
| G2.2 | PASS |
| G2.3 | PASS |
| G2.4 | PASS |
| G2.5 | PASS (fail-closed documented) |
| G3.1 | PASS |
| G3.2 | PASS |
| G3.3 | PASS |
| G3.4 | PASS |
| G3.5 | PASS |
| G4.1 | PASS |
| G4.2 | PASS (+nit) |
| G4.3 | FAIL (depends G4.4) |
| G4.4 | **FAIL** |

---

## Verdict rationale

Product acceptance for downloads / ambiguous UX / titles is **landed in the working tree and consistent with Path A locks**. Ship process criterion **G4.4 is mandatory** and currently false: tip commit does not contain the change set, and remote has no branch/push of this work. Goals doc completion authority requires all G1–G4; therefore final gate is **REJECT** until commit + push, then re-run Pi final gate (expected APPROVE or APPROVE_WITH_NITS for N1 only).

VERDICT: REJECT
