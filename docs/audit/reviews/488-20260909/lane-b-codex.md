# B 路独立复审：协议、持久化与异步归属

- 审查冻结范围：`4a63de56` → `947532a8`，Issue #488；未读取其他 judge 结论。
- 方法：直接审查生产 diff 与调用上下文；对实际生产处理函数做隔离 VM 执行；运行现有纯逻辑/隔离持久化测试。
- 未修改产品代码、真实会话或真实配置。动态测试只用合成 ID、临时测试目录。
- 证据脚本：`.omx/artifacts/pull-20260909-488/lane-b-probe.ts`。它执行从生产源码提取的函数体（只去除 `Set<string>` 类型），不是 React 渲染测试；UI 验证步骤另列。

## P1 B-1：选择集合变空后，删除操作自动扩大到未选中会话

位置：`chrome-extension/src/sidepanel/components/ThreadList.tsx:765–773`，调用按钮 `:1937–1942`。

本次引入。原实现遇到选中集合与可删集合的交集为空会直接 return；现在改成 `ids = [...selectableIds]`。

`selected` 不会因 `threadBusyById` 或查询改变而自动清空。用户选择 A 后，A 在另一界面开始运行，或用户在同一管理器输入仅匹配 B 的搜索条件，底栏仍因 `selected.size > 0` 允许删除。点击后，A 被交集剔除，但 B 被自动补进删除目标。确认框只显示数量，不显示标题；A、B 各一个时仍显示“1 个会话”，用户难以发现目标已被替换。

机器复现：实际 `handleBatchDelete`，输入 `selected = {busy-now}`、`selectableIds = {unrelated}`，得到 `{ids:["unrelated"], hard:false, source:"batch"}`。

修复建议：删除必须是用户明确选择集合的子集。交集为空时中止并提示，没有选择不能隐式解释为全选；确认时再次检查目标状态，不扩大集合。确认内容展示具体标题/数量。

## P1 B-2：标签视图“全选当前列表”会包含标签之外的隐藏会话

位置：`chrome-extension/src/sidepanel/components/ThreadList.tsx:509–516`、`:800–809`、`:1476–1487`；标签实际渲染范围 `:1339–1350`。

本次新增全选入口引入。`selectableIds` 仅按搜索 query、trashView、busy 过滤，未考虑 `activeTag`。标签视图实际只渲染 `listForTag`。按钮却写“全选当前列表中可删除的会话”，调用 `selectAllIds(selectableIds)`，把其他标签中的对话一起选中。未点击任何标签、列表只提示“选择上方标签查看会话”时，同样可全选整个过滤集。

最小 UI 验证：A 带标签 alpha，B 带标签 beta；进入标签视图点击 alpha，界面仅显示 A；点击管理器顶栏“全选”，已选为 2；点击回收站并确认会发送 A+B。回收站若采用标签筛选，永久删除影响同样存在。

修复建议：定义一个明确的当前视图目标集合，包含 activeTag；列表全选、计数、批操作及组复选框统一消费。若产品要支持跨标签全选，应另外明确标为“全选全部搜索结果”并展示范围，不借用“当前列表”。

## P2 B-3：全选超过 50 条必被协议拒绝，但 UI 先把会话全部移除

位置：`chrome-extension/src/sidepanel/components/ThreadList.tsx:776–789`、`:807–809`；`companion/src/ws/validate.ts:117–123`，`companion/src/message-router.ts:2409–2416`。

新全选入口放大已有批删除契约缺陷。协议规定单次 `thread.batch_delete` 最多 50 条，UI 没有分批或上限处理。VM 执行实际 `executePendingDelete`，用 `selectAllIds` 生成 51 条：先 dispatch `REMOVE_THREADS` 移除 51 条，再发送 51 条，生产 `validateWsMessage` 返回 `{valid:false,error:"thread.batch_delete max 50 threads"}`。磁盘未发生删除，但界面已经清空目标并退出选择模式；重新拉列表后会话重新出现。

该现象还受已有回执问题扩大：`background/index.ts:1007–1026` 忽略 `wsClient.send` 的 false 结果，固定返回 `{ok:true}`；组件 callback 只读取并丢弃 runtime.lastError。断线发送和 busy 拒绝同样没有回滚。`useWebSocket.ts:1108–1138` 只移除成功 ID、记失败日志，不恢复此前乐观移除的失败 ID。

修复建议：以持久化回执确认删除；保持失败目标可见并显示结果。全选可保留任意数量，但传输按最多 50 条分批、按每批 ok/failed 汇总；或者明确选择上限，不能静默假成功。runtime 发送成功只代表已投递，不应作为服务端删除成功。

## P2 B-4：整理助手打开后，列表全选按钮操作另一套选择状态

位置：`chrome-extension/src/sidepanel/components/ThreadList.tsx:800–805`、`:821–825` 与 `:1479–1487`、`:1889–1896`。

本次引入。顶栏/底栏“全选”显示、禁用、切换条件都读取列表 `selected/selectableIds`，但 `handleSelectAllVisible` / clear 在 `cleanupOpen && cleanupSuggestions.length > 0` 时转而操作 `cleanupSelected`。因此同一个按钮显示“取消全选”却只清空整理建议，列表仍保持全选；或者用户想选择列表，按钮只选择建议、不进入列表选择模式，文字还保持“全选”。

机器验证：实际 handler，`cleanupSuggestions=[cleanup]`、`selectableIds={visible}`，执行后 `cleanupSelected={cleanup}`，列表 `selected` 完全未变。此时按钮显示逻辑仍绑定列表状态。

修复建议：列表和整理建议各自有明确选择处理器，按钮的 label、disabled、onClick 使用同一状态域；可减少重复入口，但保留全部能力。

## 已有问题（不归因于本次 diff）

1. 恢复回收站一项后，剩余回收站项目可能全部消失：`ThreadList.tsx:829–834` 请求 include_trashed 列表，但 `useWebSocket.ts:1088–1090` 收到 `thread.restored` 又请求不带 include_trashed 的列表；后到列表替换全局线程集合，trashView 仍为 true。最小验证：回收站有 A/B，恢复 A 后 B 也不再显示；重开回收站可见 B。需要列表请求和当前视图保持一致，或用恢复 ID 局部更新。
2. optimistic REMOVE 会清掉消息缓存/busy 状态并可能切换 activeThread（`agentStore.tsx:1411–1475`）；如果请求失败，不只是行暂时消失。这是现有 reducer 与无确认删除路径共同的问题，本次统一删除处理器沿用了它。

## 持久化、版本与协议其余结论

- 新 assistant tool-call 参数脱敏是在 `persistAssistantDraft` 的 `addMessage` 前应用，执行循环仍读取原 `assistantMsg`，未发现脱敏值替换实时工具参数。tool-call id/name 保留，非法 JSON 折叠为 stub；不会因此丢失工具调用和结果的配对。
- 运行 `tsx --test companion/tests/assistant-tool-args-redact.test.ts chrome-extension/tests/thread-timeline.test.ts`：46 项通过，0 失败。其中临时 ThreadManager 测试验证持久化 cookie 值不落盘；其他测试验证 shell/host/evaluate 参数折叠和原实时参数不变。
- `resolveCliVersion` 的源码布局和 fallback 对 0.6.7 一致，ACP/MCP 版本同步；未发现当前打包路径可确定复现的版本阻断问题。候选 package.json 未校验 name 属稳健性建议，暂不提为本批缺陷。
- 外部提交未调整 HTTP/WS 会话归属协议；上一批 coding session owner 隔离未被该 diff 直接改动。
- 本路不对视觉美感、完整 ASR 实机性能或真实 Windows UI 做已验证声明。

VERDICT: REJECT

须修复 B-1/B-2 的非预期删除范围及 B-3/B-4 的契约/状态问题，并加入实际 UI 与真实回执形状覆盖后再复审。
