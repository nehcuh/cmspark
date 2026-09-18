# 502 切片 E — 完成报告（Claude lane）

分支 `feat/502-e-fleet-inspect`（worktree `/tmp/cmspark-502/e`）。未触碰主 checkout `/Users/huchen/Projects/cmspark`；无 Observatory；overlay / BottomBar 零改动（见下 diff 面）。

## Commits

| hash | 内容 |
|---|---|
| `d15b9c41` | feat(fleet): latest_tool on worker snapshot — `FleetWorkerView.latest_tool`（初版倒序扫线程 messages）+ fake-tm 测试 |
| `7cf24c2c` | feat(sidepanel): fleet glance shows latest tool — `fleetGlanceLatestToolLabel`（llm_active 优先）+ FleetStrip meta 行 `· 角色:工具名` 后缀 + 6 测试 |
| `060bbe4d` | feat(sidepanel): inspect worker without stealing the transcript — companion `brief`、store inspect 三字段、FleetWorkerList 查看 抽屉、useWebSocket SET_INSPECT_* 接线 + 14 测试 |
| `5c7ff774` | docs(#502 E): E-DONE 完成报告（初版） |
| `ae014446` | fix(fleet): stamp latest_tool on write; clear inspect on portal close — Kimi BLOCK + MAJOR-M1（见下节） |

## 合并前修复（Kimi 评审，AGENT-TASK-FIX.md）

- **BLOCK — 快照禁止每 4s 全文件读**：初版 `buildFleetSnapshot` 对每只 worker `getMessages`（`readFileSync` + `JSON.parse` 整份 transcript）。改为**写路径盖章**：`Thread` 元数据加 `latest_tool?` / `brief?`，`insertMessageAt`（`addMessage` 底层唯一漏斗）在追加时盖章——brief 只盖首条非空 user（≤160、空白折叠，复用 `firstUserPreviewFromMessages`），latest_tool 只在消息**落在末位**时盖（历史插入/分支修复不得冒充最新，测试锁）；`toolNameFromMessage` 兼容扁平与 function 两种形。快照**只读元数据**，测试用「getMessages 一调即抛」锁死；旧线程缺字段=省略（Glance 无工具名，不回读）。
- **MAJOR-M1 — 关 portal 必清 inspect**：`SET_FLEET_LIST_OPEN open:false` 单一 choke point 清 `inspectedWorkerId` + tail + latest（Escape / 背景点击 / onClose / enterWorker 全走它）。真 reducer 测试：关列表后 `shouldUpdateInspectBuffer("w1", null) === false` → token 不再 `SET_INSPECT_TAIL`。

## 测了什么

- **companion** [executed]：`npm test` 全量 exit 0；定向 `fleet-latest-tool.test.ts` 8/8（latest_tool 倒序 / 终局 assistant 文本不遮蔽 / function 形兜底 / 空线程省略 / 旧 fake 不炸 / brief 三例：原文、折叠空白截 160、无 user 省略）。
- **extension** [executed]：`npm test` 全量 **1373/1373 pass**（含 hygiene raw-color gate 绿）；新增 `fleet-strip-latest-tool.test.ts` 6 例 + `fleet-inspect-buffer.test.ts` 8 例。
- **构建** [executed]：`npm run build`（plasmo chrome-mv3）绿；`build/chrome-mv3-prod/sidepanel.b7741352.js` 含 `fleetGlanceLatestToolLabel` / `inspectedWorkerId` 符号与「本轮输出」文案（bundle 对非 ASCII 做 `\u` 转义，按转义形式验证）。
- **NEVER 核查** [executed]：`git diff c61285c6..HEAD` 共 11 文件（fleet.ts / thread-manager.ts / 3 个 ext 源文件 + types / agentStore / useWebSocket + 3 测试文件）；diff 内 `run_progress` 0 处；`SET_STREAMING` 仅 1 处代码行为**既有** chat.token 门内主路径（上下文行），其余皆注释/测试；`shouldApplyStreamEvent` 真值表原样再钉 + chat.token case 内门计数 == 1（未放宽）；tool.progress case 无任何 INSPECT 引用（stdout_tail 不转发）。

## 验收（plan Task 4）

- [x] ≥2 worker Glance 可见最近工具 — 单测 + 接线锁 + 产物符号（未跑真实 2-worker 浏览器 e2e，见已知缺口）
- [x] 点开 Inspect 不切换 `activeThreadId` — `inspectWorker` 无 `SET_ACTIVE_THREAD` / `thread.select`（源码锁）；「进入子任务」行为原样
- [x] 主对话气泡不被 worker token 污染 — inspect 更新走 `shouldUpdateInspectBuffer`（独立于 `shouldApplyStreamEvent`），仅 `SET_INSPECT_TAIL`；inspect 分支源码锁禁 `SET_STREAMING`
- [x] 无完整 system prompt — brief 只取首条 **user** 消息（复用 `firstUserPreviewFromMessages`，空白折叠 + 160 字上限）；全 diff 不读 system prompt
- [x] overlay / BottomBar 零改 — diff 文件清单不含 overlay/BottomBar；`run_progress` 零改动（worker `run_progress_propose` 未解禁）

## 与计划的偏差（均已在实现中固化并测试）

1. **messages 读取器 → 写路径盖章**：计划初稿写 `tm.get(id).messages`；`Thread` 元数据本不带 messages。初版用 `tm.getMessages` 被 Kimi BLOCK（4s 一拍全文件读），终版按 AGENT-TASK-FIX 改为 `addMessage` 盖章 + 快照只读元数据（见上「合并前修复」）。
2. **brief 走快照而非 state.threads**：计划让 extension 从 `state.threads` 读首条 user content；extension `Thread` 类型是纯元数据（无 messages 数组），客户端无单线程消息拉取通道。改为 companion `Thread.brief` 写路径盖章，经 `FleetWorkerView.brief` 随 4s `fleet.status` 带下来。
3. **Glance 纯函数落点**：计划只列 types.ts / FleetStrip.tsx；`fleetGlanceLatestToolLabel` 实际落在 `focus-band-priority.ts`（既有纯函数模块，FleetStrip 已从它 import，node 测试可直接锁）。
4. **inspect 最新工具名的 store 槽位**：计划说「tool.start 可更新 inspect 的 latest 名」但未指定载体；加 `inspectLatestTool: string`（`SET_INSPECT_LATEST_TOOL`），抽屉显示 `inspectLatestTool || w.latest_tool || "—"`。

## 已知缺口

- **未做浏览器端 e2e**：两只 worker 并发跑时 Glance 后缀刷新、Inspect 抽屉实时 tail 滚动等交互未在加载扩展的 Chrome 里实跑（需 companion + 真实 orchestrator 回合）；静态验证 = 单测 + 源码锁 + 产物符号。
- **inspect tail 只含答案 token**（`chat.token`），不含 reasoning 流（按计划字面）；worker 回合若全程思考则 tail 短暂为空。
- **tail 保留至切换/收起**：回合结束后仍可展开阅读；关 portal 或换 inspected worker 即清（MAJOR-M1）。
- **旧线程无盖章字段**：升级前已存在的 worker 线程在**下一次写入**前 Glance 无工具名、Inspect 无 brief（懒盖章，不回读旧文件——AGENT-TASK-FIX 明示可接受）。

## 不在本 PR

Observatory 全页、kimi vis 级 wire 时间线、BottomBar 新 Tab、百分比进度条（plan NEVER 清单）。
