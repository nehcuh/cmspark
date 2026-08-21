# Eval gate card — meeting-mcp-packaged-hang-20260821

**Blast tier**: T2  
**Date**: 2026-08-21  
**Base**: `50869a9`

## Capability declaration (ADR-020)

```text
Surface:      L0 (会议工作台 STT / 结束并生成纪要)
L2-classes:   (none)
Compose:      mcp-server (stdio spawn PATH + npm_config_prefix)
Autonomy:     single
Trust:        无新确认门；MCP stdio 仍 allowlist，不 dump process.env / user_env
Channel:      community
```

## Machine (must pass first)

- [x] `chrome-extension`: `tsc --noEmit` + hang/caps/adapter tests EXIT 0
- [x] `companion`: `tsc --noEmit` + mcp + prefix tests EXIT 0
- [x] `scripts/tests/test-package-gates.sh` 112 passed, 0 failed
- [x] Outcome DoD: stop without STT ACK ends; stopping copy ≠ 正在听; unpaired node not ahead of npx pair; prefix pinned; disconnect does not stick 生成中
- [x] No new L2 / confirm / default-on

## Trajectory

- [x] Diff = two incidents (meeting hang + packaged npx) + packaging pin + docs
- [x] Product REJECT folded (sendMinutesJob defer-reconnect) before Pi

## Judges

- [x] Meeting adversary: `…-adversary-meeting-20260821.md` APPROVE_WITH_NITS
- [x] MCP adversary: `…-adversary-mcp-20260821.md` APPROVE_WITH_NITS
- [x] Product adversary: `…-adversary-product-20260821.md` **REJECT** → folded
- [x] Pi rereview: `…-pi-rereview-20260821.md` APPROVE_WITH_NITS
- [x] Synthesis: `…-adversary-synthesis-20260821.md`

## Blast

- [x] T2: dual + Pi, no auto-merge
- [x] Residual: live `/Applications/CMspark.app` 10:00 unpatched; large-v3 last-window 12s grace; zip vs host.swift launcher

## Verdict

| Gate | Result |
|------|--------|
| MACHINE | PASS |
| ADVERSARY | APPROVE_WITH_NITS after Product REJECT fold |
| PI_REREVIEW | APPROVE_WITH_NITS |
| MERGE | NO (implementer does not self-merge; needs PR/CI; DMG not rebuilt) |
