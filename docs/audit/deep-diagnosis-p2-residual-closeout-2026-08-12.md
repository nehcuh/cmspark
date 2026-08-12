# Deep Diagnosis P2 Residual Closeout (2026-08-12)

Branch: `fix/p2-residual-closeout` · after #174 on main

## Residual list (from P2 closeout) → status

| Residual | Status | Notes |
|----------|--------|-------|
| 神文件 message-router / useWebSocket 续拆 | **DONE** | `handlers/mcp.ts` + `handlers/user-env.ts`；`normalize-config.ts` from useWebSocket |
| extensionConfig 明文 api_key 双驻留 | **DONE** | never persist api_key/vision_api_key; migrate strip on load |
| long-lived ax-watch / estop raw spawn | **DONE** | `resolveIntegrityHostBin` shared gate |
| multi-OS CI 冒烟 + coverage 观测 | **DONE** | `smoke-os` matrix job + informational coverage step |

## Files

- `companion/src/host-use/darwin/host-integrity.ts` — `resolveIntegrityHostBin`
- `companion/src/computer/darwin-estop.ts`, `darwin-adapters.ts`
- `companion/src/message-router/handlers/mcp.ts`, `user-env.ts`
- `companion/src/message-router.ts` — thin case arms
- `chrome-extension/src/background/index.ts` — secret-free storage
- `chrome-extension/src/sidepanel/utils/normalize-config.ts`
- `.github/workflows/ci.yml` — smoke-os + coverage observation
- `companion/tests/p2-residual-closeout.test.ts`

## Explicitly still backlog (not this residual list)

- Full thread/chat/skill/pack family extract (message-router still large)
- Fanout medium SEC-M* / CORR-M* clusters
- 真机验收 Windows/Mac
