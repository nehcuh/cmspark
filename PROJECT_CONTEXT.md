# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-09 (S60 END · Health Fanout P0–P2 · #159 MERGED)
- **Main tip**: `e4316bb` = `origin/main`（Merge #159）
- **Ship**: health-fanout P0 安全 Highs + P1（privacy/origin/pin/GC/CU UI/release）+ 部分 P2（CI22/run-tests/version lock/WS strict）
- **Dual**: r1 Pi REJECT `run-tests.mjs` JSDoc → r2 both_ok（Claude APPROVE / Pi APPROVE_WITH_NITS）
- **Closeouts**: `docs/audit/health-fanout-p0-optimization-closeout-2026-08-09.md` · `…-p1-p2-closeout-…` · reviews `p1-p2-pr159-*`
- **Next**: Whisper multi-arch pins + win-x64 sidecar；god-file 拆分；codesign；真机听写/会议；Pi nits（multi-agent cap）
- **Pitfalls**: run-tests JSDoc `*/`；dual 大 patch Claude context；handleMessage session 第 3 参；require_grant 测用 grant

### 2026-08-09 (S57 · Windows Python · #157+#156 main)
- **Then tip**: `c11a7e9`；Scheme D Python；MCP filesystem@home
- **Local only**: Whisper 打包 stash（旁路 bin）— 未随 #159
<!-- handoff:end -->
