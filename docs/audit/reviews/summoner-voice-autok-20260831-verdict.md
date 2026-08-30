# Adversarial review: summoner streaming + voice auto-activate/fallback/HF mirror + meeting auto-K

Date: 2026-08-31
Diff: `docs/audit/reviews/summoner-voice-autok-20260831-diff.patch`
Mode: read-only (source untouched)

```
VERDICT: REJECT
FINDINGS:
- [HIGH] companion/src/summoner-web.ts:2617 chat.token 不按 d.thread_id 过滤，线程切换后会把他线累积快照画进当前 log — 对齐 overlay 的 summonerCmdMatchesThread：token/done/error 丢弃 thread_id !== threadId 的帧；selectThread 开头 clearStreamMsg()
- [HIGH] companion/src/summoner-web.ts:1954 startPoll 每 1.2s renderMsgs → innerHTML="" + streamMsg=null，SSE 气泡被轮询周期性拆掉 — busy/流式期间不要用 renderMsgs 整表重绘；或 renderMsgs 保留/回挂 streaming 节点；chat.user 勿在流式中 startPoll
- [HIGH] chrome-extension/src/sidepanel/hooks/useVoiceInput.ts:137 localFallbackActive 把「模型就绪未知」（voiceModel 未到、localReady.model!==true）当成 model_missing，水合窗口默认走浏览器云 STT — 仅在已收到 voice.model.state 且确认活动模型非 ready 时启用回退；未水合保持原 localGateError fail-closed
- [MEDIUM] chrome-extension/src/sidepanel/voice/error-map.ts:188 LOCAL_FALLBACK_BROWSER_BANNER 未含云 residual（对比 TOAST_SWITCHED_BROWSER / BROWSER_ENGINE_CLOUD_RESIDUAL），ADR-023 修订写「回退横幅即云 residual 披露」未落地 — 横幅并入「可能经浏览器厂商云端」
- [MEDIUM] chrome-extension/src/sidepanel/hooks/useVoiceInput.ts:397 适配器随 engine 重建；下载完成 A1 / get_state A2 会翻转 localFallbackActive，听写中途 UNMOUNT+destroy — 以会话开始时的 engine 钉死，idle 前不因 model 就绪变化换适配器
- [LOW] companion/src/config.ts:911 modelDownloadEndpoint 只检查 typeof string，http/非法 URL 不被 load-time 强制成 ""（下载路径仍 fail-closed） — 与 sttEngine 一样在 getConfig 里 normalize 失败则 delete/置空
- [LOW] docs/adr/023-voice-local-stt-path-b.md:140 L13 锁表仍写「禁止回落、只许 CTA set_engine」，与文首 2026-08-31 修订矛盾 — 改锁表正文，避免后审按旧 L13 打回
```

## Invariants (held / broken)

| Invariant | Result | Evidence |
|-----------|--------|----------|
| `chat.token` content = cumulative snapshot, replace not append | **held** | `showStreamMsg` → `streamMsg.textContent=text` (`summoner-web.ts:1901`) |
| Summoner Host/Origin allowlist, CSP nonce, dispatch allowlist | **held** | diff does not touch `hostOk`/`originOk`/`Content-Security-Policy`/`SUMMONER_WEB_DISPATCH_ALLOW`; `chat.token` already in `SUMMONER_WEB_EVENT_ALLOW` |
| Download fail-closed: https, sha256/size pin, no shell, disk budget | **held** | `normalizeModelDownloadEndpoint` https-only; rewrite only `hostname===huggingface.co`; existing redirect https check + pin path unchanged |
| `privacy_ack_v2` not relaxed on local path | **held** | `set_engine local` still requires `privacy_ack_v2`; fallback switches client engine to browser (v1 ack), does not call `voice.stt.start` |
| Mutators `source:"settings"` dual fence | **held** for `set_prefs` | `validate.ts:489` + `SETTINGS_SOURCE_TYPES` + handler belt; Settings `sendVoice` injects `source:"settings"` |
| No **silent** fallback | **broken in hydration window** | banner exists for the happy path, but unknown-readiness is treated as `model_missing` and cloud STT starts before state arrives (HIGH #3); banner also omits cloud residual (MEDIUM) |
| `companion_disconnected` / `binary_missing` not auto-fallback | **held** | `localFallbackActive` requires `companionConnected===true`; binary-only miss keeps engine local (`model===true` short-circuits) |
| Diarize: pure TS, no new deps, `experimental: true` | **held** | silhouette/k-means in `auto-diarize.ts`; `experimental: true` still required on `DiarizeResult`; handler still persists `experimental: true` |
| Auto-activate never writes `sttEngine`; delete-active still force-browser | **held** | `maybeAutoActivateModel` / `autoCorrectActiveLocalModel` only `setVoiceFields({ localModelId })`; delete path still `sttEngine: "browser"` |

## Notes (not findings)

- Overlay already drops cross-thread tokens via `summonerCmdMatchesThread` (`companion/src/summoner/client.ts:327-333`). HTML shell is the regression: it paints `chat.token` whenever `threadId` (the *current* view id) is set, ignoring `d.thread_id`.
- HF rewrite is exact-host (`huggingface.co`); packaged manifest URLs match; `cdn-lfs.huggingface.co` would not rewrite (none in current manifest).
- `get_state` write-on-read (A2) is an explicit ADR-023 2026-08-31 exception, not a `source:"settings"` mutator. Not flagged.
- Meeting auto-K: `clampDiarizeK(0|"auto")` passthrough, text-gap ignores auto, `selectBestK` fail-closed to `DIARIZE_K_DEFAULT`, k-means init is deterministic (quantile). Tests cover 2/3-cluster and degenerate. No locateable defect.
