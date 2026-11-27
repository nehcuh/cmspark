"""Real App UI, synthetic transport. Run after nvm use22 with uv --with playwright.
No live Companion, external account, installed extension or native shell is used.
"""
import json
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

project = Path(__file__).resolve().parent.parent
shots = Path(tempfile.gettempdir()) / 'cmspark-workspace-shots'
shots.mkdir(exist_ok=True)
def show_nav(page):
    nav = page.get_by_role('navigation', name='工作区', exact=True)
    if not nav.is_visible():
        page.get_by_role('button', name='打开工作区导航').click()
    return nav

def choose_thread(page):
    recent = show_nav(page).get_by_role('region', name='最近对话')
    disclosure = recent.get_by_role('button', name='最近对话', exact=True)
    if disclosure.get_attribute('aria-expanded') != 'true':
        disclosure.click()
    row = recent.get_by_role('button', name='发布 v2.8', exact=False).first
    row.focus()
    page.keyboard.press('Enter')
    expect(page.get_by_role('banner', name='状态栏')).to_have_attribute('data-active-thread-id', 'demo-0')

def show_tools(page):
    nav = show_nav(page)
    summary = nav.locator('summary', has_text='资料与工具')
    if not summary.locator('..').evaluate('el => el.open'):
        summary.click()
    return nav.get_by_role('group', name='当前任务')

with tempfile.TemporaryDirectory(prefix='cmspark-workspace-') as directory:
    subprocess.run(['node', 'scripts/render-workspace-fixture.cjs', directory, '--cold-home'], cwd=project, check=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='chrome', headless=True)
        page = browser.new_page(viewport={'width':1440,'height':900})
        page.set_default_timeout(6000)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto((Path(directory)/'index.html').as_uri())
        composer = page.get_by_role('textbox', name='消息内容', exact=True)
        composer.wait_for()
        expect(composer).to_be_enabled()
        composer.fill('尚未发送的草稿')
        assert not page.evaluate('window.sent.some(m=>["thread.create","chat.create"].includes(m.type))')
        composer.fill('')
        choose_thread(page)
        page.wait_for_function('() => { const el = document.querySelector("textarea[aria-label=消息内容]"); return el && !el.disabled }')
        for width,height in [(1440,900),(800,700),(760,640),(759,640),(390,740),(320,480)]:
            page.set_viewport_size({'width':width,'height':height})
            page.wait_for_timeout(120)
            assert not page.evaluate('document.documentElement.scrollWidth > innerWidth'), (width,height,'horizontal overflow')
            box = composer.bounding_box()
            assert box and box['width'] >= min(220,width-60), (width,box)
            assert box['y'] >= 0 and box['y']+box['height'] <= height, (width,box)
            assert page.get_by_role('button',name='打开工作区导航',exact=True).get_attribute('aria-expanded') == ('true' if width>=760 else 'false')
            if width in (1440,390,320):page.screenshot(path=str(shots/f'empty-{width}.png'))
        # New task preserves existing action, never sends an Agent message.
        page.get_by_role('button', name='新对话', exact=True).click()
        page.wait_for_function('window.sent.some(x=>x.type==="thread.create")')
        assert not page.evaluate('window.sent.some(x=>x.type==="chat.send" || x.type==="chat.create")')
        show_nav(page)
        page.get_by_role('navigation', name='工作区').get_by_role('button', name='设置', exact=True).click()
        settings=page.get_by_role('dialog', name='设置', exact=True)
        settings.wait_for()
        assert settings.is_visible()
        settings.get_by_role('button', name='关闭设置', exact=True).click()
        choose_thread(page)
        # Existing history is named and keyboard operable; Escape returns focus.
        history=page.get_by_role('button',name='对话管理（历史对话）',exact=True)
        history.click()
        dialog=page.get_by_role('dialog',name='对话管理',exact=True)
        dialog.wait_for()
        page.wait_for_function('document.activeElement?.getAttribute("aria-label")==="搜索线程"')
        row=dialog.get_by_role('button',name='打开 发布 v2.8',exact=False).first
        row.focus();page.keyboard.press('Enter')
        assert not dialog.is_visible()
        assert page.evaluate('window.sent.some(x=>x.type==="thread.select" && x.threadId==="demo-0")')
        history.click();dialog.wait_for();page.wait_for_timeout(100);page.keyboard.press('Escape')
        assert not dialog.is_visible()
        assert history.evaluate('(el)=>el===document.activeElement')
        # Context panel fits the short viewport; closes without losing composer.
        show_nav(page)
        show_tools(page)
        page.get_by_role('group', name='当前任务').get_by_role('button', name='知识', exact=True).click()
        context=page.get_by_test_id('context-panel-host')
        context.wait_for()
        assert context.bounding_box()['height'] <= 320
        assert composer.bounding_box()['y']+composer.bounding_box()['height'] <= 480
        history.click();dialog.wait_for();page.wait_for_timeout(100)
        row=dialog.get_by_role('button',name='打开 发布 v2.8',exact=False).first
        row.focus();page.keyboard.press('Escape')
        assert not dialog.is_visible() and context.is_visible(), 'Escape must close only history'
        history.click();dialog.wait_for();page.wait_for_timeout(100)
        dialog.get_by_title('更多',exact=True).click()
        menu=page.get_by_role('menu').last;menu.wait_for()
        page.get_by_role('button',name='个人工作台',exact=True).focus();page.keyboard.press('Escape')
        assert menu.is_visible(), 'History must not consume Escape from another surface'
        menu.get_by_role('button').first.focus();page.keyboard.press('Escape')
        assert not menu.is_visible() and dialog.is_visible()
        dialog.get_by_role('searchbox',name='搜索线程').focus();page.keyboard.press('Escape')
        assert not dialog.is_visible() and context.is_visible()
        page.get_by_role('button',name='收起面板',exact=True).click()
        # Long content + actual tool card disclosure are keyboard operable.
        messages=[{'id':'u1','thread_id':'demo-0','role':'user','content':'请核对支付服务 v2.8 的需求、代码与测试，整理变更材料。','created_at':'2026-09-07T10:00:00Z'},
          {'id':'a1','thread_id':'demo-0','role':'assistant','content':'已整理当前证据。\n\n### 需要补充的内容\n\n- 需求与开发任务已建立关联。\n- 测试对应提交仍待核对。\n\n'+'`https://devops.example.test/'+('long-path/'*25)+'`', 'created_at':'2026-09-07T10:01:00Z',
           'tool_calls':[{'id':'tc1','tool_name':'get_page_text','params':{},'status':'success','result':{'success':True,'data':{'content':'这是来自合成测试网页的实际展示文本。'*80}}}]}]
        page.set_viewport_size({'width':1440,'height':900})
        choose_thread(page)
        page.evaluate('(messages)=>window.dispatchUI({type:"SET_MESSAGES",messages})',messages)
        details=page.get_by_role('button',name='展开 get_page_text 详情',exact=True)
        details.focus();page.keyboard.press('Enter')
        assert page.get_by_role('button',name='收起 get_page_text 详情',exact=True).get_attribute('aria-expanded')=='true'
        page.screenshot(path=str(shots/'conversation-1440.png'))
        assert page.get_by_role('navigation', name='工作区', exact=True).bounding_box()['width']==220
        assert page.locator('.cm-chat-content').bounding_box()['width']<=780
        assert page.locator('.cm-composer-dock').bounding_box()['width']<=780
        page.evaluate("window.dispatchEvent(new Event('cmspark:open-coding-handoff'))")
        coding=page.get_by_role('dialog',name='编程接力 面板',exact=True)
        coding.wait_for()
        for width,height in [(1440,900),(320,480)]:
            page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(100)
            rail=page.locator('.cm-status-rail').bounding_box()
            assert coding.bounding_box()['y'] >= rail['y']+rail['height']-1
        coding.get_by_role('button',name='关闭',exact=True).click()
        page.set_viewport_size({'width':1440,'height':900})
        # #483 actual App owner isolation: A → B → A, including delayed events.
        page.evaluate("""() => {
          window.dispatchUI({type:'UPSERT_THREAD',thread:{...window.demoThreads[0],workspace_root:'/repo/owner-a'}});
          window.dispatchUI({type:'UPSERT_THREAD',thread:{...window.demoThreads[1],workspace_root:'/repo/owner-b'}});
          window.dispatchUI({type:'ACP_SESSION_EVENT',event:{session_id:'coding-a',thread_id:'demo-0',state:'running',agent_id:'Fixture A',transport:'acp',mode:'propose_diff',workspace_root:'/repo/owner-a',progress_tail:'OWNER_A_PROGRESS'}});
        }""")
        coding.wait_for()
        assert coding.get_by_text('OWNER_A_PROGRESS',exact=True).is_visible()
        coding.get_by_role('button',name='关闭',exact=True).click()
        chip=page.get_by_role('status',name='编程助手会话',exact=True)
        assert chip.is_visible() and 'Fixture A' in chip.inner_text()
        page.evaluate("window.dispatchUI({type:'SET_ACTIVE_THREAD',threadId:'demo-1'});window.dispatchUI({type:'SET_MESSAGES',messages:[]})")
        page.wait_for_function("window.fixtureState.activeThreadId==='demo-1'")
        assert not coding.is_visible() and not chip.is_visible()
        page.evaluate("window.dispatchUI({type:'ACP_SESSION_EVENT',event:{session_id:'coding-a',thread_id:'demo-0',state:'closed',progress_tail:'OWNER_A_RETURNED',handback:'A complete',pending_diffs:[{applyable:true}]}})")
        page.wait_for_timeout(100)
        assert not coding.is_visible() and not chip.is_visible(), 'A background completion must not open B'
        page.evaluate("window.dispatchUI({type:'ACP_SESSION_EVENT',event:{session_id:'coding-b',thread_id:'demo-1',state:'running',agent_id:'Fixture B',transport:'acp',workspace_root:'/repo/owner-b',progress_tail:'OWNER_B_PROGRESS'}})")
        coding.wait_for()
        assert coding.get_by_text('OWNER_B_PROGRESS',exact=True).is_visible()
        assert not coding.get_by_text('OWNER_A_RETURNED',exact=True).count()
        page.evaluate("window.dispatchUI({type:'ACP_SESSION_EVENT',event:{session_id:'coding-a',thread_id:'demo-0',state:'closed',progress_tail:'OWNER_A_LATE'}})")
        page.wait_for_timeout(100)
        assert coding.get_by_text('OWNER_B_PROGRESS',exact=True).is_visible(), 'A late event cannot replace B panel'
        coding.get_by_placeholder('继续对编程助手说…（侧栏监视）',exact=True).fill('Continue owner B')
        coding.get_by_role('button',name='发送',exact=True).click()
        coding.get_by_role('button',name='停止编程会话',exact=True).click()
        assert page.evaluate("window.sent.some(x=>x.type==='acp.session.prompt' && x.session_id==='coding-b' && x.thread_id==='demo-1')")
        assert page.evaluate("window.sent.some(x=>x.type==='acp.session.cancel' && x.session_id==='coding-b' && x.thread_id==='demo-1')")
        page.screenshot(path=str(shots/'coding-owner-b.png'))
        page.evaluate("window.dispatchUI({type:'SET_ACTIVE_THREAD',threadId:'demo-0'});window.dispatchUI({type:'SET_MESSAGES',messages:[]})")
        page.wait_for_function("window.fixtureState.activeThreadId==='demo-0'")
        assert not coding.is_visible()
        assert chip.is_visible() and 'Fixture A' in chip.inner_text() and 'Fixture B' not in chip.inner_text()
        page.evaluate("window.dispatchEvent(new Event('cmspark:open-coding-handoff'))")
        coding.wait_for()
        assert coding.get_by_text('OWNER_A_LATE',exact=True).is_visible()
        assert not coding.get_by_text('OWNER_B_PROGRESS',exact=True).count()
        # A delayed B folder/Git reply cannot change A's workspace context.
        page.evaluate("""() => {
          window.emitRuntime({type:'workspace.pick_result',thread_id:'demo-1',thread:{id:'demo-1',workspace_root:'/repo/wrong-owner'},path:'/repo/wrong-owner',bound:true});
          window.dispatchEvent(new CustomEvent('cmspark:coding.git_status',{detail:{thread_id:'demo-1',workspace_root:'/repo/owner-a',is_repo:true,branch:'WRONG_OWNER_BRANCH',dirty_count:99}}));
        }""")
        page.wait_for_timeout(100)
        assert '/repo/wrong-owner' not in coding.inner_text() and 'WRONG_OWNER_BRANCH' not in coding.inner_text()
        coding.get_by_role('button',name='应用 diff',exact=True).click()
        assert page.evaluate("window.sent.some(x=>x.type==='acp.apply_diff' && x.session_id==='coding-a' && x.thread_id==='demo-0')")
        page.screenshot(path=str(shots/'coding-owner-return-a.png'))
        coding.get_by_role('button',name='关闭',exact=True).click()
        page.evaluate("window.dispatchUI({type:'CLEAR_CODING_SESSION',sessionId:'coding-a'});window.dispatchUI({type:'CLEAR_CODING_SESSION',sessionId:'coding-b'})")
        page.wait_for_timeout(100)
        assert not chip.is_visible()
        page.evaluate("window.dispatchUI({type:'UPSERT_THREAD',thread:{...window.demoThreads[0],workspace_root:null}});window.dispatchUI({type:'UPSERT_THREAD',thread:{...window.demoThreads[1],workspace_root:null}})")
        page.evaluate('(messages)=>window.dispatchUI({type:"SET_MESSAGES",messages})',messages)
        # Confirmation queue is still rendered by the unchanged production gate.
        confirmation={'confirmation_id':'fixture-confirm','tool_name':'shell_exec','dangerous_apis':['shell'], 'code_preview':'git diff base..head','risk_level':'high','requested_at':'2026-09-07T10:00:00Z','timeout_ms':45000}
        show_tools(page)
        assert page.get_by_role('group', name='当前任务').is_visible()
        page.get_by_role('group', name='当前任务').get_by_role('button', name='知识', exact=True).click()
        page.evaluate('(request)=>window.dispatchUI({type:"ADD_SECURITY_CONFIRMATION",request})',confirmation)
        page.set_viewport_size({'width':320,'height':480})
        page.wait_for_timeout(100)
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
        assert composer.bounding_box()['y']+composer.bounding_box()['height'] <= 480
        gate=page.get_by_role('alertdialog').first
        for name in ['允许','拒绝','停止']:
            button=gate.get_by_role('button',name=name,exact=True)
            box=button.bounding_box()
            assert box and 0 <= box['y'] and box['y']+box['height'] <= 480
            assert button.evaluate('(el)=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}')
        show_nav(page)
        for name in ['允许','拒绝','停止']:
            assert gate.get_by_role('button',name=name,exact=True).evaluate('(el)=>{const r=el.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}')
        choose_thread(page)
        page.screenshot(path=str(shots/'confirmation-320.png'))
        assert not page.evaluate('window.sent.some(x=>x.type==="security.confirmation.response")')
        page.evaluate("window.dispatchUI({type:'REMOVE_SECURITY_CONFIRMATION',confirmationId:'fixture-confirm'});window.dispatchUI({type:'SET_THREAD_BUSY',threadId:'demo-0',busy:true})")
        stop=page.get_by_role('button',name='停止本轮',exact=True)
        stop.wait_for()
        assert stop.bounding_box()['y']+stop.bounding_box()['height'] <= 480
        page.get_by_role('button',name='纠偏',exact=True).wait_for()
        page.get_by_role('button',name='排队',exact=True).wait_for()
        show_nav(page)
        assert stop.evaluate('(el)=>{const r=el.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}')
        choose_thread(page)
        page.screenshot(path=str(shots/'running-320.png'))
        page.evaluate("window.dispatchUI({type:'SET_THREAD_BUSY',threadId:'demo-0',busy:false});window.dispatchUI({type:'SET_CONNECTION',state:'disconnected'})")
        page.get_by_role('button',name='重新连接',exact=True).wait_for()
        assert composer.is_disabled()
        page.screenshot(path=str(shots/'offline-320.png'))
        # 200% equivalent CSS viewport reflow + reduced motion (actual media).
        page.emulate_media(reduced_motion='reduce')
        page.set_viewport_size({'width':720,'height':450})
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
        assert page.locator('.cm-workspace').evaluate('(el)=>getComputedStyle(el).scrollBehavior')=='auto'
        assert not errors, errors
        browser.close()
print('PASS: actual App responsive matrix, drawer/history keyboard, settings/context, full-width input, tool disclosure, confirmation no-submit, A/B coding ownership and controls, reflow/reduced motion. Synthetic transport only.')
