"""Task 2 Chrome coverage for the project list. No package.json dependency.

cd chrome-extension && nvm use 22
uv run --no-project --with playwright python scripts/test-project-navigation-ui.py

Task 3 startup, breadcrumb, bind, and tool cases stay in this file.
Set CMSPARK_PROJECT_NAV_FULL=1 to run them. This node's default run does not.
"""
import json
import os
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
    page.evaluate("() => window.dispatchUI({type:'SET_CONNECTION', state:'connected'})")
    page.wait_for_function("window.sent.filter(m => m.type==='project.list').length >= 2")
    listed = page.evaluate("() => window.sent.filter(m => m.type==='project.list')[0]")
    page.evaluate("(msg) => window.emitRuntime({id: msg.id, type:'project.state', revision: 9, projects:[{id:'11111111-1111-4111-8111-111111111111', name:'Zed', created_at:'t', updated_at:'t', archived_at:null}]})", listed)
    assert page.get_by_role("button", name="旧项目", exact=True).count() == 1
    assert page.get_by_role("button", name="Zed", exact=True).count() == 0
    offline = page.locator("[aria-label=项目]").inner_text()
    assert "还没有项目" not in offline

def test_bad_cache(playwright, directory):
    browser, page = launch(playwright, directory, {LIST_KEY: "{not-json"})
    open_projects(page)
    text = page.locator("[aria-label=项目]").inner_text()
    assert "还没有项目" not in text
    assert "无法取回项目列表" in text or "正在读取项目" in text
    page.screenshot(path=str(shots / "project-list-bad-cache.png"))
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
        browser.close()
        test_bad_cache(playwright, directory)
        test_empty_archive(playwright, directory)
print("project navigation ui ok")
