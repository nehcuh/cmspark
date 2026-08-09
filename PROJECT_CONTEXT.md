# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-09 (S62 END · Windows closeout + shell token · #161 MERGED)
- **Main tip**: `57bad96` = `origin/main`（Merge #161）
- **Ship**: Windows voice-pack closeout (launch fail-closed, WS validators, whisper harden) + **shell_exec/netsec `validateTokenFor`** matches `issueTokenFor` binding (cwd/targets)
- **Local package**: rebuilt SEA via `build-windows-exe.ps1 -SkipInstall -SkipNsis` → `dist-package\cmspark-windows-x64\` + `CMspark-v0.5.0-windows-x64.zip`; whisper sidecar staged
- **Pitfall**: L2 issue binds `shell|cmd|cwd=`; bare `validateToken(cmd)` always fails under enterprise_auto — use pair helpers only; kill running exe before restage
- **Next**: true-machine shell_exec under enterprise/full-auto; dictation hold/continuous; Mac unattended smoke; multi-arch whisper pins
- **Do not commit**: `.tmp-ci-*` / `.tmp-diagnosis-report.json`

### 2026-08-09 (S61 END · deep-diagnosis + 值守静默 · #160 MERGED)
- **Then tip**: `56da82f`; unattended L2+re-L2 silence; adversarial×3 + dual · #160
- **Superseded tip**: main now `57bad96` via #161
<!-- handoff:end -->
