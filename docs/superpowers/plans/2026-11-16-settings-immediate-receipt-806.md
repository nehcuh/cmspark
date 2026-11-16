# 即时设置回执（阶段 1a 计划）

GitHub: #806

状态：计划。本文件不改产品行为。配套测试 `chrome-extension/tests/settings-immediate-receipt-806.test.ts` 停在红，等独立评审后再做最小修复。

## 现有回执

已经存在、本计划继续使用的路径：

- 扩展到后台：`chrome.runtime.sendMessage({ type: "config.set", config, id?, config_revision?, confirmation_phrase? })`。`chrome-extension/src/background/index.ts` 的 `config.set` 只在 WebSocket 发出后回复 `{ ok: true }`；未连接时回复 `{ ok: false, error }`。注释写明发出不等于持久化。
- Companion：`companion/src/message-router/handlers/config.ts` 的 `config.set`。带 `id`（`settings-save:` 前缀）和 `config_revision` 时走 `saveConfigWithReceipt`。修订不一致时返回已有的 `config.conflict` 与当前 `config_revision`。写入成功返回已有的 `config.updated`、`config_revision`，以及能证明本次写入时的 `config_applied_revision`。
- 侧栏：`useWebSocket.ts` 把 `config.updated` / `config.conflict` 派成已有的 `SET_CONFIG_SNAPSHOT`。`agentStore.tsx` 忽略更旧或无法比较的修订；断连且存在 pending 保存时把 `settingsSave.status` 标成 `unknown`。
- 主保存按钮已经带 `id` 与 `config_revision`，传输 `{ ok: true }` 不关页面，也不把状态标成 `saved`。

即时开关没有走这套回执。`SettingsSlideout.tsx` 里三旗和编程接力的建议、本机终端、内嵌终端在发送前执行 `SET_CONFIG`。协议解锁关闭时立刻 `ADD_SECURITY_AUDIT`。`sendSecurityFlagConfig` 不读取回调。并发上限的回调只有在看到 `response.type === "config.updated"` 时才 `SET_CONFIG`，而后台实际只回 `{ ok: true }`；若回调里真带上一份配置，这次 `SET_CONFIG` 不看修订，会盖住更新的快照。

## 最小修复（本阶段不实施）

只改 `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx` 里这些提交回调：

- `sendSecurityFlagConfig` 与三旗开关
- `onToggleAutoSuggest`、`onToggleOpenLocalTerminal`、`onToggleEmbeddedTerminal`、`onChangeLocalTerminalApp`
- `onChangeMaxConcurrentSessions`

做法：

1. 点击后不执行 `SET_CONFIG`。界面勾选和并发数字继续读最后一次已应用的快照。
2. 发送沿用主保存的 `config.set`：带 `settings-save:` 前缀的 `id` 和当前 `config_revision`。武装三旗时继续附带现有 `confirmation_phrase`。短语常量、Companion 对短语的校验、三旗含义都不改。
3. 回调 `{ ok: false }` 或 `chrome.runtime.lastError`：保持快照值，把这次保存标为未知，不写本地成功审计。
4. 回调 `{ ok: true }` 只表示传输被接受。勾选、`state.config` 和审计都保持不动，直到对应的 `config.updated` 快照到达。
5. 更新的快照按现有 reducer 合并。更旧的修订、无法比较的修订、以及迟到的回调配置都不得盖住更新的快照。不把失败理解成“把界面回滚到点击前的本地猜测”。
6. 协议解锁的本地审计只在匹配的更新快照证明 `allow_all_schemes` 已经变成请求值之后写一次。同一 `id` 的重复快照不再追加。
7. 并发上限不再用回调里的 `config` 做 `SET_CONFIG`。值只跟随后的 `config.updated` 快照走。

不改 `companion/src/message-router/handlers/config.ts` 的授权判断，不改 capability 模型，不改 outbound，不改 Linux 终端或 Whisper。不关闭 #806。

## 红绿顺序

当前停在红。下一节点先让上述测试变绿，再跑 `settings-draft-store-806.test.ts` 和 `npm --prefix chrome-extension test`。Companion 全量测试不因这次 UI 回执而必须重跑，除非修复碰到了 Companion。

## 本阶段不解释的原生失败

`680e790697c80ed4e8aa5fa736ff10551412ab0b` 的 CI `build` 成功。`smoke (windows-native)` 失败：`activity-apps-825.test.js` 的 Windows PowerShell Apps producer 约 15 秒后 `D825_PRODUCER_PROCESS {"code":null,"killed":true,"signal":"SIGTERM"}`。评审当时 `smoke (windows-latest)` 仍在运行；随后对同一 SHA 的复查显示它已成功结束。日志没有给出这次 SIGTERM 的唯一原因。这里不把它记成产品缺陷，也不改原生代码。
