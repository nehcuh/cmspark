# 侧栏项目优先布局

> GitHub: #857
> 日期：2026-11-17
> 状态：设计与实施计划已写，停在独立文档评审。本文件不实现产品代码，不改版本号、tag 或 Release。
> 基线：`origin/main` `4b1f4891db39d945c31b2b226bfa7eb58db0337d`（v1.1.0 冻结，PR #855）。
> 设计权威：已读 [项目优先布局（首版设计草案）](https://cursor.com/canvas/store-6a25e69f-4f30-4dcc-87b6-1552e12c2b74/18ee0a4d-0010-4260-b5c1-d570ba7e7881)。该页里「确认前不改代码、不等于批准开发」已被用户后续的「标准流程，开干」覆盖。本轮仍先过文档门，再写功能。
> 实施计划：[2026-11-17-project-first-layout.md](../plans/2026-11-17-project-first-layout.md)。
> 既有元数据合同：[#641](https://github.com/nehcuh/cmspark/issues/641) / [#481](https://github.com/nehcuh/cmspark/issues/481)，[project-metadata spec](2026-10-14-project-metadata-481.md)。

## 1. 产品行为

重新打开侧栏时，恢复上次仍然有效的对话。没有可恢复的对话时，进入项目首页。点「项目」立刻看到全部已注册、未归档的项目；空项目也占一行。进入项目后，看到属于这个项目的对话，以及「项目内新对话」。

最近对话仍是全局入口。项目外是最近对话里的一种筛选，不是另一个项目，也不是本地文件夹。

查看项目只浏览。更改当前会话归属是另一次明确操作。浏览不移动会话，不改 `workspace_root`，不改授权。执行中、有待确认，或连接断开时，不能改归属；浏览和打开已有会话仍然可用。

宽窗口保留常驻导航。窄侧栏一次只显示一层：列表、项目详情或会话，并用「返回」离开。不再使用 28dvh 导航弹层套 42dvh 项目滚动。

enterprise 档始终提供 shell，命令授权仍独立。本设计不改这条已确认语义，也不实现 [#853](https://github.com/nehcuh/cmspark/issues/853)。

## 2. 推荐信息架构

导航分成四层入口，而不是只换掉 `ProjectPanel` 里的 select：

1. **项目**：项目首页是完整的未归档项目列表。点一行进入该项目详情。详情里是所属会话和「项目内新对话」。
2. **最近对话**：全局会话。筛选为「全部 / 某个已注册项目 / 项目外」。筛选不创建项目，也不把空文件夹或历史目录叫成项目。
3. **工具**：只排列现有上下文面板。按当前能力档的已有主次顺序分组。
4. **设置**：打开现有设置页。连接状态继续用现有状态栏的低噪指示，不另做一条全局断线横幅。

会话层顶部有两行，不摊成桌面三栏：

- 面包屑：`项目名称 / 对话标题`，或 `项目外 / 对话标题`。从项目进入的会话，面包屑回到该项目详情。
- 下一行：实际工作目录，以及执行状态。二者都不是项目名称。

宽窗口：导航常驻，主区域随当前层显示列表、详情或会话。窄侧栏：主区域就是当前这一层，顶部有「返回」。断点由 `navigationMode` 一处决定，见第 6 节。不把现行 760px 当成新设计的断点。

## 3. 实体关系

这些词在现有代码里已经分开，本设计保持这个边界。

| 词 | 现有事实 | 本设计里用户看见的 |
| --- | --- | --- |
| 项目 | `projects.json` 的元数据。公开字段只有 `id`、`name`、`created_at`、`updated_at`、`archived_at`。上限 256 个项目、8192 条归属、文件 4MiB。 | 一行名称。空项目也显示。 |
| 会话 / Thread | ThreadManager 拥有消息和线程。`project_id` 是读投影，不写进线程索引。 | 项目详情或最近对话里的一行。 |
| 工作区 | 线程上的 `workspace_root`。未绑定真实仓库时，执行仍可落到 `~/CMspark-projects`。入口仍是场景里的选择工作区。 | 会话第二行的目录，不是项目名。 |
| Agent | 普通线程、orchestrator、worker。舰队子任务仍用现有标题。 | 不新增一种 Agent，也不把项目当成 Agent。 |
| 执行环境 | LLM、工具、ACP、PTY、shell、待确认。忙时 `thread.project.set` 被服务端拒绝。 | 会话第二行的执行状态。忙或待确认时，改归属控件禁用。 |

项目不是目录，不是权限，也不是执行目标。选择项目不会改 cwd、确认门或 capability profile。

## 4. 现状：为什么点「项目」看不见已有列表

以下是 `4b1f4891` 的源码事实。本设计节点没有在 Chrome 里点击复现；交互测试留在实施计划里，不能用静态渲染字符串代替。

入口路径：

1. [StatusRail.tsx 第 223 行](https://github.com/nehcuh/cmspark/blob/4b1f4891db39d945c31b2b226bfa7eb58db0337d/chrome-extension/src/sidepanel/components/StatusRail.tsx#L223) 的「导航」按钮发出 `cmspark:toggle-navigation`。
2. [WorkspaceFrame.tsx 第 31 行](https://github.com/nehcuh/cmspark/blob/4b1f4891db39d945c31b2b226bfa7eb58db0337d/chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx#L31) 用 `min-width: 760px` 区分宽窄。窄时第 120–122 行把导航放进 `.cm-navigation-disclosure`。
3. [workspace-styles.ts 第 59 行](https://github.com/nehcuh/cmspark/blob/4b1f4891db39d945c31b2b226bfa7eb58db0337d/chrome-extension/src/sidepanel/ui/workspace-styles.ts#L59) 把这个弹层限制为 `max-height: 28dvh`。宽导航宽 220px，见第 9 行。
4. [WorkspaceFrame.tsx 第 168 行](https://github.com/nehcuh/cmspark/blob/4b1f4891db39d945c31b2b226bfa7eb58db0337d/chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx#L168) 渲染 `ProjectPanel`，它下面才是最近对话。

列表没有出现的机制：

- [ProjectPanel.tsx 第 14 行](https://github.com/nehcuh/cmspark/blob/4b1f4891db39d945c31b2b226bfa7eb58db0337d/chrome-extension/src/sidepanel/components/ProjectPanel.tsx#L14) `opened` 默认 `false`。第 69–71 行只有展开后才 `project.list`，并且立刻把焦点放进新项目名称。
- 第 76、80、83 行把项目画成 `<select>` 的 `<option>`。没有项目行、列表或卡片。
- 第 24 行的搜索只过滤「管理项目」那个 select。
- [workspace-styles.ts 第 6 行](https://github.com/nehcuh/cmspark/blob/4b1f4891db39d945c31b2b226bfa7eb58db0337d/chrome-extension/src/sidepanel/ui/workspace-styles.ts#L6) 给 `.cm-project-controls` 设了 `max-height: 42dvh`。
- 第 29 行请求失败时把 `snapshot` 设为 `null`，于是下拉框变空。加载没有单独文案。

数据源只有 Companion 的 `projects.json`，经 `project.list` 返回。不是本地目录扫描，不是 Git 仓库发现，也不是把最近会话自动收成项目。[project-store.ts 的 `list()`](https://github.com/nehcuh/cmspark/blob/4b1f4891db39d945c31b2b226bfa7eb58db0337d/companion/src/threads/project-store.ts#L88) 返回 `{ revision, projects }`。读操作在文件不存在时是 revision 0 的空列表，不创建文件。

冷启动今天也不会「恢复上次选中的对话」：

- [useWebSocket.ts 第 1454–1496 行](https://github.com/nehcuh/cmspark/blob/4b1f4891db39d945c31b2b226bfa7eb58db0337d/chrome-extension/src/sidepanel/hooks/useWebSocket.ts#L1454) 在活跃列表为空时自动 `thread.create`；列表非空但没有 active id 时选 `incoming[0]`。线程索引是新线程 unshift 的顺序，不是「上次选中」。
- 客户端没有持久化上次选中的线程 id。
- [agentStore.tsx 第 1229–1240 行](https://github.com/nehcuh/cmspark/blob/4b1f4891db39d945c31b2b226bfa7eb58db0337d/chrome-extension/src/sidepanel/store/agentStore.tsx#L1229) 断连时清掉 `workspaceHints`、`isProcessing` 和 `threadBusyById`，但保留 threads 和 activeThreadId。断连后如果只看 busy 标记，会把仍应禁用的改归属误判成可以点。

## 5. 状态与文案

文案集中在 `projectCopy`，测试和界面用同一句。下面的句子是验收原文。

| 情境 | 用户看见 | 禁止写成 |
| --- | --- | --- |
| 已连接，还没有快照 | 「正在读取项目」 | 还没有项目 |
| 已有快照，正在刷新 | 继续显示项目行，并写「正在更新项目列表」 | 空白或还没有项目 |
| 已连接，成功取回且未归档数为 0 | 「还没有项目」，另有关闭着的「新建项目」 | 加载失败 |
| 归档视图里没有归档项目 | 「没有归档项目」 | 还没有项目 |
| 搜索无匹配 | 「没有匹配的项目」，以及「清除搜索」 | 还没有项目 |
| 列表请求失败，且已有快照 | 保留项目行，并写「项目列表没有取回」 | 清掉列表 |
| 列表请求失败，且没有快照 | 「项目列表没有取回」 | 还没有项目 |
| 保存或改归属失败 | 「项目没有保存」 | 和列表失败混用 |
| 断连，有快照 | 项目行还在，写「离线，列表更新于 {时间}」 | 还没有项目；没有会话 |
| 断连，没有快照 | 「无法取回项目列表」 | 还没有项目；没有会话 |
| 断连，已经停在会话 | 会话还在，标「离线」 | 改成无会话或跳到空项目首页 |
| 空项目详情 | 「这个项目还没有对话」 | 隐藏该项目，或用全局最近对话充数 |
| 归入已确认 | 「新对话已归入这个项目」 | 在回执前先显示成已归入 |
| 对话已创建、归入失败 | 「新对话已创建在项目外；归入尚未确认」 | 成功，或把该对话画进这个项目 |
| 没有记住的有效对话 | 项目首页，「没有可恢复的上次对话」 | 自动新建空白对话，或选中列表第一项 |
| 记住的对话已不在或已回收 | 项目首页，「上次对话已不在，已回到项目首页」 | 选中另一个对话冒充恢复 |
| 执行中或待确认 | 可浏览、可打开；改归属禁用，句为「先结束执行或处理待确认操作，再整理。」 | 禁用浏览 |
| 断连时的归属 | 禁用，句为「连接断开，归属整理已停用。」 | 因为 busy 已被清掉就重新启用 |
| 已连接且 `workspace_root` 为空 | 「未绑定工作目录」 | 把项目名当成目录 |
| 断连且会话记录里有 `workspace_root` | 显示该路径，并加「未能刷新」 | 「未绑定工作目录」 |
| 断连且没有目录记录 | 「工作目录暂时无法刷新」 | 「未绑定工作目录」 |
| 断连时的执行行 | 「执行状态：离线」 | 「执行状态：空闲」 |

过期响应：每次刷新和每次重连增加代际。调用方拿请求记下的代际和当前 ref 做严格相等，不相等就不调用 `applyProjectListResult`。该函数只比较 `revision`：更旧 revision 保留当前快照，相等或更新的 revision 才替换。代际不等的高 revision 也不得换掉已显示的项目按钮。

`connecting` 不是断连。正在连接时保留已打开会话，不写「离线」，也不写「没有会话」或「还没有项目」。只有 `disconnected` 才用离线文案。

搜索按名称的 `toLocaleLowerCase()` 包含匹配，和现有管理搜索同一规则。清空搜索后回到当前归档视图的完整集合。默认视图只含 `archived_at === null` 的项目。`查看归档` 只显示已归档项目。`返回未归档` 回到默认视图。归档项目不混进默认列表。

新建和管理放在默认关闭的 `details` 里，摘要分别是「新建项目」和「管理项目」。打开项目列表时不调用名称输入框的 `focus()`。

## 6. 宽度

`navigationMode({ surface, innerWidth })` 是唯一断点：

- `innerWidth >= 960`：`resident`。导航常驻，主区域换层。
- `innerWidth < 960`：`layered`。一次一层，有「返回」。
- `sidepanel`、`popout` 和 `workspace` 用同一个函数。侧栏在 320、400、759 都是 layered；960 和 1200 是 resident。
- 删除窄屏的 `.cm-navigation-disclosure` 28dvh 弹层，也删除项目区 42dvh 嵌套滚动。列表可以在当前层里滚动，不再套在导航弹层里。
- 960 是本设计锁定的候选，由组件测试在上述宽度断言。它不是已经实测的 Chrome 侧栏像素。实施时如果真的量到侧栏宽度，只改 `RESIDENT_MIN_WIDTH` 和对应测试，不恢复 760，也不另写一套媒体查询。

现有 `workspace.html` 的今日、待办、资料、活动记录保持原样。本设计不重做 [#753](https://github.com/nehcuh/cmspark/issues/753) 的完整工作中心。

## 7. 两个动作和项目内新对话

**查看项目。** 点项目行只设置导航层和要看的 `project_id`。不发送 `thread.project.set`，不调用 `onFilter`，不改 active thread 的 `project_id`，不改 `workspace_root`，不发配置或确认。

**更改当前会话归属。** 只出现在当前会话的「更改当前会话归属」区域，用按钮「移入 {名称}」和「移出项目」。不用 `<select>` 承载已有项目。目标必须是未归档项目或移出。下列任一为真时按钮禁用：`connectionState !== "connected"`、该线程 `threadBusyById`、存在待确认、`project_metadata_unavailable`。禁用时项目列表和会话打开仍可用。

服务端忙门保持现有 `PROJECT_THREAD_BUSY` / `PROJECT_ACTIVITY_UNKNOWN`。客户端禁用只是提前反馈，不代替服务端拒绝。

**项目内新对话。** 继续用现在的两步，不假装跨 ProjectStore 和 ThreadManager 的原子事务：

1. `requestProjectThread` 走现有 `thread.create`。
2. 只有创建回执里的线程 id 到了，才发 `thread.project.set`，`project_id` 是用户当时打开的那个项目。
3. `matchingProjectReply` 接受这条 set 回执之后，父组件的 `onBindResult` 才把该对话放进项目详情，并保留这条成功文案。组件本地回执和父组件的 `bindNotice` 同时显示，后一次不擦掉前一次。
4. 创建成功但 set 失败、超时或代际已经变了：保留项目外的对话，显示「新对话已创建在项目外；归入尚未确认」。不自动重试 set，不把它画进项目。
5. 创建本身失败：不造对话，显示「项目没有保存」不适用；用创建路径已有的「新对话尚未确认创建，请刷新核实。」不显示归入成功。

迟到的 set 回执如果 operation、thread id 或 project id 对不上，现有 `matchingProjectReply` 继续拒绝。不能把上一个项目的成功画到当前打开的另一个项目上。

## 8. 恢复

上次有效对话只来自本机键 `cmspark.navigation.lastThreadId`。写入规则：

- active thread 仍在非回收站列表中时，记住它。
- 列表还没到时，只要记住的 id 还在，`connected`、`connecting`、`disconnected` 都保留它，不写成 null，也不进项目首页。
- 列表还没到，或断连后本地仍留着原来的 active id 时，不把记住的 id 擦掉。
- 活跃列表已经到来，而记住的 id 不在其中或已回收：清掉这个键，原因是无效恢复。
- `thread.list` 的 `incoming[0]` 不是上次有效对话。
- `list_scope` 为 `trash` 或 `all` 时，保持现有行为：不自动创建，不改 active id。

冷启动决定由唯一函数 `commitStartupNavigation` 做出。只有 `useNavigationStartup` 读取 `cmspark.navigation.lastThreadId`。`WorkspaceFrame` 和 `useWebSocket` 都不直接读这个键。`useWebSocket` 不读这个键。它在活跃 `thread.list` 上只调用 `decideActiveThreadList`：空列表不 `thread.create`，也不选 `incoming[0]`；首页结果是 `activeThreadId: null` 且 `selectThread: false`。每次读取先增加代际。回调里的代际不等于当前 ref 时，不改 `activeThreadId`，不发送 `thread.select`，也不改已经显示的恢复文案。项目首页的提交结果是 `activeThreadId: null` 和 `selectThread: false`。

- 记住的 id 仍在非回收站线程中：打开该会话。断连也一样，并标离线。`connecting` 也留在该会话，但不标离线。
- 没有记住的 id，包括升级后已有历史对话：项目首页，说明「没有可恢复的上次对话」。不自动 `thread.create`。
- 记住的 id 无效，包括活跃列表已经到达但为空：项目首页，说明「上次对话已不在，已回到项目首页」。不改选另一个会话。

这是对 [useWebSocket.ts 第 1454–1496 行](https://github.com/nehcuh/cmspark/blob/4b1f4891db39d945c31b2b226bfa7eb58db0337d/chrome-extension/src/sidepanel/hooks/useWebSocket.ts#L1454) 的行为变更。空列表不再自动造空白对话。没有线程时，现有输入占位可以继续要求先创建或选择；创建从「新对话」或项目内新对话进入。

恢复不改 `project_id`、`workspace_root` 或授权。

## 9. 工具与设置

工具 id 仍是 [ContextPanelHost.tsx 第 63–73 行](https://github.com/nehcuh/cmspark/blob/4b1f4891db39d945c31b2b226bfa7eb58db0337d/chrome-extension/src/sidepanel/components/ContextPanelHost.tsx#L63) 的九个：`tabs`、`history`、`skills`、`knowledge`、`packs`、`meeting`、`board`、`mcp`、`apps`。分组函数必须让每个 id 恰好出现一次。

分组来自现有 [mode-controller.ts 的 `contextBarTabsForLevel` 与 `contextBarOverflowTabsForLevel`](https://github.com/nehcuh/cmspark/blob/4b1f4891db39d945c31b2b226bfa7eb58db0337d/chrome-extension/src/sidepanel/mode/mode-controller.ts#L104)，并保持这两个函数的现有顺序。chat 的「当前任务」DOM 顺序是技能、知识、历史。browser 是浏览器标签页、技能。不按 `CONTEXT_PANEL_TABS` 的登记顺序重排。设置按钮在导航层或常驻导航里，不放进工具列表。`history` 今天在导航里被滤掉，本设计把它放回「当前任务」或「其他工具」中它已有的位置。不新增工具 id，不加入 shell 开关。

设置仍是导航里的单独一项，打开现有 `SET_SETTINGS_OPEN`。不重排设置页，以免碰到 [#853](https://github.com/nehcuh/cmspark/issues/853) 的 shell 入口。全局连接状态保持 [StatusRail.tsx](https://github.com/nehcuh/cmspark/blob/4b1f4891db39d945c31b2b226bfa7eb58db0337d/chrome-extension/src/sidepanel/components/StatusRail.tsx#L274) 现有的点或短标签。项目列表上的离线句子只写在列表区域。

召唤器的项目控件本轮不改。协议和 `projects.json` 不变，所以召唤器仍读写同一批项目。

## 10. 不在本轮

- 不把项目升级为目录，不扫本地文件夹，不迁移旧对话，不改项目 id。
- 不改 `projects.json` 格式、OCC、忙门、权限、capability profile、命令授权或 L2。
- 不做 Linux PTY 或 Whisper。
- 不改 `companion/package.json` 或扩展的版本号，不改 tag，不发 Release，不编辑 CHANGELOG 的版本标题。
- 不修改、不合并 PR #856。它若先合入 main，实施分支用 merge 同步，保留两边的文档，不 rebase 已推送提交。
- 不关闭 #857、#753、#476、#853。实现 PR 写 `Refs #857`。

已有项目和归属原样可读。缓存只额外写在扩展的 `chrome.storage.local` 键 `cmspark.project.list.v1`，格式 `{ format: 1, revision, projects, fetchedAt }`。损坏的缓存当作没有快照，不回写 Companion。

## 11. 验收矩阵

实施的键盘、焦点和 `details` 走 `uv run --no-project --with playwright python chrome-extension/scripts/test-project-navigation-ui.py`（先 `nvm use 22`）。它使用本机 Chrome 和 `page.keyboard.press`，与 [docs/TESTING.md](../../TESTING.md) 里已有的工作区脚本同一路径，不把 Playwright 写进 `package.json`。`node:test` 只覆盖纯函数。不使用自造 DOM 替身。

| 情境 | 预期 | 节点 |
| --- | --- | --- |
| 加载、有缓存的更新、真空、搜索无结果、列表失败、保存失败 | 第 5 节的原文，且失败不清掉已有行 | 1 |
| 归档单独查看，空项目可见，搜索可清除 | 默认列表不含归档；清除后恢复 | 1 |
| 已有项目不是 select 选项 | 项目行是 `button`；打开列表后名称框不是焦点 | 1 |
| 断连有缓存 / 无快照 | 离线原文，且不是「还没有项目」或「没有会话」 | 1 |
| 迟到代际和更旧 revision | 不覆盖更新快照 | 1 |
| 点项目行 | 不发送 `thread.project.set`，不改筛选 | 1 锁定不误发；2 进入详情 |
| 窄层返回、宽导航常驻 | 320/400/759 layered，960/1200 resident。Playwright 断言页面没有 `.cm-navigation-disclosure`，样式表没有 `28dvh` | 2 |
| 升级后有历史、没有 lastThreadId | 项目首页，原文「没有可恢复的上次对话」 | 2 |
| 正在连接 | 保留会话；不写「离线」或「没有会话」 | 2 |
| 恢复有效、无效、无记录、断连保留会话 | 第 8 节；不选第一项，不自动创建 | 2 |
| 执行中或断连改归属 | 按钮禁用，浏览仍可点 | 2 |
| 项目内新对话成功和失败 | 第 7 节的两句，失败不进项目列表 | 2 |
| 面包屑、目录、执行状态 | 分行；断连不说未绑定、不说空闲 | 2 |
| 工具九项都在，设置分开 | 每个现有 id 一次；无 shell 项 | 3 |
| 回收站范围的 thread.list | 仍不自动创建、不改 active | 2 |
| 全量 | 扩展测试、扩展 `tsc --noEmit`、companion 测试；同一 SHA 的四条 workflow、十个检查 | 3 |

四条 pull_request workflow 和十个检查是：

- CI：`build`、`smoke (ubuntu-latest)`、`smoke (macos-latest)`、`smoke (windows-latest)`、`smoke (windows-native)`、`activity (Linux X11 native)`、`acp-history-restart`
- ARM acceptance：`Affected CPU controls (Linux ARM64)`
- Linux integration ARM：`Linux integration controls (ARM64)`
- Session save recovery：`Windows session persistence`

Release 与 Build installers 不在本轮 pull_request 门禁里，也不手动触发。

## 12. 风险

- **空列表不再自动建对话。** 这是第 8 节的明确变更。第一次升级后如果还没有 `cmspark.navigation.lastThreadId`，即使用户有历史对话，也会先到项目首页，而不是打开索引第一项。
- **断连清 busy。** 改归属必须单独看连接状态，不能只看 `threadBusyById`。
- **#853。** 设置页里的 shell 开关不动。工具分组如果需要挪到设置页里的企业模块，停下来交给主对话，不在本票里改。
- **#856。** 只含发布文档。合入后 merge `origin/main`，不覆盖、不 rebase 已推历史。
- **#753。** 完整工作中心的目的地不动。侧栏四层不要替换 `workspace.html` 的今日和待办。
- **测试编译范围。** 扩展测试先过 `tsc -p tsconfig.test.json`。交互测试挂载新的展示组件和 `SidePanelLayers`，不把整个 `ContextPanelHost` 面板树当成点击目标。工具 id 的完整性仍要和 `CONTEXT_PANEL_TABS` 对账。
- **960 未在真侧栏量过。** 组件矩阵先锁定。以后的实测只改一处常量。

## 13. 设计自检

- 点「项目」看见未归档项目：第 2、5 节，节点 1 的按钮列表。
- 空项目、归档、可清除搜索：第 5 节。
- 新建管理不抢焦点：第 5 节，默认关闭的 details，且去掉第 71 行的 `focus()`。
- 浏览和改归属分开：第 7 节。
- 恢复和断连：第 8 节，并承认今天没有持久化上次线程。
- 窄层和宽导航：第 6 节，明确不沿用 760。
- 工具不丢、设置分开、shell 不动：第 9、10 节。
- 存储和 id 兼容：第 10 节，只新增扩展本地缓存键。
- 竞品：设计页已引用 ChatGPT Projects、WorkBuddy 项目文档和 ZCode ADE Tools。本 spec 只采用该页已经写明的组织方式：项目是一等容器，点进去先看见已有项。不把那些产品的桌面栏、目录模型或未在该页出现的交互写进 CMspark。
