# Deep Diagnosis P2 Closeout (2026-08-12)

Branch: `fix/p2-deep-diagnosis-batch` · base: main @ `e4de749` (#173 P0)

## Scope (fanout P2 action plan)

| ID | Item | Status |
|----|------|--------|
| ARCH-M01 | COMPANION_TOOLS 单 SoT + CI 锁步 | **FIXED** `bridge/companion-tools.ts` + `tool-catalog-lockstep.test.ts` |
| ARCH-01 | NotebookLM 取消扩展直连 LLM / 明文 key fetch | **FIXED** `llm.oneshot` + SW pending map + suggester callback |
| spawn | pack_id / intent_id 失败事务回滚删 worker | **FIXED** `SPAWN_PACK_FAILED` / `SPAWN_INTENT_FAILED` |
| SEC-09 | host 全路径 spawnHostBin（禁 raw execFile on cmspark-host） | **FIXED** darwin index + CU adapters + evidence；ax-watch 预检 integrity |
| god-file | 有界切片 | **FIXED** `llm/oneshot-handler.ts`；server 顶层 import SoT |

## Out of scope / residual

- 完整 message-router / useWebSocket 神文件继续拆分（C10 已部分完成；本批仅 oneshot 切片）
- 扩展 `extensionConfig.api_key` 存储迁移/清除（Notebook 路径已不读；其它遗留 dual-home 属后续）
- 多 OS CI 冒烟 / coverage 观测
- long-lived `ax-watch` / estop 仍用 `spawn`（已 integrity pre-check for ax-watch）

## Verification `[executed]`

```text
node --import tsx --test tests/tool-catalog-lockstep.test.ts tests/p2-deep-diagnosis-batch.test.ts
→ 10 pass / 0 fail
npx tsc --noEmit -p companion/tsconfig.json → clean
ws-router-validator-lockstep → pass (llm.oneshot in lockstep)
```

## Files (primary)

- `companion/src/bridge/companion-tools.ts` (new)
- `companion/src/llm/oneshot-handler.ts` (new)
- `companion/src/server.ts`, `message-router.ts`, `ws/validate.ts`
- `companion/src/tool/companion-dispatch.ts`
- `companion/src/host-use/darwin/index.ts`, `adapter.ts`
- `companion/src/computer/darwin-adapters.ts`, `darwin-evidence.ts`
- `chrome-extension/src/notebooklm/notebook-name-suggester.ts`
- `chrome-extension/src/background/index.ts`
- `companion/tests/tool-catalog-lockstep.test.ts`, `p2-deep-diagnosis-batch.test.ts`
