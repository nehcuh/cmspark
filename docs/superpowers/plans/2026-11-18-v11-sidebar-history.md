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

`App` 自己会再挂一个 `AgentStoreProvider`。夹具若在外面再包一层，`window.dispatchUI` 改的是外层，输入框仍停在内层。2026-11-18 的演练里，外层已经是 `activeThreadId=weekend` 且 `connected`，内层输入框仍是 `disabled`，占位仍是「请先创建或选择一个线程」。`dispatchUI` 必须来自 `App` 内部那个 provider。`getStatus` 的回调要返回 `{ connectionState: window.__connection }`。轮询约每 3 秒覆盖一次 store；测试在改连接时同时改 `window.__connection`，否则输入框会被刷回断开。`sendMessage` 把消息推进 `window.sent`，并用 `window.emitRuntime` 通知 `chrome.runtime.onMessage` 的监听者。`project.list` 不自动回答。

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

def set_connection(page, state):
    page.evaluate("""(state) => {
      window.__connection = state
      window.dispatchUI({type:'SET_CONNECTION', state: state})
    }""", state)
    page.wait_for_function(
        "(state) => window.fixtureState.connectionState === state && window.__connection === state",
        arg=state,
    )

def shot(page, name):
    page.screenshot(path="/tmp/sidebar-review/" + name + ".png")
```

改连接只调用 `set_connection`。它同时写 `window.__connection` 和 store。夹具里不允许再出现单独的 `SET_CONNECTION`。`getStatus` 每 3 秒用 `__connection` 覆盖 store；只改 store 会在下一轮被刷回断开。`test_connection_survives_poll` 在写入后等待 3500 毫秒，两端仍是同一个值才算锁住。

`render-sidebar-review-fixture.cjs` 调用上面的 esbuild，loader 为 `.css=css`、`.woff2=dataurl`、`.woff=dataurl`、`.ttf=dataurl`。入口只渲染 `App`。在 `AgentStoreProvider` 内部把当前 `state` 和 `dispatch` 赋给 `window.fixtureState` 与 `window.dispatchUI`。`sendMessage` 把参数推进 `window.sent`。`getStatus` 回 `{ connectionState: window.__connection || "disconnected" }`。其它消息回 `{ ok: true }`。若 `type === "config.set"`，只把 `config` 补丁写进 `window.companionStore.config`，不动 `externalKey`。`window.emitRuntime` 调用每个 `onMessage` 监听者。`chrome.runtime.connect` 返回带空 `onMessage` 和 `onDisconnect` 的端口。`main` 用 `repr(exc)` 打印失败。空的 `AssertionError` 没有第一行，不能用 `str(exc).splitlines()[0]`。

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

Expected: FAIL 在 `sidepanel 760` 和 `workspace 760`。现码返回 `layered`。`popout 959` 现码已经是 `layered`。这只证明纯函数。

页面实测：`/sidepanel.html` 在 759 的 `data-navigation-mode` 是 `layered`，在 960 是 `resident`。`/popout.html?surface=popout` 在 959 是 `layered`，在 960 是 `resident`。`/tabs/workspace.html` 有 `.cm-workspace-full`，759 和 960 上都没有 `data-navigation-mode`，`get_attribute` 得到 `None`。定位器存在，所以失败是 `None != "layered"`，不是超时。

先把 `data-navigation-mode` 写到 `.cm-workspace-full` 上，值仍来自现在的 `navigationMode`（960）。标记不存在时，下面两个工作区断言失败，实际值是 `None`。标记加上之后，960 会通过，760 仍是 `layered`。再改门槛，760 才变成 `resident`。

```python
def test_sidepanel_759(page):
    page.set_viewport_size({"width": 759, "height": 860})
    actual = page.locator("[data-navigation-mode]").get_attribute("data-navigation-mode")
    assert actual == "layered", actual
    shot(page, "sidepanel-759")

def test_sidepanel_760(page):
    page.set_viewport_size({"width": 760, "height": 860})
    actual = page.locator("[data-navigation-mode]").get_attribute("data-navigation-mode")
    assert actual == "resident", actual
    box = page.locator("nav.cm-navigation").bounding_box()
    assert abs(box["width"] - 220) <= 1, box["width"]
    shot(page, "sidepanel-760")

def test_workspace_759(page):
    page.set_viewport_size({"width": 759, "height": 860})
    assert page.locator(".cm-workspace-full").count() == 1
    actual = page.locator(".cm-workspace-full").get_attribute("data-navigation-mode")
    assert actual == "layered", actual
    shot(page, "workspace-759")

def test_workspace_760(page):
    page.set_viewport_size({"width": 760, "height": 860})
    assert page.locator(".cm-workspace-full").count() == 1
    actual = page.locator(".cm-workspace-full").get_attribute("data-navigation-mode")
    assert actual == "resident", actual
    box = page.locator("nav.cm-navigation").bounding_box()
    assert abs(box["width"] - 220) <= 1, box["width"]
    shot(page, "workspace-760")

def test_popout_959(page):
    page.set_viewport_size({"width": 959, "height": 860})
    actual = page.locator("[data-navigation-mode]").get_attribute("data-navigation-mode")
    assert actual == "layered", actual
    shot(page, "popout-959")

def test_popout_960(page):
    page.set_viewport_size({"width": 960, "height": 860})
    actual = page.locator("[data-navigation-mode]").get_attribute("data-navigation-mode")
    assert actual == "resident", actual
    shot(page, "popout-960")
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
def seed_connected(page):
    set_connection(page, "connected")
    page.evaluate("""() => {
      window.dispatchUI({type:'SET_THREADS', threads:[
        {id:'weekend', alias:'示例·周末清单', created_at:'2026-11-18T00:00:00.000Z', updated_at:'2026-11-18T00:00:00.000Z', config_override:{}, tool_whitelist:null, pinned_tabs:[], active_skill_ids:[], message_count:1},
        {id:'shop', alias:'示例·采购', created_at:'2026-11-18T00:00:00.000Z', updated_at:'2026-11-18T00:00:00.000Z', config_override:{}, tool_whitelist:null, pinned_tabs:[], active_skill_ids:[], message_count:1}
      ]})
      window.dispatchUI({type:'SET_ACTIVE_THREAD', threadId:'weekend'})
      window.dispatchUI({type:'NAVIGATE', layer:'session', projectId:null})
    }""")

def test_connection_survives_poll(page):
    set_connection(page, "connected")
    page.wait_for_timeout(3500)
    assert page.evaluate("window.fixtureState.connectionState") == "connected"
    assert page.evaluate("window.__connection") == "connected"

def test_disconnect_disables_the_composer(page):
    seed_connected(page)
    box = page.get_by_role("textbox", name="消息内容")
    assert box.is_enabled()
    set_connection(page, "disconnected")
    assert box.is_disabled()
    assert box.get_attribute("placeholder") == "等待 companion 连接..."

def test_draft_follows_active_thread(page):
    seed_connected(page)
    box = page.get_by_role("textbox", name="消息内容")
    assert box.is_enabled()
    box.fill("记得买水果")
    page.evaluate("() => window.dispatchUI({type:'SET_ACTIVE_THREAD', threadId:'shop'})")
    assert box.input_value() == ""
    page.evaluate("() => window.dispatchUI({type:'SET_ACTIVE_THREAD', threadId:'weekend'})")
    assert box.input_value() == "记得买水果"
```

没有活动对话时，占位先是「请先创建或选择一个线程」，输入框禁用。断连但活动对话还在时，占位是「等待 companion 连接...」，输入框同样禁用。`test_disconnect_disables_the_composer` 对现码通过，它是锁，不是本任务的红灯。红灯是 `test_draft_follows_active_thread`。填字前必须先 `assert box.is_enabled()`。禁用时去 `fill` 会超时，那个超时不算草稿串了。

- [ ] **Step 2: Run test to verify it fails**

Expected: `test_disconnect_disables_the_composer` 通过。`test_draft_follows_active_thread` 退出码非 0。切到 `shop` 后输入框仍是「记得买水果」。

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
    set_connection(page, "connected")
    page.evaluate("""() => {
      window.dispatchUI({type:'SET_THREADS', threads:[{id:'weekend', alias:'示例·周末清单', created_at:'2026-11-18T00:00:00.000Z', updated_at:'2026-11-18T00:00:00.000Z', config_override:{}, tool_whitelist:null, pinned_tabs:[], active_skill_ids:[], message_count:1}]})
      window.dispatchUI({type:'SET_ACTIVE_THREAD', threadId:'weekend'})
      window.dispatchUI({type:'NAVIGATE', layer:'session', projectId:null})
    }""")
    assert page.evaluate("window.fixtureState.navigationLayer") == "session"
    assert page.locator("fieldset:visible", has_text="更改当前会话归属").count() == 0
    assert page.locator("header[aria-label='会话位置']:visible").get_by_text("执行状态：").count() == 0
```

会话层不用 `hidden` 卸掉，只是藏起来。`get_by_text` 会数到隐藏节点，停在项目首页也会得到 1，不能拿那个数当红灯，也不能拿它当通过。必须先进入 `session`，再用 `:visible`。现码进入会话层后，可见的「更改当前会话归属」是 1，可见的「执行状态：」也是 1。

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
    set_connection(page, "connected")
    page.locator("details.cm-projects > summary").click()
    page.wait_for_function("window.sent.some(m => m.type==='project.list')")
    msg = page.evaluate("() => window.sent.find(m => m.type==='project.list')")
    page.evaluate("""(m) => window.emitRuntime({
      type:'project.state', id:m.id, revision:1,
      projects:[{id:'11111111-1111-4111-8111-111111111111', name:'验收项目', created_at:'2026-11-18T00:00:00.000Z', updated_at:'2026-11-18T00:00:00.000Z', archived_at:null}]
    })""", msg)
    created = page.locator("details.cm-projects button", has_text="创建项目").count()
    assert created == 1, created
    page.locator("details.cm-projects button", has_text="验收项目").click()
    renamed = page.locator("details.cm-projects button", has_text="改名").count()
    archived = page.locator("details.cm-projects button", has_text="归档项目").count()
    assert renamed == 1, renamed
    assert archived == 1, archived
```

导航里的「项目」和 `<summary>项目</summary>` 是两个节点。`get_by_text("项目", exact=True).click()` 会因 strict mode 直接抛错，那不是按钮缺失。打开的是 `details.cm-projects`。项目 id 必须通过 `project-request.ts` 的 UUID 校验。「创建项目」在「新建项目」里，外层展开后就在 DOM 中，不必再点内层 summary。未选中项目时，「改名」和「归档项目」不渲染。选中「验收项目」后它们进入 DOM。不要点「管理项目」的 summary，未展开时它不可见，点击会超时。

- [ ] **Step 2: Run test to verify it fails**

Expected: 三颗按钮都在 `details.cm-projects` 里时 PASS，并写明这是现存锁。少一颗时失败值是 0。用 DOM 定位，不用 `get_by_role`：内层 `details` 合上时，角色查询数不到里面的按钮。不得删按钮来制造红灯。

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
    set_connection(page, "connected")
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

`canSend` 要求已连接并且已有 `activeThreadId`。连接只能经 `set_connection` 写入。没有活动对话时占位是「请先创建或选择一个线程」，输入框禁用。第一条会红的行为断言是 `box.is_enabled()`，现码为假。不要去点一个还不存在的「发送」来制造超时。实现之后，发送和「开始第一则对话」在 `thread.created` 到来前一共只留下一条 `thread.create`，原文仍在输入框。

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
def test_list_error_retry(page):
    set_connection(page, "connected")
    page.locator("details.cm-projects > summary").click()
    page.wait_for_function("window.sent.some(m => m.type==='project.list')")
    msg = page.evaluate("() => window.sent.find(m => m.type==='project.list')")
    page.evaluate("(m) => window.emitRuntime({type:'project.error', id:m.id, error:'list failed'})", msg)
    retry = page.get_by_role("button", name="重试", exact=True)
    found = retry.count()
    assert found == 1, found
    before = page.evaluate("window.sent.filter(m => m.type==='project.list').length")
    assert before >= 1
    retry.click()
    after = page.evaluate("window.sent.filter(m => m.type==='project.list').length")
    assert after == before + 1
    assert page.get_by_text("还没有项目").count() == 0
    shot(page, "list-error-retry")
```

连接只能经 `set_connection` 写入。断开时 `ProjectPanel` 的 phase 是 `offline`，不是 `list-error`。打开的是 `details.cm-projects`，不是含糊的「项目」文本，否则会同时命中导航按钮和 summary。打开后会发 `project.list`，测试再回 `project.error`，这才进入无快照失败态。`count()` 不等待，现码是 0，所以红灯不是超时。`before >= 1` 防止还没发出列表请求就把空数组当成重试成功。实现后点击必须使 `project.list` 增加 1。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && npx tsc -p tsconfig.test.json --pretty false && node --test .test-dist/tests/project-list-retry.test.js`

Expected: 编译通过，断言 `/重试/` 失败。

- [ ] **Step 3: Write minimal implementation**

给 `ProjectListView` 增加可选 `onRetry`。无快照的失败态渲染按钮并调用它。`ProjectPanel` 传入已有的 `refresh`。

- [ ] **Step 4: Run test to verify it passes**

节点测试 PASS。再跑 Playwright，`test_list_error_retry` PASS。

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

目标回归只认侧栏 `nav.cm-navigation` 里的「管理对话」。2026-11-18 探针在 `/sidepanel.html` 上数到 0，那是这条断言今天会红的原因，不是一条要求永远为 0 的锁。顶栏「对话管理（历史对话）」和工作区里已有的「管理对话」都不能代替侧栏。

```python
def test_cancel_extract_sends_nothing(page):
    set_connection(page, "connected")
    page.evaluate("""() => {
      window.dispatchUI({type:'SET_THREADS', threads:[{id:'weekend', alias:'示例·周末清单', created_at:'2026-11-18T00:00:00.000Z', updated_at:'2026-11-18T00:00:00.000Z', config_override:{}, tool_whitelist:null, pinned_tabs:[], active_skill_ids:[], message_count:1}]})
      window.dispatchUI({type:'SET_ACTIVE_THREAD', threadId:'weekend'})
    }""")
    manage = page.locator("nav.cm-navigation").get_by_role("button", name="管理对话", exact=True)
    assert manage.count() == 1
    manage.click()
    extract = page.get_by_role("button", name="AI 提取标签", exact=True)
    assert extract.is_enabled()
    extract.click()
    cancel = page.get_by_role("button", name="取消", exact=True)
    assert cancel.count() == 1
    cancel.click()
    assert page.evaluate("window.sent.filter(m => m.type==='thread.extract_digest').length") == 0
```

`ROUTES` 把这个函数开到 `/sidepanel.html`。

- [ ] **Step 2: Run test to verify it fails**

Expected: 失败在 `manage.count() == 1`，现码是 0。侧栏入口加上之后，下一条红灯才是确认按钮「取消」的 `count()` 为 0，并且点击提取已经发出 `thread.extract_digest`。不要把 `count()` 换成一次会等待的点击。

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

- [ ] **Step 1: Write the failing test**

两条都走 `/sidepanel.html` 的 `nav.cm-navigation`。2026-11-18 在工作区点到过「关系图谱」「历史」「分布图谱」，那只说明这些面板现在挂在宽工作区，不能把工作区入口写成侧栏回归通过。

```python
def test_thread_graph_is_not_knowledge_graph(page):
    manage = page.locator("nav.cm-navigation").get_by_role("button", name="管理对话", exact=True)
    assert manage.count() == 1
    manage.click()
    graph = page.get_by_role("button", name="关系图谱", exact=True)
    assert graph.count() == 1
    graph.click()
    kinds = page.evaluate("window.sent.map(m => m.type)")
    assert "thread_graph.open" in kinds
    assert "knowledge_graph.open" not in kinds

def test_history_panel_is_not_the_thread_manager(page):
    history = page.locator("nav.cm-navigation").get_by_role("button", name="历史", exact=True)
    assert history.count() == 1
    history.click()
    assert page.get_by_text("暂无操作历史").count() == 1
    assert page.get_by_text("AI 提取标签").count() == 0
    knowledge = page.locator("nav.cm-navigation").get_by_role("button", name="知识", exact=True)
    assert knowledge.count() == 1
    knowledge.click()
    assert page.get_by_role("button", name="分布图谱").count() == 1
```

`ROUTES` 把这两个函数开到 `/sidepanel.html`，视口 960×860。现码红灯是侧栏里「管理对话」或「历史」的 `count()` 为 0。不要导入一个未导出的 `HistoryPanel`，缺导出会在编译期失败，不是行为红灯。

- [ ] **Step 2: Run test to verify it fails**

Expected: 失败在侧栏按钮 `count() == 1`，实际是 0。侧栏入口出现之后，若「历史」里出现「AI 提取标签」，或关系图谱发出 `knowledge_graph.open`，仍然 FAIL。

- [ ] **Step 3: Write minimal implementation**

聊天档工具格使用 `contextBarTabsForLevel("chat")`。不改两张图的消息类型。

- [ ] **Step 4: Run test to verify it passes**

两条都 PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx chrome-extension/scripts/test-sidebar-review-ui.py
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
    set_connection(page, "connected")
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
    assert len(sent) >= 1
    assert secret not in JSON.stringify(sent)
    assert page.evaluate("window.companionStore.externalKey") == secret
```

函数开头先 `set_connection(page, "connected")`，否则保存按钮不发出 `config.set`。`get_by_role("button", name="设置")` 会同时命中侧栏「设置」和「更多工具与设置」，必须 `exact=True`。保存按钮的文字是「保存并关闭」。`len(sent) >= 1` 必须写在密钥检查前面。空的 `config.set` 列表序列化后也不含密钥，会假绿。`sendMessage` 收到 `config.set` 时只合并 `config` 补丁，不改 `externalKey`。若补丁里出现密钥，上面的 `JSON.stringify` 断言失败。

```python
def test_unconfigured_models_open_from_other(page):
    set_connection(page, "connected")
    page.get_by_role("button", name="设置", exact=True).click()
    assert page.get_by_text("视觉模型（看图描述）").count() == 0
    page.get_by_role("button", name="其他能力").click()
    assert page.get_by_text("视觉模型（看图描述）").count() == 1
```

这个函数从 Task 10 起就在 `TESTS` 里。未配对时设置打开在连接页，模型页带 `hidden`。`get_by_text` 仍数得到「视觉模型（看图描述）」，`body.innerText` 数不到。断言用 `count()`，不用 `inner_text`。第一条会红的断言是 `count()` 不是 0。不要把找不到「其他能力」的超时当作红灯。

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

下面每个函数都先操作，再断言，再 `shot`。759/760/959/960 的函数体在 Task 2，这里不另起一份。`shot` 在断言之后。`WorkspaceNavigation` 只有收到 `onClose` 才渲染「关闭导航」。现码 `count()` 是 0，断言在点击之前失败。

```python
def test_narrow_collapsed(page):
    page.set_viewport_size({"width": 420, "height": 860})
    assert page.get_by_role("button", name="打开工作区导航").count() == 1
    disclosure = page.locator(".cm-navigation-disclosure")
    assert disclosure.count() == 1
    assert page.locator(".cm-navigation-disclosure:visible").count() == 0
    assert page.get_by_text("资料与工具").count() == 0
    shot(page, "420-collapsed")

def test_narrow_open_height(page):
    page.set_viewport_size({"width": 420, "height": 860})
    page.get_by_role("button", name="打开工作区导航").click()
    assert page.get_by_text("资料与工具").count() == 1
    box = page.locator(".cm-navigation-disclosure").bounding_box()
    assert box["height"] <= 860 * 0.28
    shot(page, "420-open")

def test_escape_returns_to_nav(page):
    page.set_viewport_size({"width": 420, "height": 860})
    nav = page.get_by_role("button", name="打开工作区导航")
    nav.click()
    page.keyboard.press("Escape")
    assert page.evaluate("document.activeElement.getAttribute('aria-label')") == "打开工作区导航"
    shot(page, "420-esc")

def test_close_returns_to_nav(page):
    page.set_viewport_size({"width": 420, "height": 860})
    page.get_by_role("button", name="打开工作区导航").click()
    close = page.get_by_role("button", name="关闭导航")
    assert close.count() == 1
    close.click()
    assert page.evaluate("document.activeElement.getAttribute('aria-label')") == "打开工作区导航"
    shot(page, "420-close")

def seed_named_threads(page):
    set_connection(page, "connected")
    page.evaluate("""() => {
      const longName = "示例·采购清单需要单行省略但完整名称仍在标题里"
      window.dispatchUI({type:'SET_THREADS', threads:[
        {id:'weekend', alias:'示例·周末清单', created_at:'2026-11-18T00:00:00.000Z', updated_at:'2026-11-18T00:00:00.000Z', config_override:{}, tool_whitelist:null, pinned_tabs:[], active_skill_ids:[], message_count:1},
        {id:'shop', alias:'示例·采购', created_at:'2026-11-18T00:00:00.000Z', updated_at:'2026-11-18T00:00:01.000Z', config_override:{}, tool_whitelist:null, pinned_tabs:[], active_skill_ids:[], message_count:1},
        {id:'long', alias: longName, created_at:'2026-11-18T00:00:00.000Z', updated_at:'2026-11-18T00:00:02.000Z', config_override:{}, tool_whitelist:null, pinned_tabs:[], active_skill_ids:[], message_count:1}
      ]})
      window.dispatchUI({type:'SET_ACTIVE_THREAD', threadId:'weekend'})
    }""")

def test_hover_row(page):
    page.set_viewport_size({"width": 960, "height": 860})
    seed_named_threads(page)
    row = page.locator("nav.cm-navigation").get_by_role("button", name="示例·采购", exact=True)
    assert row.count() == 1, row.count()
    row.hover()
    color = row.evaluate("el => getComputedStyle(el).backgroundColor")
    assert color == "rgb(238, 238, 236)", color
    shot(page, "hover-row")
# 2026-11-18 自检：行能点到，computed background 是 rgba(0, 0, 0, 0)。这是颜色红灯，不是找不到行。

def test_selected_row_has_no_outline(page):
    page.set_viewport_size({"width": 960, "height": 860})
    seed_named_threads(page)
    row = page.locator("nav.cm-navigation .cm-nav-thread[aria-current=page]")
    assert row.count() == 1
    style = row.evaluate("el => getComputedStyle(el)")
    assert style["backgroundColor"] == "rgb(233, 233, 230)"
    assert style["fontWeight"] == "500"
    assert style["outlineStyle"] == "none"
    shot(page, "selected-row")

def test_keyboard_focus_outline(page):
    page.set_viewport_size({"width": 960, "height": 860})
    seed_named_threads(page)
    row = page.locator("nav.cm-navigation .cm-nav-thread[aria-current=page]")
    row.evaluate("el => el.focus({focusVisible: true})")
    style = row.evaluate("el => getComputedStyle(el)")
    assert style["outlineStyle"] == "solid"
    assert style["outlineColor"] == "rgb(79, 70, 229)"
    shot(page, "keyboard-focus")

def test_long_name_title(page):
    page.set_viewport_size({"width": 960, "height": 860})
    seed_named_threads(page)
    full = "示例·采购清单需要单行省略但完整名称仍在标题里"
    row = page.locator("nav.cm-navigation").get_by_role("button", name=full)
    assert row.count() == 1
    assert row.get_attribute("title") == full
    overflow = row.locator("span").first.evaluate("el => getComputedStyle(el).textOverflow")
    assert overflow == "ellipsis"
    shot(page, "long-name")

def test_empty_start(page):
    page.set_viewport_size({"width": 960, "height": 860})
    set_connection(page, "connected")
    page.evaluate("() => window.dispatchUI({type:'SET_ACTIVE_THREAD', threadId:null})")
    assert page.get_by_role("button", name="开始第一则对话").count() == 1
    box = page.get_by_role("textbox", name="消息内容")
    assert box.is_enabled()
    box.fill("第一句")
    page.get_by_role("button", name="发送", exact=True).click()
    assert page.evaluate("window.sent.filter(m => m.type==='thread.create').length") == 1
    shot(page, "empty-start")

def test_extract_progress(page):
    page.set_viewport_size({"width": 960, "height": 860})
    set_connection(page, "connected")
    page.evaluate("""() => {
      const threads = Array.from({length: 20}, (_, i) => ({
        id: 't' + i, alias: '未标注' + i,
        created_at: '2026-11-18T00:00:00.000Z', updated_at: '2026-11-18T00:00:00.000Z',
        config_override: {}, tool_whitelist: null, pinned_tabs: [], active_skill_ids: [], message_count: 1
      }))
      window.dispatchUI({type:'SET_THREADS', threads})
      window.dispatchUI({type:'SET_ACTIVE_THREAD', threadId:'t0'})
    }""")
    manage = page.locator("nav.cm-navigation").get_by_role("button", name="管理对话", exact=True)
    assert manage.count() == 1
    manage.click()
    page.get_by_role("button", name="AI 提取标签", exact=True).click()
    start = page.get_by_role("button", name="开始提取", exact=True)
    assert start.count() == 1
    start.click()
    page.evaluate("""() => {
      const threads = window.fixtureState.threads.map(thread => thread.id === 't0'
        ? {...thread, digest:{tldr:'夹具', tags:['夹具'], bullets:[], extracted_at:'2026-11-18T00:00:01.000Z', content_fingerprint:'fixture'}}
        : thread)
      window.dispatchUI({type:'SET_THREADS', threads})
    }""")
    assert page.get_by_text("提取要点 1/20").count() == 1
    shot(page, "extract-progress")

ROUTES = {
    "test_section_order": ("/sidepanel.html", 960, 860),
    "test_sidepanel_759": ("/sidepanel.html", 759, 860),
    "test_sidepanel_760": ("/sidepanel.html", 760, 860),
    "test_workspace_759": ("/tabs/workspace.html", 759, 860),
    "test_workspace_760": ("/tabs/workspace.html", 760, 860),
    "test_popout_959": ("/popout.html?surface=popout", 959, 860),
    "test_popout_960": ("/popout.html?surface=popout", 960, 860),
    "test_connection_survives_poll": ("/sidepanel.html", 960, 860),
    "test_disconnect_disables_the_composer": ("/sidepanel.html", 960, 860),
    "test_draft_follows_active_thread": ("/sidepanel.html", 960, 860),
    "test_no_move_fieldset": ("/sidepanel.html", 960, 860),
    "test_project_admin": ("/sidepanel.html", 960, 860),
    "test_first_sentence_creates_one_thread": ("/sidepanel.html", 960, 860),
    "test_list_error_retry": ("/sidepanel.html", 960, 860),
    "test_cancel_extract_sends_nothing": ("/sidepanel.html", 960, 860),
    "test_thread_graph_is_not_knowledge_graph": ("/sidepanel.html", 960, 860),
    "test_history_panel_is_not_the_thread_manager": ("/sidepanel.html", 960, 860),
    "test_configured_external_asr_survives_model_save": ("/sidepanel.html", 960, 860),
    "test_unconfigured_models_open_from_other": ("/sidepanel.html", 960, 860),
    "test_narrow_collapsed": ("/sidepanel.html", 420, 860),
    "test_narrow_open_height": ("/sidepanel.html", 420, 860),
    "test_escape_returns_to_nav": ("/sidepanel.html", 420, 860),
    "test_close_returns_to_nav": ("/sidepanel.html", 420, 860),
    "test_hover_row": ("/tabs/workspace.html", 960, 860),
    "test_selected_row_has_no_outline": ("/tabs/workspace.html", 960, 860),
    "test_keyboard_focus_outline": ("/tabs/workspace.html", 960, 860),
    "test_long_name_title": ("/tabs/workspace.html", 960, 860),
    "test_empty_start": ("/sidepanel.html", 960, 860),
    "test_extract_progress": ("/sidepanel.html", 960, 860),
}
TESTS = list(ROUTES)
EXPECTED = list(ROUTES)
```

`TESTS` 就是 `ROUTES` 的键，没有只写在名单里、文件里却没有 `def` 的名字。`ran` 必须等于 `len(TESTS)`。少一个、多一个，或截图出现在断言之前，都不能申请 final gate。悬停、选中、键盘焦点和长名称走 `/tabs/workspace.html`，因为规格表把这四行标在 960 工作区。管理对话、历史、知识和提取进度走 `/sidepanel.html` 的 `nav.cm-navigation`。

- [ ] **Step 2: Run test to verify it fails**

Expected: 退出码非 0。失败在可访问名、`data-navigation-mode` 或轮廓，不是缺文件名函数。

- [ ] **Step 3: Write minimal implementation**

把 Esc 和关闭的焦点目标设为 `.cm-navigation-toggle`。不要把可见文字「导航」写成 `aria-label`。

- [ ] **Step 4: Run the full gates on this head**

```bash
cd chrome-extension && nvm use 22
uv run --no-project --with playwright python scripts/test-sidebar-review-ui.py
npx tsc -p tsconfig.test.json --pretty false && node --test .test-dist/tests/startup-destination.test.js .test-dist/tests/project-list-retry.test.js
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
| 夹具 | 420 宽点「打开工作区导航」，Tab 进导航，按 Esc。再打开并点「关闭导航」。分别量 759、760、959、960 | Esc 和关闭后，`document.activeElement` 的可访问名是「打开工作区导航」。sidepanel 与 workspace 在 759 为 layered、760 为 resident，栏宽 220。popout 在 959 为 layered、960 为 resident。键盘焦点的轮廓是 `solid` / `rgb(79, 70, 229)` | 当前行为已测，最终门未测。sidepanel 759 为 layered，960 为 resident。popout 959 为 layered，960 为 resident。workspace 759 和 960 都没有 `data-navigation-mode`。「关闭导航」现码 `count()` 为 0 |
| Companion | 纯界面 | 不适用，写未测并注明没有服务端行为 | 未测 |
| 外部或本机 | 在 Mac 上看苹方或 SF，并在已安装扩展里重复 Tab | 本环境字体是 fallback。没有 Mac 安装就未测 | 未测。没有 Mac |

### S8 断连和失败重试

| 层 | 步骤 | 预期 | 节点 0 |
| --- | --- | --- | --- |
| 夹具 | 活动对话还在时把连接设为 `disconnected`，同时写 `window.__connection`。点「重新连接」。项目列表回 `project.error` 且没有快照，点「重试」。断连时点「保存并关闭」 | 输入框禁用，占位是「等待 companion 连接...」。横幅标题是「Companion 未连接」。点击发出 `ws.forceReconnect`。重试后多一条 `project.list`，没有「还没有项目」。保存出现「尚未连接到 Companion，这次设置没有发送」 | 断连占位已测，最终门未测。没有活动对话时占位仍是「请先创建或选择一个线程」，不能拿它证明断连 |
| Companion | 停掉临时进程，再以同一 `CMSPARK_DATA_DIR` 启动。客户端重连后发 `thread.list` | 只动 `$PORT` 上的临时进程。重连后列表仍是临时线程。23401 无新连接。live mtime 不变 | 未测 |
| 外部或本机 | 「查看日志」走原生宿主打开目录 | 没有原生宿主时，夹具只断言提示「请手动打开日志目录：~/.cmspark-agent/logs/」。Mac / Windows 原生打开写未测 | 未测。没有 Mac / Windows 原生宿主 |

### 节点 0 核对

对照源码的基线是 `f0b5b09652d8aedf0e301a8318ed9fe489418f6d`。界面演练用的是当时打好的真实 `App` 包，后来把探针接到 `App` 内部的 provider 上再跑了一遍。没有启动 Companion，没有读取或修改 `~/.cmspark-agent`，没有发外部请求。证据文件：

| 文件 | 内容 |
| --- | --- |
| `/tmp/rehearse/nav-results.txt` | `navigationMode` 在 sidepanel 760 实际是 `layered` |
| `/tmp/rehearse/retry-results.txt` | `ProjectListView` 失败态 HTML 没有「重试」，只有「项目列表没有取回」 |
| `/tmp/rehearse/probe-evidence.txt` | 外层 store 与输入框脱节；设置里能看到「保存并关闭」；工作区没有 `data-navigation-mode` |
| `/tmp/rehearse/probe-evidence-2.txt` | 内层 store：已连接且有对话时可写；断连占位是「等待 companion 连接...」；提取一点就发出 `thread.extract_digest` |
| `/tmp/rehearse/probe-evidence-3.txt` | 工作区「关系图谱」发出 `thread_graph.open`；「历史」是「暂无操作历史」；「知识」里有「分布图谱」 |

已测到的当前行为：

- 外层 `dispatchUI` 不能驱动输入框。内层在 `connected` 且 `activeThreadId` 为 `weekend` 时，输入框启用，占位是「描述任务，或粘贴截图…」。
- 同一条对话改为 `disconnected` 后，输入框禁用，占位是「等待 companion 连接...」。
- 没有活动对话时，占位是「请先创建或选择一个线程」，即使同时也断开。
- `/tabs/workspace.html` 的 `.cm-workspace-full` 存在，`data-navigation-mode` 为 `None`。sidepanel 759 为 `layered`，960 为 `resident`。popout 959 为 `layered`，960 为 `resident`。
- 当前探针：`/sidepanel.html` 的 `nav.cm-navigation` 里「管理对话」数量是 0。这不是目标回归。目标是侧栏里能点到它。工作区里已有的「管理对话」不能代替。工作区探针里点「关系图谱」会发 `thread_graph.open`，点「历史」看到「暂无操作历史」，点「知识」看到「分布图谱」。
- 「对话管理（历史对话）」打开后，「AI 提取标签」可点，一点就有 1 条 `thread.extract_digest`，「取消」的 `count()` 是 0。
- 设置按钮必须 `exact=True`。打开后有「保存并关闭」。「视觉模型（看图描述）」在 `textContent` 里，不在 `innerText` 里。「外部转写已配置」不在。
- 「历史」出现「暂无操作历史」，没有「AI 提取标签」。「知识」里「分布图谱」的 `count()` 是 1。

还没有的规格文案：`开始第一则对话`、`外部转写已配置`、`其他能力`。S1 到 S8 的最终门都还是未测。上面这些只说明当前代码会在哪一条断言失败。

未测：真实 Companion 进程、临时目录落盘、隔离模型密钥、已安装扩展的重开、Mac 字体、Windows 原生宿主、永久删除、清空回收站、知识图谱「重新整理」、工具「允许」后的真实执行。

从计划里抽出的 29 个 `test_*` 已在真实 `App` 包上跑过，记录在 `/tmp/rehearse/selfcheck-report.json`。AST：没有重复定义，`ROUTES` 里的每个名字都有函数，截图名和规格表一致，测试函数里没有单独的 `SET_CONNECTION`，也没有把侧栏「管理对话」锁成 0。只改 store、不改 `__connection`，等过 3 秒后 store 回到 `disconnected`。`set_connection` 跨过这轮轮询后仍是 `connected`。

现存锁，这次是绿的：`test_sidepanel_759`、`test_popout_959`、`test_popout_960`、`test_connection_survives_poll`、`test_disconnect_disables_the_composer`、`test_project_admin`、`test_escape_returns_to_nav`、`test_selected_row_has_no_outline`、`test_keyboard_focus_outline`、`test_long_name_title`。

当前红灯都是断言，不是超时或缺符号：侧栏顺序缺「新对话」；sidepanel 760 仍是 `layered`；工作区 759 和 760 的属性是 `None`；草稿切走后原文还在；会话层仍有归属框；无对话时输入框禁用；重试按钮数量是 0；侧栏「管理对话」数量不是 1；视觉模型仍在；「外部转写已配置」不在；窄栏没有 `.cm-navigation-disclosure`；「关闭导航」数量不是 1；悬停背景是 `rgba(0, 0, 0, 0)`；没有「开始第一则对话」。

### 同一 head 的其余门禁

场景报告之外，仍要跑：

```bash
cd chrome-extension && nvm use 22
uv run --no-project --with playwright python scripts/test-sidebar-review-ui.py
npx tsc -p tsconfig.test.json --pretty false
node --test .test-dist/tests/startup-destination.test.js .test-dist/tests/project-list-retry.test.js
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
- 改连接只走 `set_connection`。`config.set` 先要求 `len(sent) >= 1`。
- 侧栏「管理对话」的目标是 `count() == 1` 并能点开。当前数量为 0 只解释今天为什么红，不是一条永远为 0 的锁。
- 每张规格截图都有函数体，断言在 `shot` 之前。`TESTS` 的每个名字都有 `def`。
- 节点 0 的最终门每一行都是未测。当前行为的演练写在「节点 0 核对」。文档提交不是 final gate。
