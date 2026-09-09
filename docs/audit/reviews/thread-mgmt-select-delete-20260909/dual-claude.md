审查完成。所有证据均为新的工作树（working-tree），而非补丁文件（补丁与实时代码一致；已通过实时的 `git diff` + 上述文件读取进行验证）。

## 声明的修复 — 判决

**1. 全选幂等（拒绝条件 1：选择项仍可能被清空）— 未触发**
- `chrome-extension/src/sidepanel/utils/thread-timeline.ts:466-468` — `selectAllIds` 是纯函数 `new Set(selectableIds)`，无读取前一个状态的情况，因此重复触发或 StrictMode updater 的重复调用无法将其清空。[已检查]
- `chrome-extension/src/sidepanel/components/ThreadList.tsx:807-809` — `handleSelectAllVisible` 执行 `selectAllIds(selectableIds)` 然后执行 `setSelected(ids)`（直接设置，而非函数式 updater；onClick 处理程序也未被 React 重复调用）。全部三个调用点（头部工具栏 `ThreadList.tsx:1481-1484`，对话整理操作行 `:1599-1616`，底部栏 `:1886-1896`）均通过此函数路由；清除是显式的 `handleClearVisibleSelection` (`:821-827`)，仅在 `allSelectableSelected` 为 true 时才可访问。[已检查]
- `toggleSelectAll`（切换变体）在 ThreadList.tsx 的任何地方都没有被导入或使用 —— 组件中无引用。[已检查]

**2. 整理助手打开且有建议时，工具栏全选填 `cleanupSelected` 而非线程 `selected`（拒绝条件 2）— 未触发**
- `ThreadList.tsx:800-806` — 在触碰线程选择之前，通过 `setCleanupSelected(new Set(...filter(Boolean).slice(0, 50)))` 进行保护并提前返回。`handleClearVisibleSelection` 中有对应的保护 (`:822-825`)。上限 50 符合声明的契约。[已检查]

**3. 面板内确认，删除路径无 `window.confirm`（拒绝条件 3）— 未触发**
- 所有三个删除源均通过 `pendingDelete` 路由：行 `:762`，批处理 `:773`，清理 `:871`；执行在 `executePendingDelete` (`:776-798`)，它发送预先存在的 `thread.delete`/`thread.batch_delete`（无新消息类型）。对话框在 `:1750-1775` 渲染，带有 `role="alertdialog"`。`ThreadList.tsx` 中唯一剩余的 `confirm(` (`:600`) 是预先存在的 `handleCleanupEmpty`（`thread.cleanup_empty` 菜单操作，未受此 diff 影响，不在行/批处理/清理契约内）——见 nit (c)。[已检查]
- 滚动进入视图的 effect 在 `:186-188` (`historyRef.current?.querySelector("[role='alertdialog']")?.scrollIntoView({ block: "nearest" })`)。注意：该样式上的 `position: sticky; top: 0` (`:2298-2311`) 现在已无用 —— 面板本身是 `overflow:hidden`，对话框是列表前的一个 `flexShrink:0` flex 子元素，因此它始终在视野内，无需 sticky。无害。[已检查]

**4. 布局上移（拒绝条件 4+5：清理在列表后 / CSS 裁剪）— 未触发**
- 实时文件中的 JSX 顺序：工具栏 `对话整理工具` `:1594` → 清理面板 `:1618-1747` → `alertdialog` `:1750` → `.cm-thread-management-list` `:1876`。列表下方旧的清理块已被删除（在 patch hunks `@@ -1705,129 +1945,6 @@` 中可见）。[已检查]
- `workspace-styles.ts:80-85` — `.cm-history-panel` `display:flex!important; flex-direction:column; overflow:hidden!important`; `.cm-thread-management-list{flex:1;min-height:0;overflow-y:auto!important}`; header/actions/`.cm-thread-cleanup` 全部 `flex-shrink:0`。面板已调整为 `panelMaxHeight`，当 `cleanupOpen` 时包含 480 (`ThreadList.tsx` hunk `@@ -850,7 +879,7 @@`)。清理面板 `maxHeight:min(42%,280px)`，`flexShrink:0`。结构上不可能出现“滚动整个历史记录才能找到它”的情况 —— 清理面板位于滚动列表之前。[已检查]

**5. 边界 — 未触发（拒绝条件 6+7）**
- diff 添加的工具/消息类型/确认方言为零：仅有 `thread.delete`, `thread.batch_delete`, `thread.suggest_cleanup`, `thread.restore`, `thread.list` —— 均为补丁前已存在。无出站配置文件 (outbound-profile)，无 overlay-acl，无新的 L1/L2。[已检查]
- 测试：`tests/thread-timeline.test.ts:325-332` 涵盖了 `selectAllIds` 幂等性，包括“全开状态下再次全选仍为全开”以及空可选集的情况；`:313-324` 测试的是切换辅助函数本身，而非工具栏连线（没有组件测试 —— 根据边界情况，这是正确的）。[已检查]

## 执行验证

- `npx tsc --noEmit` → exit 0。[已执行]
- `npx tsx --test tests/thread-timeline.test.ts` → 37 通过，0 失败，包括两个新的选择测试。[已执行]
- `git diff HEAD` 在所有五个文件上与 `docs/audit/reviews/thread-mgmt-select-delete-20260909/diff.patch` 的内容匹配（stat: 483/9/21/24/2 行更改）。`brand-mark.svg` 和 `memory/session.md` 的更改已按照范围排除。[已执行]

## 细节问题（非阻塞）

a. `tests/thread-timeline.test.ts:313` — 测试标题 “toggleSelectAll is the management 全选 quick entry” 现在在事实上是错误的：工具栏路径是 `selectAllIds`。断言验证的是辅助函数的行为，但标题记录了错误的连线方式；重命名（例如 “toggleSelectAll kept for group toggling; toolbar 全选 uses selectAllIds”）可以防止未来的读取者将切换逻辑重新连接回去。
b. 工具栏清理模式标签 (`ThreadList.tsx:1602-1615`) 在比较 `cleanupSelected.size === cleanupSuggestions.length` 时没有对 `thread_id` 进行 `.filter(Boolean)`，而选择填充时进行了过滤；如果出现虚假建议，标签和实际集合可能会不一致。防御性修复可以统一两者。
c. `handleCleanupEmpty` (`:600`) 仍然使用宿主 `confirm()` 来门控硬性、无回收站的 `thread.cleanup_empty` 删除 —— 这与该补丁在上述三个路径中修复的 Side Panel 吞掉对话框的故障类型相同，且后果更严重。这是预先存在且超出本次声明契约的范围，但值得跟进。
d. 声明的细节问题已确认按所述存在：`handleBatchDelete:767-772` / `applyCleanupTrash:866-870` 的空选回退通过禁用按钮无法到达，但已确认是安全的（确认门控）；繁忙行 `alert()` 在 `:759`（预先存在）；`styles.pendingDelete` 上的 sticky 已无用（参见修复 3）。

## 覆盖率未重新验证

- 此环境中没有 Chrome Side Panel —— 无法通过执行验证 `window.confirm` 的吞没前提、sticky/portal 的视觉放置，或者 `.cm-history-panel` 的 flex 布局是否在真实的 320px 面板中按预期表现。布局和确认判断是静态的（已检查），基于 JSX 顺序和 CSS，并且 `panelBox`/`createPortal` 路径未针对实时 DOM 进行测试。
- Companion 端对 `thread.batch_delete` 的处理未受此次 diff 影响，也未重新审查（对 mode 参数的信任是预先存在的）。
- 未重新验证清理扫描超过 50 个建议的响应形状（上限逻辑针对列表进行了防御性保护）。

裁决：批准（有细节问题）
