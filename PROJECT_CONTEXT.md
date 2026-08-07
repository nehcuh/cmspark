# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-07 (S51 — context memory A/B/C · #134 · Wave C uncommitted)
- **Ship**: PR **#134 MERGED** `06c05dc` — scene knowledge (`active_knowledge_ids` + user-scene `knowledge_refs`) + H1 structured handoff `[context_handoff]` + dual nits
- **Wave C**: `thread_recall` local commit `8d5ab36` (plan dual REJECT×2 → F-S5 synthetic assistant; impl dual both APPROVE_WITH_NITS); **await PR/merge**
- **Decisions**: H1 ≠ compact-ux “M3”; knowledge independent of skills; recall same-thread only; no embedding; compact hint only if tool allowlisted
- **Next**: PR Wave C → CI merge; optional Wave D reasoning UI/export; manual smoke long-thread compact+recall
- **SoT**: `docs/superpowers/specs/2026-08-07-context-memory-thinking-knowledge-adversarial-analysis.md` · plans wave-a/b/c under `docs/superpowers/plans/`

### 2026-08-06 (S50 — analyze_image data: · PR #130)
- **Ship**: branch `fix/analyze-image-data-url-p0` · **PR #130** — page-inline `data:` images no longer false-Security-Block
- **Next**: confirm #130 merged; reload extension + Companion smoke captcha/`data:`
- **Knowledge**: data: ≠ SSRF gate; god-mode does not skip IMAGE_FETCH http(s)
<!-- handoff:end -->
