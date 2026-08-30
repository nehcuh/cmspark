# 复审任务：召唤器流式渲染 + 语音自动激活/回退/HF 镜像 + 会议自动说话人数

你是 CMspark 的对抗性 reviewer。**只读复审，禁止改文件**。

## 背景

工作区未提交的一批改动（diff 在 `docs/audit/reviews/summoner-voice-autok-20260831-diff.patch`，完整文件在仓库里可直接读）：

1. **召唤器 HTML shell 流式渲染**（`companion/src/summoner-web.ts` 内联 JS + `companion/tests/summoner-web.test.ts`）：SSE `chat.token`（content 为累积快照，替换语义）渲染到临时 `.msg.assistant.streaming` 气泡；`chat.done` 清气泡后走原 refetch。此前 token 只触发整表 refetch，回复在轮末才出现。
2. **会议自动说话人数**（`companion/src/meeting/auto-diarize.ts`、`chrome-extension/.../MeetingPanel.tsx`、`companion/tests/meeting-mtg3-diarize.test.ts`）：新增 `meanSilhouette` / `selectBestK`；`clampDiarizeK` 让 `0`/`"auto"` 透传为自动；UI 下拉默认「自动」。
3. **语音模型自动激活 + 非静默回退 + HF 镜像**（`companion/src/config.ts`、`voice/whisper-handlers.ts`、`voice/whisper-state.ts`、`voice/whisper-download.ts`、`ws/validate.ts`、`message-router.ts`；扩展侧 `useVoiceInput.ts`、`SettingsSlideout.tsx`、`error-map.ts` 等）：
   - 下载完成自动 `localModelId`（不动 `sttEngine`）；`get_state` 自动修正失效 active（medium→small→large-v3-turbo）。
   - 新增 `voice.autoFallbackToBrowser`（默认 true）：engine=local 且 model_missing 时当次会话用 browser 引擎 + 可见横幅，不写配置。
   - 新增 `voice.modelDownloadEndpoint` / env `CMSPARK_HF_ENDPOINT`：重写 manifest 中 host===`huggingface.co` 的 URL；非 https fail-closed；sha256/size pin 不变。
   - 新 WS 消息 `voice.model.set_prefs`（`source:"settings"` 双栏，validate 层 + handler 层各一道）。

## 必须守住的不变量（review 重点）

- ADR-023：local 引擎隐私门控 `privacy_ack_v2` 不放松；禁止**静默**回落（本次放宽为「可见横幅的当次会话回落」，ADR 已补修订）；mutator 强制 `source:"settings"`。
- 下载管线 fail-closed：https only、sha256/size pin、无 shell、磁盘预算。
- `chat.token` content 是**累积快照**：渲染只能替换不能追加。
- summonner-web 安全面：Host/Origin allowlist、CSP nonce、dispatch allowlist 不得被削弱。
- diarize：纯 TS 无新依赖；`DiarizeResult.experimental: true` 保留。

## 输出格式（写到 verdict 文件，同时在 stdout 给结论）

```
VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT
FINDINGS:
- [HIGH|MEDIUM|LOW] <file:line> <问题> — <建议>
...(没有就写 none)
```

只报真实可定位的问题（给文件:行号），不要泛泛的风格建议。逐条核对 diff 的每一处行为变更；特别检查：竞态（SSE/轮询/线程切换时气泡生命周期）、config tamper-coercion 完备性、自动激活与删除强转 browser 路径的交互、扩展断连时回退逻辑是否 fail-closed。
