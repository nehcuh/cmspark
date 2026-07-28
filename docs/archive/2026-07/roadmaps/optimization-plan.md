# CMspark Agent — 优化计划

基于 2026-05-27 session 诊断结果。

## 已完成

| # | 问题 | 修复 | 文件 |
|---|------|------|------|
| 1 | Sidepanel 启动不加载配置 | `requestInitialData` 加 `config.get` | `useWebSocket.ts` |
| 2 | "No tab with id" 误判为不可恢复错误 | 补 recoverable 模式列表 | `security.ts` |
| 3 | OpenAI client 无 timeout，大上下文挂死 | `timeout: 120000` | `adapter.ts` |

---

## P0 — 稳定性 ✅

### 1. Skills 上下文优化 ✅
- 问题：勾选的 skill 全文注入 system prompt，无关也占 token
- 方案：`buildSystemPrompt` 返回紧凑索引，新增 `use_skill` 工具按需加载
- 改动：`skill-engine.ts` + `tool-definitions.ts` + `server.ts`
- 状态：[x]

### 2. 上下文窗口管理增强 ✅
- 问题：长工具链（如多页文本抓取）迅速撑满窗口
- 方案：tool result 超 8000 字符自动截断，标注原始长度
- 改动：`adapter.ts`
- 状态：[x]

### 3. Tab ID 幻觉防护 ✅ (错误恢复机制)
- 问题：LLM 可能跳过 `list_tabs` 传幻觉 tabId
- 方案：security.ts 错误分类已让 "No tab with id" 可恢复，LLM 重试时自动修正
- 状态：[x]

---

## P1 — 体验

### 4. 日志可见性 ✅
- sidepanel 底部日志条，显示最近 5 条，彩色等级
- 改动：`agentStore.tsx` + `useWebSocket.ts` + `App.tsx`
- 状态：[x]

### 5. 流式中断反馈 ✅
- Tool card 实时展示已覆盖大部分等待场景
- 用户可看到 "⏳ navigating..." → "✅ Page loaded" 全流程
- 状态：[x]

### 6. Tool 执行可视化 ✅
- 聊天区实时展示 tool 执行步骤（running → success/error）
- 改动：`server.ts` 发 `tool.start` + `useWebSocket.ts` 接收渲染
- 状态：[x]

---

## P2 — 智能

### 7. Skills 语义匹配 ✅
- **TF-IDF 快路径**：CJK 友好的 tokenizer + 余弦相似度，毫秒级响应
- **LLM 精排 Fallback**：当 TF-IDF top 置信度 < 70% 时，自动触发一次 LLM 调用对候选技能进行语义重排序（精确但耗时 ~1-2s）
- 双轨策略：高置信度走 TF-IDF（快），低置信度走 LLM（准）
- 用户输入自动匹配技能名+描述，confidence ≥ 15% 自动激活
- 改动：`semantic-match.ts`(新) + `skill-engine.ts` + `message-router.ts`
- 状态：[x]

---

## 修复记录

| 日期 | # | 变更 | 文件 |
|------|---|------|------|
| 2026-05-27 | 1 | config.get 加入 requestInitialData | `useWebSocket.ts` |
| 2026-05-27 | 2 | 安全错误分类补 recoverable | `security.ts` + `background/index.ts` |
| 2026-05-27 | 3 | API timeout 120s | `adapter.ts` |
| 2026-05-27 | 4 | Skills 按需加载 + use_skill tool | `skill-engine.ts` + `tool-definitions.ts` + `server.ts` |
| 2026-05-27 | 5 | Tool result 8000 字符截断 | `adapter.ts` |
| 2026-05-27 | 6 | Tool.start 事件 + 实时执行卡片 | `server.ts` + `useWebSocket.ts` |
