All grounding complete. Here is my independent review.

---

## 1. Summary

This is a docs-only design review (patch = context header + new spec; git confirms only 3 untracked docs/spec files, no code changes). The gap doc is a disciplined incremental SoT: it keeps the IA-2026-08-06 three-axis direction and P1–P14 pins, diagnoses the current state as "P1 discoverability + P2 delivery gap" rather than a wrong direction, and slices remediation into independently shippable Waves A/B/C. Every status-table claim I spot-checked against code held (with one nuance worth pinning — see nit 1). Locks A–G are internally consistent and consistent with ADR-020; the capability declaration matches the actual blast radius (L0, no new chrome, no Compose/L2, trust unchanged). No rejection gate triggers. Wave A is right-sized and needs zero companion protocol changes. Verdict: APPROVE_WITH_NITS.

## 2. Code spot-check notes (status table confirm/refute)

| Claim in synthesis | Evidence | Verdict |
|---|---|---|
| `⋯` menu has no extract item (U1) | `ThreadList.tsx` menu: ✨生成标题 / 📝起名 / 🧹清理空白 / 🗂整理助手 / 🗑回收站 — no extract entry | ✅ confirmed |
| `overflow:"hidden"` on panel | `ThreadList.tsx` `styles.panel.overflow: "hidden"`; `⋯` menu is `position:absolute` inside header container (zIndex 60) | ✅ confirmed |
| `panelMaxHeight` = 480 in tags/multi-select | `panelMaxHeight = selectMode \|\| view === "tags" ? 480 : 360` | ✅ confirmed |
| extract max 20, `force:false` | `validate.ts:107` and `message-router.ts:1309` both cap 20; handler skips non-stale digests unless `force` | ✅ confirmed |
| tldr not displayed in rows | `renderThreadRow` shows title/badge/tags/preview/relTime only; no tldr | ✅ confirmed |
| Tags empty state = text only, no primary CTA | "暂无标签。点 🏷 或「提取要点」…" with no button | ✅ confirmed |
| tag cloud has no cap/collapse | `renderTagsView` maps all `tagKeys` unbounded | ✅ confirmed |
| `thread.related` absent | zero hits across `companion/src`, `chrome-extension/src`, `background` | ✅ confirmed |
| `thread_digest` config absent | zero hits for `thread_digest` | ✅ confirmed |
| `@`+summary_card shipped (P1.5) | `AtThreadPopover.tsx` + `context-refs.ts` (`summary_card` mode) | ✅ confirmed |
| `suggest_cleanup` shipped | `message-router.ts:1134` | ✅ confirmed |
| Trust: batch delete per-id releaseTrust | `message-router.ts:1037–1102`: `withIndexLock` + per-id `releaseTrustBeforeThreadGone` + max 50 + busy reject | ✅ confirmed |
| tldr field exists (GAP-4) | `chrome-extension/src/sidepanel/types.ts:66` `tldr?: string` | ✅ confirmed |
| sensitive-tag regex (P14) | `digest.ts` `SENSITIVE_TAG_RE` + `normalizeTag` | ✅ confirmed |

**U2 root-cause (extra evidence):** the mechanism is stronger than the doc states. In the tags empty state the panel *shrinks to fit content* (`maxHeight` is a cap, not a height), so the absolutely-positioned menu (≈200px once the new 🏷 item lands) extends past the panel bottom edge and `overflow:hidden` clips it — while the time view, normally at full 360px max with a long list, shows all items. This exactly matches "时间正常 / 标签不全".

## 3. Blocking issues

None. R1–R6 all clear: no Graph-as-primary-nav (A2/B2/GAP-1); no Thread→Knowledge dual-write or llm_wiki ingest in Wave A (E1/GAP-9); no silent full-library LLM (D1–D2, cap 20 verified in protocol); no L2/new confirm dialect/Pack-first chrome (menu sub-item only, not a primary Side Panel entry — ADR-020 anti-pattern 1 not triggered); P1–P14 kept closed (§6, B-3's stale-extension is a *nit*-level tweak of N-c with an explicit "仅非今日组" hedge, not a P-pin reopen); Wave A independently shippable (G1 — verified zero protocol changes below).

## 4. Nits (non-blocking)

1. **A-1 `force:false` vs untagged semantics.** `buildTagIndex` buckets `digest`-present-but-`tags:[]` threads into `__untagged__` (`thread-timeline.ts:324–341`), but the handler with `force:false` returns those as `ok` *without re-extracting* (`message-router.ts:1323–1330`). Repeated "为未标注提取" runs never tag them → a permanent untagged floor that also drags the G3/Wave-C coverage gate. Pin A-1 selection semantics: either re-extract empty-tags digests with `force:true`, or exclude them from the batch and track them separately.
2. **tldr/bullets bypass `SENSITIVE_TAG_RE`.** Only tags are scrubbed (`digest.ts`); tldr/bullets are free text that can carry secret-shaped snippets into row UI + `index.json`. Local-only, so non-blocking, but D3's implementation should state tldr is not scrubbed and stays local (or add a light redaction pass).
3. **Batch latency vs spinner.** The handler extracts sequentially (one `withThreadLock` at a time, 45s timeout each — `message-router.ts:1315+`); the UI spinner force-clears at 60s (`ThreadList.tsx:240–248`). A-7 progress should be driven by `digest_updated` events (already broadcast per thread), and the 60s clear should be batch-aware.
4. **E2(2) vs C2 tension.** "写入时维护边" (E2) conflicts with C2's "compute on demand from list digest". Resolve toward on-demand for Wave C to keep the no-persistence claim honest; treat write-time edge maintenance as future work.
5. **Copy/order nits.** Appendix A wireframe menu order differs slightly from current (fine); consider whether the new 🏷 item sits before or after 🗂整理助手.

## 5. Answers to Must answer §1–7

1. **Locks A–G hold.** No blocking contradiction with ADR-020 or IA-2026-08-06. Capability declaration is accurate: L0 metadata, Compose none, Autonomy n/a, Trust unchanged (verified per-id `releaseTrust` in `batch_delete`), Channel unchanged. No new confirm family, no primary chrome — the `⋯` submenu item is not ADR-020 anti-pattern 1 material.
2. **Wave A is right-sized.** A-1/A-2 close U1's entry gap; A-4/A-5 close U2 (with A-4 correctly a GAP-3 blocker); A-3/A-7 add visibility; A-6 guards regression. Only additions worth pinning: nit 1 (untagged semantics) and worker exclusion (see Q6). Nothing blocking missing.
3. **U2 hypothesis is implementable without a repro script.** The clipping mechanism is provable by static inspection (shrink-to-fit panel + `overflow:hidden` + absolute menu). The A-4 acceptance ("time/tags 5 项均可点") is the verification. Prefer portal-to-`document.body` as the robust fix over `overflow:visible` (avoids re-clipping as items grow).
4. **E1–E3 correctly scoped.** Forbid product transplant (E1), borrow method-level patterns only (E2: compile-once digest, multi-signal related, lint-style health), and route any future "conversation→knowledge" through a new ADR (E3) — this is exactly consistent with the IA anti-goal and ADR-020's "digest is metadata, not Knowledge". Neither too strict nor too loose.
5. **Explicitly defer `@` edges to C.1b.** There is no persisted edge table; recovering `@` refs requires message scanning (scope + digest-dependent). C-1 should ship co-tag (×3) + TF (×1.5) + optional time proximity (×0.5) only. The table already hedges this — make it normative so the C-1 acceptance is unambiguous.
6. **Yes — default-exclude worker threads from「为未标注提取」.** Workers are ephemeral, low-value, and IA-2026-08-06 already excludes them from redundancy suggestions by default (B.6). Excluding them protects the 200-thread/limited-budget power user. Orchestrators should be included. Pin this in A-1's selection rule.
7. **Yes, start Wave A first after dual both_ok.** Every A-item is client-side over existing `thread.extract_digest` / `digest_updated` (no companion protocol change needed — verified). G1 satisfied; A is independently acceptable without B/C.

## 6. Explicit recommendation

**Start Wave A workflow: YES** (after dual-review both_ok, with nits 1–3 folded into Wave A implementation notes).

VERDICT: APPROVE_WITH_NITS
