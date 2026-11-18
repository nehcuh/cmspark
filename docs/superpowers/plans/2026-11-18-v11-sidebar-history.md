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


同一份夹具驱动所有界面测试。生产组件是 `App`，里面已经包含 `StatusRail`、`WorkspaceFrame` 和设置。不允许再写一套平行按钮。

夹具文件 `chrome-extension/scripts/sidebar-review-fixture.tsx` 必须：

- 用 esbuild 打成临时目录里的 `index.html`，由 Python 起本地静态服务。`/sidepanel.html`、`/tabs/workspace.html`、`/popout.html?surface=popout` 都指向这一个包。`WorkspaceFrame` 自己读 `location.pathname` 和 `surface` 查询，测试不另传门槛。
- 渲染 `AgentStoreProvider` 和真实 `App`。
- `window.sent` 记录每次 `chrome.runtime.sendMessage` 的参数。
- `window.companionStore` 是外部转写的持久快照，字段与 `VoiceExternalState` 一致，另有只存在于这个快照里的 `externalKey`。React state 的 `voiceModel.external` 只有 `keyConfigured`，没有密钥字符串。
- `window.fixtureState` 和 `window.dispatchUI` 指向同一个 store。

测试文件 `chrome-extension/scripts/test-sidebar-review-ui.py` 必须有 `launch`、`ready` 和 `main`。`main` 把下面每个 `test_*` 都执行一遍，打印 `ran=` 和 `failed=`，`ran` 必须等于函数个数且 `failed == 0`，否则 `sys.exit(1)`。`finally` 关闭浏览器并删临时目录。一个都没跑不能成功。

```python
def main():
    tests = [obj for name, obj in globals().items() if name.startswith("test_") and callable(obj)]
    assert len(tests) >= 12
    failed = 0
    with sync_playwright() as playwright:
        for test in tests:
            browser = page = directory = None
            try:
                browser, page, directory = launch(playwright)
                ready(page)
                test(page)
            except Exception as exc:
                failed += 1
                print("FAIL", test.__name__, exc)
            finally:
                if browser: browser.close()
                if directory: directory.cleanup()
    print(f"ran={len(tests)} failed={failed}")
    if failed or len(tests) < 12:
        sys.exit(1)
```

命令：`cd chrome-extension && nvm use 22 && uv run --no-project --with playwright python scripts/test-sidebar-review-ui.py`

### Task 1: 真实 App 里的侧栏构成

**Files:**
- Create: `chrome-extension/scripts/sidebar-review-fixture.tsx`
- Create: `chrome-extension/scripts/test-sidebar-review-ui.py`
- Modify: `chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx`
- Modify: `chrome-extension/src/sidepanel/ui/workspace-styles.ts`

**Interfaces:**
- Consumes: `App`、`workspaceCSS`。
- Produces: `launch(playwright)` 返回已打开的真实页面。`ready(page)` 等到 `window.fixtureState` 出现。

- [ ] **Step 1: Write the failing test**

```python
def test_section_order(page):
    page.set_viewport_size({"width": 960, "height": 860})
    text = page.locator("aside.cm-navigation, nav.cm-navigation").inner_text()
    order = ["新对话", "项目", "资料与工具", "查找对话", "最近对话", "管理对话", "设置"]
    at = -1
    for label in order:
        nxt = text.find(label)
        assert nxt > at, label
        at = nxt
```

- [ ] **Step 2: Run test to verify it fails**

Expected: 进程退出码非 0，`ran=1 failed=1`。失败是找不到「资料与工具」。当前侧栏是四个文字按钮。不是 `NameError`。

- [ ] **Step 3: Write minimal implementation**

非 full 路径渲染 v1.1 那套区域。保留项目节里已有的创建、改名、归档。

- [ ] **Step 4: Run test to verify it passes**

Expected: `ran=1 failed=0`，退出码 0。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/scripts/sidebar-review-fixture.tsx chrome-extension/scripts/test-sidebar-review-ui.py chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx chrome-extension/src/sidepanel/ui/workspace-styles.ts
git commit -m "test: require the v1.1 sidebar sections in the real app"
```

停。等本节点独立评审。

### Task 2: 三个 surface 的门槛

**Files:**
- Modify: `chrome-extension/src/sidepanel/navigation/navigation-mode.ts`
- Modify: `chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx`（第 44 行和第 84 行的 `matchMedia`）
- Modify: `chrome-extension/src/sidepanel/components/ProjectNavigationRoot.tsx`（已把 `surface` 传进 `navigationMode`，确认它不再另读 `RESIDENT_MIN_WIDTH`）
- Modify: `chrome-extension/tests/startup-destination.test.ts`
- Test: `chrome-extension/tests/startup-destination.test.ts`

**Interfaces:**
- Consumes: 已有的 `navigationMode({ surface, innerWidth })`。
- Produces: 同一函数按 surface 返回 layered 或 resident。不新增测试才看得到的导出。

`WorkspaceFrame.tsx` 第 44 行和第 84 行现在是 `matchMedia(\`(min-width: ${RESIDENT_MIN_WIDTH}px)\`)`，不看 surface。只改 `navigationMode` 会让单测变绿，而工作区仍按 960 切换。两处 `matchMedia` 必须改成该 surface 的门槛。

- [ ] **Step 1: Write the failing test**

替换 `startup-destination.test.ts` 第 70 行的测试。只调用已经存在的 `navigationMode`：

```ts
test("resident width depends on the surface", () => {
  const cases: Array<[NavigationSurface, number, "layered" | "resident"]> = [
    ["sidepanel", 759, "layered"],
    ["sidepanel", 760, "resident"],
    ["workspace", 759, "layered"],
    ["workspace", 760, "resident"],
    ["popout", 800, "layered"],
    ["popout", 959, "layered"],
    ["popout", 960, "resident"],
  ]
  for (const [surface, innerWidth, mode] of cases) {
    assert.equal(navigationMode({ surface, innerWidth }), mode, `${surface} ${innerWidth}`)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && npx tsc -p tsconfig.test.json --pretty false && node --test .test-dist/tests/startup-destination.test.js`

Expected: FAIL 在 `sidepanel 760` 和 `workspace 760`。现码返回 `layered`。`popout 959` 现码已经是 `layered`，这条用来防止以后把 popout 也改成 760。失败不是找不到函数。

- [ ] **Step 3: Write minimal implementation**

`navigationMode` 内部按 surface 选择 760 或 960。`WorkspaceFrame` 的两处 `matchMedia` 使用同一选择。`ProjectNavigationRoot` 继续把真实 `surface` 和 `innerWidth` 传进去。

- [ ] **Step 4: Run test to verify it passes**

同一条命令。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/navigation/navigation-mode.ts chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx chrome-extension/src/sidepanel/components/ProjectNavigationRoot.tsx chrome-extension/tests/startup-destination.test.ts
git commit -m "test: choose the resident width from the surface"
```

停。等本节点独立评审。

### Task 3: 切换活动会话不带走草稿

**Files:**
- Modify: `chrome-extension/src/sidepanel/App.tsx`
- Modify: `chrome-extension/scripts/test-sidebar-review-ui.py`

**Interfaces:**
- Consumes: `App` 里 `aria-label="消息内容"` 的 textarea，以及 `SET_ACTIVE_THREAD`。
- Produces: 输入框的值跟当前 `activeThreadId` 走。

- [ ] **Step 1: Write the failing test**

```python
def test_draft_follows_active_thread(page):
    page.evaluate("""() => {
      window.dispatchUI({type:'SET_THREADS', threads:[
        {id:'weekend', alias:'示例·周末清单', created_at:'t', updated_at:'t', config_override:{}, tool_whitelist:null, pinned_tabs:[], active_skill_ids:[]},
        {id:'shop', alias:'示例·采购', created_at:'t', updated_at:'t', config_override:{}, tool_whitelist:null, pinned_tabs:[], active_skill_ids:[]}
      ]})
      window.dispatchUI({type:'SET_ACTIVE_THREAD', threadId:'weekend'})
    }""")
    box = page.get_by_role("textbox", name="消息内容")
    box.fill("记得买水果")
    page.evaluate("() => window.dispatchUI({type:'SET_ACTIVE_THREAD', threadId:'shop'})")
    assert box.input_value() == ""
    page.evaluate("() => window.dispatchUI({type:'SET_ACTIVE_THREAD', threadId:'weekend'})")
    assert box.input_value() == "记得买水果"
```

- [ ] **Step 2: Run test to verify it fails**

Expected: 退出码非 0。切到 `shop` 后输入框仍是「记得买水果」。

- [ ] **Step 3: Write minimal implementation**

在 `App` 里按线程 id 保存字符串。切换前写入旧 id，再读出新 id。

- [ ] **Step 4: Run test to verify it passes**

Expected: 该测试通过，`main` 的 `failed` 不增加。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/App.tsx chrome-extension/scripts/test-sidebar-review-ui.py
git commit -m "test: keep unsent text on the active thread"
```

停。等本节点独立评审。

### Task 4: 会话主列不放归属框

**Files:**
- Modify: `chrome-extension/src/sidepanel/components/ProjectNavigationRoot.tsx`
- Modify: `chrome-extension/scripts/test-sidebar-review-ui.py`

- [ ] **Step 1: Write the failing test**

```python
def test_no_move_fieldset(page):
    page.evaluate("() => window.dispatchUI({type:'SET_ACTIVE_THREAD', threadId:'weekend'})")
    text = page.locator("body").inner_text()
    assert "更改当前会话归属" not in text
    assert "执行状态：" not in text
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL，当前会话层有这两句。

- [ ] **Step 3: Write minimal implementation**

删掉会话顶部的 fieldset 和执行状态。归属仍从项目节进入。

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS。

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

- [ ] **Step 1: Write the failing test**

```python
def test_project_admin(page):
    page.get_by_text("项目", exact=True).click()
    for label in ("创建项目", "改名", "归档项目"):
        assert page.get_by_role("button", name=label).count() == 1
```

- [ ] **Step 2: Run test to verify it fails**

Expected: 按钮不在时 FAIL。按钮已在时 PASS，报告写明没有红灯。不得删按钮来制造红灯。

- [ ] **Step 3: Write minimal implementation**

只在失败时把这三个按钮放回项目展开区。

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/components/ProjectPanel.tsx chrome-extension/scripts/test-sidebar-review-ui.py
git commit -m "test: keep project admin actions reachable"
```

停。等本节点独立评审。

### Task 6: 第一句可以创建对话

**Files:**
- Modify: `chrome-extension/src/sidepanel/App.tsx`
- Modify: `chrome-extension/scripts/test-sidebar-review-ui.py`

**Interfaces:**
- Consumes: `createBlankThread` 发出的 `thread.create`。
- Produces: 无活动对话时输入框可写。发送只产生一条 `thread.create`。创建没有确认前，原文还在，再按一次发送不再增加 `thread.create`。

- [ ] **Step 1: Write the failing test**

```python
def test_first_sentence_creates_one_thread(page):
    page.evaluate("() => window.dispatchUI({type:'SET_ACTIVE_THREAD', threadId:null})")
    box = page.get_by_role("textbox", name="消息内容")
    assert box.is_enabled()
    box.fill("第一句")
    page.get_by_role("button", name="发送").click()
    page.get_by_role("button", name="发送").click()
    assert page.evaluate("window.sent.filter(m => m.type==='thread.create').length") == 1
    assert box.input_value() == "第一句"
    page.get_by_role("button", name="开始第一则对话").click()
    assert page.evaluate("window.sent.filter(m => m.type==='thread.create').length") == 1
```

第二条点击发生在第一条尚未得到 `thread.created` 时，所以仍是一条。按钮和发送共用同一次未完成的创建。

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL。现码禁用输入框，没有「开始第一则对话」，发送不会发出 `thread.create`。

- [ ] **Step 3: Write minimal implementation**

无活动对话时允许输入并显示按钮。两种动作调用 `createBlankThread` 一次。收到 `thread.created` 之前保留原文并忽略重复点击。

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/App.tsx chrome-extension/scripts/test-sidebar-review-ui.py
git commit -m "test: create one thread from the first sentence"
```

停。等本节点独立评审。

### Task 7: 失败的项目列表可以重试

**Files:**
- Modify: `chrome-extension/src/sidepanel/components/ProjectListView.tsx`
- Modify: `chrome-extension/src/sidepanel/components/ProjectPanel.tsx`
- Create: `chrome-extension/tests/project-list-retry.test.ts`
- Modify: `chrome-extension/scripts/test-sidebar-review-ui.py`

**Interfaces:**
- Consumes: 现有 `ProjectListView` props。先不增加必填字段。
- Produces: 可选 `onRetry?: () => void`。无快照的 `list-error` 渲染「重试」。`ProjectPanel` 把 `refresh` 传进去。点击后 `window.sent` 多一条 `project.list`。

顺序：

1. 节点测试只用现有 props，断言 HTML 含「重试」。这一步能编译，红灯是字符串不存在。
2. 实现可选 `onRetry` 和按钮，并把 `refresh` 接上。
3. Playwright 点击「重试」，断言 `project.list` 的条数增加 1。这一步才算回调被调用。

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ProjectListView } from "../src/sidepanel/components/ProjectListView"

test("failed project list shows retry instead of an empty project", () => {
  const html = renderToStaticMarkup(h(ProjectListView, {
    projects: [], query: "", archiveView: false, phase: "list-error",
    fetchedAt: null, hasSnapshot: false,
    onQuery() {}, onClearQuery() {}, onToggleArchive() {}, onOpen() {},
  }))
  assert.match(html, /重试/)
  assert.doesNotMatch(html, /还没有项目/)
})
```

Playwright 在实现之后加，不在红灯阶段要求新 prop：

```python
def test_retry_requests_project_list(page):
    page.get_by_text("项目", exact=True).click()
    before = page.evaluate("window.sent.filter(m => m.type==='project.list').length")
    page.get_by_role("button", name="重试").click()
    after = page.evaluate("window.sent.filter(m => m.type==='project.list').length")
    assert after == before + 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && npx tsc -p tsconfig.test.json --pretty false && node --test .test-dist/tests/project-list-retry.test.js`

Expected: 编译通过，断言 `/重试/` 失败。

- [ ] **Step 3: Write minimal implementation**

给 `ProjectListView` 增加可选 `onRetry`。无快照的失败态渲染按钮并调用它。`ProjectPanel` 传入已有的 `refresh`。

- [ ] **Step 4: Run test to verify it passes**

节点测试 PASS。再跑 Playwright，`test_retry_requests_project_list` PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/components/ProjectListView.tsx chrome-extension/src/sidepanel/components/ProjectPanel.tsx chrome-extension/tests/project-list-retry.test.ts chrome-extension/scripts/test-sidebar-review-ui.py
git commit -m "test: retry a failed project list"
```

停。等本节点独立评审。

### Task 8: 取消提取不发请求

**Files:**
- Modify: `chrome-extension/src/sidepanel/components/ThreadList.tsx`
- Modify: `chrome-extension/scripts/test-sidebar-review-ui.py`

- [ ] **Step 1: Write the failing test**

夹具先放入一条没有 `digest` 的对话，再打开真实 `ThreadList`。

```python
def test_cancel_extract_sends_nothing(page):
    page.get_by_role("button", name="管理对话").click()
    page.get_by_role("button", name="AI 提取标签").click()
    page.get_by_role("button", name="取消").click()
    assert page.evaluate("window.sent.filter(m => m.type==='thread.extract_digest').length") == 0
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL。现码没有「取消」，点击后 `window.sent` 里已有 `thread.extract_digest`。

- [ ] **Step 3: Write minimal implementation**

先显示确认。取消只关闭确认。确认后才调用现有 `beginExtractBatch`。不增加中断或回滚。

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/components/ThreadList.tsx chrome-extension/scripts/test-sidebar-review-ui.py
git commit -m "test: cancel extraction before thread.extract_digest"
```

停。等本节点独立评审。

### Task 9: 图谱和操作历史分开

**Files:**
- Modify: `chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx`
- Modify: `chrome-extension/scripts/test-sidebar-review-ui.py`
- Create: `chrome-extension/tests/history-entry-scopes.test.ts`

- [ ] **Step 1: Write the failing test**

```python
def test_thread_graph_is_not_knowledge_graph(page):
    page.get_by_role("button", name="管理对话").click()
    page.get_by_role("button", name="关系图谱").click()
    kinds = page.evaluate("window.sent.map(m => m.type)")
    assert "thread_graph.open" in kinds
    assert "knowledge_graph.open" not in kinds
```

`history-entry-scopes.test.ts` 用 `renderToStaticMarkup` 渲染现有 `HistoryPanel`。若它未导出，在 `ContextPanelHost.tsx` 给它加 `export`，这是行为中立的，先用一条测试确认空列表文本是「暂无操作历史」且不含「AI 提取标签」。导出本身不改变渲染。

- [ ] **Step 2: Run test to verify it fails**

两条命令分别跑 Playwright 和 `node --test .test-dist/tests/history-entry-scopes.test.js`。

Expected: Playwright 在「关系图谱」不可点或消息不对时 FAIL。节点测试在文本不对时 FAIL。

- [ ] **Step 3: Write minimal implementation**

聊天档工具格使用 `contextBarTabsForLevel("chat")`。不改两张图的消息类型。

- [ ] **Step 4: Run test to verify it passes**

两条都 PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx chrome-extension/src/sidepanel/components/ContextPanelHost.tsx chrome-extension/scripts/test-sidebar-review-ui.py chrome-extension/tests/history-entry-scopes.test.ts
git commit -m "test: keep history and the two graphs apart"
```

停。等本节点独立评审。

### Task 10: 真实设置字段和已配置的外部转写

**Files:**
- Modify: `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx`
- Modify: `chrome-extension/scripts/sidebar-review-fixture.tsx`
- Modify: `chrome-extension/scripts/test-sidebar-review-ui.py`

**Interfaces:**
- Consumes: `voiceModel.external.keyConfigured` 和设置草稿里的 `api_key`。
- Produces: 已配置时显示「外部转写已配置」。保存主模型不改 `window.companionStore.externalKey`。页面文本和所有 input 的 value 都不含这把密钥。

- [ ] **Step 1: Write the failing test**

```python
def test_configured_external_asr_survives_model_save(page):
    secret = "sk-example-secret"
    page.evaluate("""(secret) => {
      window.companionStore.externalKey = secret
      window.dispatchUI({type:'SET_VOICE_MODEL_STATE', modelState:{
        sttEngine:'external', localModelId:'', recommendedModelId:'', models:{},
        binary:{status:'absent'}, diskBudgetMB:0, diskUsedMB:0,
        external:{style:'deepseek', baseUrl:'https://example.invalid/v1', normalizedUrl:'https://example.invalid/v1', model:'', keyConfigured:true, maxDurationMs:null, maxBytes:1, requestTimeoutMs:1, limitNote:'deepseek-docs'}
      }})
    }""", secret)
    page.get_by_role("button", name="设置").click()
    assert page.get_by_text("模型名称").count() >= 1
    assert page.get_by_text("外部转写已配置").count() == 1
    assert secret not in page.locator("body").inner_text()
    values = page.locator("input").evaluate_all("els => els.map(el => el.value)")
    assert secret not in values
    page.get_by_role("button", name="保存", exact=True).first.click()
    assert page.evaluate("window.companionStore.externalKey") == secret
```

未配置的路径另测：不设置 `sttEngine: "external"` 时，主路径看不到「视觉模型（看图描述）」；点「其他能力」后看得到。

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL。现码没有「外部转写已配置」这句，主路径看得到视觉模型区块。

- [ ] **Step 3: Write minimal implementation**

只改展示。已配置的外部转写留在语音页的一行入口里，打开后仍是原来的字段。保存主模型的消息不得带上 `externalKey`。不改 `companion/src/voice/external-asr-session.ts`。

- [ ] **Step 4: Run test to verify it passes**

Playwright PASS。再跑且无 diff：

```bash
cd companion && npx tsc -p tsconfig.test.json --pretty false && node --test .test-dist/tests/voice-external-asr-session.test.js .test-dist/tests/voice-external-asr-config.test.js .test-dist/tests/voice-external-asr-meeting.test.js
```

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/components/SettingsSlideout.tsx chrome-extension/scripts/sidebar-review-fixture.tsx chrome-extension/scripts/test-sidebar-review-ui.py
git commit -m "test: keep configured external transcription hidden from the main settings path"
```

停。等本节点独立评审。

### Task 11: 每张截图都先有断言

**Files:**
- Modify: `chrome-extension/scripts/test-sidebar-review-ui.py`

**Interfaces:**
- Consumes: `StatusRail` 按钮的可访问名「打开工作区导航」。
- Produces: 规格第 4 节每一行都是一个 `test_*`。断言先于 `screenshot`。`main` 的 `ran` 覆盖这些函数。

- [ ] **Step 1: Write the failing test**

每个视口一个函数。焦点示例：

```python
def test_escape_returns_to_the_nav_button(page):
    page.set_viewport_size({"width": 420, "height": 860})
    nav = page.get_by_role("button", name="打开工作区导航")
    nav.click()
    page.keyboard.press("Escape")
    assert page.evaluate("document.activeElement.getAttribute('aria-label')") == "打开工作区导航"
    page.screenshot(path="/tmp/sidebar-review/420-esc.png")
```

选中行的键盘焦点：

```python
row = page.locator(".cm-nav-thread[aria-current=page]")
row.evaluate("el => el.focus({focusVisible: true})")
style = row.evaluate("el => getComputedStyle(el)")
assert style["outlineStyle"] == "solid"
assert style["outlineColor"] == "rgb(79, 70, 229)"
```

另写 `test_close_returns_to_the_nav_button`，点关闭后断言同一个可访问名。759、760、959、960 各有断言 `data-navigation-mode`，截图在断言之后。

- [ ] **Step 2: Run test to verify it fails**

Expected: 退出码非 0。失败在可访问名、`data-navigation-mode` 或轮廓，不是缺文件名函数。

- [ ] **Step 3: Write minimal implementation**

把 Esc 和关闭的焦点目标设为 `.cm-navigation-toggle`。不要把可见文字「导航」写成 `aria-label`。

- [ ] **Step 4: Run the full gates on this head**

```bash
cd chrome-extension && nvm use 22
uv run --no-project --with playwright python scripts/test-sidebar-review-ui.py
npx tsc -p tsconfig.test.json --pretty false && node --test .test-dist/tests/startup-destination.test.js .test-dist/tests/project-list-retry.test.js .test-dist/tests/history-entry-scopes.test.js
cd .. && npm --prefix chrome-extension test && npm --prefix companion test
```

然后跑仓库四条 workflow。十个 CI 检查和上面的 Playwright 都绿，才能申请 final gate。任一失败就停。截图文件存在但断言没跑，`ran` 对不上，也算失败。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/scripts/test-sidebar-review-ui.py
git commit -m "test: assert each sidebar screenshot before saving it"
```

停。等独立 final gate。写计划的人不能把这一步标成已通过。

## 覆盖矩阵

| 规格 | 任务 |
| --- | --- |
| 侧栏构成 | Task 1 |
| surface 门槛、WorkspaceFrame 的 matchMedia、959 | Task 2 |
| 草稿随活动会话 | Task 3 |
| 主列不放归属框 | Task 4 |
| 项目创建、改名、归档 | Task 5 |
| 第一句可写、发送、不重复创建 | Task 6 |
| 失败重试和 `project.list` | Task 7 |
| 取消不发 `thread.extract_digest` | Task 8 |
| 两张图谱和操作历史 | Task 9 |
| 已配置外部转写和密钥不回显 | Task 10 |
| 截图、759/760/959/960、Esc 和关闭 | Task 11 |
| 四条 workflow、十个 CI、final gate | Task 11 |

## 自审

- 界面测试都从 `test_*` 进入 `main`，`ran` 至少 12，失败退出码非 0。
- 门槛测试只调用已有的 `navigationMode`。红灯是 760 仍为 layered。
- 重试的节点测试不传尚不存在的 prop。点击后的 `project.list` 条数是第二条断言。
- 焦点断言使用「打开工作区导航」和 `focus({ focusVisible: true })`。
- 节点 0 的文档提交不是 final gate。
