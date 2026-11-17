"""Task 2 Chrome coverage for the project list. No package.json dependency.

cd chrome-extension && nvm use 22
uv run --no-project --with playwright python scripts/test-project-navigation-ui.py
"""
import json
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
LIST_KEY = "cmspark.project.list.v1"
THREAD_KEY = "cmspark.navigation.lastThreadId"
shots = Path("/opt/cursor/artifacts")
alpha = {"id": "11111111-1111-4111-8111-111111111111", "name": "Alpha", "created_at": "t", "updated_at": "t", "archived_at": None}
empty_named = {"id": "22222222-2222-4222-8222-222222222222", "name": "空项目", "created_at": "t", "updated_at": "t", "archived_at": None}
archived = {**alpha, "id": "33333333-3333-4333-8333-333333333333", "name": "旧项目", "archived_at": "t2"}

def release_generation(page, key, generation, seed):
    page.wait_for_function(
        "(arg) => window.storageWaiters.some(item => item.key === arg.key && item.generation === arg.generation)",
        arg={"key": key, "generation": generation},
    )
    released = page.evaluate(
        """(arg) => {
          const index = window.storageWaiters.findIndex(item => item.key === arg.key && item.generation === arg.generation)
          if (index < 0) return false
          const item = window.storageWaiters.splice(index, 1)[0]
          item.callback(arg.seed)
          return true
        }""",
        {"key": key, "generation": generation, "seed": seed},
    )
    assert released

def release_latest(page, key, seed):
    page.wait_for_function("(key) => window.storageWaiters.some(item => item.key === key)", arg=key)
    generation = page.evaluate("(key) => window.storageWaiters.filter(item => item.key === key).at(-1).generation", key)
    release_generation(page, key, generation, seed)

def launch(playwright, directory, storage, level="chat"):
    subprocess.run(["node", "scripts/render-project-navigation-fixture.cjs", directory, "--hold-storage", f"--level={level}"], cwd=root, check=True)
    browser = playwright.chromium.launch(channel="chrome", headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
    page = browser.new_page(viewport={"width": 320, "height": 800})
    page.set_default_timeout(6000)
    page.goto((Path(directory) / "index.html").as_uri())
    release_latest(page, LIST_KEY, storage)
    return browser, page

def open_projects(page):
    summary = page.locator("summary").filter(has_text="项目").first
    summary.focus()
    page.keyboard.press("Enter")

def test_list(page):
    open_projects(page)
    page.get_by_role("button", name="Alpha", exact=True).wait_for()
    page.get_by_role("button", name="空项目", exact=True).wait_for()
    assert page.get_by_role("button", name="旧项目", exact=True).count() == 0
    assert page.evaluate("!window.sent.some(m => m.type==='project.state')")
    assert page.evaluate("() => document.activeElement?.getAttribute('aria-label') !== '新项目名称'")
    create_summary = page.locator("summary", has_text="新建项目")
    create = create_summary.locator("xpath=..")
    assert create.evaluate("el => el.open === false")
    create_summary.focus()
    page.keyboard.press("Enter")
    assert create.evaluate("el => el.open === true")
    alpha_row = page.get_by_role("button", name="Alpha", exact=True)
    alpha_row.focus()
    page.keyboard.press("Enter")
    assert page.evaluate("!window.sent.some(m => m.type==='thread.project.set')")
    assert page.evaluate("window.filterCalls === undefined || window.filterCalls === 0")
    page.screenshot(path=str(shots / "project-list-open.png"))
    page.get_by_role("button", name="返回", exact=True).click()
    page.get_by_role("textbox", name="搜索项目", exact=True).fill("zzz")
    assert page.get_by_role("button", name="Alpha", exact=True).count() == 0
    assert "没有匹配的项目" in page.locator("[aria-label=项目]").inner_text()
    page.get_by_role("button", name="清除搜索", exact=True).click()
    page.get_by_role("button", name="Alpha", exact=True).wait_for()
    page.get_by_role("button", name="空项目", exact=True).wait_for()
    page.get_by_role("button", name="查看归档", exact=True).click()
    page.get_by_role("button", name="旧项目", exact=True).wait_for()
    assert page.get_by_role("button", name="Alpha", exact=True).count() == 0
    assert page.get_by_role("button", name="空项目", exact=True).count() == 0
    page.screenshot(path=str(shots / "project-list-archived.png"))
    page.evaluate("() => window.dispatchUI({type:'SET_CONNECTION', state:'disconnected'})")
    disconnected = page.locator("[aria-label=项目]").inner_text()
    assert "离线，列表更新于 t" in disconnected
    assert "还没有项目" not in disconnected
    page.evaluate("() => window.dispatchUI({type:'SET_CONNECTION', state:'connected'})")
    page.wait_for_function("window.sent.filter(m => m.type==='project.list').length >= 2")
    listed = page.evaluate("() => window.sent.filter(m => m.type==='project.list')[0]")
    page.evaluate("(msg) => window.emitRuntime({id: msg.id, type:'project.state', revision: 9, projects:[{id:'11111111-1111-4111-8111-111111111111', name:'Zed', created_at:'t', updated_at:'t', archived_at:null}]})", listed)
    assert page.get_by_role("button", name="旧项目", exact=True).count() == 1
    assert page.get_by_role("button", name="Zed", exact=True).count() == 0
    offline = page.locator("[aria-label=项目]").inner_text()
    assert "还没有项目" not in offline

def test_layout(page):
    css = "".join(page.locator("style").all_inner_texts())
    assert "28dvh" not in css
    assert "cm-navigation-disclosure" not in css
    assert page.locator(".cm-navigation-disclosure").count() == 0
    for width in (320, 400, 759):
        page.set_viewport_size({"width": width, "height": 800})
        page.wait_for_function("(value) => document.querySelector('[data-navigation-mode]').getAttribute('data-navigation-mode') === value", arg="layered")
    for width in (960, 1200):
        page.set_viewport_size({"width": width, "height": 800})
        page.wait_for_function("(value) => document.querySelector('[data-navigation-mode]').getAttribute('data-navigation-mode') === value", arg="resident")
    page.set_viewport_size({"width": 320, "height": 800})
    page.wait_for_function("(value) => document.querySelector('[data-navigation-mode]').getAttribute('data-navigation-mode') === value", arg="layered")

def test_stale_startup(page):
    page.wait_for_function("(key) => window.storageWaiters.some(item => item.key === key)", arg=THREAD_KEY)
    held = page.evaluate("(key) => window.storageWaiters.find(item => item.key === key).generation", THREAD_KEY)
    before = page.evaluate("window.fixtureState.activeThreadId")
    page.evaluate("() => window.dispatchUI({type:'SET_THREADS', threads: window.demoThreads})")
    page.wait_for_function(
        "(arg) => window.storageWaiters.some(item => item.key === arg.key && item.generation !== arg.generationHeld)",
        arg={"key": THREAD_KEY, "generationHeld": held},
    )
    release_generation(page, THREAD_KEY, held, {THREAD_KEY: "demo-0"})
    assert page.evaluate("window.fixtureState.activeThreadId") == before
    assert page.evaluate("!window.sent.some(m => m.type==='thread.select')")

def test_breadcrumb(page):
    page.evaluate("""() => window.dispatchUI({type:'SET_THREADS', threads:[{id:'demo-0', alias:'笔记', project_id:'11111111-1111-4111-8111-111111111111', trashed_at:null, created_at:'t', updated_at:'t', config_override:{}, tool_whitelist:null, pinned_tabs:[], active_skill_ids:[]}]})""")
    release_latest(page, THREAD_KEY, {THREAD_KEY: "demo-0"})
    page.get_by_role("banner", name="会话位置").wait_for()
    page.evaluate("() => window.dispatchUI({type:'SET_CONNECTION', state:'connecting'})")
    assert "正在连接，归属整理已停用。" in page.locator("body").inner_text()
    assert "连接断开，归属整理已停用。" not in page.locator("body").inner_text()
    assert "执行状态：离线" not in page.locator("body").inner_text()
    assert page.get_by_role("button", name="移入 Alpha", exact=True).is_disabled()
    page.evaluate("() => window.dispatchUI({type:'SET_CONNECTION', state:'connected'})")
    page.get_by_role("banner", name="会话位置").get_by_role("button", name="Alpha", exact=True).click()
    page.get_by_role("region", name="项目详情").wait_for()
    assert page.evaluate("!window.sent.some(m => m.type==='thread.project.set')")

def test_bind(page):
    page.get_by_role("button", name="项目内新对话", exact=True).click()
    page.wait_for_function("window.sent.some(m => m.type==='thread.create')")
    created = page.evaluate("() => window.sent.find(m => m.type==='thread.create')")
    page.evaluate("(msg) => window.emitRuntime({type:'thread.created', id: msg.id, thread:{id: msg.id, alias:'新项目对话', project_id:null, created_at:'t', updated_at:'t', config_override:{}, tool_whitelist:null, pinned_tabs:[], active_skill_ids:[]}})", created)
    page.wait_for_function("window.sent.some(m => m.type==='thread.project.set')")
    ok = page.evaluate("() => window.sent.find(m => m.type==='thread.project.set')")
    page.evaluate("(msg) => window.emitRuntime({type:'project.changed', id: msg.id, operation_id: msg.operation_id, revision: msg.expected_revision + 1, thread_id: msg.thread_id, project_id: msg.project_id, thread:{id: msg.thread_id, project_id: msg.project_id}})", ok)
    page.locator(f"[data-project-threads] [data-thread-id='{ok['thread_id']}']").wait_for()
    assert page.get_by_text("新对话已归入这个项目").count() == 2
    before = page.evaluate("() => window.sent.filter(m => m.type==='thread.create').length")
    page.get_by_role("button", name="项目内新对话", exact=True).click()
    page.wait_for_function(f"() => window.sent.filter(m => m.type==='thread.create').length > {before}")
    created2 = page.evaluate("() => window.sent.filter(m => m.type==='thread.create').at(-1)")
    page.evaluate("(msg) => window.emitRuntime({type:'thread.created', id: msg.id, thread:{id: msg.id, alias:'新项目对话', project_id:null, created_at:'t', updated_at:'t', config_override:{}, tool_whitelist:null, pinned_tabs:[], active_skill_ids:[]}})", created2)
    page.wait_for_function("window.sent.filter(m => m.type==='thread.project.set').length >= 2")
    bad = page.evaluate("() => window.sent.filter(m => m.type==='thread.project.set').at(-1)")
    page.evaluate("(msg) => window.emitRuntime({type:'project.error', id: msg.id, operation_id: msg.operation_id, error:'rejected'})", bad)
    page.get_by_text("新对话已创建在项目外；归入尚未确认").wait_for()
    body = page.locator("body").inner_text()
    assert "新对话已归入这个项目" in body
    assert page.locator(f"[data-project-threads] [data-thread-id='{bad['thread_id']}']").count() == 0
    assert page.locator(f"[data-project-threads] [data-thread-id='{ok['thread_id']}']").count() == 1

def test_wrong_project_receipt(playwright, directory):
    browser, page = launch(playwright, directory, {LIST_KEY: json.dumps({"format": 1, "revision": 2, "fetchedAt": "t", "projects": [alpha, archived]})})
    open_projects(page)
    row = page.get_by_role("button", name="Alpha", exact=True)
    row.wait_for()
    row.focus()
    page.keyboard.press("Enter")
    page.get_by_role("button", name="项目内新对话", exact=True).click()
    page.wait_for_function("window.sent.some(m => m.type==='thread.create')")
    created = page.evaluate("() => window.sent.find(m => m.type==='thread.create')")
    page.evaluate("(msg) => window.emitRuntime({type:'thread.created', id: msg.id, thread:{id: msg.id, alias:'新项目对话', project_id:null, created_at:'t', updated_at:'t', config_override:{}, tool_whitelist:null, pinned_tabs:[], active_skill_ids:[]}})", created)
    page.wait_for_function("window.sent.some(m => m.type==='thread.project.set')")
    ok = page.evaluate("() => window.sent.find(m => m.type==='thread.project.set')")
    page.evaluate("(msg) => window.emitRuntime({type:'project.changed', id: msg.id, operation_id: msg.operation_id, revision: msg.expected_revision + 1, thread_id: msg.thread_id, project_id: msg.project_id, thread:{id: msg.thread_id, project_id: msg.project_id}})", ok)
    page.locator("[data-project-threads]").get_by_text("新对话已归入这个项目").nth(1).wait_for()
    page.get_by_role("button", name="项目内新对话", exact=True).click()
    page.wait_for_function("window.sent.filter(m => m.type==='thread.create').length >= 2")
    created2 = page.evaluate("() => window.sent.filter(m => m.type==='thread.create').at(-1)")
    page.evaluate("(msg) => window.emitRuntime({type:'thread.created', id: msg.id, thread:{id: msg.id, alias:'新项目对话', project_id:null, created_at:'t', updated_at:'t', config_override:{}, tool_whitelist:null, pinned_tabs:[], active_skill_ids:[]}})", created2)
    page.wait_for_function("window.sent.filter(m => m.type==='thread.project.set').length >= 2")
    bad = page.evaluate("() => window.sent.filter(m => m.type==='thread.project.set').at(-1)")
    page.evaluate("(msg) => window.emitRuntime({type:'project.changed', id: msg.id, operation_id: msg.operation_id, revision: msg.expected_revision + 1, thread_id: msg.thread_id, project_id: 'other-project', thread:{id: msg.thread_id, project_id: 'other-project'}})", bad)
    assert page.locator(f"[data-project-threads] [data-thread-id='{bad['thread_id']}']").count() == 0
    assert "新对话已归入这个项目" in page.locator("body").inner_text()
    browser.close()

def test_restore_none(playwright, directory):
    browser, page = launch(playwright, directory, {LIST_KEY: json.dumps({"format": 1, "revision": 1, "fetchedAt": "t", "projects": [alpha]})})
    release_latest(page, THREAD_KEY, {})
    page.get_by_text("没有可恢复的上次对话", exact=True).wait_for()
    assert page.evaluate("window.fixtureState.activeThreadId") is None
    assert page.evaluate("!window.sent.some(m => m.type==='thread.create' || m.type==='thread.select')")
    browser.close()

def test_bad_cache(playwright, directory):
    browser, page = launch(playwright, directory, {LIST_KEY: "{not-json"})
    open_projects(page)
    text = page.locator("[aria-label=项目]").inner_text()
    assert "正在读取项目" in text
    assert "还没有项目" not in text
    assert "无法取回项目列表" not in text
    page.screenshot(path=str(shots / "project-list-bad-cache.png"))
    browser.close()

def emit_error(page, message, secret):
    page.evaluate(
        "(msg) => window.emitRuntime({id: msg.id, type:'project.error', error: msg.secret})",
        {"id": message["id"], "secret": secret},
    )

def region_text(page):
    return page.locator("[aria-label=项目]").inner_text()

def panel_text(page):
    return page.locator(".cm-project-controls").inner_text()

def test_connected_list_error_without_cache(playwright, directory):
    browser, page = launch(playwright, directory, {})
    open_projects(page)
    page.wait_for_function("window.sent.some(m => m.type==='project.list')")
    listed = page.evaluate("() => window.sent.filter(m => m.type==='project.list').at(-1)")
    emit_error(page, listed, "raw-list-secret")
    page.locator("[aria-label=项目]").get_by_text("项目列表没有取回", exact=True).wait_for()
    text = panel_text(page)
    assert "raw-list-secret" not in text
    assert "离线" not in text
    assert "无法取回项目列表" not in text
    assert "还没有项目" not in text
    page.evaluate("() => window.dispatchUI({type:'SET_CONNECTION', state:'disconnected'})")
    page.evaluate("() => window.dispatchUI({type:'SET_CONNECTION', state:'connected'})")
    page.wait_for_function("window.sent.filter(m => m.type==='project.list').length >= 2")
    latest = page.evaluate("() => window.sent.filter(m => m.type==='project.list').at(-1)")
    page.evaluate("(msg) => window.emitRuntime({id: msg.id, type:'project.state', revision: 1, projects:[]})", latest)
    page.locator("[aria-label=项目]").get_by_text("还没有项目", exact=True).wait_for()
    text = region_text(page)
    assert "项目列表没有取回" not in text
    assert "无法取回项目列表" not in text
    browser.close()

def test_save_failure_survives_list_recovery(playwright, directory):
    browser, page = launch(playwright, directory, {LIST_KEY: json.dumps({"format": 1, "revision": 2, "fetchedAt": "t", "projects": [alpha]})})
    open_projects(page)
    page.get_by_role("button", name="Alpha", exact=True).wait_for()
    page.wait_for_function("window.sent.some(m => m.type==='project.list')")
    listed = page.evaluate("() => window.sent.filter(m => m.type==='project.list').at(-1)")
    emit_error(page, listed, "raw-list-secret")
    page.locator("[aria-label=项目]").get_by_text("项目列表没有取回", exact=True).wait_for()
    assert page.get_by_role("button", name="Alpha", exact=True).count() == 1
    text = panel_text(page)
    assert "raw-list-secret" not in text
    assert "无法取回项目列表" not in text
    assert "还没有项目" not in text
    create_summary = page.locator("summary", has_text="新建项目")
    create_summary.focus()
    page.keyboard.press("Enter")
    page.get_by_role("textbox", name="新项目名称", exact=True).fill("Beta")
    page.get_by_role("button", name="创建项目", exact=True).click()
    page.wait_for_function("window.sent.some(m => m.type==='project.create')")
    created = page.evaluate("() => window.sent.filter(m => m.type==='project.create').at(-1)")
    emit_error(page, created, "raw-save-secret")
    page.get_by_role("alert").filter(has_text="项目没有保存").wait_for()
    assert "raw-save-secret" not in panel_text(page)
    assert page.get_by_role("button", name="Alpha", exact=True).count() == 1
    assert "项目列表没有取回" in panel_text(page)
    page.get_by_role("button", name="Alpha", exact=True).focus()
    page.keyboard.press("Enter")
    page.get_by_role("button", name="返回", exact=True).click()
    page.locator("summary", has_text="管理项目").focus()
    page.keyboard.press("Enter")
    page.get_by_role("textbox", name="项目新名称", exact=True).fill("Gamma")
    page.get_by_role("button", name="改名", exact=True).click()
    page.wait_for_function("window.sent.some(m => m.type==='project.rename')")
    renamed = page.evaluate("() => window.sent.filter(m => m.type==='project.rename').at(-1)")
    emit_error(page, renamed, "raw-rename-secret")
    page.get_by_role("alert").filter(has_text="项目没有保存").wait_for()
    assert "raw-rename-secret" not in panel_text(page)
    assert page.get_by_role("button", name="Alpha", exact=True).count() == 1
    assert page.get_by_role("button", name="Gamma", exact=True).count() == 0
    page.evaluate("() => window.dispatchUI({type:'SET_CONNECTION', state:'disconnected'})")
    page.evaluate("() => window.dispatchUI({type:'SET_CONNECTION', state:'connected'})")
    page.wait_for_function("window.sent.filter(m => m.type==='project.list').length >= 2")
    latest = page.evaluate("() => window.sent.filter(m => m.type==='project.list').at(-1)")
    page.evaluate(
        "(msg) => window.emitRuntime({id: msg.id, type:'project.state', revision: 3, projects:[{id:'11111111-1111-4111-8111-111111111111', name:'Alpha', created_at:'t', updated_at:'t', archived_at:null}]})",
        latest,
    )
    page.wait_for_function("""() => {
      const text = document.querySelector('[aria-label=项目]').innerText
      return !text.includes('项目列表没有取回') && !text.includes('离线，列表更新于')
    }""")
    assert "项目没有保存" in panel_text(page)
    assert page.get_by_role("button", name="Alpha", exact=True).count() == 1
    browser.close()

def test_empty_archive(playwright, directory):
    browser, page = launch(playwright, directory, {LIST_KEY: json.dumps({"format": 1, "revision": 1, "fetchedAt": "t", "projects": [alpha]})})
    open_projects(page)
    page.get_by_role("button", name="查看归档", exact=True).click()
    assert "没有归档项目" in page.locator("[aria-label=项目]").inner_text()
    assert page.get_by_role("button", name="Alpha", exact=True).count() == 0
    browser.close()

shots.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix="cmspark-project-nav-") as directory:
    with sync_playwright() as playwright:
        cache = {LIST_KEY: json.dumps({"format": 1, "revision": 2, "fetchedAt": "t", "projects": [alpha, empty_named, archived]})}
        browser, page = launch(playwright, directory, cache)
        test_list(page)
        test_layout(page)
        test_stale_startup(page)
        test_breadcrumb(page)
        test_bind(page)
        browser.close()
        test_bad_cache(playwright, directory)
        test_empty_archive(playwright, directory)
        test_connected_list_error_without_cache(playwright, directory)
        test_save_failure_survives_list_recovery(playwright, directory)
        test_wrong_project_receipt(playwright, directory)
        test_restore_none(playwright, directory)
print("project navigation ui ok")
