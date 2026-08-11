# Residual nits closeout — Thread History IA A/B/C

**Date:** 2026-08-11  
**Source:** dual-review nits from wave-a-impl-r2 / wave-b-impl / wave-c-impl

## Fixed

| ID | Nit | Fix |
|----|-----|-----|
| A-dead-event | `cmspark:digest_updated` window event never listened | Removed dispatch; progress via UPSERT only |
| A-batch-serial | Overlapping `extractBatchRef` corruption | `batchId` + refuse second batch while remaining; ignore superseded complete |
| A-menu-clamp | Portal menu below viewport | Flip above button when near bottom |
| A-cta-dead | Dead showPrimaryCta clauses / empty CTA | `showPrimaryCta = ids.length > 0` only |
| A-session-md | "dual reviewers APPROVED" misleading | Clarified design vs impl wording |
| B-force-dead | Dead `force` locals in lazy select | Return `force: ids.length > 0` only |
| B-quota | Quota at send, not success | Charge on `extract_digest.completed` ok[] only |
| B-copy | 「保存后生效」 mismatch | Copy: immediate panel + 保存 persists |
| B-settings | 会话索引 under Export | Moved to **实验功能** section |
| C-ws-bridge | Companion related unused | Wire 🔗 → `thread.related` + event; local fallback first |
| C-tokenizer | Client missing STOP_WORDS / kana | Align with semantic-match |
| C-lint-On2 | per-node findRelated | One `buildRelatedEdges` + degree |
| C-tests | Thin companion tests | Trashed / empty-digest cases |

## Machine

- extension: **615** pass / 0 fail  
- companion: `thread-related` 4 pass  

## Not changed (accepted residual)

- Graph is edge list popup (not force-directed viz library) — by design for Side Panel  
- Companion does not echo `batch_id` on extract complete — client serializes without it when field absent  
