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

这里的宽屏只指 `sidepanel` 或 `workspace` 达到 760。`popout` 仍要到 960 才 resident。这两档的侧栏内容与窄栏展开的是同一套，不是四个文字按钮。侧栏可以收起。收起和展开不移动焦点。宽度保持在该 surface 的 resident 门槛以上时，记住这次收起。重新打开插件后，窄栏仍从收起开始。缩到门槛以下不自动再展开。

选中行只用 `#e9e9e6` 和字重 500。悬停用 `#eeeeec`。靛蓝 2px 轮廓、外偏 3px 只出现在 `:focus-visible`。禁用行不透明度 0.65，且不可点。长名称单行省略，可读名称仍是全文。

聊天档工具格保留现有 `contextBarTabsForLevel` 与 overflow 的能力。因为「历史」在当前聊天档的当前任务里，它必须可见，不能照 v1.1 那一行 `filter` 再滤掉。点「历史」打开 `HistoryPanel`，不打开对话管理。

### 2.2 聊天与项目

主列是对话正文和输入。不把「工作目录」「执行状态」和「更改当前会话归属」的默认 fieldset 放在每则对话顶部。

项目筛选不改变工作目录，也不改变权限。新建、改名、归档仍可从项目节进入，不能只留一个没有去处的「新建与归档」。选中项目后，最近对话只显示该项目的对话。切到另一则对话不把未发送文字带过去。返回原对话时，那则的未发送文字还在。

没有可恢复对话时，现码把输入框设为 `disabled`，占位是「请先创建或选择一个线程」，发送不会创建对话（`App.tsx` 的 `needsThread`）。本规格要求补上「开始第一则对话」：按钮可点，输入框可写，点按钮或发送第一句都创建对话。这是新行为，单独验收，不能算进恢复上次对话那一项。

`ProjectListView` 在 `phase === "list-error"` 时只显示 `projectCopy.listFailed`，组件 props 没有重试回调。本规格要求失败且没有快照时出现「重试」，点击调用新的 `onRetry`。已有快照时仍显示旧列表和失败句，不显示「还没有项目」。离线且没有快照仍用 `projectCopy.offlineEmpty`。

### 2.3 对话管理

「管理对话」保持在「最近对话」旁，待确认时禁用。点它进入对话管理。R4 把原浮层放到聊天主区，这是本规格采纳的布局：窄栏和宽屏都看得到同一组控件。关闭后恢复进入前的对话、焦点和该对话的未发送文字。

页面包含：时间、标签、手动分组、AI 分组、选择、搜索、「AI 提取标签」、「整理助手」、「关系图谱」、「回收站」，以及行内「AI 标签」「分类」「删除」。「⋯」保留「AI 生成标题」和「未命名→首条起名」，不把它们放到顶栏。

在 `beginExtractBatch` 之前增加确认。文案写明：最多 20 条还没有要点的对话，写入要点和标签，不删除，不改手动分组。取消不调用 `beginExtractBatch`，也不发送提取消息。确认后才沿用现有批次。本规格不新增中断进行中批次的按钮，也不回滚已经写入的要点。进行中的进度句保持「提取要点 {done}/{total}」。没有写回时，按钮可再次点。测试用的标签和进度不是真实模型输出。

整理助手保持规则扫描和已有确认。关系图谱保持新标签页和「打开会话」不关图。分布图谱仍从知识面板进入，不从对话管理进入，不把知识节点画成聊天。

### 2.4 设置

设置减法只减少外部模型的常驻展示。主对话模型的服务地址、模型名、密钥和保存仍在主路径。视觉模型、外部转写表单、实验里的本地视觉定位默认不铺在主路径。已保存的地址、密钥、开关、模型数据和历史全部保留。不自动删除、不卸载、不停用运行能力。

已经启用外部转写的用户，在语音页能看到「外部转写已配置」，并打开原来的字段。未启用的用户从「其他能力」打开同一组字段。保存其他设置不得清空这些字段。隐藏表单不得改变已合并的外部转写请求、会议仍不走外部转写、以及失败时不静默改回本地引擎。本规格不增加供应商，也不扩大本地 ASR。

权限、本机工具、密钥与环境、连接与配对仍可从设置分类到达。

## 3. 非目标

不合并、不修改、不发布 #864。不改 #856。不改版本，不打 tag。不新增右侧结果栏、不新增外部模型、不把 `ws_secret` 当作授权。不在本规格里优化 Linux 专项或本地 ASR。没有 Mac 字体和安装测试就不写已通过。

## 4. 验收

每个实现节点停在独立评审。本规格和节点 0 的文档 PR 不是实现通过，也不是合并通过。最终节点在同一 head 上跑扩展与 companion 全量测试，以及仓库四条 workflow、十个 CI 检查，再进入独立 final gate。旧 head 的绿色不算。

视觉门是 `chrome-extension/scripts/test-sidebar-review-ui.py`。命令：

```bash
cd chrome-extension && nvm use 22
uv run --no-project --with playwright python scripts/test-sidebar-review-ui.py
```

它用本机 Chrome 打开真实 `WorkspaceFrame` 夹具，不是手画页。必须断言并保存这些截图，缺任一张或任一条断言失败，就不能申请 final gate：

| 视口 | 状态 | 断言 |
| --- | --- | --- |
| 420×860，`sidepanel` | 默认收起 | 看不到「资料与工具」；可访问名「打开工作区导航」在顶栏 |
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

截图文件名与上表一一对应，写到该次运行的临时目录。报告写明字体是运行机器的 fallback，不是 Mac 验收。`popout` 不在这张视觉表里，它的 960 门槛由 `startup-destination.test.ts` 锁住。
