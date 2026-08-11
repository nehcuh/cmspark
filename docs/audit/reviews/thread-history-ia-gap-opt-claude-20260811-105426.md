I have all the grounding I need. Let me write the review.

---

# Dual external review — Thread History IA Gap Optimization (batch `thread-history-ia-gap-opt`)

**Reviewer:** Claude (independent) · **Date:** 2026-08-11 · **Stage:** Design SoT only (docs-only diff)

## 1. Summary

The synthesis is a disciplined gap re-plan that keeps the IA-2026-08-06三轴方向 intact, correctly scopes llm_wiki to method-borrow (not product transplant), gates Graph behind digest coverage, and right-sizes Wave A as independently shippable. Capability declaration is honest (L0 / no Compose / no Autonomy change / trust monotonicity preserved). All four reported user pains (U1–U4) map to concrete code-level evidence I spot-checked. No R1–R6 rejection gate fires. Approving with nits — the spec is safe to enter Wave A workflow implementation after the second external reviewer concur.

## 2. Code spot-check notes (confirm/refute status table §2)

| Claim in synthesis | Verdict | Evidence |
|---|---|---|
| `handleExtractDigest` exists, row-only icon, no `⋯` item | ✅ confirm | `ThreadList.tsx:225-245` (handler), `:425-434` (row 🏷 button); `⋯` menu at `:713-746` lists only 生成标题/起名/清理空白/整理助手/回收站 — no extract item |
| `panel.overflow: "hidden"` + Tags maxHeight 480 | ✅ confirm | `ThreadList.tsx:971` (`overflow: "hidden"` on `styles.panel`); `:349` `panelMaxHeight = selectMode \|\| view === "tags" ? 480 : 360` |
| Tag cloud has NO max-height / NO collapse | ✅ confirm | `ThreadList.tsx:1181-1187` `styles.tagCloud` has no maxHeight; render at `:588-622` has no "更多" collapse |
| `tldr` NOT shown in list — only `tags` pills | ✅ confirm | `ThreadList.tsx:358` reads `t.digest?.tags`; no `t.digest?.tldr` rendered anywhere in `renderThreadRow` |
| `thread.extract_digest` enforces max 20 | ✅ confirm | `companion/src/message-router.ts:1308-1309` `if (ids.length > 20) return { type: "error", error: "thread.extract_digest max 20 threads per request" }` |
| `ThreadDigest` pipeline exists (P1 backend) | ✅ confirm | `companion/src/threads/digest.ts:1-60`; `contentFingerprint` matches P12; `SENSITIVE_TAG_RE` matches P14 |
| `AtThreadPopover` exists (P1.5) | ✅ confirm | `chrome-extension/src/sidepanel/components/AtThreadPopover.tsx:24` |
| `thread.related` NOT implemented | ✅ confirm | `rg thread\.related` in `companion/src` → no matches |
| `thread_digest` config (default off) NOT implemented | ✅ confirm | `rg thread_digest` in `companion/src` → no matches; consistent with "P1/P3 ❌ 代码未见" |

Patch file is empty (docs-only): confirmed via `git diff --stat` (only untracked .md files). Not stale.

## 3. Capability declaration audit (ADR-020 checklist)

| Field | Declared | Audit |
|---|---|---|
| Surface | L0 chat UX / thread nav metadata | ✅ correct — no CDP/Host additions |
| L2-classes | (none) | ✅ |
| Compose | none new (digest/tags/related = Thread index metadata, NOT Skill/Knowledge/Pack) | ✅ critical correctness — explicitly closes the "implicit Knowledge dual-write" anti-goal (§9, GAP-9) |
| Autonomy | n/a for graph; worker display stays flat+badge | ✅ consistent with IA-2026-08-06 pin P1 |
| Trust | batch_delete / extract 不改 trust; delete still per-id releaseTrust | ✅ carried forward from dual-synthesis P3 — no regression introduced |
| Channel | community \| enterprise unchanged | ✅ |

**Pack-first check:** Wave A adds items *inside* the existing `⋯` menu (A-1) and an empty-state CTA inside the existing Tags view (A-2). No new Side Panel 一级常驻入口. ADR-020 §6 reverse-pattern 1 does not fire.

**New runtime / confirm dialect check:** none. Reuses existing `thread.extract_digest` WS family (`message-router.ts:1299`).

## 4. Rejection gates R1–R6

| # | Gate | Result |
|---|---|---|
| R1 | Graph as primary nav | ✅ Lane A 锁 A2 forbids; Lane B 锁 B2 confines full graph to popover/new-tab |
| R2 | Thread→Knowledge dual-write / llm_wiki ingest as Wave A | ✅ Lane E 锁 E1 forbids; Lane C 锁 C1 forbids graph DB in Wave C |
| R3 | Silent full-library LLM digest with no cap | ✅ 锁 D1 (≤20 + visible + cancellable), 锁 D2 (no silent end-of-session), 锁 D4 (no default full-library), GAP-2 (≤20/batch) |
| R4 | L2 / new confirm dialect / Pack-first chrome | ✅ none introduced |
| R5 | Reopens IA P1–P14 without override | ✅ §6 explicitly preserves all 14 pins; no silent reopen detected |
| R6 | Wave A cannot ship independently | ✅ 锁 G1 + GAP-8 — Wave A acceptance does not require `thread.related` |

All gates hold. **No blocking issues.**

## 5. Nits (non-blocking)

- **N1 — A-1 should explicitly inherit busy-thread skip.** Wave A-1 says "取最多 20 个未标注 id" but doesn't say it skips busy threads. The current code already does (`ThreadList.tsx:129-135` `selectableIds` filters `threadBusyById`). Suggest adding "skips busy threads (carry P2 forward)" to A-1 acceptance so the implementer doesn't regress.
- **N2 — Worker/orchestrator default behavior in batch extract is undefined.** IA-2026-08-06 §B.6 explicitly excluded workers from cleanup assistant by default. The synthesis's Must-answer §6 raises this question but the spec doesn't pin an answer. Recommend: Wave A-1 defaults to **include** workers (digest is harmless, no trust change) BUT Wave A progress UI shows `worker ×N` badge so user can cancel. Cost-conscious users can filter via search before clicking. Not blocking — current behavior already includes them.
- **N3 — U2 root cause labeled "嫌疑"; repro before fix is cheap.** The hypothesis (`overflow:hidden` on panel + `⋯` menu positioned `top:"100%"` inside panel at `ThreadList.tsx:1069-1081`) is structurally plausible, but the synthesis itself hedges. A 5-minute dev repro (open tags view with 5+ tags, click ⋯, observe whether last items are clipped) before implementing A-4 would convert hypothesis to fact. A-4's fix (portal to `document.body` OR panel `overflow:visible` + list-only scroll) covers either root cause, so non-blocking.
- **N4 — GAP-4 tldr 120-char cap vs CJK visual width.** `digest.ts:32` `MAX_TLDR = 120` is character count; 120 CJK chars ≈ 240px+ at 13px font — may wrap in a 300px panel even with ellipsis. Single-line ellipsis (`text-overflow:ellipsis; white-space:nowrap`) handles it visually, but the truncation point will be ~half the Latin case. Acceptable but worth flagging to implementer.
- **N5 — GAP-10 testing scope.** Add: "A-1 button disabled state when 0 untagged non-busy threads exist (don't fire empty batch)" and "A-4 menu portal renders above panel backdrop (z-index > 51)".
- **N6 — Wave C signal weights.** The ×3 / ×4 / ×1.5 / ×0.5 weights are declared "初值，可配置常数，非 ML" — good. Recommend stating these live in a code constant (not user-facing settings UI) to prevent scope creep into "tune your own graph" settings surface later.

## 6. Answers to Must-answer §1–7

1. **Lane locks A–G hold?** Yes. No blocking contradiction with ADR-020 or IA-2026-08-06. Trust monotonicity preserved (delete still per-id `releaseTrust`), no L2/Compose/Autonomy regression, three-axis doctrine preserved.
2. **Wave A right-sized for U1/U2?** Yes. U1 → A-1/A-2 (discoverable entry + empty-state CTA). U2 → A-3/A-4/A-5 (tldr row, overflow fix, tag-cloud collapse). No blocking item missing. (Nits N1/N2 above for completeness.)
3. **U2 root-cause good enough to implement?** Yes — hypothesis is structurally sound (`ThreadList.tsx:971` overflow:hidden + `:1069` menu absolute-positioned inside panel). A-4 fix covers both candidate root causes (portal OR list-only scroll). A 5-min pre-impl repro is recommended (N3) but not blocking.
4. **llm_wiki locks E1–E3 correctly scoped?** Yes. E1 forbids product transplant (entity wiki, default full graph, Louvain UI). E2 permits method borrow (compile-once digest, write-time edges, multi-signal related, lint items) — these are pattern-borrows, not product transplants. E3 correctly routes any future "对话知识化" to a separate ADR with Knowledge/Obsidian export. Neither over-strict (still permits good ideas) nor over-loose (forbids the bad transplant).
5. **Wave C `@` edges required or deferred?** Defer is correct. Signal table note "若可从消息/元数据恢复；否则 Wave C.1 可 defer 到 C.1b" is the right call — `@` edges are not currently persisted as graph edges (they live as `context_refs` in `companion/src/threads/context-refs.ts`), so making them required in C-1 would force a schema migration that doesn't belong in Wave C. Recommend explicitly stating in C-1 acceptance: "if `@` edges unavailable, fall back to 共 tag + TF only; do not block C-1 on edge persistence."
6. **Worker/orchestrator excluded from batch by default?** See N2. Default-include with progress-badge is my recommendation; not blocking. The synthesis's adversarial persona "power user 200+ threads limited budget" is the stress case — the ≤20 cap + visible progress + "继续下一批" gate already prevents runaway cost.
7. **Approve starting Wave A workflow implementation?** **Yes** — pending second external reviewer concurrence (`both_ok=true`).

## 7. Adversarial persona sweep

- **Power user, 200+ untagged, limited budget** — protected by ≤20/batch (GAP-2), visible progress (锁 D1), no silent full-library (锁 D4). Wave B's `max_per_day` adds a second layer when scheduled path ships.
- **Expected "full auto tag everything overnight"** — managed by F1/F2 copy discipline ("提取要点" / "整理标签", not "自动整理"). Wave B is opt-in only.
- **Knowledge-graph fan** — Wave C delivers Graph popover + Related 3-list; default brain-map explicitly forbidden (锁 A2/B2/E1). Lane E argument is the right call.
- **Security-minded** — tldr stays local in `~/.cmspark-agent/` (0o600 per CLAUDE.md A3); no cloud sync (§9 anti-goal); tags run through `SENSITIVE_TAG_RE` (`digest.ts:46`); no new tool gate added.
- **Implementer** — Wave A needs NO companion protocol changes. `thread.extract_digest` already accepts `thread_ids[]` up to 20 (`message-router.ts:1299-1309`). Pure UI work.

## 8. Recommendation

**Start Wave A workflow implementation after second reviewer passes.** Enter Slice A: A-1 (`⋯` menu item), A-2 (Tags empty CTA), A-3 (tldr row), A-4 (overflow portal fix), A-5 (tag cloud collapse), A-6 (preserve multi-select extract), A-7 (progress toast). Defer B/C to subsequent slices per 锁 G1/G2/G3.

## Nits (consolidated, non-blocking)

- N1: A-1 acceptance should explicitly state busy-thread skip (carry P2 forward).
- N2: Worker/orchestrator default-include in batch extract with progress-badge disclosure (no exclusion by default; cost-conscious users filter via search).
- N3: 5-min U2 repro before A-4 implementation (hypothesis → fact); non-blocking since A-4 fix covers both root causes.
- N4: GAP-4 tldr 120-char cap — flag CJK visual width to implementer.
- N5: GAP-10 add empty-batch guard test + portal z-index test.
- N6: Wave C signal weights stated as code constants, not user-facing config.

VERDICT: APPROVE_WITH_NITS
