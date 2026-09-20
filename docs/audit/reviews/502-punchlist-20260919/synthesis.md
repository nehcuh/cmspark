# 502 punchlist 六路对抗合成

> **Date:** 2026-09-19
> **Branch:** `fix/502-adversarial-punchlist` `022b2f60`
> **Base:** `origin/main` `93923c1d`
> **Scope:** 97 files, +12102 / −183。含 #502 操作面、#504–#511 punch list、#513 舰队建议卡、#514 Glance 推送 / spawn kick。未提交 `memory/project-knowledge.md` 不进审。
> **PR:** [#512](https://github.com/nehcuh/cmspark/pull/512)（punch list）；#513/#514 叠在同一 head，尚无独立 PR。
> **Lanes:** A PRODUCT · B CORRECTNESS · C SECURITY · D ARCHITECTURE · E UX · F SKEPTIC（互不读对方报告）
> **Orchestrator 抽查:** 下列 BLOCK/MAJOR 均对照 HEAD 源码复读；spawn 回归测试由编排器复跑。

```text
Surface:      Side Panel stream + Settings + 已有全页 terminal tab
L2-classes:   none new; spawn_worker L2 预览/HMAC 未跟上 #514 goal
Compose:      Fleet still ADR-015 threads; ACP still Composition
Autonomy:     fleet accept 不 arm；kick 扩大 abort-map 空洞
Trust:        归档 stub 方言；persist_full 须保存后才进 companion
Channel:      community
Blast:        T2
```

**总判：REJECT。** 四条独立 BLOCK（用户可见折叠、归档方言、kick 停不掉、CI spawn 夹具）+ 若干 MAJOR。不得把六路数字相加。

---

## 1. 六路表

| 路 | verdict | 抽查后站得住的 BLOCK/MAJOR | 被折 / 降级 |
|----|---------|---------------------------|-------------|
| A PRODUCT | REJECT | X2 归档 SEC-C 方言；X6 开关已开启未落盘；X7 双「继续」；X3 spawn L2 无 goal | Glance / 不 arm / 不嵌 Alacritty 已推翻 |
| B CORRECTNESS | AWN | X8 live mirror 盖住 #430 隔离 | #504/#505/#506/#507/#511/#513/#514 主契约抽查成立 |
| C SECURITY | AWN | X3 HMAC/预览无 goal（MAJOR） | HARD_DENY / 归档 redact / propose 不 spawn / PTY fail-closed 成立 |
| D ARCHITECTURE | REJECT | X4 kick 不进 abort map；X5 fresh 门被 4s poll 续命 | spawn 有 brief+kick；fleet_suggest 全层接线；page-follow 在 |
| E UX | REJECT | X1 live/L2 被 trailing 答案挤成 done 芯 | 确认台仍可弹；空 content 回合逃过此洞 |
| F SKEPTIC | REJECT | X9 spawn 夹具红 + 全绿叙事 | goal 必填在生产 dispatch；accept 不 arm；D/Observatory 未偷运 |

独立命中（高置信）：X2 = A+E；X3 = A+C。其余 BLOCK 各只一路，但编排器源码复读成立。

---

## 2. 去重后的真问题

同一根因只记一次。换角描述收进「也表现为」。

### X1 — BLOCK · 进行中的工具卡被折进审计芯

- **根因：** `#514` `consolidateRunToolTurns` 把有正文的 mid-turn assistant 放到 tools 块**之后**；`ChatView` 仍用 `itemIsLast` 给 tools 块喂 `threadBusy` / pending L2。`tool.start` 会把流式正文落成带 `tool_calls` 的 assistant 行（`useWebSocket.ts:713-761`）。
- **文件：** `ChatView.tsx:484-492, 1152-1153`；`tool-history-view.ts:384-415`
- **用户：** 「好的，我来打开页面」被当成答案；当前 running / 确认中卡躲进默认收起的「展开审计」。Spec §2.2/§2.3 失守。DeepSeek 空 content 回合碰巧逃过。
- **来源：** E P-E-1。A 未报（漏）。不是 X7（触顶双 CTA）。
- **证据：** [inspected] 编排器复读。无浏览器 e2e。
- **修：** 当前 run 的最后一颗 `kind:"tools"` 才是 live 前沿，即使后面还有 trailing assistant。

### X2 — BLOCK · 默认归档复用 SEC-C「出于安全未持久化」

- **根因：** `archiveToolPayload` 注释写明复用 `{redacted,len,sha256}` 以便面板继续说「出于安全未持久化」。默认档把 **非敏感** navigate/click/get_page_text 也收成同一信封。
- **文件：** `tool-persistence-redact.ts:272-283`；`ChatView.tsx:1724-1734`
- **用户：** reload 后展开审计，每一步都像被安全折叠。人去「安全与信任」，不去「对话归档」。Spec §3 要求「正文未保存」。
- **来源：** A P-A-1 + E P-E-2（独立，同一洞）。
- **证据：** [inspected]
- **修：** 产品省略 ≠ 安全折叠。两套文案。cookie/shell 仍走 SEC-C。

### X3 — MAJOR · `spawn_worker` 已必填 goal 并立即 kick，L2 预览与 HMAC 仍不含 goal

- **根因：** 预览串 `role/alias/pack/allow/deny/intent`（`l2-admission.ts:329-330`）；token 同字段（`security-policy.ts:95-101`）。`spawn_expert_team` 已有 `goal=`。#514 批准后立刻 `persistWorkerBrief` + `kickWorkerChat`。
- **用户：** 确认台批准「检索 worker」，看不到将执行的任务句。换 goal 的活 token 在 TTL 内仍过 `validateTokenFor`。
- **来源：** A P-A-4 + C P-C-1。不是新 L2 类，不是 propose 无 L2。
- **证据：** [inspected]
- **修：** 预览截断 goal/role_prompt；HMAC 绑定二者；消毒同 `sanitizeFleetSubtask`。HARD_DENY 仍在，故非 BLOCK。

### X4 — BLOCK · kick 的 `chatCreate` 不进 abort map → Glance `llm_active` 假、全停停不掉

- **根因：** `kickWorkerChat`（`server.ts:765-782`）直接 `adapter.chatCreate`，不 `abortControllers.set`、不传 `signal`。`listLlmActiveThreadIds` = abort map keys。`abortThreadChat` 无 controller 则 `stopped:false` 且不 release 闸（闸在 `scheduleWhenLlmSlotAvailable` 里占着直到模型自然结束）。`fleet.stop_all` 走 `abortThreadChat`（`message-router.ts:4438`）。
- **用户：** spawn 后 Glance 显示 idle；点全停画 paused，worker 仍在打 token。
- **来源：** D P-D-1。专家组队 kick 旧洞；#514 把普通 `spawn_worker` 接上同一 kick，爆炸半径变默认路径。
- **证据：** [inspected]
- **修：** kick 必须与 router `chat.create` 同一套 AbortController + signal + owner panel。测试：spawn+kick 后 `abortThreadChat` 必须打断 HTTP。

### X5 — MAJOR · #514「10 分钟 fresh」被 FleetStrip 4s `fleet.status` 续命

- **根因：** `hasFleetActivity` 看 `state.fleet.at` vs 10min（`FocusBand.tsx:66-75`）。Glance 一挂上就 4s pull（`FleetStrip.tsx:66-71`）。`buildFleetSnapshot` 每次写新 `at`。要过期必须先卸 Glance，要卸必须先过期。
- **用户：** 空闲舰队在本会话里永久占 FocusBand。「不是 forever squat」不成立。
- **来源：** D P-D-2。不是 X4。
- **证据：** [inspected] 分类单测不挂 Strip+store。
- **修：** idle 且无 lock/intent/llm_active 时停 poll；或用 pull 不碰的 `activity_at`。

### X6 — MAJOR · 归档开关显示「已开启」但未 `config.set`

- **根因：** 点击只 `SET_CONFIG`（`SettingsSlideout.tsx:3457-3461`）。同文件编程接力 / 内嵌终端立刻 `config.set`。Companion 要等页脚「保存并关闭」整包 `toSave`（`handleSave:426-432`，allowlist 已收该字段）。
- **用户：** 开了继续聊，reload 仍是桩。以为功能坏了。
- **来源：** A P-A-2。与 X2 不同：X2 是已写成的桩文案；这是开关何时生效。
- **证据：** [inspected]
- **修：** 点击即 `config.set`，或在保存前禁止写「已开启」。

### X7 — MAJOR · 未武装触顶同时出现「回复继续」与「继续做完」（arm）

- **根因：** `shouldShowRoundLimitHint` 只看 `!loopView && terminal==="round_limit"`（`LoopStatusRow.tsx:35-39`）。`LoopSuggestCard` 是独立块（`ChatView.tsx:566-579`）。kernel 在 unarmed + `round_limit` + 未勾项时仍发 `task_loop.suggest`（`loop-kernel.ts:360-378`）。#505「无双提示」只对上了 LoopStatusRow。
- **用户：** 两条继续。点「继续做完」= 注入 20-run 续跑自主权。
- **来源：** A P-A-3。不是 X1。
- **证据：** [inspected]
- **修：** 有 `loopSuggest` 则不画 RoundLimitHint；或触顶只留与动作一致的一条 CTA。

### X8 — MAJOR · #504 live mirror 让 #430 内容风控隔离对同进程续跑失效

- **根因：** `quarantinePersistedToolRow` 只 `updateMessage`（`adapter.ts:283-330`）。rebuild 优先 live（`:435-444`）。`rememberLiveToolResult` 从不改写成隔离桩。
- **用户：** 同进程「继续」把已隔离的大工具正文再喂给模型，再撞一次 400。
- **来源：** B P-B-1。重启无 mirror，磁盘路径仍对。
- **证据：** [inspected] live-rebuild 测试未走 content-risk。
- **修：** 隔离时同步 `rememberLiveToolResult`；或 disk `quarantined` 时不要用 live。

### X9 — BLOCK · `goal` 必填后旧 spawn 夹具红，全绿叙事不成立

- **根因：** 生产 `spawn_worker` 拒空 goal（`companion-dispatch.ts:176-187`，正确）。`p2-deep-diagnosis-batch` / `spawn-rollback-demote` 未带 goal。
- **编排器 [executed]：** 12 测 7 过 5 败，失败句均为 `spawn_worker requires goal` / `INVALID_ARGS` vs 期望 `SPAWN_PACK_FAILED` / `SPAWN_INTENT_FAILED`。
- **叙事：** PR #512「1416/1416 · 零新增失败」对的是更早 SHA `c7986a62`。tip 提交写 180/180、1442/1442。HEAD 上这些 spawn 回归是红的。Linux CI 同样会红。
- **来源：** F P-F-1。goal 本身成立（overturned）。P-F-3「既有测试全绿」并入本条。
- **修：** 夹具加 goal；intent 用例按 BOARD_MISSING 软跳过改期望；停止引用历史 1416/1442。

### X10 — MAJOR · 内嵌终端设置开关 `config.set` 被 companion allowlist 丢掉

- **根因：** UI 发 `{ embedded_terminal: { enabled } }`（`SettingsSlideout.tsx:3262-3270`）。handler 收了 `persist_full_tool_history` 和 `coding_handoff`，**没有** `embedded_terminal`（`handlers/config.ts`）。默认关 → 点开是空操作（安全方向 fail-closed）；磁盘若已 true，点关也存不住。
- **来源：** C residual。本分支刚给归档开关补了 allowlist，同类洞留在 C 切片开关上。
- **证据：** [inspected]
- **修：** allowlist 收 `embedded_terminal.enabled` 布尔；与 X6 机制不同（一个没发、一个发了被丢）。

---

## 3. 降级 / 并入 / 推翻

| 候选 | 处置 | 理由 |
|------|------|------|
| F P-F-2 kick 测试 mock 掉生产 start | **并入 X4 + NIT** | 生产 `server.ts` **确实** bind kick 并 `scheduleWhenLlmSlotAvailable`。测试证不了 LLM 起跑，但「根本没 kick」被 B/D 推翻。残余：unbound 时 `success:true kicked:false`（D P-D-3，NIT） |
| F P-F-3 spec 验收未勾 | **并入 X9** | 带外评测可另开；「既有全绿」已被 5 条红测证伪 |
| F P-F-4 源码正则护照 | **NIT 簇** | accept 不 arm 的生产路径 [inspected] 成立；#508 仍是正则，不是用户洞 |
| E P-E-3 / F P-F-5 文案里的「100」 | **NIT** | 触顶提示存在且非墓碑；与线稿 AC-D「不进文案」张力，不是功能撒谎 |
| A P-A-5 history.db/logs 未对外说明 | **NIT** | 配置 SCOPE 注释在；用户设置少一句。不是新泄漏 |
| B P-B-2 武装段间文案粘住 | **NIT** | 续跑仍 enqueue |
| B P-B-3 LoopStatusRow 全局确认计数 | **NIT** | #507 工具史作用域已 stamp `worker_id` |
| D P-D-4 spawn_worker 无 zod | **NIT** | executor 仍 fail-closed |
| D P-D-5 run-end 舰队 push 单播 | **NIT** | spawn/kick 已 broadcast |
| E P-E-4 建议卡脚无 wrap | **NIT** | 无浏览器实测 overflow |
| F P-F-6 DONE.md 计数互相打架 | **NIT** | 文档当护照 |
| 「Glance 从不出现」 | **推翻** | spawn/kick/run-end 有 push |
| 「accept 会 arm」 | **推翻** | `chat.send` + dismiss，无 `task_loop.arm` |
| 「嵌 Alacritty / 自动开 PTY」 | **推翻** | embed_intent 仅点击+L2；darwin∧enabled |
| 「#504 磁盘也存全文」 | **推翻** | live-rebuild 测试：同进程全文、磁盘桩、新 ThreadManager 回落桩 |
| 「Goal Driver / Observatory 已出荷」 | **推翻** | CHANGELOG 只写 G1；无 goal_state / Observatory 字符串 |

---

## 4. 仍成立的切片（抽查）

- **A 工具史分组 / hydrate 门** 在（空 content 路径）；X1 是 #514 合并后的 live 前沿。
- **B 归档 stub + #511 失败行诊断 + 敏感类先 redact** 在。
- **C Mode C peek/take fail-closed、无 file 拒 argv、默认关** 在。
- **G1/ #505** `chat.done.terminal=round_limit` 在；墓碑文案已删。X7 是双 CTA。
- **#513** propose 零变更、SUMMONER/worker 拒、accept 不 arm、校验器 lockstep 在。评测脚本仍带外。
- **#514** goal+brief+kick 生产路径在；BOARD_MISSING 软跳过在。X4/X5/X9 是它的残差。

---

## 5. 合并门

| Gate | Result |
|------|--------|
| MACHINE | **FAIL** — X9：spawn 回归 5 红 [executed] |
| ADVERSARY | **REJECT** — X1 X2 X4 X9 独立 BLOCK |
| 建议 | 先修四条 BLOCK + X3/X6/X7（HITL/开关/双 CTA），再 dual 复审放行 |

本文件不是 dual。kimi + claude 复审另文。
