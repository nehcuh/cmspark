# 回到 v1.1 完整侧栏并补回历史入口

GitHub: #865

Base: `08fe57feacd6ca634eb2f8369dada10420ce0d44`（`origin/main`，Merge pull request #861）。

对照：v1.1.0 `4b1f4891db39d945c31b2b226bfa7eb58db0337d` 的 `WorkspaceFrame` 与 `workspaceCSS`。`ThreadList.tsx`、`ThreadGraphApp.tsx`、`KnowledgeGraphApp.tsx` 在 v1.1.0 与当前 `6d69c577` 之间无差异；该文件内容因此也在 `08fe57fe` 上。

这是规格，不是实现。R3 / R4 图片是示例，不能当作运行结果，也不能把稀疏假文案抄进组件。

## 1. 已核对的事实

1. 侧栏路径在 `full === false` 时走 `ProjectNavigationRoot`，不是 v1.1 的 `WorkspaceNavigation`。宽屏门槛是 `RESIDENT_MIN_WIDTH = 960`。v1.1 的左栏门槛是 `matchMedia("(min-width: 760px)")`，栏宽 220px。
2. v1.1 侧栏顺序是：品牌、新对话、可折叠项目、资料与工具图标格、搜索和最近对话、底部设置。`管理对话` 在「最近对话」标题旁，派发 `cmspark:open-thread-manager`。待确认时该按钮禁用。
3. v1.1 工具格执行 `CONTEXT_PANEL_TABS.filter(t => t.id !== "history")`，所以「历史」不在那一格。当前 `contextBarTabsForLevel("chat")` 返回 `skills`、`knowledge`、`history`。`HistoryPanel` 渲染的是 `state.operations` 工具记录，空文案是「暂无操作历史」。它不是对话列表。
4. 选中样式是 `background: #e9e9e6`、`font-weight: 500`，没有描边。键盘 `:focus-visible` 是 `outline: 2px solid #4f46e5`、`outline-offset: 3px`。悬停是 `#eeeeec`。
5. 聊天输入草稿是 `App.tsx` 里的一个 `useState("")`。现码没有按对话分开保存。切换对话会不会串稿，必须以新测试为准，不能沿用未证实的说法。
6. 对话管理的可见名称和范围：
   - 视图：时间、标签、手动分组、AI 分组。AI 分组按已提取要点的首个主题标签归类，帮助文案写明不改变手动分组。
   - `AI 提取标签` / `为未标注提取要点`：`handleExtractUntagged`，最多 `EXTRACT_DIGEST_MAX`（20）条未标注对话，调用 `beginExtractBatch`。现码没有启动前确认。进行中再点一次，若批次仍有 `remaining`，直接返回。界面进度句是「提取要点 {done}/{total}」，结束加「 · 完成」。没有单独的取消按钮，也没有失败回滚。
   - 行内「AI 标签」只处理这一条。
   - 「⋯」里的「AI 生成标题」发送 `thread.generate_title`，目标是当前对话，没有当前对话时用列表第一条；没有对话则提示「暂无线程可生成标题」。
   - 「未命名→首条起名」发送 `thread.batch_auto_title` 且 `only_empty: true`。传入选中 id 时带 `thread_ids`。不传 id 时本规格只承诺请求参数，不承诺服务端改写全部历史。
   - 「整理助手（规则）」发送 `thread.suggest_cleanup`，`include_workers: false`，并排除当前对话。天数 0 / 30 / 90。移入回收站走已有 `pendingDelete` 确认。它不是模型整理。
   - 「关系图谱」与菜单里的「会话关系图」都调用 `openThreadGraph`，消息 `thread_graph.open`，在新标签页打开。页内标题是「会话关系图」。可搜索、孤立点、强度、适应、图例。Enter 或「打开会话」发 `thread_graph.open_thread`，图页不关。超过 300 条显示「仅显示最近 300 会话」。图上不能删除或改分组。
7. 「分布图谱」在知识面板，常量 `KNOWLEDGE_GRAPH_ENTRY_LABEL`。消息 `knowledge_graph.open`。对象是知识文档。超过 200 篇只画标题顺序前 200。实线是内容相似，虚线是 AI 关联。节点动作是打开文档，不是打开聊天。「重新整理」的文案是「让 AI 整理现有 N 篇」，N 是知识篇数。未配置模型时按钮不可用。
8. 删除一条或选中多条先进入确认。回收站内是永久删除。运行中的对话不能删。清空回收站的提示写明未满 30 天的也会删除。
9. 设置里的外部模型展示包括「视觉模型（看图描述）」、语音页里引擎草稿为 external 时的「外部转写」、实验页的本地视觉定位。这些是展示，不是本规格要删除的配置键。
10. 本环境没有苹方或 SF。没有在真实 Mac 上渲染或安装扩展。规格不把 Linux fallback 当成 Mac 验收。
11. 2026-11-18 用真实 `App` 包核对过当前行为。`App` 内部已有 provider，外层 `dispatch` 改不到输入框。有活动对话时断开，输入框禁用，占位是「等待 companion 连接...」。没有活动对话时占位是「请先创建或选择一个线程」。`/tabs/workspace.html` 的 `.cm-workspace-full` 没有 `data-navigation-mode`。侧栏没有「管理对话」；现有入口的可访问名是「对话管理（历史对话）」。点「AI 提取标签」会立刻发出 `thread.extract_digest`。设置里保存按钮是「保存并关闭」。未配对时模型页是 `hidden`，「视觉模型（看图描述）」仍在 DOM 里。这些是当前行为，不是本规格的通过。

## 2. 目标行为

### 2.1 侧栏

`navigation-mode.ts` 现在用同一个 `RESIDENT_MIN_WIDTH = 960`，`navigationMode` 不看 `surface`。`startup-destination.test.ts` 第 70–75 行把 `sidepanel`、`popout`、`workspace` 都锁在这个值上。v1.1 的 `WorkspaceFrame` 用的是另一条规则：`matchMedia("(min-width: 760px)")`，而且当时没有按 surface 分叉。

本规格不把三个 surface 一起改成 760。已审阅的完整侧栏只覆盖侧栏和宽工作区：

| surface | 小于门槛 | 达到门槛 | 理由 |
| --- | --- | --- | --- |
| `sidepanel` | layered | `>= 760` resident | 日常侧栏约 400px，必须走 28dvh 折叠。拖到 v1.1 的 760 才出 220px 栏。 |
| `workspace` | layered | `>= 760` resident | 用户要的宽工作区完整侧栏，对齐 v1.1 的 760，而不是现在的 960。 |
| `popout` | layered | `>= 960` resident | 审阅稿没有改弹出对话框。现有测试对这个 surface 的 960 继续有效。 |

`navigationMode` 必须按 surface 取门槛。实现时要改 `startup-destination.test.ts` 的断言，并同时跑该旧测试和新测试。只跑新测试不算通过。

窄栏默认不显示侧栏。若存在上次仍有效的对话，打开后进入该对话。顶栏可见文字可以是「导航」，但可访问名保持 `StatusRail.tsx` 现有的「打开工作区导航」，旁边是当前对话名和「弹出」。点这个按钮后，第 1 节的完整侧栏出现在聊天上方，高度不超过视口的 28dvh，超出部分在该层内滚动。顶栏不出现「项目 / 最近 / 工具 / 设置」四个并排入口。点一则对话或按 Esc，该层收起。打开时焦点进入导航一次。Esc 和关闭各自把焦点还回「打开工作区导航」。点对话后焦点进入该对话输入框一次。键盘焦点用 `focus({ focusVisible: true })` 或真实 Tab，不用无参数的 `focus()`。

窄栏视觉以 v1.0.1 的实际布局为准。展开的导航位于状态栏上方，最近对话和搜索优先显示，资料与工具默认折叠。会话详情从展开的导航进入。聊天顶部只显示一行状态栏，打开导航时输入区仍固定在底部。

这里的宽屏只指 `sidepanel` 或 `workspace` 达到 760。`popout` 仍要到 960 才 resident。这两档的侧栏内容与窄栏展开的是同一套，不是四个文字按钮。侧栏可以收起。收起和展开不移动焦点。宽度保持在该 surface 的 resident 门槛以上时，记住这次收起。重新打开插件后，窄栏仍从收起开始。缩到门槛以下不自动再展开。

选中行只用 `#e9e9e6` 和字重 500。悬停用 `#eeeeec`。靛蓝 2px 轮廓、外偏 3px 只出现在 `:focus-visible`。禁用行不透明度 0.65，且不可点。长名称单行省略，可读名称仍是全文。

聊天档工具格保留现有 `contextBarTabsForLevel` 与 overflow 的能力。因为「历史」在当前聊天档的当前任务里，它必须可见，不能照 v1.1 那一行 `filter` 再滤掉。点「历史」打开 `HistoryPanel`，不打开对话管理。

### 2.2 聊天与项目

主列是对话正文和输入。不把「工作目录」「执行状态」和「更改当前会话归属」的默认 fieldset 放在每则对话顶部。

项目筛选不改变工作目录，也不改变权限。新建、改名、归档仍可从项目节进入，不能只留一个没有去处的「新建与归档」。选中项目后，最近对话只显示该项目的对话。切到另一则对话不把未发送文字带过去。返回原对话时，那则的未发送文字还在。

没有可恢复对话时，现码把输入框设为 `disabled`。`canSend` 还要求 `connectionState === "connected"` 且已有 `activeThreadId`。按钮的 `title` 在没有对话时是「请先创建线程」，不是「发送」。占位是「请先创建或选择一个线程」。本规格要求在已连接、且没有活动对话时：输入框可写，有「开始第一则对话」，点它或点发送都只产生一条 `thread.create`。创建还没得到 `thread.created` 时原文留在输入框里，再点不会发出第二条 `thread.create`。这是新行为，单独验收。

`ProjectListView` 在 `phase === "list-error"` 时只显示 `projectCopy.listFailed`，组件 props 没有重试回调。本规格要求失败且没有快照时出现「重试」，点击调用新的 `onRetry`。已有快照时仍显示旧列表和失败句，不显示「还没有项目」。离线且没有快照仍用 `projectCopy.offlineEmpty`。

### 2.3 对话管理

「管理对话」保持在「最近对话」旁，待确认时禁用。点它进入对话管理。R4 把原浮层放到聊天主区，这是本规格采纳的布局：窄栏和宽屏都看得到同一组控件。关闭后恢复进入前的对话、焦点和该对话的未发送文字。

页面包含：时间、标签、手动分组、AI 分组、选择、搜索、「AI 提取标签」、「整理助手」、「关系图谱」、「回收站」，以及行内「AI 标签」「分类」「删除」。「⋯」保留「AI 生成标题」和「未命名→首条起名」，不把它们放到顶栏。

在 `beginExtractBatch` 之前增加确认。文案写明：最多 20 条还没有要点的对话，写入要点和标签，不删除，不改手动分组。确认按钮的可见文字是「开始提取」，旁边是「取消」。取消不调用 `beginExtractBatch`，也不发送提取消息。点「开始提取」后才沿用现有批次。本规格不新增中断进行中批次的按钮，也不回滚已经写入的要点。进行中的进度句保持「提取要点 {done}/{total}」。没有写回时，按钮可再次点。测试用的标签和进度不是真实模型输出。

整理助手保持规则扫描和已有确认。关系图谱保持新标签页和「打开会话」不关图。分布图谱仍从知识面板进入，不从对话管理进入，不把知识节点画成聊天。

### 2.4 设置

设置减法只减少外部模型的常驻展示。主对话模型的服务地址、模型名和密钥仍在主路径。保存按钮的可见文字是「保存并关闭」，点击后发送 `config.set`。视觉模型、未启用时的外部转写表单、实验里的本地视觉定位默认不铺在主路径。已保存的地址、密钥、开关、模型数据和历史全部保留。不自动删除、不卸载、不停用运行能力。`voiceModel.external` 只有 `keyConfigured`，密钥字符串不到达侧栏。

已经启用外部转写的用户，在语音页能看到「外部转写已配置」，并打开原来的字段。未启用的用户从「其他能力」打开同一组字段。保存其他设置不得清空这些字段。隐藏表单不得改变已合并的外部转写请求、会议仍不走外部转写、以及失败时不静默改回本地引擎。本规格不增加供应商，也不扩大本地 ASR。

权限、本机工具、密钥与环境、连接与配对仍可从设置分类到达。

## 3. 非目标

不合并、不修改、不发布 #864。不改 #856。不改版本，不打 tag。不新增右侧结果栏、不新增外部模型、不把 `ws_secret` 当作授权。不在本规格里优化 Linux 专项或本地 ASR。没有 Mac 字体和安装测试就不写已通过。场景矩阵是同一实现 head 的验收，不是恢复发布。

## 4. 验收

每个实现节点停在独立评审。本规格和节点 0 的文档 PR 不是实现通过，也不是合并通过。最终节点在同一 head 上跑扩展与 companion 全量测试，以及仓库四条 workflow、十个 CI 检查，并交出第 5 节的场景报告，再进入独立 final gate。旧 head 的绿色不算。节点 0 不执行这些场景，不能把文档里的「未测」改成通过。

视觉门是 `chrome-extension/scripts/test-sidebar-review-ui.py`。命令：

```bash
cd chrome-extension && nvm use 22
uv run --no-project --with playwright python scripts/test-sidebar-review-ui.py
```

它用本机 Chrome 打开真实 `WorkspaceFrame` 夹具，不是手画页。必须断言并保存这些截图，缺任一张或任一条断言失败，就不能申请 final gate：

| 视口 | 状态 | 断言 |
| --- | --- | --- |
| 420×860，`sidepanel` | 默认收起 | 可见区域看不到「资料与工具」（藏在 DOM 里不算出现）；可访问名「打开工作区导航」在顶栏 |
| 420×860 | 点「打开工作区导航」 | 导航层高度不超过视口的 28% |
| 759×860，`sidepanel` | 仍是窄栏 | `data-navigation-mode` 为 `layered` |
| 760×860，`sidepanel` | 刚到宽栏 | `data-navigation-mode` 为 `resident`，侧栏宽 220 |
| 759×860，`workspace` | 未到宽工作区 | `layered` |
| 760×860，`workspace` | 宽工作区 | `resident` |
| 959×860，`popout` | 弹出对话框仍窄 | `layered` |
| 960×860，`popout` | 弹出对话框变宽 | `resident` |
| 420×860 | 键盘 Tab 到导航内，按 Esc | `document.activeElement` 的可访问名是「打开工作区导航」 |
| 420×860 | 点关闭 | 焦点同样回到「打开工作区导航」 |
| 960×860，`workspace` | 悬停「示例·采购」 | 背景为 `rgb(238, 238, 236)` |
| 960×860 | 选中「示例·周末清单」且未用键盘聚焦 | 背景为 `rgb(233, 233, 230)`，`outline-style` 为 `none` |
| 960×860 | 对该行 `focus({ focusVisible: true })` | `outline-style` 为 `solid`，颜色为 `rgb(79, 70, 229)` |
| 960×860 | 长名称 | 行内出现省略，完整名称在 `title` |
| 960×860 | 无对话 | 有「开始第一则对话」，输入框未禁用，发送会创建一次 |
| 960×860 | 项目列表失败 | 有「重试」，点击后多一条 `project.list`，没有「还没有项目」 |
| 960×860 | 提取进行中 | 文本匹配 `提取要点 1/20` |

「导航」只是按钮里的可见文字。`StatusRail.tsx` 第 223 行的可访问名是 `aria-label="打开工作区导航"`。断言用可访问名，不用可见文字冒充。`locator.focus()` 不算键盘焦点。Esc 和关闭各测一次。每张截图必须在对应断言成功之后保存。只检查文件存在不算通过。

截图文件名与上表一一对应，写到该次运行的临时目录：`420-collapsed`、`420-open`、`sidepanel-759`、`sidepanel-760`、`workspace-759`、`workspace-760`、`popout-959`、`popout-960`、`420-esc`、`420-close`、`hover-row`、`selected-row`、`keyboard-focus`、`long-name`、`empty-start`、`list-error-retry`、`extract-progress`。报告写明字体是运行机器的 fallback，不是 Mac 验收。popout 的 959 和 960 就在上表。`startup-destination.test.ts` 同时锁住 popout 的 960 门槛。

## 5. 场景演示

最终门的场景报告写在 `/tmp/sidebar-scenarios/<40位 sha>/report.md`，截图和录屏放在同一目录。每一行都要有场景、层、步骤、预期、实际、截图或录屏、环境、commit、证据路径、结果。结果只取通过、失败、未测。失败先改，独立评审后再用新 head 重跑整张矩阵。

三层不能互相冒充：

| 层 | 跑什么 | 通过说明什么 |
| --- | --- | --- |
| 真实组件夹具 | 现有 Playwright 打开真实 `App`。`sendMessage` 进 `window.sent`，配置进内存里的 `companionStore` | 只说明界面和将要发出的消息 |
| 真实 Companion | `CMSPARK_DATA_DIR` 指向空临时目录，端口写在该目录的 `config.json`，不占用 23401，不读不写 `~/.cmspark-agent` | 只说明临时目录里的持久化和协议 |
| 真实外部服务或本机环境 | 隔离密钥、已装入 Chrome 的扩展、Mac 或 Windows | 只有该环境自己的证据可以标通过 |

夹具注入的标签、进度和模型正文都标成夹具，不算 Companion，也不算外部服务。临时目录里的 `base_url` 用 `http://127.0.0.1:9/v1`，密钥用假值。用户原文能落进临时线程即可。连不上这个地址是预期，不能改去连真实供应商。本环境没有隔离的真实模型密钥，也没有装进 Chrome 用户配置的扩展，没有 Mac 或 Windows 安装。这些行保持未测，并写上缺的前置。

数据只来自这次临时目录或夹具内存。开始前记录 `~/.cmspark-agent/config.json` 的 mtime，结束后必须相同。不点「永久删除」「清空回收站」「重新整理」。不勾选「本线程内自动批准同类」，不打开自动批准危险操作。不发送会出网的页面脚本、导航、邮件、聊天或外部 MCP 写入。回收站只对临时目录里刚创建的对话做「移入回收站」和「恢复」。

场景和通过时要看到的结果：

1. 首次配置、新建、重开。已连接且没有活动对话时，输入框可写。点「开始第一则对话」或发送，只产生一条 `thread.create`。没收到 `thread.created` 时原文还在，再点不产生第二条。夹具重开时读取 `cmspark.navigation.lastThreadId`，列表里有这条对话就进入它。Companion 重启后，`thread.list` 仍返回临时目录里的这条。装进 Chrome 后再真正关上侧栏重开，这一行在本环境未测。
2. 项目。侧栏里「新项目名称」和「创建项目」发出 `project.create`。选中项目后，最近对话只剩该项目的。A 的未发送文字不出现在 B，回到 A 还在。改名和归档仍可到达。
3. 对话管理。入口是「管理对话」，对话框名是「对话管理」。搜索框可访问名是「搜索线程」。视图是时间、标签、手动分组、AI 分组。点「AI 提取标签」后先确认；点「取消」不发送 `thread.extract_digest`。确认后的进度句是「提取要点 {done}/{total}」。夹具可以显示一条假标签，但真实要点写入要等外部模型，本环境未测。对夹具对话点删除，先出现「将 N 个会话移入回收站？」。取消不发送 `thread.batch_delete`。确认后的模式是 `trash`。回收站里点恢复，发送 `thread.restore`。不执行永久删除。
4. 两张图。「关系图谱」或「会话关系图」发送 `thread_graph.open`。图页「打开会话」发送 `thread_graph.open_thread`，图页不关。知识面板的「分布图谱」发送 `knowledge_graph.open`，对象是知识文档。点「历史」仍打开操作历史，空文案是「暂无操作历史」。不点「重新整理」。
5. 设置减法。主路径有「服务地址（Base URL）」「模型名称」「API Key」，保存按钮是「保存并关闭」。主路径看不到「视觉模型（看图描述）」，从「其他能力」能打开。已配置外部转写时，语音页有「外部转写已配置」，保存别的设置不改 `externalKey`。真实转写请求未测。
6. 确认。注入一条 `evaluate` 的 `security.confirmation.request`。点「拒绝」或按 Esc，发出 `security.confirmation.response` 且未批准，没有执行消息。点「允许」只在工具不会出网、也不会写 live 目录时才测；否则这一行未测。不打开确认台去批准真实页面。
7. 窄宽和键盘。420 宽从「打开工作区导航」展开，Esc 和「关闭导航」把焦点还回该按钮。759 仍是 layered，760 起 sidepanel 和 workspace 为 resident，栏宽 220。popout 在 959 仍是 layered，960 为 resident。键盘焦点用真实 Tab 或 `focus({ focusVisible: true })`。Mac 字体未测。
8. 断连和重试。`disconnected` 时横幅标题是「Companion 未连接」，「重新连接」发送 `ws.forceReconnect`。项目列表失败且没有快照时有「重试」，点击多一条 `project.list`。断连时点「保存并关闭」，出现「尚未连接到 Companion，这次设置没有发送」。Companion 层只停掉临时进程再拉起，不碰 23401 上已有的进程。

四条 pull_request workflow 仍是 CI、ARM acceptance、Linux integration ARM、Session save recovery。十个检查仍是 `build`、四条 smoke、`activity (Linux X11 native)`、`acp-history-restart`、`Affected CPU controls (Linux ARM64)`、`Linux integration controls (ARM64)`、`Windows session persistence`。Release 和 Build installers 不手动触发。场景矩阵不替代这十个检查。
