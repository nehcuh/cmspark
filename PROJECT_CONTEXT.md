# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-09 (S61 END · deep-diagnosis + 值守静默 · #160 MERGED)
- **Main tip**: `56da82f` = `origin/main`（Merge #160）
- **Ship**: deep-diagnosis fanout P0–P2 hardening + unattended true silence（ADR-021 2026-08-09）
- **Unattended**: armed grant → host_computer initial L2 **and** mid-task re-L2 silent（incl. PROMPT_ALWAYS）；hard deny still throw；alone flags never arm
- **Review**: adversarial ×3 + dual A/B → all APPROVE_WITH_NITS · Merge YES · CI green then merge
- **Next**: Mac smoke 值守；executor reL2 unattended regression test（nit）；estop≠disarm toast；Whisper multi-arch pins + win-x64 sidecar；god-file split
- **Pitfalls**: 值守≠只免 initial L2；文档/矩阵必须跟 ADR-021；dual-write cruise 仍可在 grant 死后残留

### 2026-08-09 (S60 END · Health Fanout P0–P2 · #159 MERGED)
- **Then tip**: `e4316bb`；health-fanout P0+P1/P2；dual r2 both_ok
- **Superseded tip**: main now `56da82f` via #160
<!-- handoff:end -->
