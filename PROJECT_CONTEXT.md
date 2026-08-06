# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-06 (S50 — analyze_image data: · PR #130)
- **Ship**: branch `fix/analyze-image-data-url-p0` · **PR #130** — page-inline `data:` images no longer false-Security-Block; extension `promoteFetchSrc` + companion residual local decode; mime allowlist + 6MiB; dual R3 both_ok (Pi APPROVE / Claude APPROVE_WITH_NITS)
- **Also on** `build/dmg-latest` (local, unpushed stack with voice/shell merges)
- **Next**: merge #130; reload extension + restart Companion; smoke captcha/`data:` analyze_image; optional residual DRY (`sanitizeImageDim` in companion)
- **Knowledge**: data: ≠ SSRF gate; god-mode does not skip IMAGE_FETCH http(s); plasmo strict:false needs `ok === true/false`

### 2026-08-06 (S48 — Thread History IA P0–P1.5 · PR #127)
- **Ship**: branch `feat/thread-history-ia-p0-p15` · **PR #127** — timeline, multi-select batch delete, digests/tags, soft trash, `@` summary_card
- **Dual**: impl R1 REJECT → R2 both APPROVE_WITH_NITS
- **Next**: merge #127; manual smoke ☰ / trash / `@`
<!-- handoff:end -->
