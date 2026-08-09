# Deep Diagnosis P2 Optimization Closeout — 2026-08-09

**Branch:** `fix/deep-diagnosis-p0` (continues P0/P1)  
**Source:** [deep-diagnosis-fanout-2026-08-09.md](./deep-diagnosis-fanout-2026-08-09.md) P2 plan  
**Scope:** Bounded P2 engineering debt — **not** full god-file split

## Status

| # | P2 item | Status | Notes |
|---|---------|--------|-------|
| 1 | protocol_version 协商 | **done** | `protocol.ts`；handshake 协商；拒绝越界版本；auth.ok 带 min/max |
| 2 | WS unknown type fail-closed | **done** | 默认生产 strict；dev/test 或 `CMSPARK_WS_STRICT=0` 可放行 |
| 3 | esbuild external SoT | **done** | `esbuild-bundle-args.json` + `run-esbuild-bundle.mjs`；package.json / package.sh / build-windows-exe 共用 |
| 4 | Node engines | **done** | companion / chrome-extension / root：`>=20` |
| 5 | meeting delete + cap | **done** | `meeting.delete` RPC；`MAX_MEETINGS=100` + create 时 enforce |
| 6 | Whisper multi-arch pin | **docs/fail-closed** | 不伪造 hash；注释矩阵；已有 fail-closed 单测 |
| 7 | tab-resolver | **documented** | 故意不自动接线（防 wrong-tab）；测试保留 |
| 8 | server.ts 神文件拆分 | **deferred** | 超出本批 2× 边界；另开专项 |

## Verification [executed]

- companion `tsc --noEmit` — pass  
- chrome-extension `tsc --noEmit` — pass  
- `protocol` + `ws-validate-strict` + `meeting-audio-gc` + `voice-binary-resolve` — **27 pass**

## Residual / backlog

- Extract `validateWsMessage` / tool executor from `server.ts`（独立 PR）  
- Whisper win-x64 / linux-x64 / darwin-x64 真 pin（需各平台 `--write-pins`）  
- CI matrix windows/mac job（非本机可证）  
- launchd / SEA packaging 更深 fail-closed  

## Next

1. 用户授权：commit P0+P1+P2 并开 PR  
2. 或专项 god-file 拆分  
