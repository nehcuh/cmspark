# Adversary synthesis — meeting stop hang + packaged MCP npx ENOENT

**Batch**: `meeting-mcp-packaged-hang-20260821`  
**Date**: 2026-08-21  
**Base**: `50869a9`  
**Blast**: T2  

## Independent judges (implementer did not self-APPROVE)

| Role | Report | First VERDICT | After fold |
|------|--------|---------------|------------|
| Meeting/STT skeptic | `meeting-mcp-packaged-hang-adversary-meeting-20260821.md` | APPROVE_WITH_NITS | (nits residual) |
| MCP/packaging/security | `meeting-mcp-packaged-hang-adversary-mcp-20260821.md` | APPROVE_WITH_NITS | PATH tail nit folded |
| Product/DoD | `meeting-mcp-packaged-hang-adversary-product-20260821.md` | **REJECT** (B1, B2) | B1+B2 folded in source |

## Product REJECT that was absorbed

**B1**: 「结束并生成纪要」+ Companion death set `pendingGenerate` then `sendViaRuntime` dropped the WS send → 「生成中…」 forever; generate button disabled.  
**Fold**: `meetingMinutesSendPlan` + `sendMinutesJob` defers when disconnected; retry on reconnect; 90s watchdog unsticks busy. Tests: `meetingMinutesSendPlan defers when Companion is down`.

**B2**: TROUBLESHOOTING spoke as if the running `.app` already reordered PATH.  
**Fold**: copy now says 旧包没有这层修复 + 立刻可用的 `env.PATH` / prefix；新版本才会自动配对.

## Machine (this session)

- chrome-extension `tsc --noEmit` + hang/caps tests: EXIT 0  
- companion `tsc --noEmit` + mcp + prefix tests: EXIT 0 (1 skip win32 PATH)  
- `scripts/tests/test-package-gates.sh`: 112 passed, 0 failed  

## Residuals (honest, not blockers for source)

- Installed `/Applications/CMspark.app` (10:00) still unpatched; live MCP is config `env.PATH` workaround.  
- `stopGrace` 12s can drop last window on large-v3-turbo.  
- DMG main launch is host.swift; `launch-companion.sh` is zip/staging. MCP children still get `buildMcpStdioEnv`.  
- No “load last meeting” UI; transcript remains in the open panel after defer.

## Pi rereview

`meeting-mcp-packaged-hang-pi-rereview-20260821.md` — **VERDICT: APPROVE_WITH_NITS**

Confirms Product B1/B2 absorbed in live source. Residual nits: `sendViaRuntime` still ignores SW `{ok:false}` (90s watchdog); refine-drain window; reconnect effect idle-guard (flag not cleared on skip — inspect if reconnect during `starting`).

## Gate (eval-engineering-gate)

| Gate | Result |
|------|--------|
| MACHINE | PASS (this session: ext hang tests, companion mcp tests, package-gates 112/0) |
| ADVERSARY | mixed first pass: Meeting+MCP APPROVE_WITH_NITS; Product **REJECT** then fold |
| PI_REREVIEW | APPROVE_WITH_NITS |
| MERGE | **not claimed by implementer** — Pi APPROVE* after fold; still needs PR/CI; installed 10:00 `.app` is **not** this tree |
