只读对抗复审：先读评审规范、diff 和相关 ADR，再逐条核对召唤器流式、语音回退和会议自动说话人数三条不变量。用户指定了对抗复审角色和 verdict 格式，我按该清单核对 diff 与源码，不走通用 `/review` 编排。补丁被截断了，接着读剩余 diff，并对照源码核对竞态、隐私门控和 fail-closed。接下来对着源码核对几处高风险点：SSE 线程过滤、听写回退与隐私门控、以及 `get_state` 写配置。不变量已对完：召唤器 SSE 线程过滤、轮询清气泡、以及听写水合期默认回云是会卡线的问题。正在写入 verdict。```
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

完整 verdict：`docs/audit/reviews/summoner-voice-autok-20260831-verdict.md`

三条 **HIGH** 都是这次 diff 新引入的行为洞，不是风格问题：

1. **跨线程泄漏**：overlay 已有 `summonerCmdMatchesThread`，HTML shell 的 `chat.token` 只看「当前有没有 threadId」，不看 `d.thread_id`。切线程后旧线快照会画进新对话。
2. **气泡被轮询拆掉**：`chat.user` 仍 `startPoll()`，每 1.2s `renderMsgs` 做 `innerHTML=""` 并把 `streamMsg=null`。流式渲染和轮询在抢同一个 DOM，长回复会闪。
3. **水合期默认回云**：`voiceModel === null` 时 `localReady.model !== true` 为真，再叠加 `autoFallbackToBrowser` 默认 true，侧栏连上但 `get_state` 未到的窗口会把本机听写送进浏览器云 STT。断连路径仍 fail-closed，这一段不是。

守住的不变量：token 用 `textContent` 替换（累积快照）；Host/Origin/CSP nonce/dispatch allowlist 未动；下载 https + sha256/size pin + 无 shell；`set_prefs` 双栏 `source:"settings"`；`privacy_ack_v2` 的 local 门没松；删除活动模型仍强转 browser；diarize 纯 TS 且 `experimental: true` 仍在。会议自动 K 没有可定位缺陷。
