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
- 不合并 #864，不改 #856，不改版本，不打 tag。场景矩阵不恢复发布，也不包含 Linux 专项或本地 ASR。
- 每个节点在自己的提交上停住，等独立评审。旧 head 的绿色不算本节点。
- 没有 Mac 字体或安装测试就在节点报告里写未测。没有隔离的真实模型密钥时，外部服务行写未测。
- 最终门包含规格第 5 节的场景矩阵。节点 0 只把步骤和预期写进计划，不启动 Companion，不改 `~/.cmspark-agent`。

---


同一份真实 `App` 夹具驱动所有界面测试。`package.json` 没有直接依赖 `esbuild` 或 `playwright`。打包用已经随 Plasmo 安装的 `chrome-extension/node_modules/esbuild`。浏览器用系统 Chrome：`playwright.chromium.launch(channel="chrome")`，不另装 Playwright 浏览器。字体文件必须加 loader，否则打包 KaTeX 的 `.woff` 会失败。`chrome.runtime.connect` 必须有桩，否则 `useWebSocket` 抛错，页面只剩「重试」，后面的定位都会超时。

`launch` 和 `ready` 的完整实现：

```python
def build(directory):
    subprocess.run([
        "node", "scripts/render-sidebar-review-fixture.cjs", directory
    ], cwd=root, check=True)

def launch(playwright, path, width, height):
    directory = tempfile.TemporaryDirectory()
    build(directory.name)
    server = subprocess.Popen(["python3", "scripts/serve-sidebar-review.py", directory.name])
    browser = playwright.chromium.launch(channel="chrome", headless=True, args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": width, "height": height})
    page.set_default_timeout(8000)
    page.goto(f"http://127.0.0.1:8766{path}")
    page.wait_for_function("() => window.fixtureState && window.dispatchUI && !document.body.innerText.includes('界面渲染错误')")
    return browser, page, directory, server

def ready(page):
    page.wait_for_function("() => window.fixtureState.connectionState !== undefined")
```

`render-sidebar-review-fixture.cjs` 调用上面的 esbuild，loader 为 `.css=css`、`.woff2=dataurl`、`.woff=dataurl`、`.ttf=dataurl`。入口渲染 `AgentStoreProvider` 和 `App`。`sendMessage` 把参数推进 `window.sent`。若 `type === "config.set"`，只把 `config` 补丁写进 `window.companionStore.config`，不动 `externalKey`。`chrome.runtime.connect` 返回带空 `onMessage` 和 `onDisconnect` 的端口。

`main` 使用文件底部的显式 `TESTS` 列表，不用「至少 12 个」这种从第一天就写死的数字。打印用 `repr`，避免空的 `AssertionError` 让整批中断。

```python
def main():
    failed = 0
    with sync_playwright() as playwright:
        for test in TESTS:
            browser = page = directory = server = None
            try:
                browser, page, directory, server = launch(playwright, *ROUTES[test.__name__])
                ready(page)
                test(page)
            except Exception as exc:
                failed += 1
                print("FAIL", test.__name__, repr(exc)[:400])
            finally:
                if browser: browser.close()
                if server: server.terminate()
                if directory: directory.cleanup()
    print(f"ran={len(TESTS)} failed={failed}")
    if failed or len(TESTS) != len(EXPECTED):
        sys.exit(1)
```

Task 1 的 `TESTS` 只有 `test_section_order`，`EXPECTED` 也只有它，所以当时 `ran=1`。每增加一个测试函数，就同时把它的名字放进 `TESTS` 和 `EXPECTED`。最后一任务的名单见 Task 11，那里才要求全部跑完。命令：`cd chrome-extension && nvm use 22 && uv run --no-project --with playwright python scripts/test-sidebar-review-ui.py`

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

Expected: 退出码 1，`ran=1 failed=1`。失败是找不到「资料与工具」。当前侧栏是四个文字按钮。不是 `NameError`。

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
- Modify: `chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx` 第 44 行和第 84 行的 `matchMedia(RESIDENT_MIN_WIDTH)`，以及 `full === true` 的根节点
- Modify: `chrome-extension/src/sidepanel/components/ProjectNavigationRoot.tsx`
- Modify: `chrome-extension/tests/startup-destination.test.ts`
- Modify: `chrome-extension/scripts/test-sidebar-review-ui.py`
- Test: 上面两个测试文件都要跑

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

Expected: FAIL 在 `sidepanel 760` 和 `workspace 760`。现码返回 `layered`。`popout 959` 现码已经是 `layered`。这只证明纯函数。`WorkspaceFrame` 在 `full === true` 时不渲染 `ProjectNavigationRoot`，页面上没有 `data-navigation-mode`。所以同一任务还要跑下面这些页面函数，并先加一个不改门槛的标记。

先把 `data-navigation-mode` 写到 `full === true` 的 `.cm-workspace-full` 上，值仍来自现在的 `navigationMode`（全是 960）。这一步的页面测试是：`/tabs/workspace.html` 在 960 为 `resident`，在 959 为 `layered`。标记不存在时这条失败。标记加上之后它会通过，并且工作区在 760 仍是 `layered`。然后再把断言改成下面的新门槛，这时 760 才是行为红灯。

```python
def test_widths(page):
    pass

def test_sidepanel_759(page):
    assert page.locator("[data-navigation-mode]").get_attribute("data-navigation-mode") == "layered"

def test_sidepanel_760(page):
    assert page.locator("[data-navigation-mode]").get_attribute("data-navigation-mode") == "resident"

def test_workspace_759(page):
    assert page.locator(".cm-workspace-full").get_attribute("data-navigation-mode") == "layered"

def test_workspace_760(page):
    assert page.locator(".cm-workspace-full").get_attribute("data-navigation-mode") == "resident"

def test_popout_959(page):
    assert page.locator("[data-navigation-mode]").get_attribute("data-navigation-mode") == "layered"

def test_popout_960(page):
    assert page.locator("[data-navigation-mode]").get_attribute("data-navigation-mode") == "resident"
```

`ROUTES` 把这些函数分别开到 `/sidepanel.html` 759 或 760、`/tabs/workspace.html` 759 或 760、`/popout.html?surface=popout` 959 或 960。通过命令是节点测试和 `uv run --no-project --with playwright python scripts/test-sidebar-review-ui.py` 一起跑。只跑节点测试不算通过。

- [ ] **Step 3: Write minimal implementation**

`navigationMode` 内部按 surface 选择 760 或 960。`WorkspaceFrame` 第 44 行和第 84 行的 `matchMedia` 使用同一选择，不再写死 `RESIDENT_MIN_WIDTH`。`full === true` 的根节点使用这个结果。`ProjectNavigationRoot` 继续传入真实 `surface`。

- [ ] **Step 4: Run test to verify it passes**

两条命令都 PASS。`popout` 在 959 仍是 `layered`。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/navigation/navigation-mode.ts chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx chrome-extension/src/sidepanel/components/ProjectNavigationRoot.tsx chrome-extension/tests/startup-destination.test.ts chrome-extension/scripts/test-sidebar-review-ui.py
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
    page.evaluate("""() => {
      window.dispatchUI({type:'SET_CONNECTION', state:'connected'})
      window.dispatchUI({type:'SET_THREADS', threads:[{id:'weekend', alias:'示例·周末清单', created_at:'t', updated_at:'t', config_override:{}, tool_whitelist:null, pinned_tabs:[], active_skill_ids:[]}]})
      window.dispatchUI({type:'SET_ACTIVE_THREAD', threadId:'weekend'})
      window.dispatchUI({type:'NAVIGATE', layer:'session', projectId:null})
    }""")
    assert page.evaluate("window.fixtureState.navigationLayer") == "session"
    assert page.get_by_text("更改当前会话归属").count() == 0
    assert page.get_by_text("执行状态：").count() == 0
```

必须先进入 `session` 层。停在项目首页时，这两句不在可见文本里，测试会误绿。进入会话层后，现码里「更改当前会话归属」的 `count()` 是 1。

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
    page.evaluate("() => window.dispatchUI({type:'SET_CONNECTION', state:'connected'})")
    page.evaluate("() => window.dispatchUI({type:'SET_ACTIVE_THREAD', threadId:null})")
    box = page.get_by_role("textbox", name="消息内容")
    assert box.is_enabled()
    box.fill("第一句")
    send = page.get_by_role("button", name="发送", exact=True)
    send.click()
    send.click()
    assert page.evaluate("window.sent.filter(m => m.type==='thread.create').length") == 1
    assert box.input_value() == "第一句"
    page.get_by_role("button", name="开始第一则对话").click()
    assert page.evaluate("window.sent.filter(m => m.type==='thread.create').length") == 1
```

`canSend` 要求已连接并且已有 `activeThreadId`。没有连接时按钮标题是「请先创建线程」，输入框禁用。测试必须先 `SET_CONNECTION` 为 `connected`。第一条会红的行为断言是 `box.is_enabled()`，现码为假，占位仍是「请先创建或选择一个线程」。不要去点一个还不存在的「发送」来制造超时。实现之后，发送和「开始第一则对话」在 `thread.created` 到来前一共只留下一条 `thread.create`，原文仍在输入框。

- [ ] **Step 2: Run test to verify it fails**

Expected: 退出码非 0。`assert box.is_enabled()` 失败。

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
    page.evaluate("() => window.dispatchUI({type:'SET_CONNECTION', state:'connected'})")
    page.get_by_text("项目", exact=True).click()
    page.wait_for_function("window.sent.some(m => m.type==='project.list')")
    msg = page.evaluate("() => window.sent.find(m => m.type==='project.list')")
    page.evaluate("(m) => window.emitRuntime({type:'project.error', id:m.id, error:'list failed'})", msg)
    assert page.get_by_role("button", name="重试").count() == 1
    before = page.evaluate("window.sent.filter(m => m.type==='project.list').length")
    page.get_by_role("button", name="重试").click()
    after = page.evaluate("window.sent.filter(m => m.type==='project.list').length")
    assert after == before + 1
```

必须先 `SET_CONNECTION` 为 `connected`。断开时 `ProjectPanel` 的 phase 是 `offline`，不是 `list-error`。打开项目会发 `project.list`，测试再回 `project.error`，这才进入无快照失败态。`count()` 不等待，现码是 0，所以红灯不是超时。实现后点击必须使 `project.list` 增加 1。

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
    page.get_by_role("button", name="设置", exact=True).click()
    assert page.get_by_text("模型名称").count() >= 1
    assert page.get_by_text("外部转写已配置").count() == 1
    assert secret not in page.locator("body").inner_text()
    values = page.locator("input").evaluate_all("els => els.map(el => el.value)")
    assert secret not in values
    page.get_by_role("button", name="保存并关闭", exact=True).click()
    sent = page.evaluate("() => window.sent.filter(m => m.type==='config.set')")
    assert secret not in JSON.stringify(sent)
    assert page.evaluate("window.companionStore.externalKey") == secret
```

`get_by_role("button", name="设置")` 会同时命中侧栏「设置」和「更多工具与设置」，必须 `exact=True`。保存按钮的文字是「保存并关闭」。`sendMessage` 收到 `config.set` 时只合并 `config` 补丁，不改 `externalKey`。若补丁里出现密钥，上面的 `JSON.stringify` 断言失败。

```python
def test_unconfigured_models_open_from_other(page):
    page.evaluate("() => window.dispatchUI({type:'SET_CONNECTION', state:'connected'})")
    page.get_by_role("button", name="设置", exact=True).click()
    assert page.get_by_text("视觉模型（看图描述）").count() == 0
    page.get_by_role("button", name="其他能力").click()
    assert page.get_by_text("视觉模型（看图描述）").count() == 1
```

这个函数从 Task 10 起就在 `TESTS` 里。第一条会红的断言是视觉模型区块现在就能看见，所以 `count()` 不是 0。不要把找不到「其他能力」的超时当作红灯。

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

`TESTS` 在这一任务必须正好包含这些名字，每个都先操作、再断言、再截图：`test_sidepanel_759`、`test_sidepanel_760`、`test_workspace_759`、`test_workspace_760`、`test_popout_959`、`test_popout_960`、`test_escape_returns_to_nav`、`test_close_returns_to_nav`、`test_hover_row`、`test_selected_row_has_no_outline`、`test_keyboard_focus_outline`、`test_long_name_title`、`test_empty_start`、`test_list_error_retry`、`test_extract_progress`。`ran` 等于这份名单的长度。少一个就退出码非 0，不能申请 final gate。

```python
def test_close_returns_to_nav(page):
    page.set_viewport_size({"width": 420, "height": 860})
    page.get_by_role("button", name="打开工作区导航").click()
    assert page.get_by_role("button", name="关闭导航").count() == 1
    page.get_by_role("button", name="关闭导航").click()
    assert page.evaluate("document.activeElement.getAttribute('aria-label')") == "打开工作区导航"
    page.screenshot(path="/tmp/sidebar-review/420-close.png")
```

现码没有「关闭导航」，所以 `count()` 先得到 0。这是立即失败，不是点击超时。

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

然后跑下面的场景矩阵，再跑仓库四条 workflow。十个 CI 检查、Playwright 和场景报告都在同一 head 上成立，才能申请 final gate。任一失败就停。截图文件存在但断言没跑，`ran` 对不上，也算失败。场景行标成通过但没有实际输出和证据路径，也算失败。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/scripts/test-sidebar-review-ui.py
git commit -m "test: assert each sidebar screenshot before saving it"
```

停。等独立 final gate。写计划的人不能把这一步标成已通过。

## 最终验收：场景演示矩阵

这一节属于 Task 11 的同一 head。规格第 5 节是行为合同，这里是可执行步骤。节点 0 的每一行结果都是未测。实现时把报告写到 `/tmp/sidebar-scenarios/<40位 sha>/report.md`，截图和录屏放在同一目录。不要改写本节的「节点 0」行来充当通过。

报告每行包含：场景、层、步骤、预期、实际、截图或录屏、环境、commit、证据路径、结果。结果只写通过、失败或未测。失败先修，独立评审后换新 head 重跑整张表。夹具结果不能填进 Companion 行。临时目录里连不上模型，不能填进外部服务行。

### 隔离

```bash
LIVE="${HOME}/.cmspark-agent/config.json"
BEFORE=$(stat -c %Y "$LIVE" 2>/dev/null || echo missing)
DIR=$(mktemp -d /tmp/cmspark-scenario.XXXXXX)
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
```

把 `config.json` 写进 `$DIR`，`port` 用 `$PORT`，`llm.base_url` 用 `http://127.0.0.1:9/v1`，`llm.api_key` 用 `fixture-not-a-real-key`，`llm.model_name` 用 `fixture-model`。然后 `CMSPARK_DATA_DIR="$DIR" node companion/dist/index.js`。结束后再 `stat` 一次 `$LIVE`，mtime 必须等于 `$BEFORE`。进程监听的必须是 `$PORT`，不是 23401。删掉 `$DIR`。不向 23401 上已有的进程发消息。

夹具层继续用 Task 1 的 `launch` / `ready`。面板发出的是 `chrome.runtime.sendMessage` 的类型，例如 `chat.send`、`thread.create`。Companion 层看到的是后台翻译后的类型，例如 `chat.create`。两层的证据分开写。

### 三层

| 层 | 证据 | 不能写成 |
| --- | --- | --- |
| 真实组件夹具 | Playwright、`window.sent`、断言之后的截图 | Companion 已落盘，或模型已回复 |
| 真实 Companion | 临时目录里的线程文件、`thread.list`、配置 mtime、监听端口 | 外部供应商已接受请求 |
| 真实外部服务或本机环境 | 隔离密钥的供应商响应、已安装扩展的重开、Mac 或 Windows | 本环境没有这些前置，默认未测 |

### 明确不做

不点「永久删除」和「清空回收站」。不点知识图谱的「重新整理」。不勾选「本线程内自动批准同类」。不打开「自动批准所有危险操作」。不发送 `evaluate` 或 `navigate` 到真实页面。不发邮件、外部聊天或外部 MCP 写入。不优化 Linux 专项或本地 ASR。不改版本，不打 tag。

### S1 首次配置、新建发送、重开恢复

| 层 | 步骤 | 预期 | 节点 0 |
| --- | --- | --- | --- |
| 夹具 | 已连接，线程列表为空。输入「验收隔离句」。点「开始第一则对话」，再点一次发送 | `window.sent` 里只有一条 `thread.create`。没注入 `thread.created` 前，原文仍在输入框。注入创建结果后，把 `cmspark.navigation.lastThreadId` 设成该 id 并重载，活动对话就是它 | 未测。实现尚未开始 |
| Companion | 对临时进程发送 `config.set` 只改主模型字段，再 `thread.create`，写入用户原文的 `chat.create`，停进程，用同一 `CMSPARK_DATA_DIR` 再启动，发 `thread.list` | 临时 `config.json` 有新的模型名，假密钥仍在。线程文件含「验收隔离句」。重启后列表仍有该 id。出站只可能打到 `127.0.0.1:9`，并且失败。live mtime 不变 | 未测。节点 0 不启动进程 |
| 外部或本机 | 用隔离密钥让同一句拿到供应商正文；把扩展装进独立 Chrome 配置，关上侧栏再打开 | 只有真实响应正文和安装后的重开录像可以标通过 | 未测。没有隔离密钥，也没有装进 Chrome 用户配置的扩展 |

### S2 项目创建、选择、切换和草稿

| 层 | 步骤 | 预期 | 节点 0 |
| --- | --- | --- | --- |
| 夹具 | 在项目节输入名称并点「创建项目」。选中该项目。在对话 A 输入未发送文字，切到 B，再切回 A | 发出 `project.create`。最近对话只显示该项目的。B 的输入框是空的，A 的原文还在。改名和归档按钮仍在 | 未测 |
| Companion | 用临时进程执行 `project.create`、`project.rename`、`project.archive`，再 `project.list` | 临时目录里的项目记录跟上这三次操作。live 目录不变。草稿隔离不在这一层重复声称通过 | 未测 |
| 外部或本机 | 无外部服务 | 不适用，报告写未测并注明没有外部依赖 | 未测 |

### S3 历史搜索、分组、提取取消、提取结果、回收站

| 层 | 步骤 | 预期 | 节点 0 |
| --- | --- | --- | --- |
| 夹具 | 点「管理对话」。在可访问名「搜索线程」里输入标题片段。依次点时间、标签、手动分组、AI 分组。点「AI 提取标签」，在确认里点「取消」。另一次确认后，注入进度。对夹具对话点删除，先点取消，再确认移入回收站，然后恢复 | 对话框名是「对话管理」。搜索只留下匹配行。取消后 `window.sent` 没有 `thread.extract_digest`。进度文本匹配 `提取要点 1/20`。取消删除不发送 `thread.batch_delete`。确认后的消息是 `thread.batch_delete` 且 `mode` 为 `trash`。恢复发送 `thread.restore`。不出现「永久删除」的点击 | 未测。夹具标签不算模型结果 |
| Companion | 临时进程只跑取消路径和一条夹具对话的 trash 再 restore | 消息日志没有 `thread.extract_digest`。临时线程先进入回收站再回到列表。不对 live 历史发 `thread.batch_delete`。不发 `mode: "hard"`，不点「清空回收站」 | 未测 |
| 外部或本机 | 真实「AI 提取标签」要等模型写回要点 | 没有隔离密钥就保持未测。夹具进度不能挪到这一行 | 未测。没有隔离密钥 |

### S4 会话关系图和分布图谱

| 层 | 步骤 | 预期 | 节点 0 |
| --- | --- | --- | --- |
| 夹具 | 点「关系图谱」。在图页点「打开会话」。从知识面板点「分布图谱」。再点工具格「历史」 | `thread_graph.open` 的载荷是对话，不是知识文档。`thread_graph.open_thread` 之后图页仍在。`knowledge_graph.open` 不从对话管理进入。历史面板空文案是「暂无操作历史」 | 未测 |
| Companion | 临时进程提供这两张图的现有读取。不点「重新整理」 | 图数据只含临时目录里的对话或知识文档。没有模型整理请求 | 未测 |
| 外部或本机 | 「重新整理」会调用模型 | 不点击。没有密钥就写未测 | 未测 |

### S5 设置减法、主模型和已配置外部语音

| 层 | 步骤 | 预期 | 节点 0 |
| --- | --- | --- | --- |
| 夹具 | 打开设置。看主路径。打开「其他能力」。给内存状态设 `voiceModel.external.keyConfigured === true`，打开语音页。点「保存并关闭」 | 主路径有「服务地址（Base URL）」「模型名称」「API Key」，没有「视觉模型（看图描述）」。其他能力里能看见视觉模型。语音页有「外部转写已配置」。`config.set` 不含 `externalKey`，内存里的 `externalKey` 仍是原值 | 未测。源码里现有的句子是「外部转写已启用」，「外部转写已配置」和「其他能力」还没有 |
| Companion | 临时 `config.json` 预先写入外部转写密钥。只保存主模型字段 | 磁盘上的外部密钥字节不变。live `config.json` 的 mtime 不变。不发起转写 HTTP | 未测 |
| 外部或本机 | 真实外部转写一次，或 Mac / Windows 系统语音 | 没有密钥和对应系统就未测。不把本地 ASR 优化加进本计划 | 未测。没有隔离密钥，也没有 Mac / Windows |

### S6 工具确认的允许和拒绝

| 层 | 步骤 | 预期 | 节点 0 |
| --- | --- | --- | --- |
| 夹具 | 注入 `security.confirmation.request`，`tool_name` 为 `evaluate`。点「拒绝」。再注入一条，按 Esc | 两次都发出 `security.confirmation.response`，批准为假。`window.sent` 没有执行该工具的消息。不勾选自动批准同类 | 未测 |
| Companion | 临时进程发出同一条确认。只走拒绝 | 队列清空，临时日志没有这次 `evaluate` 的执行。不连接用户浏览器 | 未测 |
| 外部或本机 | 点「允许」只有在该工具不出网、不写 live 目录时才执行 | `evaluate` 和 `navigate` 不满足这条，允许路径写未测。不打开确认台批准真实页面 | 未测。允许路径没有无副作用的常用工具可跑 |

### S7 窄屏、宽屏和键盘

| 层 | 步骤 | 预期 | 节点 0 |
| --- | --- | --- | --- |
| 夹具 | 420 宽点「打开工作区导航」，Tab 进导航，按 Esc。再打开并点「关闭导航」。分别量 759、760、959、960 | Esc 和关闭后，`document.activeElement` 的可访问名是「打开工作区导航」。sidepanel 与 workspace 在 759 为 layered、760 为 resident，栏宽 220。popout 在 959 为 layered、960 为 resident。键盘焦点的轮廓是 `solid` / `rgb(79, 70, 229)` | 未测。截图断言仍以 Task 11 的函数名单为准 |
| Companion | 纯界面 | 不适用，写未测并注明没有服务端行为 | 未测 |
| 外部或本机 | 在 Mac 上看苹方或 SF，并在已安装扩展里重复 Tab | 本环境字体是 fallback。没有 Mac 安装就未测 | 未测。没有 Mac |

### S8 断连和失败重试

| 层 | 步骤 | 预期 | 节点 0 |
| --- | --- | --- | --- |
| 夹具 | 把连接设为 `disconnected`。点「重新连接」。把项目阶段设为 `list-error` 且没有快照，点「重试」。断连时点「保存并关闭」 | 横幅标题是「Companion 未连接」。点击发出 `ws.forceReconnect`。重试后多一条 `project.list`，没有「还没有项目」。保存出现「尚未连接到 Companion，这次设置没有发送」 | 未测 |
| Companion | 停掉临时进程，再以同一 `CMSPARK_DATA_DIR` 启动。客户端重连后发 `thread.list` | 只动 `$PORT` 上的临时进程。重连后列表仍是临时线程。23401 无新连接。live mtime 不变 | 未测 |
| 外部或本机 | 「查看日志」走原生宿主打开目录 | 没有原生宿主时，夹具只断言提示「请手动打开日志目录：~/.cmspark-agent/logs/」。Mac / Windows 原生打开写未测 | 未测。没有 Mac / Windows 原生宿主 |

### 节点 0 核对

核对基线是写入本节之前的 `f0b5b09652d8aedf0e301a8318ed9fe489418f6d`。只读了源码，没有启动 Companion，没有读取或修改 live 配置，没有发外部请求。

源码里已经有的名字：`打开工作区导航`、`关闭导航`、`保存并关闭`、`服务地址（Base URL）`、`模型名称`、`API Key`、`视觉模型（看图描述）`、`外部转写`、`外部转写已启用`、`Companion 未连接`、`重新连接`、`尚未连接到 Companion，这次设置没有发送`、`创建项目`、`新项目名称`、`管理对话`、`对话管理`、`搜索线程`、`时间`、`标签`、`手动分组`、`AI 分组`、`AI 提取标签`、`关系图谱`、`会话关系图`、`回收站`、`移入回收站`、`分布图谱`、`重新整理`、`允许`、`拒绝`、`暂无操作历史`。消息名：`thread.create`、`chat.send`、后台的 `chat.create`、`project.create`、`thread.extract_digest`、`thread.batch_delete`、`thread.restore`、`thread_graph.open`、`thread_graph.open_thread`、`knowledge_graph.open`、`security.confirmation.response`、`ws.forceReconnect`、`cmspark.navigation.lastThreadId`。

还没有的规格文案：`开始第一则对话`、`外部转写已配置`、`其他能力`。所以 S1 和 S5 即使对着当前界面跑，也不能标通过。

### 同一 head 的其余门禁

场景报告之外，仍要跑：

```bash
cd chrome-extension && nvm use 22
uv run --no-project --with playwright python scripts/test-sidebar-review-ui.py
npx tsc -p tsconfig.test.json --pretty false
node --test .test-dist/tests/startup-destination.test.js .test-dist/tests/project-list-retry.test.js .test-dist/tests/history-entry-scopes.test.js
cd .. && npm --prefix chrome-extension test && npm --prefix companion test
```

四条 pull_request workflow：CI、ARM acceptance、Linux integration ARM、Session save recovery。十个检查：`build`、`smoke (ubuntu-latest)`、`smoke (macos-latest)`、`smoke (windows-latest)`、`smoke (windows-native)`、`activity (Linux X11 native)`、`acp-history-restart`、`Affected CPU controls (Linux ARM64)`、`Linux integration controls (ARM64)`、`Windows session persistence`。不手动触发 Release 或 Build installers。

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
| 八个使用场景、三层证据、隔离临时目录 | 最终验收矩阵 |
| 四条 workflow、十个 CI、final gate | Task 11 与最终验收矩阵 |

## 自审

- 界面测试都从 `test_*` 进入 `main`，`ran` 至少 12，失败退出码非 0。
- 门槛测试只调用已有的 `navigationMode`。红灯是 760 仍为 layered。
- 重试的节点测试不传尚不存在的 prop。点击后的 `project.list` 条数是第二条断言。
- 焦点断言使用「打开工作区导航」和 `focus({ focusVisible: true })`。
- 场景矩阵的按钮和消息名能在当前源码或规格里找到。规格新增的三句不写成已经存在。
- 节点 0 的每一行都是未测。文档提交不是 final gate。
