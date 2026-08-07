# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-07 (S51 — context memory A/B/C · #134 · Wave C uncommitted)
- **Ship**: PR **#134 MERGED** `06c05dc` — scene knowledge (`active_knowledge_ids` + user-scene `knowledge_refs`) + H1 structured handoff `[context_handoff]` + dual nits
- **Wave C**: `thread_recall` implemented; plan dual REJECT×2 then R2 path fixed (F-S5 synthetic assistant for orphan tools); impl dual both APPROVE_WITH_NITS; tests green; **not yet committed**
- **Decisions**: H1 ≠ compact-ux “M3”; knowledge independent of skills; recall same-thread only; no embedding; compact hint only if tool allowlisted
- **Next**: commit/PR Wave C → CI merge; optional Wave D reasoning UI/export; manual smoke long-thread compact+recall
- **SoT**: `docs/superpowers/specs/2026-08-07-context-memory-thinking-knowledge-adversarial-analysis.md` · plans wave-a/b/c under `docs/superpowers/plans/`

### 2026-08-06 (S50 — analyze_image data: · PR #130)
- **Ship**: branch `fix/analyze-image-data-url-p0` · **PR #130** — page-inline `data:` images no longer false-Security-Block
- **Next**: confirm #130 merged; reload extension + Companion smoke captcha/`data:`
- **Knowledge**: data: ≠ SSRF gate; god-mode does not skip IMAGE_FETCH http(s)
<!-- handoff:end -->
