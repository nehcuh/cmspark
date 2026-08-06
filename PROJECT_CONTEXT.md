# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-06 (S48 — Thread History IA P0–P1.5 · PR #127)
- **Ship**: branch `feat/thread-history-ia-p0-p15` · `ebb7fd7` · **PR #127** — timeline (today/yesterday/month·day), multi-select batch delete, digests/tags, soft trash+restore+30d purge, `@` summary_card refs, rules cleanup
- **Dual**: design APPROVE_WITH_NITS; impl R1 REJECT (B1 hard-delete default / B2 list_scope / B3 @ Enter) → fixes + perf → **R2 both APPROVE_WITH_NITS** (`both_ok`)
- **Next**: merge #127; manual smoke ☰ / trash / `@` / 整理助手; optional nits (B2/B3 tests, trashed chat guard)
- **Knowledge**: list_scope isolation · delete default hard · single-pass list · digest queue max 2

### 2026-08-06 (S47 — Trust B lifecycle #126 + DMG)
- **Ship**: PR **#126** merge `b338498` — Trust restore all leave paths; allowTrust; install strip; holder; journal; DMG 0.4.0 → `/Applications`
- **Next residual**: 真机 Trust/skill_install 验收；S43 合盖 A/B；host-integrity packaging 可选
<!-- handoff:end -->
