"""Exercise the production extension UI with an isolated, seeded Companion fixture.

Build companion first. Run from chrome-extension via
uv run --no-project --with playwright python scripts/test-workspace-appearance.py
Pass --screenshots DIR to save the three preview images.
"""
import argparse
import subprocess
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


project = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument("--screenshots", type=Path)
screenshots = parser.parse_args().screenshots
if screenshots:
    screenshots.mkdir(parents=True, exist_ok=True)


def shot(page, name):
    if screenshots:
        page.screenshot(path=str(screenshots / (name + ".png")))


def message(role, key, content):
    return dict(role=role, id=key, thread_id="demo-0",
                created_at="2026-11-27T10:00:00Z", content=content)


with tempfile.TemporaryDirectory(prefix="cmspark-extension-theme-") as directory:
    subprocess.run(["node", "scripts/render-workspace-fixture.cjs", directory], cwd=project, check=True)
    server = subprocess.Popen(["node", "scripts/personal-workspace-ui-fixture.cjs", directory],
                              cwd=project, stdout=subprocess.PIPE, text=True)
    try:
        url = server.stdout.readline().strip()
        if not url.startswith("http://127.0.0.1:"):
            raise RuntimeError("Local workspace fixture failed to start")
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="chrome", headless=True)
            page = browser.new_page(viewport={"width":1000, "height":740}, locale="zh-CN",
                                    color_scheme="light", reduced_motion="reduce")
            page.set_default_timeout(6000)
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(url)
            expect(page.get_by_role("heading", name="今天及已逾期")).to_be_visible()
            expect(page.get_by_role("banner", name="状态栏")).to_contain_text("个人工作台")
            expect(page.get_by_role("region", name="最近会议")).to_contain_text("暂无会议记录")
            shot(page, "extension-workspace")
            page.goto(url.split("/tabs/")[0] + "/sidepanel.html")
            page.set_viewport_size({"width":390, "height":720})
            field = page.get_by_role("textbox", name="消息内容")
            expect(field).to_be_enabled()
            page.get_by_role("button", name="打开工作区导航").click()
            page.get_by_role("region", name="最近对话").get_by_role("button", name="发布 v2.8", exact=False).click()
            expect(page.get_by_role("banner", name="状态栏")).to_have_attribute("data-active-thread-id", "demo-0")
            messages = [
                message("user","u","帮我梳理周五上线评审前的安排。"),
                message("assistant","a","### 周五上线评审\n\n需要在会议前确认两件事。\n\n- 林宁在周四下班前汇总数据库变更。\n- 周航在评审前复核回滚步骤，并把结果发到项目群。"),
            ]
            update = "msgs=>window.dispatchUI({type:'SET_MESSAGES',messages:msgs})"
            page.evaluate(update, messages)
            expect(page.get_by_role("heading", name="周五上线评审")).to_be_visible()
            menu = page.get_by_role("button", name="更多工具与设置")
            menu.focus()
            page.keyboard.press("Enter")
            popout = page.get_by_role("menuitem", name="弹出对话框")
            expect(popout).to_be_focused()
            page.keyboard.press("ArrowDown")
            expect(page.get_by_role("menuitem", name="提取技能")).to_be_focused()
            page.keyboard.press("Escape")
            expect(menu).to_be_focused()
            field.fill("再把时间和负责人列出来。")
            field.dispatch_event("keydown", {"key":"Enter", "isComposing":True})
            expect(field).to_have_value("再把时间和负责人列出来。")
            assert not page.evaluate("window.sent.some(m=>m.type==='chat.create')")
            for mode, background in [("light", "rgb(248, 248, 244)"), ("dark", "rgb(27, 33, 31)")]:
                page.emulate_media(color_scheme=mode, reduced_motion="reduce")
                expect(page.locator(".cm-workspace")).to_have_css("background-color", background)
                shot(page, "extension-chat-" + mode)
            rows = [dict(messages[i % 2], id=f"row-{i}") for i in range(24)]
            page.evaluate(update, rows)
            scroller = page.get_by_role("region", name="对话记录")
            expect(scroller.locator(".cmspark-msg-row")).to_have_count(len(rows))
            page.wait_for_function("()=>{const el=document.querySelector('.cm-chat-scroll');return el.scrollTop>0}")
            scroller.hover()
            page.mouse.wheel(0, -10000)
            jump = page.get_by_role("button", name="回到最新")
            expect(jump).to_be_visible()
            page.evaluate("m=>window.dispatchUI({type:'ADD_MESSAGE',message:m})",dict(messages[0],id="last"))
            assert scroller.evaluate("el=>el.scrollTop") < 25
            jump.click()
            expect(jump).to_be_hidden()
            assert scroller.evaluate("el=>el.scrollHeight-el.scrollTop-el.clientHeight") < 5
            for w,h in [(320,480),(375,540),(800,420),(760,740),(1440,900)]:
                page.set_viewport_size({"width":w,"height":h})
                box = field.bounding_box()
                assert box and box["y"] + box["height"] <= h
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            assert not errors, errors
            browser.close()
    finally:
        server.terminate()
        server.wait(10)
print("PASS workspace, sidebar, system themes, menu/IME, history position and responsive composer")
