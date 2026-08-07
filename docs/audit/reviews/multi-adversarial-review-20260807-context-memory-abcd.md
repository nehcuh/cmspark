# Multi-Adversarial Code Review — Waves A–D (context / memory / thinking / knowledge)

**Date**: 2026-08-07  
**Range**: `5a401f1..849639c`  
**Base**: `5a401f1` (S52 multi-lane nits + supply-chain pins · #133)  
**Tip**: `849639c` (Merge #136 Wave D)  
**Method**: 4 independent adversarial lanes in parallel (Security / Correctness / Architecture / Compat) + orchestrator re-verify  
**Orchestrator**: Grok Build · post-ship multi-lane pattern  

**Production commits (no-merges)**:
| Commit | Theme |
|--------|--------|
| `ae8bbdb` | Wave A+B: scene knowledge binding + H1 ThreadHandoff (#134) |
| `8d5ab36` | Wave C: `thread_recall` cold archive search (#135) |
| `8135ad6` | Wave D: reasoning display modes + export opt-in (#136) |

**Prior dual-gates (plan + impl)**: Wave A/B/C/D plan+impl Claude+Pi artifacts under `docs/audit/reviews/wave-*`.

**Lane reports**: this synthesis embeds lane scoreboards (lanes ran as explore subagents; not separate files).

---

## Lane verdicts

| Lane | Status | Recommendation |
|------|--------|----------------|
| Security | WATCH | **REQUEST_CHANGES** |
| Correctness | WATCH | **REQUEST_CHANGES** |
| Architecture | **CLEAR** (core HOLDs) | **PASS_WITH_NITS** |
| Compat/Platform | WATCH (product wiring) | **PASS_WITH_NITS** |

---

## Final synthesis

| Field | Value |
|-------|--------|
| **Architectural status** | **CLEAR** on Runtime/Digest/Export, Knowledge≠Trust, same-thread cold archive, no raw CoT *in notice body* |
| **Internal multi-lane** | **REQUEST_CHANGES** |
| **Merge-ready (code already on main)?** | **YES for** core compact path (M1/H1/M2), pack knowledge apply/unapply, `thread_recall` pure search+F-S5 for covered tools, export *default-off* privacy, worker isolation |
| | **NO for treating Waves A–D as “settings-complete / security-clean”** until minimum bar below |
| **Product ship honesty** | Do **not** claim: (1) Settings reasoning mode updates all historical rows; (2) export-include-thinking applies to StatusRail/ThreadList/🧠; (3) fork keeps scene knowledge; (4) compaction/recall fully F-S5 for workspace files; (5) history.db never retains recall queries |

### Deterministic merge gate

- Architect = **CLEAR** on axis HOLDs  
- Security **HIGH OPEN**: S-1 workspace F-S5, S-2 history.db recall payloads, S-3 handoff `role:user` framing  
- Correctness **HIGH OPEN**: F1 MessageRow memo, F2 export wiring, F3 fork composition  
→ multi-lane **REQUEST_CHANGES**

### Evidence levels

- Lanes: primarily `[inspected]` tip + cited paths  
- Orchestrator re-check:
  - MessageRow custom memo omits `showReasoningMode` — **CONFIRMED** `[inspected]` `ChatView.tsx:708-719`
  - StatusRail/ThreadList export omit `include_reasoning` — **CONFIRMED** `[inspected]`
  - Summary router drops `include_reasoning` — **CONFIRMED** `[inspected]` `message-router.ts` summary branch
  - Fork copies skills+tabs only — **CONFIRMED** `[inspected]` `message-router.ts:1593-1596`
  - `COMPACT_SENSITIVE_*` lacks `workspace_*` — **CONFIRMED** `[inspected]` `context-budget.ts:19-36`
  - `historyStore.record` raw params for all tools incl. recall — **CONFIRMED** `[inspected]` `adapter.ts:998-1005`
  - Handoff notice `role:user` — **CONFIRMED** `[inspected]` `context-budget.ts:105-113`
  - Logs omit recall query text — **CONFIRMED** `[inspected]` `server.ts:3851-3855`

---

## Scope (production themes)

| Wave | PR | What landed |
|------|-----|-------------|
| A | #134 | `active_knowledge_ids` + pack `knowledge_refs` → Composition inject |
| B | #134 | H1 `ThreadHandoff` structured working memory + mid_loop reformat |
| C | #135 | `thread_recall` same-thread keyword/CJK + F-S5 redact + gated hint |
| D | #136 | Reasoning UI modes + export `include_reasoning` opt-in |

---

## Cross-lane scoreboard (KEEP findings)

| ID | Sev | Title | Lanes | Evidence | Fix sketch |
|----|-----|-------|-------|----------|------------|
| **P0-1** | **H** | MessageRow custom memo ignores `showReasoningMode` (+ stale `onExport`) | Corr F1 | `ChatView.tsx:708-719` | Compare `showReasoningMode`; pass `exportIncludeReasoning` primitive or drop custom cmp for those props |
| **P0-2** | **H** | Export include-reasoning only on ChatView single; StatusRail/ThreadList/summary ignore | Corr F2 · Compat M · Sec S-7 | StatusRail 318–345; ThreadList 440–444; message-router summary omit | Plumb flag all UI entrypoints; pass into `serializeSummaryToMarkdown` |
| **P0-3** | **H** | F-S5 gap: `workspace_*` (file bodies) not redacted on compact / recall | Sec S-1 | `context-budget.ts:19-36,207-210`; recall reuses path | Add workspace_* to sensitive set like `host_read`; tests |
| **P0-4** | **H** | `thread_recall` query + hit excerpts land in `history.db` unredacted | Sec S-2 | `adapter.ts:998-1005`; `history/store.ts` omits `thread_recall` | Special-case redactForStorage: hash query, metadata-only hits |
| **P1-1** | **H** | H1/M2 notices injected as `role:user` without untrusted framing | Sec S-3 | `context-budget.ts:90-113` vs tool `wrapUntrusted` | Prefer system/data framing + “machine memory not user intent” in system prompt |
| **P1-2** | **H** | `thread.fork` drops knowledge / modes / whitelist / pack / handoff / reasoning | Corr F3 · Sec S-5 · Arch F7 | `message-router.ts:1584-1596` | Deliberate fork field matrix; tests; never auto-reapply Trust |
| **P2-1** | **M** | Compaction MCP F-S5 weaker than history.db | Sec S-4 | context-budget vs store MCP RE | Align policies |
| **P2-2** | **M** | Missing dual-truth tests (memo, export matrix, fork, pack×recall hint) | Corr F7 | — | Contract tests |
| **P2-3** | **M** | `rolling_summary` dual-duty (UI chip + request re-attach) | Arch F6 · Corr F4 | adapter meta write | Split later; don’t expand dual-use |
| **P2-4** | **M** | Pack/orchestrator omit `thread_recall` → long pack sessions lose cold archive | Arch F8 · Compat L · Corr F6 | pack yamls; ORCHESTRATOR allowlist | Document; optional pack template — **do not force-inject** |
| **P3-1** | **L** | H1 extract may consume CoT slices (notice body still structured) | Sec S-6 · Arch residual | adapter `includeReasoning: true` | Default false or stricter |
| **P3-2** | **L** | D2 skill-path knowledge union residual | Arch F7 | skill-engine | Remove after release window |
| **P3-3** | **L** | Recall ranks on unredacted bodies | Sec S-8 | thread-recall score path | Score post-redact |

---

## Verified-clean (HOLD)

| Control | Status | Evidence |
|---------|--------|----------|
| Runtime ≠ Digest ≠ Export | **HOLD** | Separate modules/meta/serializers |
| No raw CoT in compressed *notice* body | **HOLD** | formatHandoffForNotice / omit/summary prefixes only |
| Knowledge ≠ Trust elevation | **HOLD** | pack Trust only via gesture path; knowledge = Composition IDs |
| No cross-thread embedding memory | **HOLD** | `thread_recall` same-thread only; `@` uses digest cards |
| Worker cannot search parent via recall | **HOLD** | forced `__thread_id`; workers empty history |
| Export reasoning default-off (protocol) | **HOLD** | `include_reasoning === true` only |
| Pack knowledge apply/unapply + D8 empty preserve | **HOLD** | pack-engine + tests |
| mid_loop H1 re-attach when rolling_summary empty | **HOLD** | context-budget + tests |
| Logs omit recall query text | **HOLD** | query_len only |
| Cookie/shell/evaluate F-S5 (covered set) | **HOLD** | tests present |

---

## Minimum bar (before claiming “settings-complete / security-clean”)

1. **P0-1** MessageRow memo includes `showReasoningMode` (and export flag freshness).  
2. **P0-2** Wire `include_reasoning` on StatusRail + ThreadList + summary router.  
3. **P0-3** F-S5 `workspace_*` on compact/recall.  
4. **P0-4** history.db special-case for `thread_recall`.  
5. **P1-2** fork copies at least `active_knowledge_ids` + selection modes (document pack/trust policy).  
6. **P1-1** handoff framing hardening (can be same batch or immediate follow-up; security residual).  

Optional (non-blocking for honesty docs): P2 dual-duty / pack recall documentation / D2 cleanup.

---

## Product honesty matrix

| Claim | Safe to say today? |
|-------|-------------------|
| Long threads compact with M1 head-drop + H1 structured handoff | **Yes** (full surface) |
| Same-thread cold search via `thread_recall` when tool allowed | **Yes** |
| Pack-bound knowledge injects into system prompt | **Yes** |
| Thinking export default off | **Yes** |
| Settings “始终展开/折叠” applies to **all** historical reasoning blocks | **No** (P0-1) |
| Settings “导出包含思考过程” applies to **all** export buttons | **No** (P0-2) |
| Fork preserves scene knowledge / pack surface | **No** (P1-2) |
| Compaction never re-surfaces workspace file secrets into H1/M2/recall | **No** (P0-3) |
| history.db free of recall query text | **No** (P0-4; logs OK) |

---

## Recommended next batch

**Wave E (hardening)** — single PR preferred:

1. UI: memo + export plumbing (P0-1, P0-2)  
2. F-S5 + history: workspace_* + thread_recall storage (P0-3, P0-4)  
3. Fork composition matrix (P1-2)  
4. Handoff untrusted/system framing (P1-1)  
5. Tests for dual-truth matrix  

Then re-run multi-lane → target **PASS_WITH_NITS**.

---

## Wave E status (2026-08-07 same-session)

**Plan**: `docs/superpowers/plans/2026-08-07-wave-e-ux-security-hardening.md`

| ID | Status |
|----|--------|
| P0-1 MessageRow memo | **FIXED** `[inspected]` + code |
| P0-2 export wiring + summary router | **FIXED** |
| P0-3 workspace F-S5 | **FIXED** + unit test |
| P0-4 history thread_recall | **FIXED** + unit test |
| P1-1 notice framing | **FIXED** (content frame; role still user) |
| P1-2 fork composition | **FIXED** + integration test |

Targeted companion tests: **173 pass / 0 fail** `[executed]` (context-budget, handoff, recall, markdown-export, history, files).

**Residual for re-lane**: role=user notices (framed only); pack×recall product docs; rolling_summary dual-duty; D2 union. Dual-gate / multi-lane re-review recommended before claiming PASS_WITH_NITS on main.

---

## Gate vs prior dual-reviews

Plan/impl dual gates (Claude+Pi) correctly landed core mechanics. **Post-ship multi-lane** surfaces **cross-surface wiring** (export entrypoints, memo) and **adjacent security surfaces** (history.db, workspace F-S5, fork composition) that dual gates on single-wave diffs under-weighted. This is expected post-ship multi-lane value, not a failure of the dual-gate process on A–D cores.

---

*Orchestrator synthesis 2026-08-07 · four independent explore lanes · no production code modified in this review.*
