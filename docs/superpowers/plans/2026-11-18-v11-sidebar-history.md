# v1.1 侧栏与历史入口实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让侧栏回到 v1.1 的完整构成，并把 #865 里已经核对的历史入口补回可发现、作用域不混的位置。

**Architecture:** 侧栏路径继续从 `WorkspaceFrame` 进入，但 `full === false` 时不再以四个文字按钮作为导航本体。宽窄门槛、选中和焦点、对话管理确认都先写成可失败的测试，再改组件。设置只改展示，不改外部转写的请求模块。

**Tech Stack:** Chrome 扩展 React、`node:test`、`chrome-extension/tsconfig.test.json`、`uv run --no-project --with playwright` 驱动真实组件夹具。不把缺符号当成红灯。

GitHub: #865

**Base:** `08fe57feacd6ca634eb2f8369dada10420ce0d44`

## Global Constraints

- 规格是 `docs/superpowers/specs/2026-11-18-v11-sidebar-history-design.md`。冲突时以规格为准。
- `sidepanel` 与 `workspace` 在 `>= 760` 为 resident；`popout` 仍在 `>= 960`。栏宽 `220px`，窄层最高 `28dvh`。
- 改门槛时必须同时跑 `startup-destination.test.ts`。只跑新测试不算通过。
- 选中 `#e9e9e6`、字重 500、无描边。悬停 `#eeeeec`。`:focus-visible` 为 `2px solid #4f46e5`，`outline-offset: 3px`。
- 不删除配置、密钥、开关、模型数据或历史。不改 `companion/src/voice/external-asr-*.ts` 的请求行为。
- 提取确认取消时不调用 `beginExtractBatch`。不新增中断进行中批次或回滚已写要点的行为。
- 不合并 #864，不改 #856，不改版本，不打 tag。
- 每个节点在自己的提交上停住，等独立评审。旧 head 的绿色不算本节点。
- 没有 Mac 字体或安装测试就在节点报告里写未测。

---


夹具只有一份，后面的任务往同一份里加断言。文件是 `chrome-extension/scripts/sidebar-review-fixture.tsx` 和 `chrome-extension/scripts/test-sidebar-review-ui.py`。夹具用 esbuild 打出临时页，挂上真实 `AgentStoreProvider`、`workspaceCSS` 和被测组件，并把 `state`、`dispatch`、`sent` 放到 `window`。Playwright 用 `channel="chrome"`。命令一律先 `cd chrome-extension && nvm use 22`。

### Task 1: 真实侧栏构成

**Files:**
- Create: `chrome-extension/scripts/sidebar-review-fixture.tsx`
- Create: `chrome-extension/scripts/test-sidebar-review-ui.py`
- Modify: `chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx`
- Modify: `chrome-extension/src/sidepanel/ui/workspace-styles.ts`

**Interfaces:**
- Consumes: `WorkspaceFrame`、`AgentStoreProvider`、`workspaceCSS`。
- Produces: 夹具页 `window.fixtureState` 与 `window.dispatchUI`。Python 函数 `launch(width, surface)`。

- [ ] **Step 1: Write the failing test**

`test-sidebar-review-ui.py` 里写：

```python
def test_section_order(page):
    text = page.locator("nav, aside").first.inner_text()
    order = ["新对话", "项目", "资料与工具", "查找对话", "最近对话", "管理对话", "设置"]
    at = -1
    for label in order:
        nxt = text.find(label)
        assert nxt > at, label
        at = nxt
    assert "项目最近对话工具设置" not in text.replace("\n", "")
```

`launch(960, "workspace")` 后调用它。

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --no-project --with playwright python scripts/test-sidebar-review-ui.py`

Expected: FAIL，断言找不到按序的「资料与工具」。当前 `full === false` 走 `ProjectNavigationRoot` 的四个文字按钮。失败原因不是 `NameError`。

- [ ] **Step 3: Write minimal implementation**

非 full 的 `WorkspaceFrame` 渲染与 v1.1 `WorkspaceNavigation` 相同的区域和类。保留 `ProjectPanel` 里已有的创建、改名、归档控件。

- [ ] **Step 4: Run test to verify it passes**

同一条命令。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/scripts/sidebar-review-fixture.tsx chrome-extension/scripts/test-sidebar-review-ui.py chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx chrome-extension/src/sidepanel/ui/workspace-styles.ts
git commit -m "test: require the v1.1 sidebar sections"
```

停。等本节点独立评审。

### Task 2: 按 surface 分门槛

**Files:**
- Modify: `chrome-extension/src/sidepanel/navigation/navigation-mode.ts`
- Modify: `chrome-extension/tests/startup-destination.test.ts`
- Test: `chrome-extension/tests/startup-destination.test.ts`

**Interfaces:**
- Consumes: `NavigationSurface`。
- Produces: `surfaceResidentMinWidth(surface: NavigationSurface): number`。`sidepanel` 与 `workspace` 返回 760，`popout` 返回 960。`navigationMode` 用这个值，不再只用 `RESIDENT_MIN_WIDTH`。

- [ ] **Step 1: Write the failing test**

把 `startup-destination.test.ts` 第 70 行起换成：

```ts
test("resident width depends on the surface", () => {
  assert.equal(surfaceResidentMinWidth("sidepanel"), 760)
  assert.equal(surfaceResidentMinWidth("workspace"), 760)
  assert.equal(surfaceResidentMinWidth("popout"), 960)
  for (const surface of ["sidepanel", "workspace"] as const) {
    assert.equal(navigationMode({ surface, innerWidth: 759 }), "layered")
    assert.equal(navigationMode({ surface, innerWidth: 760 }), "resident")
  }
  assert.equal(navigationMode({ surface: "popout", innerWidth: 759 }), "layered")
  assert.equal(navigationMode({ surface: "popout", innerWidth: 800 }), "layered")
  assert.equal(navigationMode({ surface: "popout", innerWidth: 960 }), "resident")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && npx tsc -p tsconfig.test.json --pretty false && node --test .test-dist/tests/startup-destination.test.js`

Expected: FAIL，`surfaceResidentMinWidth` 不存在，而且现码在 760 对所有 surface 仍是 layered。

- [ ] **Step 3: Write minimal implementation**

按规格表实现。不要把 `popout` 改成 760。

- [ ] **Step 4: Run test to verify it passes**

同一条命令。Expected: PASS。这就是原来的旧测试文件，不能另写一个新文件然后跳过它。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/navigation/navigation-mode.ts chrome-extension/tests/startup-destination.test.ts
git commit -m "test: split the resident width by surface"
```

停。等本节点独立评审。

### Task 3: 切换 App 的活动会话不带走草稿

**Files:**
- Modify: `chrome-extension/src/sidepanel/App.tsx`
- Modify: `chrome-extension/scripts/sidebar-review-fixture.tsx`
- Modify: `chrome-extension/scripts/test-sidebar-review-ui.py`

**Interfaces:**
- Consumes: `App` 的消息输入框，`aria-label` 为「消息内容」。
- Produces: 输入框的值跟 `activeThreadId` 走。夹具必须渲染 `App`，不能渲染一个自造输入框。

- [ ] **Step 1: Write the failing test**

```python
def test_draft_stays_on_its_thread(page):
    page.evaluate("""() => window.dispatchUI({type:'SET_THREADS', threads:[
      {id:'weekend', alias:'示例·周末清单', created_at:'t', updated_at:'t', config_override:{}, tool_whitelist:null, pinned_tabs:[], active_skill_ids:[]},
      {id:'shop', alias:'示例·采购', created_at:'t', updated_at:'t', config_override:{}, tool_whitelist:null, pinned_tabs:[], active_skill_ids:[]}
    ]})""")
    page.evaluate("() => window.dispatchUI({type:'SET_ACTIVE_THREAD', threadId:'weekend'})")
    box = page.get_by_role("textbox", name="消息内容")
    box.fill("记得买水果")
    page.evaluate("() => window.dispatchUI({type:'SET_ACTIVE_THREAD', threadId:'shop'})")
    assert box.input_value() == ""
    page.evaluate("() => window.dispatchUI({type:'SET_ACTIVE_THREAD', threadId:'weekend'})")
    assert box.input_value() == "记得买水果"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --no-project --with playwright python scripts/test-sidebar-review-ui.py`

Expected: FAIL，切到 `shop` 后输入框仍是「记得买水果」。现码是 `App.tsx` 的一个 `useState`。

- [ ] **Step 3: Write minimal implementation**

在 `App` 内用 `Record<string, string>` 按 `activeThreadId` 保存。切换时先写入旧 id，再读出新 id。

- [ ] **Step 4: Run test to verify it passes**

同一条命令。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/App.tsx chrome-extension/scripts/sidebar-review-fixture.tsx chrome-extension/scripts/test-sidebar-review-ui.py
git commit -m "test: keep the composer draft on the active thread"
```

停。等本节点独立评审。

### Task 4: 会话主列不放归属框

**Files:**
- Modify: `chrome-extension/src/sidepanel/components/ProjectNavigationRoot.tsx`
- Modify: `chrome-extension/scripts/test-sidebar-review-ui.py`

**Interfaces:**
- Consumes: Task 1 的夹具。
- Produces: 打开一则对话后，页面文本不含「更改当前会话归属」和「执行状态：」。

- [ ] **Step 1: Write the failing test**

```python
def test_no_move_fieldset(page):
    open_thread(page, "weekend", "示例·周末清单")
    text = page.locator("body").inner_text()
    assert "更改当前会话归属" not in text
    assert "执行状态：" not in text
```

`open_thread` 在同一个 Python 文件里定义为调用 `dispatchUI` 设置线程并切到 session 层。

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --no-project --with playwright python scripts/test-sidebar-review-ui.py`

Expected: FAIL，当前会话层有该 fieldset。

- [ ] **Step 3: Write minimal implementation**

去掉会话层顶部的 fieldset 和执行状态行。归属仍从项目节进入。

- [ ] **Step 4: Run test to verify it passes**

同一条命令。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/components/ProjectNavigationRoot.tsx chrome-extension/scripts/test-sidebar-review-ui.py
git commit -m "test: drop the resident move fieldset"
```

停。等本节点独立评审。

### Task 5: 项目创建、改名、归档仍在

**Files:**
- Modify: `chrome-extension/src/sidepanel/components/ProjectPanel.tsx`
- Modify: `chrome-extension/scripts/test-sidebar-review-ui.py`

**Interfaces:**
- Consumes: `ProjectPanel` 的 `project.create`、`project.rename`、`project.archive`。
- Produces: 展开项目后三个按钮都在。`onFilter` 的参数仍只是项目 id 字符串。

- [ ] **Step 1: Write the failing test**

```python
def test_project_admin(page):
    page.get_by_text("项目", exact=True).click()
    for label in ("创建项目", "改名", "归档项目"):
        assert page.get_by_role("button", name=label).count() == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --no-project --with playwright python scripts/test-sidebar-review-ui.py`

Expected: 若按钮不在可点路径上则 FAIL。若现码展开后已经有这三个按钮，测试 PASS，报告写明没有红灯，因为控件还在。不得删掉它们来制造红灯。

- [ ] **Step 3: Write minimal implementation**

只在失败时把按钮放回项目展开区。

- [ ] **Step 4: Run test to verify it passes**

同一条命令。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/components/ProjectPanel.tsx chrome-extension/scripts/test-sidebar-review-ui.py
git commit -m "test: keep project admin actions reachable"
```

停。等本节点独立评审。

### Task 6: 没有对话时可以写下第一句

**Files:**
- Modify: `chrome-extension/src/sidepanel/App.tsx`
- Modify: `chrome-extension/scripts/test-sidebar-review-ui.py`

**Interfaces:**
- Consumes: `needsThread` 与 `createBlankThread`。
- Produces: 无 `activeThreadId` 时按钮「开始第一则对话」可点，输入框未禁用。点按钮或发送第一句都往 `window.sent` 推入 `type: "thread.create"`。

- [ ] **Step 1: Write the failing test**

```python
def test_first_sentence_creates_a_thread(page):
    page.evaluate("() => window.dispatchUI({type:'SET_ACTIVE_THREAD', threadId:null})")
    box = page.get_by_role("textbox", name="消息内容")
    assert box.is_enabled()
    page.get_by_role("button", name="开始第一则对话").click()
    assert page.evaluate("window.sent.some(m => m.type==='thread.create')")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --no-project --with playwright python scripts/test-sidebar-review-ui.py`

Expected: FAIL。现码在 `needsThread` 时禁用输入框，占位是「请先创建或选择一个线程」，页面上没有「开始第一则对话」。

- [ ] **Step 3: Write minimal implementation**

无活动对话时显示该按钮并允许输入。两种动作都调用现有的创建线程消息，创建成功后再把这句放进新对话。不要在创建前假装已经有对话。

- [ ] **Step 4: Run test to verify it passes**

同一条命令。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/App.tsx chrome-extension/scripts/test-sidebar-review-ui.py
git commit -m "test: let the first sentence create a thread"
```

停。等本节点独立评审。

### Task 7: 项目列表失败可以重试

**Files:**
- Modify: `chrome-extension/src/sidepanel/components/ProjectListView.tsx`
- Create: `chrome-extension/tests/project-list-retry.test.ts`

**Interfaces:**
- Consumes: `ProjectListView` 的现有 props。
- Produces: 新增 `onRetry: () => void`。`phase === "list-error" && !hasSnapshot` 时渲染按钮「重试」。

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { renderToStaticMarkup } from "react-dom/server"
import { ProjectListView } from "../src/sidepanel/components/ProjectListView"

test("list failure offers retry and does not look empty", () => {
  let clicks = 0
  const html = renderToStaticMarkup(<ProjectListView
    projects={[]} query="" archiveView={false} phase="list-error"
    fetchedAt={null} hasSnapshot={false} onQuery={() => {}} onClearQuery={() => {}}
    onToggleArchive={() => {}} onOpen={() => {}} onRetry={() => { clicks += 1 }} />)
  assert.match(html, /重试/)
  assert.doesNotMatch(html, /还没有项目/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && npx tsc -p tsconfig.test.json --pretty false && node --test .test-dist/tests/project-list-retry.test.js`

Expected: FAIL，`onRetry` 不是 `ProjectListView` 的 prop，类型错误；即使绕过类型，HTML 里也没有「重试」。

- [ ] **Step 3: Write minimal implementation**

在无快照的 `list-error` 下渲染该按钮并调用 `onRetry`。不要把失败文案改成 `projectCopy.empty`。

- [ ] **Step 4: Run test to verify it passes**

同一条命令。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/components/ProjectListView.tsx chrome-extension/tests/project-list-retry.test.ts
git commit -m "test: retry a failed project list"
```

停。等本节点独立评审。

### Task 8: 取消提取不会发出请求

**Files:**
- Modify: `chrome-extension/src/sidepanel/components/ThreadList.tsx`
- Modify: `chrome-extension/scripts/sidebar-review-fixture.tsx`
- Modify: `chrome-extension/scripts/test-sidebar-review-ui.py`

**Interfaces:**
- Consumes: `ThreadList` 按钮「AI 提取标签」和 `beginExtractBatch` 发出的 `thread.extract_digest`。
- Produces: 确认框按钮「确认提取」和「取消」。取消后 `window.sent` 没有 `thread.extract_digest`。

- [ ] **Step 1: Write the failing test**

夹具渲染真实 `ThreadList`，并放入一条没有 `digest` 的对话。

```python
def test_cancel_extract_sends_nothing(page):
    page.get_by_role("button", name="管理对话").click()
    page.get_by_role("button", name="AI 提取标签").click()
    page.get_by_role("button", name="取消").click()
    assert page.evaluate("!window.sent.some(m => m.type==='thread.extract_digest')")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --no-project --with playwright python scripts/test-sidebar-review-ui.py`

Expected: FAIL。现码没有「取消」，点击「AI 提取标签」会直接 `sendMessage({ type: "thread.extract_digest" })`。

- [ ] **Step 3: Write minimal implementation**

先显示确认。取消只关确认。确认后才走现有 `beginExtractBatch`。不增加停止进行中批次的控件。

- [ ] **Step 4: Run test to verify it passes**

同一条命令。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/components/ThreadList.tsx chrome-extension/scripts/sidebar-review-fixture.tsx chrome-extension/scripts/test-sidebar-review-ui.py
git commit -m "test: cancel untagged extraction before any request"
```

停。等本节点独立评审。

### Task 9: 图谱和操作历史分开

**Files:**
- Modify: `chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx`
- Modify: `chrome-extension/scripts/test-sidebar-review-ui.py`
- Test: `chrome-extension/tests/history-entry-scopes.test.ts`

**Interfaces:**
- Consumes: `HistoryPanel`、`thread_graph.open`、`knowledge_graph.open`。
- Produces: 聊天档工具格有「历史」。点它不见「AI 提取标签」。点「关系图谱」只记录 `thread_graph.open`。知识页的「分布图谱」只记录 `knowledge_graph.open`。

- [ ] **Step 1: Write the failing test**

```python
def test_graph_messages_stay_apart(page):
    page.get_by_role("button", name="管理对话").click()
    page.get_by_role("button", name="关系图谱").click()
    kinds = page.evaluate("window.sent.map(m => m.type)")
    assert "thread_graph.open" in kinds
    assert "knowledge_graph.open" not in kinds
```

`history-entry-scopes.test.ts` 用 `renderToStaticMarkup` 渲染 `HistoryPanel` 的空状态，断言含「暂无操作历史」且不含「AI 提取标签」。`HistoryPanel` 若未导出，测试文件先导出一个同名包装再测；不要新写一个假的历史列表。

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --no-project --with playwright python scripts/test-sidebar-review-ui.py`

以及 `cd chrome-extension && npx tsc -p tsconfig.test.json --pretty false && node --test .test-dist/tests/history-entry-scopes.test.js`

Expected: Playwright FAIL，直到「关系图谱」可点并只发会话图消息。节点测试 FAIL，直到空操作史渲染出「暂无操作历史」。

- [ ] **Step 3: Write minimal implementation**

聊天档工具格使用 `contextBarTabsForLevel("chat")`，因此含「历史」。不要改两张图的打开消息。

- [ ] **Step 4: Run test to verify it passes**

两条命令都 PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx chrome-extension/scripts/test-sidebar-review-ui.py chrome-extension/tests/history-entry-scopes.test.ts
git commit -m "test: separate history from the two graphs"
```

停。等本节点独立评审。

### Task 10: 真实设置字段

**Files:**
- Modify: `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx`
- Modify: `chrome-extension/scripts/sidebar-review-fixture.tsx`
- Modify: `chrome-extension/scripts/test-sidebar-review-ui.py`

**Interfaces:**
- Consumes: 设置页真实标签「模型名称」「视觉模型（看图描述）」「外部转写」。
- Produces: 主路径看得到「模型名称」。未启用外部转写时看不见「保存外部转写」，点「其他能力」后看得到。已启用时不点「其他能力」也看得到「外部转写已配置」。

- [ ] **Step 1: Write the failing test**

```python
def test_settings_hides_unused_external_fields(page):
    page.get_by_role("button", name="设置").click()
    assert page.get_by_text("模型名称").count() == 1
    assert page.get_by_text("视觉模型（看图描述）").count() == 0
    assert page.get_by_role("button", name="保存外部转写").count() == 0
    page.get_by_role("button", name="其他能力").click()
    assert page.get_by_text("视觉模型（看图描述）").count() == 1
```

夹具把一份已填写的外部转写配置放进 state。另加断言：不打开该区就保存主模型后，`window.fixtureState` 里的外部转写字段仍在。

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --no-project --with playwright python scripts/test-sidebar-review-ui.py`

Expected: FAIL，现码主路径能看见「视觉模型（看图描述）」。

- [ ] **Step 3: Write minimal implementation**

只改 `SettingsSlideout.tsx` 的展示。不改 `companion/src/voice/external-asr-session.ts`。

- [ ] **Step 4: Run test to verify it passes**

Playwright PASS。再跑且这些文件无 diff：

```bash
cd companion && npx tsc -p tsconfig.test.json --pretty false && node --test .test-dist/tests/voice-external-asr-session.test.js .test-dist/tests/voice-external-asr-config.test.js .test-dist/tests/voice-external-asr-meeting.test.js
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/components/SettingsSlideout.tsx chrome-extension/scripts/sidebar-review-fixture.tsx chrome-extension/scripts/test-sidebar-review-ui.py
git commit -m "test: keep external model settings reachable but not resident"
```

停。等本节点独立评审。

### Task 11: 视口、焦点和最终门

**Files:**
- Modify: `chrome-extension/scripts/test-sidebar-review-ui.py`
- Modify: `chrome-extension/scripts/sidebar-review-fixture.tsx`

**Interfaces:**
- Consumes: Task 1–10 的真实组件。
- Produces: 规格第 4 节那张表里的每一条断言和截图。失败则不能申请 final gate。

- [ ] **Step 1: Write the failing test**

在同一个 Python 文件里逐条实现规格第 4 节的表。焦点用：

```python
page.locator("[aria-current=page]").focus()
style = page.locator("[aria-current=page]").evaluate("el => getComputedStyle(el)")
assert style["outlineStyle"] == "solid"
assert style["outlineColor"] == "rgb(79, 70, 229)"
```

Esc 与关闭之后：

```python
assert page.evaluate("document.activeElement.getAttribute('aria-label')") == "导航"
```

截图路径：`/tmp/sidebar-review/420-closed.png`、`420-open.png`、`420-esc.png`、`420-close.png`、`960-rail.png`、`960-hover.png`、`960-selected.png`、`960-focus.png`、`960-long.png`、`960-empty.png`、`960-error.png`、`960-progress.png`。缺文件即失败。

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --no-project --with playwright python scripts/test-sidebar-review-ui.py`

Expected: FAIL，在焦点回到「导航」或 28dvh 高度上失败，而不是缺函数名。

- [ ] **Step 3: Write minimal implementation**

只补齐让这些断言成立的焦点和高度。不改 `popout` 的 960。

- [ ] **Step 4: Run the full gates on this head**

```bash
uv run --no-project --with playwright python scripts/test-sidebar-review-ui.py
cd chrome-extension && npx tsc -p tsconfig.test.json --pretty false && node --test .test-dist/tests/startup-destination.test.js
npm --prefix chrome-extension test
npm --prefix companion test
```

然后在该提交上跑仓库四条 workflow。十个 CI 检查都绿，且上面的 Playwright 也绿，才能申请独立 final gate。任一失败就停。旧 head 的绿色不算。不提高超时后盲重跑。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/scripts/test-sidebar-review-ui.py chrome-extension/scripts/sidebar-review-fixture.tsx
git commit -m "test: gate sidebar screenshots and focus return"
```

停。等独立 final gate。写计划的人不能把这一步标成已通过。

## 覆盖矩阵

| 规格 | 任务 |
| --- | --- |
| 2.1 侧栏构成、选中、悬停、键盘焦点 | Task 1、Task 11 |
| 2.1 surface 门槛与旧测试 | Task 2 |
| 2.1 28dvh、Esc、关闭回到「导航」 | Task 11 |
| 2.2 恢复上次对话 | Task 3 使用现有 `commitStartupNavigation`，不另改规则 |
| 2.2 草稿随活动会话切换 | Task 3 |
| 2.2 主列不放归属 fieldset | Task 4 |
| 2.2 项目创建、改名、归档 | Task 5 |
| 2.2 第一句创建对话 | Task 6 |
| 2.2 列表失败重试 | Task 7 |
| 2.3 管理对话、提取确认、取消不发 `thread.extract_digest` | Task 8 |
| 2.3 不中断、不回滚 | Task 8 明确不实现 |
| 2.3 两张图谱和操作历史 | Task 9 |
| 2.4 真实设置字段与外部转写保留 | Task 10 |
| 第 4 节截图清单 | Task 11 |
| 最终四条 workflow、十个 CI、final gate | Task 11 |

## 自审

- 测试里没有未定义的 `renderSideNav`、`createDrafts`、`confirmExtractUntagged`、`previewRow`。
- Task 2 改的是 `startup-destination.test.ts`，并要求跑这个旧文件。
- Task 6 和 Task 7 单独对应第一句创建和失败重试，矩阵不再把它们算进 Task 3 或 Task 5。
- Task 11 的失败会挡住 final gate。节点 0 的文档提交不是这道门。
