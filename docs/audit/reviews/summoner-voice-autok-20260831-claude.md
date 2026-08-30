裁定：批准（有保留意见）
发现：
- [MEDIUM] chrome-extension/src/sidepanel/components/SettingsSlideout.tsx:1736 (saveVoiceEndpoint ~1375) — `onKeyDown` 的 Enter 分支没有 `voiceEndpointDraft != null` 守卫（onBlur 有）：保存成功后 draft 被置 null 且焦点仍在输入框，再按一次 Enter（或聚焦后未编辑直接按 Enter）会把 `modelDownloadEndpoint: ""` 发给 companion，静默清掉已配置的镜像源 — Enter 分支加与 onBlur 相同的 `if (voiceEndpointDraft != null)` 守卫。
- [MEDIUM] chrome-extension/src/sidepanel/hooks/useVoiceInput.ts:137 — `opts.localReady?.model !== true` 把「voice.model 镜像尚未水合 / get_state 未返回或失败」（undefined）也判为 model_missing：engine=local 且模型实际就绪时，面板刚打开的第一次听写会落到 browser 引擎。回退依据是镜像新鲜度而非真实模型状态；横幅可见所以不算静默，但云/本机引擎选择可能出错 — 仅在镜像已加载且 `model === false` 时启用 fallback（或复用 localGateError 的 model_missing 判定条件）。
- [MEDIUM] chrome-extension/src/sidepanel/voice/error-map.ts:187 — LOCAL_FALLBACK_BROWSER_BANNER 只说「本次使用浏览器听写」，没有 TOAST_SWITCHED_BROWSER 同款的云 residual 披露（「可能经浏览器厂商云端」）；而本次 ADR-023 修订明确写「回退横幅即云 residual 披露」，文案与声明的隐私契约不一致 — 横幅追加云 residual 短语。
- [LOW] companion/src/summoner-web.ts:1897 — showStreamMsg 首次流式时永久 `removeChild(#empty)`；renderMsgs 只做 `log.innerHTML=""` 不会重建空态节点，此后空线程视图在整个页面生命周期内失去空态提示，且其他 `$("empty")` 引用会拿到 null — 改为 style.display 切换或由 renderMsgs 重建。

不变量核对（无违例）：privacy_ack_v2 门控未触碰（回退走 browser 引擎，不需 ack；server 端强制不变）；回退为可见横幅 + 当次会话 + 设置可关，符合本次明示放宽；endpoint 在任何 fs/网络副作用前 normalize，https fail-closed（零 fetch 测试覆盖），sha256/size pin 不变，仅重写 huggingface.co 精确主机；chat.token 以 `textContent` 整体替换（累积快照语义保持），且 token 不再触发整线程重取；summoner Host/Origin/CSP/dispatch allowlist 未动；diarize（silhouette/selectBestK）纯 TS，退化输入回落默认 K。
