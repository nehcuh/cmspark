# CMspark 插件会话「截断 / 切走丢失 / 多出 w2k8z9」— 四路独立对抗合成

> **日期:** 2026-09-01  
> **HEAD:** `3cd70cf8` (`main`)  
> **现场:** `~/.cmspark-agent/threads/{3qb5ea,w2k8z9}.json` + `companion-2026-09-01.log`  
> **状态:** 四路合成 + **kimi AWN + claude AWN**（`thread-loss-3qb5ea-20260901-{kimi,claude}.md`）。nits 已折进 §3。**允许按 P0 开工**（尚未写码）。  
> **现象:** 插件对话 `3qb5ea` 提示工具输出截断；点其他对话再回来消息丢失；侧栏多出 `w2k8z9`。

```text
Surface:      Side Panel thread list + chat column + companion LLM loop
L2-classes:   (none — persistence / recency / output cap)
Compose:      n/a
Autonomy:     n/a
Trust:        honesty of transcript vs disk; recency clock ≠ metadata write
Channel:      community
Blast:        T2 (user-visible history honesty; no RCE)
```

**产品句：** 侧栏里看到的「最近对话」必须是真人消息时间，不是摘要任务；切走再回来必须还能看见已经生成过的内容；模型打满输出上限时，截断必须落盘且在 UI 上说清楚。

**实现是否允许开工：是（P0，折完 dual nits）。** Dual 双方 `APPROVE_WITH_NITS`，无 REJECT。

---

## 1. 四路表

| 路 | verdict | 站得住的根因 | 被推翻 / 降级 |
|----|---------|--------------|----------------|
| **A CORR** | PARTIAL | 截断工具批 **不 `addMessage`**；切会话 `messages:[]` 只水合磁盘；`3qb5ea` 磁盘未删正文 | `w2k8z9` 不是本次 `thread.create`；1000 条上限无关 |
| **B PRODUCT** | PARTIAL | digest `update()` bump `updated_at` → 按该字段排序 → 旧线程进「今天」；切会话必清空列 | 点击选中不会 `thread.create`；不是 fork；不是同一 id 双行 |
| **C STREAM** | CONFIRMED + PARTIAL | thinking 吃光 `max_tokens=8192` → 空 `content`；H2 `truncatedToolBatch` 才是截断文案且不落盘；`chat.done.truncated` UI 不读 | `#265 listSig` 不卸消息列表；输入 overflow 未发生 |
| **D SKEPTIC** | STORY_PARTLY_HOLDS | 三条独立 bug 叠加 + 用户误读；磁盘双真相成立 | 磁盘 compaction / nanoid 碰撞 / `get()` 空快照 / overlay lease / SW 创建线程 |

**抽查（本合成，[inspected] 代码 + [executed] 现场 json/log）：**

- `3qb5ea.json` 27 条，最后是用户「继续」`2026-09-01T05:47:43.717Z`，其后无助手。
- `05:35:14` `completion_tokens:8192` → 助手 `content:""` + 巨大 `reasoning_content`。
- `05:42:16` `run_progress_propose` + `ensure_project_dir` 成功；`05:42:17` 起多次 `llm.anthropic_request` **无** `llm.usage`。
- `w2k8z9` `created_at=2026-08-31T05:38:39Z`；`updated_at=digest.extracted_at=2026-09-01T06:25:20.409Z`；09-01 log **零** `thread.create`。
- `computeMaxTokens`: `min(8192, floor(cw/8))` → 即使用户 `context_window` 是 128k 或 1e6，输出帽都是 **8192**。
- `SET_ACTIVE_THREAD` 跨 id 必 `messages: []`。`handleSelect` 不发 `chat.abort`。
- `truncatedToolBatch` `return` 在 `llm.usage` / `addMessage` **之前**。

**被推翻（四路交叉，禁止当根因修）：**

- 磁盘删了 `3qb5ea` 历史 / `MAX_MESSAGES_PER_THREAD` 裁剪
- `w2k8z9` 是 `3qb5ea` 的 fork 或今天新建
- 点击选中会 `thread.create`
- `#265` `listSig` remount 卸掉 ChatView 消息列表（key 只在 `RunProgress`）
- `get()` `saveIndex` 空快照盖 index（已是内存 seed）
- compaction 写回并删除 `threads/<id>.json`
- nanoid 碰撞、overlay composer lease

四路皆 PARTIAL/CONFIRMED 且 BLOCK 可折 → **overall_verdict = PASS_WITH_CHANGES**（诊断成立，修复针如下）。任一未折的「磁盘损坏 / 新建线程」叙事会把路径打回 REJECT。

---

## 2. 根因（三条独立因果，叠成用户看到的「乱」）

### R1 — 输出帽 8192 + thinking 计入 completion（空回复 / 正文腰斩）

**证据：** `companion/src/llm/providers/anthropic-convert.ts:58-61`；现场 `05:35:14` / `05:39:05` 两次 `completion_tokens:8192`。  
**机制：** Anthropic 路径强制 `max_tokens=computeMaxTokens(cw)`。glm-5.3 thinking_delta 计入 `output_tokens`。adapter 只把 `token` 累进 `assistantContent`。纯文本 length-stop **会** `addMessage`（可空 content）并在 `chat.done` 带 `truncated:true`。  
**UI 洞：** `useWebSocket.ts` `chat.done` **不读** `truncated`；历史态 reasoning 默认折叠 → 05:35 看起来像空白气泡。

### R2 — 截断工具批不落盘 + 切会话只水合磁盘（「消息丢失」）

**证据：** `adapter.ts:1047-1072` `truncatedToolBatch` → `chat.error`「输出被截断（工具调用不完整），已停止。」→ `return`（无 `addMessage`、无 `llm.usage`）。  
`agentStore.tsx:798-809` 切 id → `messages:[]`；`ThreadList.tsx:721-722` 只 `thread.select`，不 `chat.abort`。  
`useWebSocket.ts` `chat.error` / `chat.aborted` 用客户端临时 id，不进 json。  
**现场：** PDF 工具成功后 round-2（写 HTML）从 `05:42:17` 起无 usage；用户 13:47 再「继续」仍无助手落盘。切走再回来只看到磁盘上停在「继续」的磁带。

**注意（C/D）：** 「无 `llm.usage` ≠ 一定 hang」。当前代码 H2 成功截断时 **本来就不打 usage**。`05:50:44` 是二次 H2 还是 hang，**unknown**——所以修法第一条就是把 usage/finish_reason 打在 return 之前。

### R3 — digest 写 index 当「最近活跃」（「多出 w2k8z9」）

**证据：** `thread-manager.ts:878` `update()` 无条件 `updated_at = monotonicTimestamp()`；`message-router.ts:2037` `update({ digest })`；`thread-timeline.ts:168-171` 列表/「今天」按 `updated_at`。  
live `thread_digest.enabled: true`, `on_idle_hours: 24`。`w2k8z9` 上次真人消息 08-31 14:11，约 24h 后 09-01 14:25 抽出 digest，被顶到「今天」第一，别名仍是重复的 `cruise-wl`（index 里 55 条同名），digest tldr 看起来像新对话。  
handler 里 `source: "manual"` **写死**，懒加载摘要也会被标成 manual。

三条独立：修 R3 不会让截断落盘；修 R2 不会让旧线程别跳到今天。必须三条都折。

---

## 3. 修复针（具体到文件，按 P0→P2）

### P0 — 诚实：落盘 + 时钟

| ID | 改什么 | 文件 | 行为 | 测试 |
|----|--------|------|------|------|
| **P0-1** | digest/run_progress/budget **禁止**当列表时钟 | `companion/src/threads/thread-manager.ts:878`；`insertMessageAt` / `addMessage`（wrapper 在 :1012） | **不变量：** 消息行追加推进 `last_message_at`；元数据写入永不推进。不要把时钟钉死在 `addMessage` 这个薄包装上（compaction/import 也走 insert）。`update({ digest })` 只改 digest。现有 `addMessage` 里的 `updated_at` bump（:1066）可留，timeline 改读 `last_message_at` 后无害。 | `update({ digest })` 不改 `last_message_at`；lazy extract 不把线程推进「今天」 |
| **P0-2** | 列表排序/分组用消息时钟 | `chrome-extension/src/sidepanel/utils/thread-timeline.ts:168-182`；overlay `companion-client.ts:239-244` | `last_message_at \|\| created_at`。现有测试 `prefers updated_at` **要反转**。**迁移：** 现存 ~339 线程没有 `last_message_at`；若直接 fallback `created_at` 会按创建日重排。`get()` 懒回填：从 `threads/<id>.json` 最后一条消息 `created_at` 写入（只内存或一次 index，**不要**为此 bump 列表时钟以外的字段）。 | 日历分组测改断言；无字段旧线程回填后仍按最后消息日分组 |
| **P0-3** | 截断工具批必须落盘 | `companion/src/llm/adapter.ts:1051-1072` + 已有 `persistInterruptedRemainder` / :1731-1739 | `return` 前：`llm.usage` + `finish_reason` **先打 log**；`addMessage` 助手（content + 不完整 tool_calls + reasoning + `truncated`/`incomplete_tools`）+ 一条持久错误行；**然后** `chat.error`。不完整 `tool_calls` 必须走现有 interrupted 填充，否则下一轮 unpaired tool_result / provider 400。 | 扩 `adapter-steer-overflow.test.ts`：prompt-mode truncated batch 后 `getMessages` 非空且 tool 行可配对 |
| **P0-4** | 切会话不要先变成空白真相 | `agentStore.tsx:809` | 跨 id 保留 `messagesByThreadId` 缓存，或等 `thread.messages` 到达再替换；空白期显示加载而非 EmptyState。失败 fail-closed 时重试 `thread.select`。 | 切 B 再回 A，hydrate 延迟时仍能看见缓存条 |

### P1 — 上限与 UI 诚实

| ID | 改什么 | 文件 | 行为 | 测试 |
|----|--------|------|------|------|
| **P1-1** | thinking 模型输出帽 | `anthropic-convert.ts:58-61`；config 增加 `llm.max_tokens` / thinking budget | 不要把 1M/128k 窗口的 `/8` 再 `min(8192)` 当 glm-5.3 聊天帽。thinking 与 text 分预算，或至少可配置且默认高于 8192。H2 retry 必须动 **输出** 预算，不能只 compact 输入（输入没爆时 retry 是空转）。 | `computeMaxTokens(1e6)===8192` 视为脚枪：加 glm-thinking 策略测证明聊天帽不再是这个 |
| **P1-2** | UI 读 `truncated` | `useWebSocket.ts` `chat.done`；`ChatView`/`MessageRow` | 渲染「回答被输出上限截断」。空 content + 有 reasoning → 「思考耗尽额度，正文未发出」。hydrate 后仍在。 | 已有 adapter 测发 `truncated:true`；补 UI/hydrate 测 |
| **P1-3** | abort 冲刷（**不要改 `drainThreadOnSupersede`**） | `adapter.ts` abort catch ~1748-1760（`persistInterruptedRemainder` + 仅非空 `assistantContent` 的 fallback） | Dual 纠正：`drainThreadOnSupersede`（`message-router.ts:234`）只拒 pending 确认，不冲刷半截助手。真正缺口是 abort catch：reasoning-only 时 `assistantContent` 为空就不落盘。无 `savedAssistantId` 时 reasoning 也要落盘。切走或「继续」steer 不得丢掉 round-2 半截 HTML。 | abort + 空 content 非空 reasoning → json 有行 |

### P2 — 产品债（不阻塞 P0）

| ID | 改什么 |
|----|--------|
| **P2-1** | 重复 alias（`cruise-wl` ×55）列表显示 preview + `#id`；hostname 形 alias 允许 auto-title 覆盖 |
| **P2-2** | extract_digest 的 `source` 不要把 lazy 写成 `manual` |
| **P2-3** | 空 `cruise-wl` 壳走已有 `cleanupEmpty` 入口 |

---

## 4. 明确不要修

- 不要为这次拆 `#265` RunProgress / `listSig`。
- 不要把 compaction 当成删磁盘历史来「修」。
- 不要把 `w2k8z9` 当损坏 fork 删掉（那是 8/31 真实 2 条消息的立项风险分析）。
- 不要恢复 `get()` 写盘。
- 不要在 `handleSelect` 里盲目 `chat.abort` 而不先 flush（会把 R2 变成「一点就丢」，除非 P0-3/P1-3 已落地）。

---

## 5. Unknown（不挡 P0，但 Dual 若当 BLOCK 需说明为什么）

- GLM 实际 `stop_reason` 未打日志（推断 `max_tokens`）。
- `05:50:44` hang vs 第二次 H2。时间线上还有 `05:44:50.378` 第二次 `llm.anthropic_request`（无 usage）——与 auto `lengthRecoveryUsed` retry 合拍，但没有 compact 日志；P0-3 打 log 后可消歧。
- `05:39:05` `prompt_tokens:56`：provider 谎报 vs 真的短请求（thinking 不回传）。不单独当 R1 的否证。
- 用户 06:25 是打开列表懒加载还是点了「提取未标注」——两条都走 `extract_digest`，R3 都成立。
- `thread.messages` 超大 `reasoning_content` 是否撞 10MB WS 帽：本事件用户看到的是「缺最后一轮」而非整列空白，H6 降级。

---

## 6. 验收（修完后用本事件回放）

1. 把 `w2k8z9` 再 extract 一次 → 侧栏排序仍按 08-31 最后一条消息，不进今天顶部。
2. 复现 truncated tool batch fixture → `threads/<id>.json` 有助手+错误行；切走再回来还在。
3. thinking 打满、无 text_delta → 不是空白泡，有截断芯片。
4. 切 A→B→A，B 的 `thread.messages` 延迟 500ms → A 列不闪 EmptyState。

---

## 7. Dual（kimi + claude）

| 路 | VERDICT | 独立抽查 |
|----|---------|----------|
| kimi | **APPROVE_WITH_NITS** | 7 项 cite 全部现场核对；`w2k8z9.updated_at === digest.extracted_at`；H2 `return` 在 usage/addMessage 之前 |
| claude | **APPROVE_WITH_NITS** | 同上；live `protocol: anthropic` + `context_window: 1000000` → 帽 8192；`handleSelect` 闭环 wipe→hydrate |

**折进 P0 的 nits（双方重叠）：** 时钟不变量钉在 insert 而非 wrapper；旧线程 `last_message_at` 必须回填；截断落盘要配对 interrupted tool 行；P1-3 改 adapter abort catch 不改 `drainThreadOnSupersede`。

原文：`thread-loss-3qb5ea-20260901-kimi.md` · `thread-loss-3qb5ea-20260901-claude.md`
