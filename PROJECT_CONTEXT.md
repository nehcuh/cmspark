# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-12 (session-end · meeting STT hotfix · #179 OPEN)
- **Branch**: `fix/meeting-stt-hotfix-refine-absorb` @ **`ff00681`**（+ memory handoff commit）
- **PR**: https://github.com/nehcuh/cmspark/pull/179 — dual Claude+Pi **APPROVE_WITH_NITS** both_ok；高优先 nits 已吸
- **内容**: soft-continue/pin/package/双ack + 会议 AI priorContext 纠错 + 智能分段 + drain 竞态/`binary_broken` 硬停
- **Main tip**（远程）: 仍以 `origin/main` 为准；本批未合
- **Next**: CI 绿合 #179 → 真机 smoke（双 ack、AI 纠错、坏二进制硬停）→ 可选全量 DMG
- **Do not commit**: `dist/` · dual-review 巨型 `.patch` · 勿把未审 host hash 当无关噪声丢

### 2026-08-12 (prior · deep-diagnosis residual)
- Tip was `6d7e7e8` #175 residual closeout；Precision #168–#171 + diagnosis #172–#175 已在 main
<!-- handoff:end -->
