# Multi-Adversarial Code Review — main S52 pull (#132 Trust trash + mid_loop M2 · packaging SoT)

**Date**: 2026-08-07  
**Range**: `14e1b28..d34bac2` (after `git pull --rebase origin main`)  
**Base**: `14e1b28` (Merge #131 settings-thread-compact-ux · S51 multi-lane tip)  
**Tip**: `d34bac2` (`chore(packaging): single version SoT, drop stale 0.2.0 stamps`)  
**Method**: 4 independent adversarial lanes in parallel (Security / Correctness / Architecture / Compat) + orchestrator re-verify + machine checks  
**Orchestrator**: Grok Build · post-ship multi-lane pattern (`memory/project-knowledge.md`)  

**Lane reports**:
- [`s52-lane-security-20260807.md`](s52-lane-security-20260807.md)
- [`s52-lane-correctness-20260807.md`](s52-lane-correctness-20260807.md)
- [`s52-lane-architecture-20260807.md`](s52-lane-architecture-20260807.md)
- [`s52-lane-compat-20260807.md`](s52-lane-compat-20260807.md)

**Diff artifacts**:
- [`s52-main-pull-diff-20260807-090154.patch`](s52-main-pull-diff-20260807-090154.patch)
- [`s52-main-pull-diff-stat-20260807-090154.txt`](s52-main-pull-diff-stat-20260807-090154.txt)

**Prior reviews in range**:
- S51 multi-lane `6d2cdcf..14e1b28` → **REQUEST_CHANGES** (P0 Trust trash cookie + mid_loop M2 dual-truth) — [`multi-adversarial-review-20260807-main-s51.md`](multi-adversarial-review-20260807-main-s51.md)
- #132 fix adversarial + Pi → APPROVE_WITH_NITS — [`s51-p0-fix-adversarial-20260807.md`](s51-p0-fix-adversarial-20260807.md)

---

## Lane verdicts

| Lane | Status | Recommendation |
|------|--------|----------------|
| Security | **CLEAR** | **PASS_WITH_NITS** |
| Correctness | WATCH | **PASS_WITH_NITS** |
| Architecture | **CLEAR** | **PASS_WITH_NITS** |
| Compat/Platform | WATCH | **PASS_WITH_NITS** |

---

## Final synthesis

| Field | Value |
|-------|--------|
| **Architectural status** | **CLEAR** |
| **Internal multi-lane** | **PASS_WITH_NITS** |
| **Merge-ready (code already on main)?** | **YES** for #132 Trust trash cookie + mid_loop M2 re-attach + packaging SoT + voice OS copy + single hard-delete broadcast |
| **S51 P0-1 Trust soft-delete cookie** | **FIXED / HOLDS** |
| **S51 P0-2 mid_loop M2 request strip** | **FIXED / HOLDS** |
| **Product ship honesty** | May claim soft-trash releases Trust cruise and hard-delete does not re-fire; may claim mid_loop keeps prior rolling summary on the LLM request path (content is pre_loop text, not a fresh mid_loop summary) |

### Deterministic merge gate

- Architect = **CLEAR**  
- No Security HIGH OPEN  
- No Correctness HIGH OPEN  
- All four lanes **PASS_WITH_NITS** (nits only)  
→ multi-lane **PASS_WITH_NITS** (not REQUEST_CHANGES)

### Evidence levels

- Lanes: primarily `[inspected]` patch + live tip  
- Orchestrator re-check (this session):
  - `releaseTrustBeforeThreadGone`: restore when `!alreadyTrashed`, then clear cookie via TM; already-trashed clear-only — **CONFIRMED** `[inspected]` `pack-engine.ts:398-445`
  - Callers pass `threadManager`: delete / batch_delete / cleanup_empty — **CONFIRMED** `[inspected]` `message-router.ts:1193`, `1259`, `1355`
  - list trash cookie scrub without restore — **CONFIRMED** `[inspected]` `message-router.ts:1389-1396`
  - mid_loop re-attach: `phase === "mid_loop" && keepSummary && mode === "m1"` → `attachRollingSummaryToMessages` + `mode = "m2"` — **CONFIRMED** `[inspected]` `adapter.ts:557-580`
  - #126 HOLDs (install strip / spawn allowTrust:false / unapply restore) — **HOLD** `[inspected]` (not edited in range)
  - Targeted tests: packs-engine + context-budget — **37 pass / 0 fail** `[executed]`
  - Package gates — **62 pass / 0 fail** `[executed]`

---

## Scope (production themes in range)

| Theme | Commits / notes |
|-------|-----------------|
| #132 Trust trash cookie | `5ee73eb` — restore-then-clear; alreadyTrashed clear-only; list scrub |
| #132 mid_loop M2 re-attach | same — request path + mode m2 dual-truth close |
| #132 nits | single hard-delete broadcast; Windows voice permission copy |
| Packaging SoT | `d34bac2` — companion/package.json SoT; Info.plist placeholder; NSIS inject; gates |

---

## P0 re-verify (S51 → closed)

### 1. Trust cookie on soft-delete — **FIXED**

- **Lanes**: Security F1 · Correctness Trust re-verify · Architecture F1  
- **Where**: `pack-engine.ts:398-445`; callers `message-router.ts`  
- **User path closed**: Trust scene → 移入回收站 → Settings 关三旗 → 永久删除 → cruise stays OFF  
- **Also closed**: trash A → apply B → hard-delete A does not clobber B; pre-S51 leftover cookie on hard-delete (clear-only)  
- **Tests**: `packs-engine.test.ts` S51 P0 matrix `[executed]`

### 2. mid_loop M2 request re-attach — **FIXED**

- **Lanes**: Correctness P0-2 · Architecture F3 · Security F4 (non-privilege)  
- **Where**: `adapter.ts:557-580`  
- **Behavior**: prior `rolling_summary` re-attached into LLM messages; mode/event `m2`; single notice via in-place replace  
- **Tests**: context-budget two-pass unit test `[executed]` (orchestration residual: no full `runContextBudgetPass` integration test — Correctness F3 LOW)

---

## Nits only (non-blocking)

| ID | Sev | Item | Lane |
|----|-----|------|------|
| N1 | L | Soft-trash leaves Pack **composition** after Trust release (honesty, not cruise clobber) | Sec F3 · Arch F2 |
| N2 | L | mid_loop re-attach nested in meta `try`; dead mode ternary after re-attach | Corr F1/F2 |
| N3 | L | Unit test is pure two-pass; no adapter orchestration integration test | Corr F3 |
| N4 | L | NSIS fallback hardcodes `0.4.0`; ext≠companion warn-only | Corr F4 · Compat F1/F2 |
| N5 | L | ADR-020 lifecycle string omits trash/delete as Trust exit | Arch F5 |
| N6 | L | Side Panel `error-map.ts` voice copy still OS-agnostic | Compat F4 |
| N7 | L | mid_loop `mode:m2` is re-attach of pre_loop text, not fresh mid_loop summary | Corr F6 · Arch F3 residual |

---

## HOLDS (do not re-break)

| Theme | Status |
|-------|--------|
| #126 unapply / uninstall / switch restore | **HOLD** |
| #126 install strip origin/trust | **HOLD** |
| #126 spawn `allowTrust:false` | **HOLD** |
| #126 journal + single-holder (active) | **HOLD** (strengthened by cookie clear) |
| S51 P0-1 Trust soft-delete cookie | **CLOSED** |
| S51 P0-2 mid_loop M2 dual-truth | **CLOSED** |
| #128 shell abort / #130 data: / #127 trash list_scope / #129 voice gates | **HOLD** (outside #132 edit surface) |

---

## Recommended follow-up (optional, not ship-gate)

**S52 nits batch implemented (2026-08-07 follow-up session):**

| ID | Action |
|----|--------|
| N2/N3/N7 | `retainMidLoopRollingSummary` pure helper; re-attach **before** meta try; unit tests; mode honesty documented |
| N4 | NSIS fallback ↔ companion version gate; ext/companion lock-step gate; ps1 fail-closed (override `CMSPARK_ALLOW_VERSION_DRIFT=1`) |
| N5 | ADR-020 lifecycle includes trash/delete cookie clear + soft-trash composition residual |
| N6 | `osMicPrivacyHint` + `mapSpeechError` OS-aware; voice-permission reuses helper |
| N1 | ADR + pack-engine comment + SceneStatusBar title honesty (no unapply-on-trash) |

Out of scope: dual-external re-run; full multi-thread Trust refcount redesign; unapply-on-soft-trash product change.

---

## Commits in range

```
d34bac2 chore(packaging): single version SoT, drop stale 0.2.0 stamps
5ee73eb fix(security,llm): S51 Trust trash cookie + mid_loop M2 re-attach (#132)
```

Local (not in origin tip of this review range; docs-only ahead):

```
bc358b7 docs(memory): S51 handoff — settings/timeline/context-budget #131 + multi-PR merge
```

---

## Machine checks (this session)

| Check | Result |
|-------|--------|
| `node --test` packs-engine + context-budget | **37 pass / 0 fail** `[executed]` |
| `scripts/tests/test-package-gates.sh` | **62 pass / 0 fail** `[executed]` |

---

*S52 multi-adversarial · 2026-08-07 · Grok Build*
