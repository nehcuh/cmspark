# v1.1 侧栏与历史入口实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让侧栏回到 v1.1 的完整构成，并把 #865 里已经核对的历史入口补回可发现、作用域不混的位置。

**Architecture:** 侧栏路径继续从 `WorkspaceFrame` 进入，但 `full === false` 时不再以四个文字按钮作为导航本体。宽窄门槛、选中和焦点、对话管理确认都先写成可失败的测试，再改组件。设置只改展示，不改外部转写的请求模块。

**Tech Stack:** Chrome 扩展 React、`node:test`、`chrome-extension/tsconfig.test.json`、Playwright 只用于真实组件视口截图。

GitHub: #865

**Base:** `08fe57feacd6ca634eb2f8369dada10420ce0d44`

## Global Constraints

- 规格是 `docs/superpowers/specs/2026-11-18-v11-sidebar-history-design.md`。冲突时以规格为准。
- 窄栏 `< 760px`，宽屏 `>= 760px`，栏宽 `220px`，展开层最高 `28dvh`。
- 选中 `#e9e9e6`、字重 500、无描边。悬停 `#eeeeec`。`:focus-visible` 为 `2px solid #4f46e5`，`outline-offset: 3px`。
- 不删除配置、密钥、开关、模型数据或历史。不改 `companion/src/voice/external-asr-*.ts` 的请求行为。
- 提取确认取消时不调用 `beginExtractBatch`。不新增中断进行中批次或回滚已写要点的行为。
- 不合并 #864，不改 #856，不改版本，不打 tag。
- 每个节点在自己的提交上停住，等独立评审。旧 head 的绿色不算本节点。
- 没有 Mac 字体或安装测试就在节点报告里写未测。

---

### Task 1: 侧栏构成与选中 / 焦点

**Files:**
- Create: `chrome-extension/tests/sidebar-v11-structure.test.ts`
- Modify: `chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx`
- Modify: `chrome-extension/src/sidepanel/components/ProjectNavigationRoot.tsx`
- Modify: `chrome-extension/src/sidepanel/ui/workspace-styles.ts`
- Test: `chrome-extension/tests/sidebar-v11-structure.test.ts`

**Interfaces:**
- Consumes: 现有 `WorkspaceNavigation` 的按钮文案和 `cm-nav-*` 类。
- Produces: `full === false` 的侧栏 DOM 含品牌、`新对话`、`项目`、`资料与工具`、`查找对话…`、`最近对话`、`管理对话`、`设置`。选中元素带 `aria-current="page"` 且计算样式无 `outline-style: solid`。`:focus-visible` 才有靛蓝轮廓。

- [ ] **Step 1: Write the failing test**

```ts
test("side panel navigation keeps the v1.1 sections in order", () => {
  const text = renderSideNav({ full: false, width: 960 })
  const order = ["新对话", "项目", "资料与工具", "查找对话", "最近对话", "管理对话", "设置"]
  let at = -1
  for (const label of order) {
    const next = text.indexOf(label)
    assert.ok(next > at, label)
    at = next
  }
  assert.equal(text.includes("项目最近对话工具设置"), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && npx tsc -p tsconfig.test.json --pretty false && node --test .test-dist/tests/sidebar-v11-structure.test.js`

Expected: FAIL，因为当前窄/宽侧栏主路径是 `ProjectNavigationRoot` 的四个文字按钮，找不到按序的「资料与工具」。

- [ ] **Step 3: Write minimal implementation**

让非 full 的 `WorkspaceFrame` 使用与 v1.1 `WorkspaceNavigation` 相同的区域和类，而不是只渲染四个 `cm-nav-item`。不要删除 `ProjectPanel` 的新建、改名、归档控件；它们仍在「项目」展开后可达。

- [ ] **Step 4: Run test to verify it passes**

同一条命令。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/tests/sidebar-v11-structure.test.ts chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx chrome-extension/src/sidepanel/components/ProjectNavigationRoot.tsx chrome-extension/src/sidepanel/ui/workspace-styles.ts
git commit -m "test: restore v1.1 sidebar section order"
```

停。等本节点独立评审。

### Task 2: 760 门槛、28dvh 与宽屏收起

**Files:**
- Create: `chrome-extension/tests/sidebar-viewport.test.ts`
- Modify: `chrome-extension/src/sidepanel/navigation/navigation-mode.ts`
- Modify: `chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx`
- Test: `chrome-extension/tests/sidebar-viewport.test.ts`

**Interfaces:**
- Consumes: Task 1 的侧栏 DOM。
- Produces: `navigationMode({ surface: "sidepanel", innerWidth })` 在 `759` 返回 `"layered"`，在 `760` 返回 `"resident"`。layered 导航容器最大高度是 `28dvh`。resident 收起后焦点元素不变。

- [ ] **Step 1: Write the failing test**

```ts
test("rail starts at 760 and the narrow layer is capped at 28dvh", () => {
  assert.equal(navigationMode({ surface: "sidepanel", innerWidth: 759 }), "layered")
  assert.equal(navigationMode({ surface: "sidepanel", innerWidth: 760 }), "resident")
  const css = readWorkspaceCss()
  assert.match(css, /max-width:\s*759px/)
  assert.match(css, /max-height:\s*28dvh/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && npx tsc -p tsconfig.test.json --pretty false && node --test .test-dist/tests/sidebar-viewport.test.js`

Expected: FAIL，当前 `RESIDENT_MIN_WIDTH` 是 960。

- [ ] **Step 3: Write minimal implementation**

把 resident 门槛改为 760。窄层使用现有 disclosure 容器和 `28dvh`。宽屏收起只改本地 state，不调用 `element.focus`。

- [ ] **Step 4: Run test to verify it passes**

同一条命令。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/tests/sidebar-viewport.test.ts chrome-extension/src/sidepanel/navigation/navigation-mode.ts chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx
git commit -m "test: use the 760 sidebar breakpoint"
```

停。等本节点独立评审。

### Task 3: 上次对话与按对话隔离草稿

**Files:**
- Create: `chrome-extension/tests/composer-draft-by-thread.test.ts`
- Modify: `chrome-extension/src/sidepanel/App.tsx`
- Test: `chrome-extension/tests/composer-draft-by-thread.test.ts`

**Interfaces:**
- Consumes: `startup-destination.ts` 的 `commitStartupNavigation`。
- Produces: `draftFor(threadId)` 与 `setDraft(threadId, text)`。切换 `activeThreadId` 时输入框显示目标对话自己的字符串。

- [ ] **Step 1: Write the failing test**

```ts
test("switching threads does not carry unsent text", () => {
  const drafts = createDrafts()
  drafts.set("weekend", "记得买水果")
  drafts.set("shop", "")
  assert.equal(drafts.get("shop"), "")
  assert.equal(drafts.get("weekend"), "记得买水果")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && npx tsc -p tsconfig.test.json --pretty false && node --test .test-dist/tests/composer-draft-by-thread.test.js`

Expected: FAIL，`createDrafts` 尚不存在。现码只有 `App.tsx` 的一个 `text` state。

- [ ] **Step 3: Write minimal implementation**

用 `Record<string, string>` 保存草稿。激活对话变化时读写该记录，不把上一条的字符串写入下一条。`commitStartupNavigation` 的恢复规则不改。

- [ ] **Step 4: Run test to verify it passes**

同一条命令。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/tests/composer-draft-by-thread.test.ts chrome-extension/src/sidepanel/App.tsx
git commit -m "test: keep unsent text on its own thread"
```

停。等本节点独立评审。

### Task 4: 聊天主列去掉常驻状态框

**Files:**
- Modify: `chrome-extension/src/sidepanel/components/ProjectNavigationRoot.tsx`
- Modify: `chrome-extension/src/sidepanel/components/SessionContextBar.tsx`
- Test: `chrome-extension/tests/sidebar-v11-structure.test.ts`

**Interfaces:**
- Consumes: Task 1 的渲染函数。
- Produces: 会话层文本不含「更改当前会话归属」，也不含「执行状态：」。

- [ ] **Step 1: Write the failing test**

在 `sidebar-v11-structure.test.ts` 增加：

```ts
test("session column does not open with the move fieldset", () => {
  const text = renderSessionColumn({ threadTitle: "示例·周末清单" })
  assert.equal(text.includes("更改当前会话归属"), false)
  assert.equal(text.includes("执行状态："), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && npx tsc -p tsconfig.test.json --pretty false && node --test .test-dist/tests/sidebar-v11-structure.test.js`

Expected: FAIL，当前 `ProjectNavigationRoot` 会话层有该 fieldset。

- [ ] **Step 3: Write minimal implementation**

会话主列只保留标题和消息挂载点。项目归属仍从「项目」节进入，不从每则对话顶部进入。

- [ ] **Step 4: Run test to verify it passes**

同一条命令。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/tests/sidebar-v11-structure.test.ts chrome-extension/src/sidepanel/components/ProjectNavigationRoot.tsx chrome-extension/src/sidepanel/components/SessionContextBar.tsx
git commit -m "test: remove the resident move fieldset from chat"
```

停。等本节点独立评审。

### Task 5: 项目新建、改名、归档仍可达

**Files:**
- Modify: `chrome-extension/src/sidepanel/components/ProjectPanel.tsx`
- Test: `chrome-extension/tests/sidebar-v11-structure.test.ts`

**Interfaces:**
- Consumes: `ProjectPanel` 现有 `project.create`、`project.rename`、`project.archive`。
- Produces: 展开「项目」后能找到「创建项目」「改名」「归档项目」。筛选回调不接收工作目录或权限字段。

- [ ] **Step 1: Write the failing test**

```ts
test("project admin actions stay inside the project section", () => {
  const text = renderProjectSection({ open: true })
  for (const label of ["创建项目", "改名", "归档项目"]) {
    assert.ok(text.includes(label), label)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && npx tsc -p tsconfig.test.json --pretty false && node --test .test-dist/tests/sidebar-v11-structure.test.js`

Expected: FAIL，若这些控件被收进不可到达的分支。若现码已经渲染它们，测试先 PASS，则本步只加测试并在报告里写「红灯未出现，因为控件仍在」。不得为了制造红灯而删控件。

- [ ] **Step 3: Write minimal implementation**

只在测试失败时把这三个按钮放回项目节。不要给 `onFilter` 增加 `workspace_root` 或权限参数。

- [ ] **Step 4: Run test to verify it passes**

同一条命令。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/tests/sidebar-v11-structure.test.ts chrome-extension/src/sidepanel/components/ProjectPanel.tsx
git commit -m "test: keep project create rename and archive reachable"
```

停。等本节点独立评审。

### Task 6: 对话管理入口与提取确认

**Files:**
- Create: `chrome-extension/tests/thread-manager-extract-confirm.test.ts`
- Modify: `chrome-extension/src/sidepanel/components/ThreadList.tsx`
- Test: `chrome-extension/tests/thread-manager-extract-confirm.test.ts`

**Interfaces:**
- Consumes: `beginExtractBatch(ids, force)` 与 `EXTRACT_DIGEST_MAX`。
- Produces: `confirmExtractUntagged({ accepted, ids })`。`accepted === false` 返回 `{ send: false }`。`accepted === true` 返回 `{ send: true, ids }`，且 `ids.length <= 20`。

- [ ] **Step 1: Write the failing test**

```ts
test("cancel does not start untagged extraction", () => {
  const result = confirmExtractUntagged({ accepted: false, ids: ["a", "b"] })
  assert.deepEqual(result, { send: false })
})

test("confirm sends at most twenty untagged ids", () => {
  const ids = Array.from({ length: 25 }, (_, i) => String(i))
  const result = confirmExtractUntagged({ accepted: true, ids })
  assert.equal(result.send, true)
  if (result.send) assert.equal(result.ids.length, 20)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && npx tsc -p tsconfig.test.json --pretty false && node --test .test-dist/tests/thread-manager-extract-confirm.test.js`

Expected: FAIL，`confirmExtractUntagged` 不存在。

- [ ] **Step 3: Write minimal implementation**

在 `handleExtractUntagged` 前显示确认。取消只关闭确认。确认后调用现有 `beginExtractBatch`。不增加取消进行中批次的按钮。对话管理的视图名和「关系图谱」「整理助手」「回收站」保持可见。关闭管理后调用进入前保存的焦点元素。

- [ ] **Step 4: Run test to verify it passes**

同一条命令。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/tests/thread-manager-extract-confirm.test.ts chrome-extension/src/sidepanel/components/ThreadList.tsx
git commit -m "test: confirm before untagged tag extraction"
```

停。等本节点独立评审。

### Task 7: 两张图谱和操作历史不混

**Files:**
- Create: `chrome-extension/tests/history-entry-scopes.test.ts`
- Modify: `chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx`
- Test: `chrome-extension/tests/history-entry-scopes.test.ts`

**Interfaces:**
- Consumes: `openThreadGraph` 的 `thread_graph.open`，知识按钮的 `knowledge_graph.open`，`HistoryPanel`。
- Produces: 聊天档工具格含「历史」。`renderHistoryPanel([])` 含「暂无操作历史」，不含「AI 提取标签」。关系图谱按钮的点击记录是 `thread_graph.open`。分布图谱按钮的点击记录是 `knowledge_graph.open`。

- [ ] **Step 1: Write the failing test**

```ts
test("operation history is not the thread manager", () => {
  assert.match(renderHistoryPanel([]), /暂无操作历史/)
  assert.doesNotMatch(renderHistoryPanel([]), /AI 提取标签/)
})

test("the two graph buttons send different messages", () => {
  assert.equal(graphMessage("thread"), "thread_graph.open")
  assert.equal(graphMessage("knowledge"), "knowledge_graph.open")
  assert.match(renderChatTools(), /历史/)
  assert.match(renderThreadManagerActions(), /整理助手/)
  assert.match(renderThreadManagerActions(), /关系图谱/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && npx tsc -p tsconfig.test.json --pretty false && node --test .test-dist/tests/history-entry-scopes.test.js`

Expected: FAIL，直到渲染助手和断言接上现有组件。若 `HistoryPanel` 已含该句，把失败点设在「聊天档工具格含历史」这一条，因为 v1.1 网格会滤掉它。

- [ ] **Step 3: Write minimal implementation**

聊天档按 `contextBarTabsForLevel("chat")` 显示「历史」。不要在 `openThreadGraph` 里发送 `knowledge_graph.open`。不要给会话关系图增加删除按钮。

- [ ] **Step 4: Run test to verify it passes**

同一条命令。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/tests/history-entry-scopes.test.ts chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx
git commit -m "test: keep history and the two graphs on their own entries"
```

停。等本节点独立评审。

### Task 8: 设置只隐藏外部模型展示

**Files:**
- Create: `chrome-extension/tests/settings-external-model-display.test.ts`
- Modify: `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx`
- Test: `chrome-extension/tests/settings-external-model-display.test.ts`
- Regression: `companion/tests/voice-external-asr-session.test.ts`、`companion/tests/voice-external-asr-config.test.ts`、`companion/tests/voice-external-asr-meeting.test.ts`

**Interfaces:**
- Consumes: 语音页外部转写字段和 `committedExternal`。
- Produces: `externalAsrFieldsVisible({ committed, advancedOpen })`。已启用或打开「其他能力」时为 true。保存其他页不修改外部转写对象。

- [ ] **Step 1: Write the failing test**

```ts
test("configured external transcription stays reachable and is not cleared", () => {
  assert.equal(externalAsrFieldsVisible({ committed: true, advancedOpen: false }), true)
  const saved = { base_url: "https://example.invalid/v1", model: "示例模型" }
  assert.deepEqual(saveUnrelatedSettings(saved), saved)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && npx tsc -p tsconfig.test.json --pretty false && node --test .test-dist/tests/settings-external-model-display.test.js`

Expected: FAIL，函数尚不存在。

- [ ] **Step 3: Write minimal implementation**

主路径保留对话模型的地址、模型名、密钥和保存。视觉模型、未启用时的外部转写表单、实验视觉定位默认不铺开。已启用外部转写显示「外部转写已配置」并打开原字段。不删除配置键，不改 `companion/src/voice/external-asr-session.ts`。

- [ ] **Step 4: Run test to verify it passes**

扩展测试同上，Expected: PASS。

再跑：`cd companion && npx tsc -p tsconfig.test.json --pretty false && node --test .test-dist/tests/voice-external-asr-session.test.js .test-dist/tests/voice-external-asr-config.test.js .test-dist/tests/voice-external-asr-meeting.test.js`

Expected: PASS，且这些测试文件无 diff。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/tests/settings-external-model-display.test.ts chrome-extension/src/sidepanel/components/SettingsSlideout.tsx
git commit -m "test: hide unused external model fields without clearing them"
```

停。等本节点独立评审。

### Task 9: 真实组件视口、键盘与全量门

**Files:**
- Create: `chrome-extension/scripts/sidebar-viewport-preview.tsx`
- Test: 本节点不新造产品行为。它渲染 Task 1–8 的组件。

**Interfaces:**
- Consumes: 前八个任务的组件。
- Produces: 小于 760 和大于等于 760 的截图，覆盖默认、悬停、选中、键盘焦点、长名称、空列表、列表失败、提取进度句。截图旁写明不是 Mac 字体。

- [ ] **Step 1: Write the failing test**

```ts
test("preview marks keyboard focus separately from selection", () => {
  const selected = previewRow({ state: "selected" })
  const focused = previewRow({ state: "focus-visible" })
  assert.equal(selected.outlineStyle, "none")
  assert.equal(focused.outlineStyle, "solid")
  assert.equal(focused.outlineColor, "rgb(79, 70, 229)")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && npx tsc -p tsconfig.test.json --pretty false && node --test .test-dist/tests/sidebar-viewport.test.js`

Expected: FAIL，直到预览行把两种状态分开。

- [ ] **Step 3: Write minimal implementation**

用 Playwright 打开预览页，viewport 设为 `420x860` 和 `960x860`。键盘用 `focus({ focusVisible: true })`。报告写明字体是环境 fallback，未做 Mac 安装。

- [ ] **Step 4: Run the full gates on this head**

```bash
npm --prefix chrome-extension test
npm --prefix companion test
```

然后在该提交上跑仓库四条 workflow。十个 CI 检查都完成后才申请独立 final gate。Expected: 全绿才可申请。有失败就停在该失败，不把旧 head 的绿算进来，不提高超时后盲重跑。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/scripts/sidebar-viewport-preview.tsx chrome-extension/tests/sidebar-viewport.test.ts
git commit -m "test: render sidebar states at narrow and wide widths"
```

停。等独立 final gate。本计划的作者不能把这一步标成已通过。

## 覆盖矩阵

| 规格 | 任务 |
| --- | --- |
| 2.1 侧栏构成与选中 / 焦点 | Task 1、Task 9 |
| 2.1 760、28dvh、宽屏收起不抢焦点 | Task 2、Task 9 |
| 2.2 恢复上次对话 | Task 3 |
| 2.2 草稿按对话隔离 | Task 3 |
| 2.2 主列不放归属 fieldset | Task 4 |
| 2.2 项目新建改名归档、失败不是空项目 | Task 5 |
| 2.3 管理对话入口、视图、行内动作 | Task 6、Task 7 |
| 2.3 提取确认、取消不发请求、不中断不回滚 | Task 6 |
| 2.3 规则整理与回收站确认 | Task 6 的现有确认路径不改，Task 7 保证入口仍在 |
| 2.3 会话关系图与分布图谱分开 | Task 7 |
| 2.1 「历史」是操作记录且聊天档可见 | Task 7 |
| 2.4 设置展示减法且不改外部转写运行 | Task 8 |
| 4 真实组件宽窄渲染与键盘 | Task 9 |
| 3 不发布、不改版本 | 所有任务的 Global Constraints |

## 自审

- 计划里没有待定项。每个红灯都写了命令和失败原因。
- `confirmExtractUntagged`、`navigationMode`、`createDrafts`、`externalAsrFieldsVisible` 在首次出现的任务里定义，后面沿用同一名字。
- 现码已经满足的项目按钮不强迫制造红灯。
- Mac 字体和原生安装没有被写成已测。
