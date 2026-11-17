"""Real App shell. Cold start stays on the project home; settings and tools are not inside the hidden session layer.

cd chrome-extension && uv run --no-project --with playwright python scripts/test-app-shell-ui.py
"""
import subprocess
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
shots = Path("/opt/cursor/artifacts")

def serve(directory: Path):
    handler = lambda *args, **kwargs: SimpleHTTPRequestHandler(*args, directory=str(directory), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    Thread(target=server.serve_forever, daemon=True).start()
    return server

def open_session(page, surface):
    if surface == "workspace":
        page.get_by_role("navigation", name="工作区").get_by_role("button", name="发布 v2.8", exact=False).first.click()
    else:
        page.get_by_role("navigation", name="工作区").get_by_role("button", name="最近对话", exact=True).focus()
        page.keyboard.press("Enter")
        row = page.get_by_role("region", name="最近对话").get_by_role("button", name="发布 v2.8", exact=False).first
        row.focus()
        page.keyboard.press("Enter")
    page.wait_for_function('() => { const el = document.querySelector("textarea[aria-label=消息内容]"); return el && !el.disabled }')

def check_surface(page, surface):
    composer = page.get_by_role("textbox", name="消息内容", exact=True)
    composer.wait_for()
    assert composer.is_disabled(), surface
    assert composer.is_visible(), surface
    nav = page.get_by_role("navigation", name="工作区")
    nav.get_by_role("button", name="设置", exact=True).click()
    settings = page.get_by_role("dialog", name="设置", exact=True)
    settings.wait_for()
    assert settings.is_visible()
    settings.get_by_role("button", name="关闭设置", exact=True).click()
    assert not settings.is_visible()
    if surface == "workspace":
        assert page.get_by_role("group", name="当前任务").get_by_role("button").first.is_visible()
    else:
        nav.get_by_role("button", name="工具", exact=True).click()
        current = page.get_by_role("group", name="当前任务")
        assert current.get_by_role("button").all_inner_texts()[:3] == ["技能", "知识", "历史"]
        current.get_by_role("button", name="技能", exact=True).click()
        page.get_by_test_id("context-panel-host").wait_for()
        page.get_by_role("button", name="收起面板", exact=True).click()
    open_session(page, surface)
    assert composer.is_enabled()
    for width, height in ((320, 800), (400, 800), (759, 800), (960, 800), (1200, 800)):
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(80)
        assert not page.evaluate("document.documentElement.scrollWidth > innerWidth"), (surface, width)
        box = composer.bounding_box()
        assert box and box["y"] >= 0 and box["y"] + box["height"] <= height + 1, (surface, width, box)
    page.screenshot(path=str(shots / f"app-shell-{surface}.png"))

shots.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix="cmspark-app-shell-") as directory:
    subprocess.run(["node", "scripts/render-workspace-fixture.cjs", directory, "--cold-home"], cwd=root, check=True)
    base = Path(directory)
    (base / "tabs").mkdir()
    (base / "tabs" / "workspace.html").write_text((base / "index.html").read_text())
    (base / "tabs" / "app.js").write_bytes((base / "app.js").read_bytes())
    if (base / "app.css").exists():
        (base / "tabs" / "app.css").write_bytes((base / "app.css").read_bytes())
    server = serve(base)
    host = f"http://127.0.0.1:{server.server_port}"
    pages = {
        "sidepanel": host + "/",
        "popout": host + "/?surface=popout",
        "workspace": host + "/tabs/workspace.html",
    }
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        for surface, url in pages.items():
            page = browser.new_page(viewport={"width": 1200, "height": 800})
            page.set_default_timeout(8000)
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(url)
            page.wait_for_function("Boolean(window.dispatchUI)")
            check_surface(page, surface)
            assert not errors, (surface, errors)
            page.close()
        browser.close()
    server.shutdown()
print("app shell ui ok")
