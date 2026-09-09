"""#497: actual App navigation; synthetic transport, no live user data.

Run with Node 22: uv run --no-project --with playwright python scripts/test-sidebar-disclosures-ui.py
"""
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
shots = Path('/private/tmp/cmspark-sidebar-497-shots')
shots.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='cmspark-sidebar-ui-') as directory:
    subprocess.run(['node', 'scripts/render-workspace-fixture.cjs', directory], cwd=root, check=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True)
        for width, height in [(760,740),(1040,760),(1440,900),(760,420),(320,480),(390,740),(759,740)]:
            page = browser.new_page(viewport={'width':width,'height':height})
            page.set_default_timeout(6000)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto((Path(directory)/'index.html').as_uri())
            page.wait_for_function('Boolean(window.fixtureState?.threads.length)')
            if width < 760:
                page.locator('.cm-navigation-toggle').click()
            nav = page.get_by_role('complementary', name='工作区', exact=True)
            tools = nav.locator('.cm-nav-tools')
            conversations = nav.get_by_role('region', name='最近对话', exact=True)
            toggle = nav.get_by_role('button', name='最近对话', exact=True)
            search = nav.get_by_role('textbox', name='筛选最近对话')
            assert tools.evaluate('(el)=>el.open') == (width >= 760)
            assert tools.evaluate('(el)=>Boolean(el.compareDocumentPosition(document.querySelector(".cm-nav-conversations")) & Node.DOCUMENT_POSITION_FOLLOWING)') == (width >= 760)
            if width == 1040:
                page.screenshot(path=str(shots/'wide-default.png'))
            search.fill('支付')
            active = page.evaluate('window.fixtureState.activeThreadId')
            toggle.focus()
            page.keyboard.press('Enter')
            assert toggle.get_attribute('aria-expanded') == 'false'
            assert not search.is_visible()
            assert not conversations.locator('.cm-nav-thread').first.is_visible()
            assert page.evaluate('window.fixtureState.activeThreadId') == active
            assert nav.get_by_role('button', name='新对话', exact=True).is_visible()
            assert nav.get_by_role('button', name='管理对话', exact=True).is_visible()
            if width == 1040:
                page.screenshot(path=str(shots/'conversations-collapsed.png'))
            page.keyboard.press('Tab')
            assert page.evaluate('document.activeElement.classList.contains("cm-nav-manage")')
            toggle.focus()
            page.keyboard.press('Space')
            assert toggle.get_attribute('aria-expanded') == 'true'
            assert search.input_value() == '支付'
            search.fill('')
            # All existing resource entries survive, and user collapse survives rerender.
            if not tools.evaluate('(el)=>el.open'):
                tools.locator('summary').click()
            assert nav.get_by_role('navigation', name='资源与能力').get_by_role('button').count() == 8
            assert nav.get_by_role('button', name='浏览器标签页', exact=True).locator('span').evaluate('(el)=>el.scrollWidth<=el.clientWidth')
            if width >= 760:
                tools.locator('summary').click()
                nav.locator('.cm-nav-thread').nth(1).click()
                assert not tools.evaluate('(el)=>el.open')
                tools.locator('summary').click()
                for label in ['浏览器标签页','技能','知识','场景与专家','会议','任务板','MCP','应用']:
                    button = nav.get_by_role('button', name=label, exact=True)
                    button.scroll_into_view_if_needed()
                    button.click()
                    assert button.get_attribute('aria-current') == 'true', label
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            nav.evaluate('(el)=>el.scrollTop=0')
            page.screenshot(path=str(shots/f'sidebar-{width}-{height}.png'))
            if width >= 760:
                toggle.click()
                nav.get_by_role('button', name='管理对话', exact=True).click()
                panel = page.get_by_role('dialog', name='历史对话列表', exact=True)
                panel.wait_for()
                for label in ['标签','手动分组','AI 分组','整理助手','关系图谱']:
                    assert panel.get_by_role('button', name=label, exact=True).count() == 1
            assert not errors, errors
            page.close()
            print(f'PASS {width}x{height}: defaults/order, keyboard collapse, query retention, preserved entries')
        browser.close()
