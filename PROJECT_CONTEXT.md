# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-09 (S62 END · Windows closeout + shell token · #161 MERGED)
- **Main tip**: see `origin/main` after experience commit（base merge `57bad96` #161）
- **Ship**: Windows voice-pack closeout + **shell_exec/netsec `validateTokenFor`**
- **Experience SoT**: `docs/audit/voice-pack-windows-closeout-s62-2026-08-09.md`
- **Local package**: `dist-package\cmspark-windows-x64\` + zip v0.5.0（not in git）
- **Pitfall**: L2 issue/validate binding must match; kill cmspark-agent before SEA restage
- **Next**: true-machine shell_exec + dictation; Mac unattended smoke; multi-arch whisper pins
- **Do not commit**: `.tmp-ci-*` / `.tmp-diagnosis-report.json`

### 2026-08-09 (S61 END · deep-diagnosis + 值守静默 · #160 MERGED)
- **Then tip**: `56da82f`; unattended L2+re-L2 silence; adversarial×3 + dual · #160
- **Superseded tip**: main now `57bad96` via #161
<!-- handoff:end -->
