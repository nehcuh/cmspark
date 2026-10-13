"""Actual React component/CSS in isolated Chromium; never connects to user services."""
import json
from pathlib import Path
import subprocess
import tempfile
from playwright.sync_api import sync_playwright

project = Path(__file__).resolve().parent.parent
shots = Path(tempfile.gettempdir()) / 'cmspark-613-navigation-shots'
shots.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory() as out:
    subprocess.run(['node', 'scripts/render-task-navigation-fixture.cjs', out], cwd=project, check=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True)
        page = browser.new_page()
        page.set_default_timeout(5000)
        browser_errors = []
        page.on('pageerror', lambda error: browser_errors.append(str(error)))
        page.route('**/*', lambda route: route.abort())
        page.set_content((Path(out) / 'fixture.html').read_text())
        page.add_script_tag(content=(Path(out) / 'fixture.js').read_text())
        for width in [320, 390, 900]:
            page.set_viewport_size({'width': width, 'height': 650})
            page.evaluate("window.showCase('available')")
            button = page.get_by_role('button', name='返回主任务', exact=False)
            button.wait_for()
            assert button.is_enabled()
            assert page.locator('.cm-parent-task-title').inner_text().startswith('主任务 · Office')
            assert page.locator('.cm-child-task-title').inner_text().startswith('子任务 · 格式入口')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
            rect = button.bounding_box()
            assert rect and rect['x'] >= 0 and rect['x'] + rect['width'] <= width, rect
            button.click()
            button.focus()
            page.keyboard.press('Enter')
            page.keyboard.press('Space')
            page.screenshot(path=str(shots / f'available-{width}.png'))
        calls = page.evaluate('window.navigationCalls')
        assert len(calls) == 9, calls
        assert all(call == {'type': 'thread.select', 'threadId': 'parent', 'busy': {'parent': True, 'child': True}} for call in calls), calls
        for kind, label in [('missing', '主任务暂不可用'), ('trashed', '主任务在回收站'), ('cycle', '主任务关系无效')]:
            page.evaluate('(kind) => window.showCase(kind)', kind)
            button = page.get_by_role('button', name=label, exact=True)
            button.wait_for()
            assert button.is_disabled()
            assert page.locator('.cm-child-task-title').is_visible()
            button.evaluate('(element) => element.click()')
            assert len(page.evaluate('window.navigationCalls')) == 9
            page.screenshot(path=str(shots / f'{kind}.png'))
        assert not browser_errors, browser_errors
        browser.close()
(shots / 'evidence.json').write_text(json.dumps({'widths': [320, 390, 900], 'navigation_calls': calls, 'unavailable_cases': ['missing', 'trashed', 'cycle']}, ensure_ascii=False, indent=2))
print(f'PASS: rendered parent/child, click/Enter/Space, no overflow and unavailable refusal; screenshots {shots}')
