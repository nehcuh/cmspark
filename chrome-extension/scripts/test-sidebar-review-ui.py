import subprocess
import sys
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]

def build(directory):
    subprocess.run([
        "node", "scripts/render-sidebar-review-fixture.cjs", directory
    ], cwd=root, check=True)

def launch(playwright, path, width, height):
    directory = tempfile.TemporaryDirectory()
    build(directory.name)
    server = subprocess.Popen(["python3", "scripts/serve-sidebar-review.py", directory.name], cwd=root)
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

def main():
    failed = 0
    with sync_playwright() as playwright:
        for name in TESTS:
            test = globals()[name]
            browser = page = directory = server = None
            try:
                browser, page, directory, server = launch(playwright, *ROUTES[name])
                ready(page)
                test(page)
            except Exception as exc:
                failed += 1
                print("FAIL", name, repr(exc)[:400])
            else:
                print("PASS", name)
            finally:
                if browser: browser.close()
                if server:
                    server.terminate()
                    try:
                        server.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        server.kill()
                        server.wait(timeout=5)
                if directory: directory.cleanup()
    print(f"ran={len(TESTS)} failed={failed}")
    if failed or len(TESTS) != len(EXPECTED):
        sys.exit(1)

def test_section_order(page):
    page.set_viewport_size({"width": 960, "height": 860})
    text = page.locator("aside.cm-navigation, nav.cm-navigation").inner_text()
    order = ["新对话", "项目", "资料与工具", "查找对话", "最近对话", "管理对话", "设置"]
    at = -1
    for label in order:
        nxt = text.find(label)
        assert nxt > at, label
        at = nxt

ROUTES = {
    "test_section_order": ("/sidepanel.html", 960, 860),
}
TESTS = list(ROUTES)
EXPECTED = list(ROUTES)

if __name__ == "__main__":
    main()
