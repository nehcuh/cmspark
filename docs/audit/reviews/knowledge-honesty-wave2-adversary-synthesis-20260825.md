# Wave 2 independent adversarial synthesis

**Date:** 2026-08-25  
**Branch:** `feat/knowledge-honesty-wave0`  
**Machine:** `companion npm test` 3539+20 pass, 0 fail; Wave 2 focused suite 108 pass after noun/redact follow-up.

## Capability

```text
Surface:      L0 related ≤3 + distill confirm-import + 话题夹 + overlay copy
L2-classes:   (none)
Compose:      knowledge query-time; Thread.topic_folder string
Autonomy:     n/a
Trust:        distill never auto-writes; overlay ACL unchanged
Channel:      unchanged
Blast:        T2
```

## Round 1 verdicts

| Lane | VERDICT | Notes |
|------|---------|--------|
| Product | **REJECT** | F-UX-NOUN-1: ThreadList overflow still 「关联图谱 / 类 Obsidian」 next to 话题夹 |
| Impl | APPROVE_WITH_NITS | contracts hold; weak router related assert; title not redacted; payload spread |
| Security | APPROVE_WITH_NITS | ACL hold; regex theater on xox remainder / password=value; title bypass |
| External | APPROVE_WITH_NITS | no Project/graph DB/overlay knowledge admin |

## Follow-up (this session)

- Side Panel + thread-graph user copy: 图谱 → 相关会话 / 会话关系图
- `SENSITIVE_BODY_RE` captures xox remainder + `password=`/`api_key=` values; title redacted
- `topic_folder` optimistic UI sanitizes; confirm import spreads payload first
- Tests: related `=== 3`, legacy name seed, title redact, slack remainder

## Round 2 (Product re-review)

| Lane | VERDICT |
|------|---------|
| Product | **APPROVE_WITH_NITS** — F-UX-NOUN-1 BLOCK cleared; residual: two 「相关会话」 nouns, related still behind ⋯ |

**Adversary gate:** all four lanes APPROVE* → proceed to `scripts/dual-external-review.sh`.

## Folded after Claude AWN (`132009`)

- Error preview clears `payload` (no stale import)
- Distill redacts before per-message clip; PEM block includes body through END
- `knowledge.related` honors `limit` clamped 1–3
- Knowledge 「相关」 is a row button (not only ⋯)
- 🔗 = 列表内相关；overflow / graph chrome = 会话关系图
- 话题夹 empty CTA；overlay dead `button.pack` CSS removed

**Left parked (not this slice):** overlay `pack.apply` HTTP peek (spec + tests lock); `knowledge.import` `user_gesture` server 400 (Wave 0b parked).
