# 即时设置回执（阶段 1a 计划）

GitHub: #806

状态：计划。本文件不改产品行为。配套测试 `chrome-extension/tests/settings-immediate-receipt-806.test.ts` 停在红，等独立评审后再做最小修复。

## 现有回执

已经存在、本计划继续使用的路径：

- 扩展到后台：`chrome.runtime.sendMessage({ type: "config.set", config, id?, config_revision?, confirmation_phrase? })`。`chrome-extension/src/background/index.ts` 的 `config.set` 只在 WebSocket 发出后回复 `{ ok: true }`；未连接时回复 `{ ok: false, error }`。注释写明发出不等于持久化。
- Companion：`companion/src/message-router/handlers/config.ts` 的 `config.set`。带 `id`（`settings-save:` 前缀）和 `config_revision` 时走 `saveConfigWithReceipt`。修订不一致时返回已有的 `config.conflict` 与当前 `config_revision`。写入成功返回已有的 `config.updated`、`config_revision`，以及能证明本次写入时的 `config_applied_revision`。
- 侧栏：`useWebSocket.ts` 把 `config.updated` / `config.conflict` 派成已有的 `SET_CONFIG_SNAPSHOT`。`agentStore.tsx` 忽略更旧或无法比较的修订；断连且存在 pending 保存时把 `settingsSave.status` 标成 `unknown`。
- 主保存按钮已经带 `id` 与 `config_revision`，传输 `{ ok: true }` 不关页面，也不把状态标成 `saved`。

即时 `config.set` 没有走这套回执。`SettingsSlideout.tsx` 在发送前或发送后立刻 `SET_CONFIG`，并且多数调用不登记回调、不带 `id` / `config_revision`。核对过的入口：

- 危险操作关闭 `470-473`，武装确认 `484-494`
- 企业工具关闭 `497-500`，武装确认 `510-520`
- 协议解锁关闭 `536-552`（含立即审计），武装确认 `555-578`（含立即审计）
- `applySecurityFlagsTarget` `607-621`：运行自主度武装在 `710-714` 同步调用；解除武装在通道回调 `733-737` 里调用。两者都会合并三旗并写审计
- 编程建议 `3220-3233`，本机终端 `3235-3248`，内嵌终端 `3254-3262`，本机终端应用 `3264-3277`，ACP 总开关 `3279-3292`
- 并发上限 `3200-3205` 有回调，但消息仍没有 `id` / `config_revision`；回调看到 `response.type === "config.updated"` 才 `SET_CONFIG`。后台 `config.set` 实际只回 `{ ok: true }` 或 `{ ok: false, error }`

`config.set` 没有墙钟超时。现有「未知」只来自三处：保存回调里的 `chrome.runtime.lastError` 或 `ok: false`（`SettingsSlideout.tsx` `415`）、WebSocket 上 `id` 匹配 `settings-save:` 的 `error` 帧（`useWebSocket.ts` `2389-2393`）、以及 pending 保存期间断连（`agentStore.tsx` `1197-1204`）。本计划不新造超时消息。

## 最小修复（本阶段不实施）

只改 `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx` 里上面列出的提交回调。

1. 点击后不执行 `SET_CONFIG`。勾选、并发数字和终端应用继续显示最后一次已应用快照。
2. 每次即时 `config.set` 带主保存已有的 `settings-save:` id 和当前 `config_revision`，并登记回调。武装三旗时继续附带现有 `confirmation_phrase`。短语常量、Companion 校验、三旗含义都不改。
3. 回调 `{ ok: false }` 或 `lastError`：快照值不动，`settingsSave.status` 变为已有的 `unknown`，审计不增加。
4. 回调 `{ ok: true }` 只表示传输被接受，状态保持 `pending`。测试必须实际调用这个回调后再看勾选、`state.config` 和审计；缺回调本身失败，不能跳过。值和审计都等到对应 `config.updated` 快照。审计入口在快照前是 0，匹配快照后恰好 1，重复同一快照仍是 1。
5. 更旧修订、无法比较的修订，以及迟到回调里的配置，都不得盖住更新的快照，也不得把同一次 `id` 的审计再写一条。
6. 协议解锁和运行自主度的本地审计只在匹配的更新快照证明请求值已经落定后写一次。
7. 并发上限不再用回调里的 `config` 做 `SET_CONFIG`。值只跟随后的快照走。

无人值守武装 `638-694` 走的是已有 `security.unattended.arm`，不是这组 `config.set`。它的回调在 `{ ok: true }` 后写审计，但仍等待 `security.unattended.status`，不在本计划里改它的授权语义。

不改 `companion/src/message-router/handlers/config.ts` 的授权判断，不改 capability 模型，不改 outbound，不改 Linux 终端或 Whisper。不关闭 #806。

## 入口覆盖

每个入口都锁住「`callback({ ok: true })` 之后仍是权威快照、`settingsSave.status` 为 `pending`、审计没有提前增加」。拒绝、`lastError` 和断连共用危险操作关闭上的未知路径。协议解锁与运行自主度另外锁住确认前 0、确认后恰好 1、重复确认仍是 1。更旧修订不能盖住更新快照。并发上限的 `{ ok: true }` 不改变数字；它的回调若带上一份旧配置，也不能盖住更新快照。

| 入口 | 传输 ok 后仍未成功 | 拒绝或 lastError | 确认后审计恰好 1 |
|---|---|---|---|
| 危险操作关 / 开 | 有 | 关有两种 | 开不写审计 |
| 企业工具关 / 开 | 有 | 共用 | 开不写审计 |
| 协议解锁关 / 开 | 有 | 共用 | 关、开都有 |
| 编程建议、本机终端开关、本机终端应用、内嵌终端、ACP | 有 | 内嵌终端有 lastError | 无审计 |
| 并发上限 | 有，且迟到 `config.updated` 不盖新快照 | 共用未知机制 | 无审计 |
| 运行自主度武装 / 解除 | 有 | 解除先等通道回调 | 都有 |

## 红绿顺序

当前停在红。下一节点先让上述测试变绿，再跑 `settings-draft-store-806.test.ts` 和 `npm --prefix chrome-extension test`。Companion 全量测试不因这次 UI 回执而必须重跑，除非修复碰到了 Companion。

## 本阶段不解释的原生失败

`680e790697c80ed4e8aa5fa736ff10551412ab0b` 的 CI `build` 成功。`smoke (windows-native)` 失败：`activity-apps-825.test.js` 的 Windows PowerShell Apps producer 约 15 秒后 `D825_PRODUCER_PROCESS {"code":null,"killed":true,"signal":"SIGTERM"}`。评审当时 `smoke (windows-latest)` 仍在运行；随后对同一 SHA 的复查显示它已成功结束。日志没有给出这次 SIGTERM 的唯一原因。这里不把它记成产品缺陷，也不改原生代码。
