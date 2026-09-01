# #265 live-plan spec r1 对抗合成

> **日期**: 2026-08-31  
> **对象**: `docs/superpowers/specs/2026-08-31-runprogress-live-plan-design.md` r1 DRAFT  
> **路**: Product / Trust / UX-density / Skeptic（独立 explore，实现者未参评）  
> **结论**: **4× REJECT**。不得按 r1 写 plan / 写码。下列针已折进 spec **r2**。

| 路 | VERDICT | 一句话 |
|----|---------|--------|
| Product | REJECT | 产品句是当轮必见；机制是模型可忘 → 狗食仍 00 |
| Trust | REJECT | 自勾口 + overlay dispatch 纸门（`params.surface` 活路上没有） |
| UX | REJECT | 「看见」写成必然；零 UI 掩盖密度/替换展开泄漏 |
| Skeptic | REJECT | leftover H1 挡新任务；`seed` 语义谎；`read_page` 不是工具名 |

## 折进 r2 的阻塞针

1. **本轮边界** = 一次 `chat.create`。该请求内至多一次成功 propose。下一则用户消息可整表替换（含 H1 残单）。不是「全勾完才换」。
2. **页面工具准入（一次）**：本请求还没成功 propose，且本轮要跑页面工具 → 该次工具 `success: false` `error_code: PROPOSE_REQUIRED`（可重试）。`list_tabs` 不挡。不是 L2，不是永远禁 click。
3. **写入映射**强制 `{ text, tool? } → { id: live:i, source: seed, done: false }`；模型 JSON `done`/`source`/`id` 丢弃。`item.tool === "run_progress_propose"` 丢掉 tool。adapter **跳过**对该工具名的 `applyToolResult`。
4. **overlay**：handshake surface 注入执行器（同 `__thread_id`）；`summoner` 或缺失 → 不写。新提示只在 `surface !== "summoner"` 分支追加，不污染共享 `basePrompt` 常量。
5. **错误码**一律 `ALREADY_HAS_STEPS` / `PROPOSE_REQUIRED` / `CLEARED` / `EMPTY_ITEMS` / `SUMMONER_ACL` / `WORKER_DENIED` / `THREAD_REQUIRED`。提示与测同一字符串。
6. **工具名**用 catalog：`get_page_text` / `click` / `navigate` / `type` / `wait_for`。禁止 `read_page`。
7. **广播**：成功 propose = 一次 `update` + `broadcast(thread.updated)`，禁止 `[]` 中间态。ChatView `key={`${activeThreadId}:${items[0]?.id ?? "∅"}`}` 以便替换时按 Wave 1 默开/默收。
8. **SoT 句**：`source: "seed"` = 可勾的 companion 写入（H1 **或** propose）。切片 6「v1 seed-only from H1」本票显式修订，不是偷换。
9. **§0 诚实**：当轮看见 = 本则用户消息里页面操作前 propose 成功（准入保证，不是 live LLM 自觉）。未做页面工具则可以没有卡。
10. **密度**：不宣称零密度影响。01 三摊开在流内 ~110px 是选定态，不进 StatusRail。L2 40% 债本票不修。

## 不折（仍否）

- StatusRail C / Wave 2 Glance
- adapter 散文抽取 / 从用户句拆步骤
- overlay 勾选 / `SUMMONER_ALLOW` toggle
- #230 自动勾；新 `thread.todo`；L2 确认方言
- 永久「没 propose 就不能 click」（只挡本请求第一次页面工具，propose 成功后放行）

## r2 dual（2026-08-31）

| 路 | VERDICT |
|----|---------|
| Product | AWN（sticky-null / CONTINUOUS_FAILURE_LIMIT 已折 r2b） |
| Trust | REJECT（页面工具集合、surface 袋、工人）→ r2b 折 |
| UX | REJECT（`live:0` key 假关闭）→ `listSig` 全表 |
| Skeptic | REJECT（双义 surface/error/工具名）→ r2b 折 |

## r2b dual（2026-08-31）

| 路 | VERDICT | 折 |
|----|---------|----|
| Product | AWN | `PROPOSE_REQUIRED` 不计入 `recoverableFailureCounts` |
| Trust | AWN | PAGE_TOOLS ⊇ TAB_LEASE；`set_tab_url` 允许非 JSON catalog 别名 |
| UX | AWN | §2 改为 `listSig` 全表（删「首条 id」） |
| Skeptic | REJECT→折 | 单一失败信封；缺 stamp 一义（handshake WS，不读模型袋） |

spec 状态 → **r2b LOCKED**。可写 plan（计划节点仍须 dual）。
