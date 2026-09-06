# LLM 历史/知识检索工具（search_threads / search_knowledge）— 设计

> GitHub: #439
> 日期：2026-09-06
> 状态：设计定案（pi 独立设计，`.tmp/lane-status/dev-439-pi.md`；场景证据：对话 70mj33）
> 规模：T1，Slice 1 一次性交付。

## 1. 工具形状（两个分开，不合一）

- `search_threads { query: string(≤120), limit?: 1–10 默认 5 }`（**LLM 工具独立 clamp：
  默认 5、上限 10——不要复用 `SUMMONER_SEARCH_LIMIT_*`（那是 UI wire 的 10/20）**）→
  `{ hits: [{ thread_id, title, alias, updated_at, snippet }] }`；snippet = digest.tldr
  经 redactSecrets ≤200 字；0 命中诚实空数组。
- `search_knowledge { query, limit? }` → `{ hits: [{ id, title, folder, snippet }] }`；
  snippet = title/description ≤200 字（派生索引字段，非正文）**且同样过 redactSecrets**。
- 两工具结果 **omit `score`**（内核排序字段不外泄，免模型对分数幻觉）。
- 「引用进对话」**不新增动词**：模型在回答里点名 title/thread_id 即可；把会话内容带进
  上下文是 UI 动作（#433 context_refs type:"thread" 摘要卡）。

## 2. 挂载与执行

- catalog L1 只读类（bridge/tool-definitions.ts 注册；不进 L2 确认面）。
- 执行复用 `companion/src/summoner/read-search.ts` 的 searchThreadRows /
  knowledgeSearchRows 纯函数（不新造检索点）；**执行面必须是 companion 本地**
  （与 `thread_recall` 同槽 companion-tools；**禁止** tool.forward 到扩展——脱敏核
  跑不到还把 query 打到浏览器）。
- 行池过滤谓词与 message-router `thread.search` **同一谓词**（排除
  agent_role = worker/orchestrator；纯函数本身不过滤，调用方必须过滤）。
- 召唤器对话与侧栏对话**同权**（执行在 companion，无 surface 差分）。
- 与兄弟工具 `thread_recall` 的分工写进 prompt：`thread_recall` = **本线程**被压缩的
  旧轮次；`search_threads` = **别的会话**的标题/摘要（70mj33 的「我今天聊了什么」是后者）。
- 两工具加入 `PLAN_READONLY_ALLOWED_TOOLS`（只读观察类；计划档可用——只读回顾不属于
  plan_readonly 要拦的变更面）。

## 3. system prompt（≤3 行，防误触发）

在**全局 catalog 前言**补（不写 system_prompt_append，不按会话重复塞）：`search_threads`：用户问「之前聊过/历史/某话题上次说过」时调用；
先搜，命中给一句话摘要并问是否深入。`search_knowledge`：问「有没有关于 X 的知识/笔记」时
调用。两者只回标题+摘要，不读消息原文；只在用户询问过往内容时调用，不要例行扫描。
（描述里写清「本地 CMspark 会话/知识库」，避免与 MCP namespace 混淆。）

## 4. 与 #273 的关系

#273 自动注入是检索路由面，本票是显式问答触发面——零改动 #273；不做自动注入变体；
不做跨系统去重。

## 5. 防滥用与脱敏断言

- query ≤120 trim；limit clamp ≤10；总回包 ≤~2KB；每轮调用次数沿用既有轮次预算。
- 测试钉死：① 构造 sk-/api_key=/PEM/ghp_ 形态 → 工具结果必须 [REDACTED]；
  ② 结果 JSON 不含 messages/原文字段；③ 0 命中空数组不编造。

## 6. 切片与 NOT

- Slice 1（本票）：两工具 + prompt + 测试。不暴露 peek 给 LLM；不做引用动词。
- Slice 2（另票另评审）：如确有「深入一条」诉求，`summarize_thread` 复用
  distillThreadMarkdown ≤2000。
- NEVER：不开放 messages 原文检索/导出；不改 #273；不加监听口。

## 7. 验收

- AC-1：召唤器新对话问「我今天聊了什么」→ 模型调用 search_threads → 按命中摘要回答
  （70mj33 场景复测）。
- AC-2：构造含密钥形态的 digest → 工具结果全 [REDACTED]。
- AC-3：无命中 → 模型如实说「没找到」，不编造。
- AC-4（红线）：#273 注入路径零改动；L2 面无新条目；summoner/侧栏同权。
- AC-5：plan_readonly 线程里两工具可用（只读观察），返回形状不变。
