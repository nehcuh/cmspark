# Multi-Adversarial Code Review — main S51 pull (post-S46 → HEAD)

**Date**: 2026-08-07  
**Range**: `6d2cdcf..14e1b28` (after `git pull --ff-only origin main`)  
**Base**: `6d2cdcf` (S46 handoff tip; prior multi-lane closed Trust B design issues → #126)  
**Tip**: `14e1b28` (Merge #131 settings-thread-compact-ux)  
**Method**: 4 independent adversarial lanes + orchestrator user-perspective filter  
**Orchestrator**: Grok Build · post-ship multi-lane pattern  

**Lane reports**:
- [`s51-lane-security-20260807.md`](s51-lane-security-20260807.md)
- [`s51-lane-correctness-20260807.md`](s51-lane-correctness-20260807.md)
- [`s51-lane-architecture-20260807.md`](s51-lane-architecture-20260807.md)
- [`s51-lane-compat-20260807.md`](s51-lane-compat-20260807.md)

**Diff artifacts**:
- [`s51-main-pull-diff-stat-20260806.txt`](s51-main-pull-diff-stat-20260806.txt) (or same-day sibling)
- Production themes below (docs/memory excluded from judgment)

---

## Lane verdicts

| Lane | Status | Recommendation |
|------|--------|----------------|
| Security | WATCH | **REQUEST_CHANGES** |
| Correctness | WATCH | **REQUEST_CHANGES** |
| Architecture | WATCH | **REQUEST_CHANGES** |
| Compat/Platform | OK | **PASS_WITH_NITS** |

---

## Themes in range

| Theme | PR / commits | Prior dual-review |
|-------|--------------|-------------------|
| Trust B lifecycle | #126 `7b71eef` | Claude+Pi APPROVE_WITH_NITS |
| Thread History IA | #127 | R2 both APPROVE_WITH_NITS |
| shell_exec abort | #128 | R2 both APPROVE_WITH_NITS |
| voice input M1 | #129 | Pi R2 APPROVE_WITH_NITS |
| analyze_image data: | #130 | R3 Pi APPROVE / Claude AWN |
| settings accordion + context budget | #131 | Pi APPROVE_WITH_NITS |

---

## Orchestrator user-perspective filter

For each multi-lane finding, first-principles from the **user product path** (not review theater):

| Candidate | Real product/code issue? | Decision |
|-----------|--------------------------|----------|
| Trust cookie survives soft-delete → hard-delete re-restores cruise | **YES** — user path: Trust scene → 移入回收站 → Settings 关三旗 → 永久删除 → cruise 被 cookie 静默写回 | **P0 KEEP** |
| mid_loop recompact drops M2 summary from **LLM request** (meta kept) | **YES** — long tool loops lose the only compressed early context; UI「查看摘要」与模型所见双真 | **P0 KEEP** |
| Soft-delete keeps message files / history.db | Design recycle-bin; not a vuln if copy honest | **DEMOTÉ / product-OK** |
| Voice STT to browser vendor | Disclosed + privacy ack; no Companion elevation | **ACCEPT** |
| Context auto default without first-run ack | Product choice; modes in Settings; not silent privilege | **P2 nit** |
| Windows voice permission copy macOS-only | Real UX miss, not security | **P1/P2** |
| win32 taskkill untested | Residual verification gap | **P2** |
| Multi-panel single hard-delete no broadcast | Rare multi-surface desync | **P2** |
| data: SSRF / install spoof / spawn Trust | Prior P0s **HOLD** at tip | **HOLD** |

---

## Final synthesis

| Field | Value |
|-------|--------|
| **Architectural status** | WATCH |
| **Internal multi-lane** | **REQUEST_CHANGES** |
| **Merge-ready (code already on main)?** | **YES for** shell abort, voice M1, analyze_image data:, History IA core, Trust B primary leave paths (unapply/uninstall/switch/spawn/install strip) |
| | **NO for treating Trust×Trash + mid_loop M2 as closed** — two cross-feature defects remain |
| **Product ship honesty** | Do not claim “删除对话后安全配置一定回到原样” until P0-1; do not claim “长会话工具轮仍保留滚动摘要” until P0-2 |

### Deterministic merge gate

- Architect ≠ CLEAR  
- Security HIGH (Trust soft-delete cookie double-restore) **CONFIRMED** `[inspected]`  
- Correctness HIGH (mid_loop M2 request strip) **CONFIRMED** `[inspected]`  
→ multi-lane **REQUEST_CHANGES**

### Evidence re-check (orchestrator)

**P0-1 Trust soft-delete cookie** `[inspected]`:
- `releaseTrustBeforeThreadGone` restores globals from cookie but **does not clear** `mission_pack_trust_snapshot` (`pack-engine.ts:391-409`).
- Comment on `restoreTrustFromThreadCookie`: “Callers must clear … separately” — soft-delete callers do not.
- `trash()` only sets `trashed_at` (`thread-manager.ts:378-386`).
- Second call on hard-delete-from-trash re-invokes restore with same cookie (`message-router.ts:1190-1207`).
- `findOtherTrustHolders` uses active `list()` (excludes trash) → dual-cookie clobber class.

**P0-2 mid_loop M2 request path** `[inspected]`:
- `shouldRunM2(..., "mid_loop")` returns false (`context-budget-m2.ts`).
- `messages = compact.messages` installs plain M1 omit notice.
- Meta keep path restores `rolling_summary` for UI (`adapter.ts:557-588`) but **never** re-calls `attachRollingSummaryToMessages` on the request array.
- Result: dual-truth (UI summary vs model context).

---

## P0 — must fix (this session)

### 1. Clear Trust cookie on first release; never double-restore

- **Fix**:
  1. `releaseTrustBeforeThreadGone(thread, by, threadManager?)` after successful restore: `applyPackPatch` / update nulling `mission_pack_trust_snapshot` (and keep pack composition as product decides — Architecture F3 is separate MED).
  2. Make release **idempotent** (second call no-ops when cookie null).
  3. Tests: apply Trust → trash → flip Settings cruise OFF → hard-delete → flags stay OFF; trash A(trust) → apply B(trust) → hard-delete A → B elevation not clobbered to A’s pre-apply.

### 2. mid_loop re-attach prior rolling summary into LLM messages

- **Fix**:
  1. After resolving `keepSummary` on mid_loop, if mode stayed m1: `messages = attachRollingSummaryToMessages(messages, compact.droppedCount, keepSummary)`; set `mode = "m2"`.
  2. Event `mode` agrees with kept summary.
  3. Test: pre_loop M2 → mid_loop recompact → request contains `SUMMARY_PREFIX` + prior bullets.

---

## P1/P2 — optional / non-blocking this batch

| ID | Sev | Item |
|----|-----|------|
| P1-voice-copy | M | Windows voice permission copy not macOS-only |
| P2-broadcast | L | single `thread.delete` hard broadcast |
| P2-win-test | L | win32 tree-kill integration test |
| P2-context-ack | L | first-run informed ack when shipping auto default |
| P2-pack-split | L | soft-trash leaves pack composition without Trust |

---

## HOLDS (do not re-break)

| Theme | Status |
|-------|--------|
| #126 unapply/uninstall/switch restore | HOLD |
| #126 install strip origin/trust | HOLD |
| #126 spawn allowTrust:false | HOLD |
| #126 journal + single-holder (active) | HOLD |
| #128 shell abort + process tree | HOLD |
| #130 data: local decode / no schemeOk | HOLD |
| #127 trash list_scope / @ Enter / batch busy | HOLD |
| #129 voice no auto-send / busy gate | HOLD |

---

## Recommended follow-up batch

**Branch**: `fix/s51-trust-trash-m2-midloop`

1. P0-1 Trust release clears cookie + tests  
2. P0-2 mid_loop attachRollingSummary + tests  
3. Optional: Windows voice copy nit if touch-adjacent  
4. Pi re-review of fix diff → commit  

---

## Orchestrator final line

**VERDICT: REQUEST_CHANGES**

Non-Trust non-budget themes are solid at tip. Cross-feature defects: **Trust × soft-delete cookie lifetime** and **context-budget mid_loop M2 request strip**.
