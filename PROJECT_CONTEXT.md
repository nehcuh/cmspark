# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-05 (S45 — multi-lane review + P0 fix #125 MERGED)
- **Ship**: PR **#125** merge `7c8ec53` on `origin/main` — upload thread isolation + scoped fleet.stop_all + safeUploadBasename
- **Review**: post-pull 4-lane REQUEST_CHANGES → implement → adversarial pass → Claude APPROVE / Pi APPROVE_WITH_NITS → CI green → merge
- **Key fixes**: mapBusy always / panel chrome gated; run+parent stop stamps; companion persist upload errors; plasmo 0.4.0
- **Next**: optional true-device spawn/stop smoke; S43 lid-close A/B still open; no blocking code debt from S45
- **Knowledge**: `memory/project-knowledge.md` §上传错误跨线程 · §Fleet 显示/停止 · §Windows dual-review

### 2026-08-05 (S44 — file upload stuck / ship main)
- **Ship**: `c6b1e8b` on `origin/main` — busy clear + reasoning UI + upload diagnostics
- **Root**: optimistic `isProcessing` without `file.upload_error` handler; env mismatch (App vs source)
- **Next**: bake into CMspark.app if users stay on packaged build
- **Knowledge**: `memory/project-knowledge.md` §附件上传「思考中」
<!-- handoff:end -->
