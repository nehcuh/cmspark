import argparse
import subprocess
import sys
import tempfile
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
NAV = "打开工作区导航"

def seed(page):
    page.evaluate("""() => {
      window.__connection = 'connected'
      window.dispatchUI({type:'SET_CONNECTION', state:'connected'})
      const now = new Date().toISOString()
      window.dispatchUI({type:'SET_THREADS', threads:['周末清单','示例采购'].map((alias, i) => ({
        id:'sidebar-' + i, alias, created_at:now, updated_at:now,
        config_override:{}, tool_whitelist:null, pinned_tabs:[], active_skill_ids:[], message_count:2
      }))})
      window.dispatchUI({type:'SET_ACTIVE_THREAD', threadId:'sidebar-0'})
    }""")
    expect(page.get_by_role("textbox", name="消息内容")).to_be_enabled()
    page.evaluate("""() => window.emitRuntime({type:'thread.messages', thread_id:'sidebar-0', messages:[
      {role:'user',content:'帮我列一个周末清单。'},
      {role:'assistant',content:'先查天气，再安排一件想做的事。'}], run_status:'idle'})""")
    expect(page.get_by_text("帮我列一个周末清单。", exact=True)).to_be_visible()

def verify(page, base, output):
    def visit(path, width):
        page.set_viewport_size({"width": width, "height": 860})
        page.goto(base + path)
        page.wait_for_function("window.dispatchUI && !document.body.innerText.includes('界面渲染错误')")
        return page.locator("[data-navigation-mode]")
    def shot(name):
        if output:
            page.screenshot(path=output / (name + ".png"))
    for path, name, cutoff in [("/sidepanel.html","sidepanel",760),
                               ("/tabs/workspace.html?view=chat","workspace",760),
                               ("/sidepanel.html?surface=popout","popout",960)]:
        shell = visit(path, cutoff - 1)
        expect(shell).to_have_attribute("data-navigation-mode", "layered")
        page.set_viewport_size({"width": cutoff, "height": 860})
        expect(shell).to_have_attribute("data-navigation-mode", "resident")
        nav = page.get_by_role("navigation", name="工作区", exact=True)
        expect(nav).to_be_visible()
        assert abs(nav.bounding_box()["width"] - 220) < 1
        toggle = page.get_by_role("button", name=NAV)
        toggle.click()
        expect(nav).to_be_hidden()
        expect(toggle).to_be_focused()
        toggle.click()
        expect(nav).to_be_visible()
        print("PASS", name, cutoff, flush=True)
    shell = visit("/sidepanel.html", 420)
    seed(page)
    toggle = page.get_by_role("button", name=NAV)
    expect(toggle).to_have_attribute("aria-expanded", "false")
    expect(page.get_by_text("资料与工具", exact=True)).to_be_hidden()
    shot("narrow-collapsed")
    toggle.click()
    disclosure = page.get_by_role("dialog", name="工作区导航")
    expect(disclosure).to_be_visible()
    assert disclosure.bounding_box()["height"] <= 860 * .28 + 1
    assert disclosure.evaluate("(e) => e.contains(document.activeElement)")
    shot("narrow-navigation")
    page.keyboard.press("Escape")
    expect(toggle).to_be_focused()
    expect(disclosure).to_be_hidden()
    toggle.click()
    disclosure.get_by_role("button", name="关闭导航").click()
    expect(toggle).to_be_focused()
    expect(disclosure).to_be_hidden()
    print("PASS compact keyboard and close", flush=True)

    shell = visit("/sidepanel.html", 960)
    seed(page)
    nav = page.get_by_role("navigation", name="工作区", exact=True)
    text = nav.inner_text()
    labels = ["新对话", "项目", "资料与工具", "查找对话", "最近对话", "管理对话", "设置"]
    assert [text.index(label) for label in labels] == sorted(text.index(label) for label in labels)
    chat_a = nav.get_by_role("button", name="周末清单", exact=True)
    chat_b = nav.get_by_role("button", name="示例采购", exact=True)
    expect(chat_a).to_have_attribute("aria-current", "page")
    expect(chat_a).to_have_css("background-color", "rgb(233, 233, 230)")
    chat_b.hover()
    expect(chat_b).to_have_css("background-color", "rgb(238, 238, 236)")
    shot("wide-sidebar")
    nav.get_by_role("textbox", name="筛选最近对话").fill("采购")
    expect(chat_a).to_have_count(0)
    expect(chat_b).to_be_visible()
    nav.get_by_role("textbox", name="筛选最近对话").fill("")
    box = page.get_by_role("textbox", name="消息内容")
    box.fill("A 的草稿")
    chat_b.click()
    expect(box).to_have_value("")
    expect(box).to_be_focused()
    box.fill("B 的草稿")
    chat_a.click()
    expect(box).to_have_value("A 的草稿")
    print("PASS navigation order, search and draft isolation", flush=True)
    entry = nav.get_by_role("button", name="管理对话")
    entry.click()
    manager = page.get_by_role("dialog", name="对话管理", exact=True)
    expect(manager).to_be_visible()
    for label in ["AI 提取标签", "整理助手", "关系图谱", "回收站", "AI 分组"]:
        expect(manager.get_by_role("button", name=label, exact=True)).to_be_visible()
    extract = manager.get_by_role("button", name="AI 提取标签")
    extract.click()
    confirm = manager.get_by_role("alertdialog", name="确认提取标签")
    expect(confirm).to_be_visible()
    cancel = confirm.get_by_role("button", name="取消", exact=True)
    expect(cancel).to_be_focused()
    page.keyboard.press("Escape")
    expect(extract).to_be_focused()
    assert page.evaluate("window.sent.filter(m=>m.type==='thread.extract_digest').length") == 0
    shot("history-management")
    manager.get_by_role("button", name="关系图谱", exact=True).click()
    assert page.evaluate("window.sent.some(m=>m.type==='thread_graph.open')")
    manager.get_by_role("button", name="关闭历史对话").click()
    expect(entry).to_be_focused()
    expect(box).to_have_value("A 的草稿")
    nav.get_by_role("button", name="历史", exact=True).click()
    expect(page.get_by_text("暂无操作历史", exact=True)).to_be_visible()
    print("PASS history entry, confirmation and graph", flush=True)

    nav.get_by_text("项目", exact=True).click()
    page.wait_for_function("window.sent.some(m=>m.type==='project.list')")
    page.evaluate("""() => {
      const request = window.sent.filter(m=>m.type==='project.list').at(-1)
      window.emitRuntime({type:'error', id:request.id, error:'fixture listing failure'})
    }""")
    retry = nav.get_by_role("button", name="重试", exact=True)
    expect(retry).to_be_visible()
    expect(nav.get_by_text("还没有项目", exact=True)).to_have_count(0)
    initial = page.evaluate("window.sent.filter(m=>m.type==='project.list').length")
    retry.click()
    assert page.evaluate("window.sent.filter(m=>m.type==='project.list').length") == initial + 1
    page.evaluate("""() => {
      const request = window.sent.filter(m=>m.type==='project.list').at(-1)
      const now = new Date().toISOString()
      const id = '12345678-1234-4123-8123-123456789abc'
      const thread = window.fixtureState.threads.find(t=>t.id==='sidebar-1')
      window.dispatchUI({type:'UPSERT_THREAD', thread:{...thread, project_id:id}})
      window.emitRuntime({type:'project.state',id:request.id,revision:1,projects:[
        {id,name:'家庭项目',created_at:now,updated_at:now,archived_at:null}
      ]})
    }""")
    nav.get_by_role("button", name="家庭项目", exact=True).click()
    expect(chat_a).to_have_count(0)
    expect(chat_b).to_be_visible()
    expect(page.get_by_role("region", name="项目详情")).to_be_visible()
    shot("project-filter")
    page.set_viewport_size({"width": 420, "height": 860})
    expect(disclosure).to_be_hidden()
    toggle.click()
    page.get_by_role("region", name="项目详情").get_by_role("button", name="示例采购").click()
    expect(disclosure).to_be_hidden()
    expect(box).to_be_focused()
    page.set_viewport_size({"width": 960, "height": 860})
    expect(nav).to_be_visible()
    expect(box).to_have_value("B 的草稿")
    print("PASS project list retry and filter", flush=True)

    nav.get_by_role("button", name="设置", exact=True).click()
    page.get_by_role("button", name="模型与推理", exact=True).click()
    vision = page.get_by_text("视觉模型（看图描述）", exact=True)
    expect(vision).to_be_hidden()
    page.locator('[data-settings-page="model"]').get_by_text("其他能力", exact=True).click()
    expect(vision).to_be_visible()
    page.keyboard.press("Escape")
    print("PASS secondary model remains accessible", flush=True)

    page.evaluate("window.dispatchUI({type:'SET_ACTIVE_THREAD',threadId:null})")
    page.wait_for_function("window.fixtureState.activeThreadId === null")
    expect(box).to_be_enabled()
    page.evaluate("window.__rejectCreate = true")
    box.fill("第一句")
    page.get_by_role("button", name="发送", exact=True).click()
    expect(page.get_by_text("创建请求未发送，输入已保留，可以重试。")).to_be_visible()
    expect(box).to_have_value("第一句")
    page.evaluate("window.__rejectCreate = false; window.sent.length = 0")
    page.clock.install()
    send = page.get_by_role("button", name="发送", exact=True)
    send.click()
    send.click()
    page.get_by_role("button", name="开始第一则对话").click()
    created = page.evaluate("window.sent.filter(m=>m.type==='thread.create')")
    assert len(created) == 1
    expect(box).to_have_value("第一句")
    page.clock.fast_forward(15_100)
    lookup = page.get_by_role("button", name="查询创建结果")
    expect(lookup).to_be_visible()
    count = page.evaluate("window.sent.filter(m=>m.type==='thread.list').length")
    lookup.click()
    assert page.evaluate("window.sent.filter(m=>m.type==='thread.list').length") == count + 1
    assert page.evaluate("window.sent.filter(m=>m.type==='thread.create').length") == 1
    expect(box).to_have_value("第一句")
    page.evaluate("""(id) => window.emitRuntime({type:'thread.created', id, thread:{
      id, alias:'', created_at:new Date().toISOString(), updated_at:new Date().toISOString(),
      config_override:{}, tool_whitelist:null, pinned_tabs:[], active_skill_ids:[]
    }})""", created[0]["id"])
    expect(page.get_by_role("button", name="开始第一则对话")).to_have_count(0)
    expect(box).to_have_value("第一句")
    print("PASS late creation receipt preserves the first draft", flush=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--screenshots", type=Path)
    args = parser.parse_args()
    if args.screenshots:
        args.screenshots.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as directory:
        subprocess.run(["node", "scripts/render-sidebar-review-fixture.cjs", directory], cwd=ROOT, check=True)
        server = subprocess.Popen([sys.executable, "scripts/serve-sidebar-review.py", directory], cwd=ROOT,
                                  stdout=subprocess.PIPE, text=True)
        try:
            port = int(server.stdout.readline())
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(channel="chrome", headless=True)
                page = browser.new_page()
                page.set_default_timeout(8000)
                verify(page, f"http://127.0.0.1:{port}", args.screenshots)
                browser.close()
        finally:
            server.terminate()
            server.wait(timeout=5)

if __name__ == "__main__":
    main()
