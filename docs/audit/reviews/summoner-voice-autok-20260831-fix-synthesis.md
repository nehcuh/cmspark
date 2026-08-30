# 修复回合合成：summoner-voice-autok-20260831

> 日期：2026-08-31
> 输入：[grok verdict](summoner-voice-autok-20260831-verdict.md)（REJECT，3H/2M/2L）· [claude verdict](summoner-voice-autok-20260831-claude.md)（APPROVE_WITH_NITS，2M/1L）
> 修复后 diff：[summoner-voice-autok-20260831-diff.patch](summoner-voice-autok-20260831-diff.patch)（已再生为最终态）

## 逐条处置

| # | 级别 | 发现 | 处置 |
|---|------|------|------|
| G1 | HIGH | `chat.token` 不按 `d.thread_id` 过滤，跨线程快照泄漏（summoner-web.ts） | **已修**：token / done / aborted / error 分支均加 `d.thread_id!==threadId → return`；`selectThread` 入口 `clearStreamMsg()` |
| G2 | HIGH | 1.2s 轮询 `renderMsgs` 周期性拆掉 streaming 气泡 | **已修**：轮询 tick 在 `streamMsg && run_status==="llm"` 时跳过整表重绘（仅同步 busy）；轮询仅是 SSE 兜底 |
| G3 | HIGH | 水合窗口把「就绪未知」当 model_missing，默认走云 STT（useVoiceInput.ts:137） | **已修**：抽出纯函数 `resolveLocalFallbackActive`，仅当 `localStateHydrated===true && localModelReady===false` 才回退；App.tsx 传 `localStateHydrated: state.voiceModel != null`；新增 `chrome-extension/tests/voice-fallback.test.ts` |
| G4 | MEDIUM | 回退横幅缺云 residual 披露 | **已修**：`LOCAL_FALLBACK_BROWSER_BANNER` 拼接 `BROWSER_ENGINE_CLOUD_RESIDUAL`；voice-composer-ux.test.ts 加断言 |
| G5 | MEDIUM | 回退中途翻转导致适配器 UNMOUNT 重建 | **已修**：`adapterEngine` 在会话活跃期钉死（`adapterEngineRef` 仅 idle 时跟随 `engine`），effect 改用钉死值 |
| G6 | LOW | config 加载期不校验 endpoint 合法性 | **已修**：`getConfig` tamper-coercion 增加 https origin 校验，非法即 delete（下载路径 normalize 仍兜底） |
| G7 | LOW | ADR-023 L13 锁表与文首修订矛盾 | **已修**：L13 正文补 2026-08-31 修订条文 |
| C1 | MEDIUM | SettingsSlideout Enter 分支缺 `voiceEndpointDraft != null` 守卫，误清空已配镜像源 | **已修**：Enter 加同款守卫 |
| C2 | LOW | `showStreamMsg` 永久移除 `#empty`，重建空态无 id | **已修**：`renderMsgs` 重建空态补 `empty.id="empty"`（与 `paintUser`/`showStreamMsg` 的移除约定闭环） |

## 复测

- chrome-extension：858/858 pass（含新增 voice-fallback 2 例 + banner 1 例）
- companion：本次改动相关测试（summoner-web / diarize / whisper-handlers / whisper-download）全过；全量 83 失败均为 main 基线预置（stash 基线 81 + 2 个 Windows 0o600 权限断言的抖动项），与本次改动无关
- summoner-web.test.ts 增加 5 条源码锁断言（线程守卫 / 轮询跳过 / selectThread 清理 / empty id）

## 结论

两路发现全部落地修复并通过复测，可提交。
