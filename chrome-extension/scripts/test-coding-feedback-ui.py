"""Actual App/panel/chip with isolated transport/clipboard and recorded Companion payloads.
Run after nvm use22 via uv + an available Playwright Python environment. No live shell/model.
CMSPARK_CODING_BASELINE_PANEL optionally selects the immutable old panel for a red proof.
"""
import json
import os
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

project = Path(os.environ.get('CMSPARK_CODING_FIXTURE_ROOT', str(Path(__file__).resolve().parent.parent)))
fixture = json.loads(Path(os.environ.get('CMSPARK_CODING_CONTROL_FIXTURE', str(project / 'tests/fixtures/coding-control-522.json'))).read_text())
checks = []
with tempfile.TemporaryDirectory(prefix='cmspark-coding-ui-') as directory:
    builder = project / 'scripts/render-workspace-fixture.cjs'
    baseline = os.environ.get('CMSPARK_CODING_BASELINE_PANEL')
    if baseline:
        source = builder.read_text().replace("plugins:[{name:'synthetic-transport'", "plugins:[{name:'baseline-panel',setup(b){b.onLoad({filter:/CodingAgentPanel\\.tsx$/},args=>({contents:fs.readFileSync(process.env.CMSPARK_CODING_BASELINE_PANEL,'utf8'),loader:'tsx',resolveDir:path.dirname(args.path)}));}},{name:'synthetic-transport'")
        builder = Path(directory) / 'baseline-builder.cjs'
        builder.write_text(source)
    subprocess.run(['node', str(builder), directory], cwd=project, check=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='chrome', headless=True)
        page = browser.new_page(viewport={'width':1000,'height':900})
        page.set_default_timeout(6000)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script("const realNow=Date.now.bind(Date);const clockOffset=" + str(fixture['progress']['terminal_command_expires_at'] - 30000) + "-realNow();Date.now=()=>realNow()+clockOffset;Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{if(window.clipboardFail)throw new Error('fixture clipboard denied');window.copiedCommand=text}}})")
        page.goto((Path(directory)/'index.html').as_uri())
        page.wait_for_function('window.dispatchUI && window.fixtureState.activeThreadId')
        page.evaluate("""payload => {
          window.codingFixture=payload;
          window.dispatchUI({type:'UPSERT_THREAD',thread:{...window.demoThreads[0],id:payload.progress.thread_id,alias:'Synthetic coding owner',workspace_root:payload.progress.workspace_root}});
          window.dispatchUI({type:'SET_ACTIVE_THREAD',threadId:payload.progress.thread_id});
          window.emitCoding(payload.progress);
        }""", fixture)
        page.wait_for_function("window.fixtureState.activeThreadId==='owner-522' && window.fixtureState.codingSessionsById['fixture-session']")
        page.evaluate("window.dispatchEvent(new Event('cmspark:open-coding-handoff'))")
        coding = page.get_by_role('dialog', name='编程接力 面板', exact=True)
        coding.wait_for()
        stop = coding.get_by_role('button', name='停止监视会话', exact=True)
        # The first negative fails on the baseline panel (swallowed callback error).
        page.evaluate("window.stopReply='last-error'")
        stop.click()
        coding.get_by_role('alert').filter(has_text='Fixture runtime disconnected').wait_for()
        assert '已停止' not in coding.inner_text()
        assert not stop.is_disabled()
        page.evaluate("window.stopReply='refused'")
        stop.click()
        coding.get_by_role('alert').filter(has_text='Fixture forwarding refused').wait_for()
        assert not stop.is_disabled()
        page.evaluate("window.stopReply='throw'")
        stop.click()
        coding.get_by_role('alert').filter(has_text='Fixture runtime context invalidated').wait_for()
        checks.append('runtime lastError/refusal/throw are visible; none claims stopped')
        # Runtime forwarding success must still wait for a real owner-stamped Companion receipt.
        page.evaluate("window.stopReply='defer'")
        stop.click()
        coding.get_by_text('停止请求已发送，等待本机会话确认。', exact=True).wait_for()
        page.evaluate("window.finishStop({ok:true})")
        assert stop.is_disabled()
        assert '已停止' not in coding.inner_text()
        page.evaluate("window.emitCoding({...window.codingFixture.receipt,thread_id:'wrong-owner'})")
        assert stop.is_disabled()
        page.evaluate("window.emitCoding(window.codingFixture.refused)")
        coding.get_by_role('alert').filter(has_text=fixture['refused']['error']).wait_for()
        assert not stop.is_disabled()
        stop.click()
        page.evaluate("window.finishStop({ok:true});window.emitCoding(window.codingFixture.receipt)")
        coding.get_by_text('已收到停止确认', exact=True).wait_for()
        assert '已停止' in coding.inner_text()
        assert not stop.count()
        page.evaluate("window.emitCoding(window.codingFixture.stopped);window.emitCoding(window.codingFixture.progress)")
        assert '已停止' in coding.inner_text() and not stop.count()
        # Actual closed-session refusals are not Stop failures and remain visible after an ack.
        coding.get_by_role('button', name='关闭', exact=True).click()
        chip = page.get_by_role('status', name='编程助手会话', exact=True)
        page.evaluate("window.prompt=()=> 'synthetic closed followup'")
        chip.get_by_role('button', name='追问', exact=True).click()
        assert page.evaluate("window.sent.some(x=>x.type==='acp.session.followup'&&x.session_id==='fixture-session'&&x.thread_id==='owner-522')")
        page.evaluate("window.emitCoding(window.codingFixture.followupRefused)")
        chip.get_by_role('alert').filter(has_text=fixture['followupRefused']['error']).wait_for()
        assert '已停止' in chip.inner_text()
        page.evaluate("window.dispatchEvent(new Event('cmspark:open-coding-handoff'))")
        coding.wait_for()
        coding.get_by_role('alert').filter(has_text=fixture['followupRefused']['error']).wait_for()
        checks.append('actual closed followup rejection stays visible in chip and panel after cancellation')
        checks.append('forwarding != Stop; actual ack/event stop and late-running refusal')
        # Exact recorded original command only; no focus/resume/execute authority.
        copy = coding.get_by_role('button', name='复制本次启动命令', exact=True)
        before = page.evaluate('window.sent.length')
        copy.click()
        page.wait_for_function('window.copiedCommand')
        assert page.evaluate('window.copiedCommand') == fixture['progress']['terminal_command_line']
        assert page.evaluate('window.sent.length') == before
        assert '手动执行会启动 Agent' in coding.inner_text()
        assert coding.get_by_role('button', name='发送', exact=True).is_disabled()
        page.evaluate("window.clipboardFail=true;document.execCommand=()=>false")
        copy.click()
        coding.get_by_role('alert').filter(has_text='复制启动命令失败').wait_for()
        page.evaluate("window.clipboardFail=false;window.emitCoding({...window.codingFixture.initial,session_id:'command-unavailable'})")
        coding.get_by_text('本次启动命令不可用；请自行切换到已有外部终端。', exact=True).wait_for()
        assert not coding.get_by_role('button', name='复制本次启动命令', exact=True).count()
        page.evaluate("window.emitCoding({...window.codingFixture.progress,session_id:'command-expiry',terminal_command_expires_at:Date.now()+500})")
        coding.get_by_role('button', name='复制本次启动命令', exact=True).wait_for()
        coding.get_by_text('临时启动命令已过期；请自行切换到已有外部终端。', exact=True).wait_for()
        assert not coding.get_by_role('button', name='复制本次启动命令', exact=True).count()
        checks.append('CLI copy equals actual launch command; copy sends no host command; composer remains disabled')
        # A late callback may update its immutable old owner row, never the new current session.
        page.evaluate("window.emitCoding({...window.codingFixture.progress,session_id:'late-old'});window.stopReply='defer'")
        stop.wait_for(); stop.click()
        page.evaluate("window.emitCoding({...window.codingFixture.progress,session_id:'late-new'});window.finishStop(undefined,'OLD_CALLBACK_FAILURE')")
        page.wait_for_function("window.fixtureState.codingSessionIdByThread['owner-522']==='late-new'")
        assert 'OLD_CALLBACK_FAILURE' not in coding.inner_text()
        assert not stop.is_disabled()
        checks.append('late original callback cannot contaminate replacement session')
        # The collapsed chip uses the same feedback contract as the panel.
        coding.get_by_role('button', name='关闭', exact=True).click()
        chip = page.get_by_role('status', name='编程助手会话', exact=True)
        page.evaluate("window.stopReply='last-error'")
        chip.get_by_role('button', name='停止监视会话', exact=True).click()
        chip.get_by_role('alert').filter(has_text='Fixture runtime disconnected').wait_for()
        page.evaluate("window.stopReply='defer'")
        chip.get_by_role('button', name='停止监视会话', exact=True).click()
        page.evaluate("window.finishStop({ok:true})")
        chip.get_by_role('alert').filter(has_text='停止尚未确认').wait_for(timeout=12000)
        assert not chip.get_by_role('button', name='停止监视会话', exact=True).is_disabled()
        assert '已停止' not in chip.inner_text()
        checks.append('collapsed chip Stop error remains visible')
        # Large inactive terminal payloads are retired through actual reducer and returning UI.
        page.evaluate("""() => {
          window.dispatchUI({type:'SET_ACTIVE_THREAD',threadId:'demo-0'});
          window.dispatchUI({type:'SET_MESSAGES',messages:[{id:'saved-result',role:'assistant',content:'SAVED_THREAD_RESULT'}]});
          for(let i=0;i<100;i++)window.emitCoding({...window.codingFixture.stopped,session_id:'cache-'+i,thread_id:'owner-522',progress_tail:'x'.repeat(16000),handback:'🧪'.repeat(8000)});
        }""")
        page.wait_for_function("window.fixtureState.codingSessionsById['cache-99']")
        assert page.evaluate("Object.values(window.fixtureState.codingSessionsById).filter(x=>x.sessionId.startsWith('cache-')&&!x.cacheCompacted).length") <= 16
        assert page.evaluate("Object.values(window.fixtureState.codingSessionsById).filter(x=>x.sessionId.startsWith('cache-')&&!x.cacheCompacted).reduce((s,x)=>s+new TextEncoder().encode(JSON.stringify(x)).length,0)") <= 256*1024
        page.evaluate("window.dispatchUI({type:'SET_ACTIVE_THREAD',threadId:'owner-522'})")
        page.wait_for_function("window.fixtureState.activeThreadId==='owner-522'")
        page.evaluate("window.dispatchEvent(new Event('cmspark:open-coding-handoff'))")
        coding.wait_for()
        # Existing owner selection was late-new (running), protected by design.
        assert '此会话输出已收起' not in coding.inner_text()
        # Select the first completed cache record through a separate immutable owner.
        page.evaluate("""() => {
          window.dispatchUI({type:'SET_ACTIVE_THREAD',threadId:'demo-0'});
          window.dispatchUI({type:'UPSERT_THREAD',thread:{...window.demoThreads[0],id:'retired-owner',alias:'Retired synthetic owner'}});
          window.emitCoding({...window.codingFixture.stopped,session_id:'oversized',thread_id:'retired-owner',handback:'🧪'.repeat(70000)});
          window.dispatchUI({type:'SET_ACTIVE_THREAD',threadId:'retired-owner'});
        }""")
        page.wait_for_function("window.fixtureState.activeThreadId==='retired-owner'")
        page.evaluate("window.dispatchEvent(new Event('cmspark:open-coding-handoff'))")
        coding.wait_for()
        coding.get_by_text('此会话输出已收起。可返回所属主对话查看回传内容（如有）。', exact=True).wait_for()
        assert not coding.get_by_role('button',name='复制本次启动命令',exact=True).count()
        page.evaluate("window.emitCoding({...window.codingFixture.progress,session_id:'oversized',thread_id:'retired-owner'})")
        assert not coding.get_by_role('button',name='停止监视会话',exact=True).count()
        checks.append('inactive count/UTF-8 budgets, protected live owner, retirement notice and stale event refusal')
        page.evaluate("""() => {
          window.dispatchUI({type:'SET_ACTIVE_THREAD',threadId:'demo-0'});
          window.dispatchUI({type:'UPSERT_THREAD',thread:{...window.demoThreads[0],id:'cancel-owner',alias:'Cancelled without ack'}});
          window.emitCoding({...window.codingFixture.stopped,session_id:'a-cancel-noack',thread_id:'cancel-owner'});
          for(let i=0;i<20;i++)window.emitCoding({...window.codingFixture.stopped,session_id:'z-cancel-buffer-'+i,thread_id:'buffer-owner-'+i});
        }""")
        page.wait_for_function("window.fixtureState.codingSessionsById['a-cancel-noack'].cacheCompacted")
        page.evaluate("window.dispatchUI({type:'SET_ACTIVE_THREAD',threadId:'cancel-owner'})")
        page.wait_for_function("window.fixtureState.activeThreadId==='cancel-owner'")
        page.evaluate("window.dispatchEvent(new Event('cmspark:open-coding-handoff'))")
        coding.wait_for()
        assert '已停止' in coding.inner_text(), 'minimal cancellation marker survives retirement without ack/error text'
        page.evaluate("window.emitCoding({...window.codingFixture.progress,session_id:'a-cancel-noack',thread_id:'cancel-owner'})")
        assert '已停止' in coding.inner_text() and not coding.get_by_role('button', name='停止监视会话', exact=True).count()
        checks.append('cancelled no-ack retirement stays stopped; late same-ID running cannot resurrect it')
        page.evaluate("window.emitCoding({...window.codingFixture.proposed,session_id:'wait-offered'});window.dispatchUI({type:'SET_ACTIVE_THREAD',threadId:'owner-522'})")
        page.wait_for_function("window.fixtureState.activeThreadId==='owner-522'")
        page.evaluate("window.dispatchEvent(new Event('cmspark:open-coding-handoff'))")
        coding.wait_for()
        coding.get_by_role('button', name='← 返回主对话（会话尚未开始运行）', exact=True).wait_for()
        assert ' · 待启动' in coding.inner_text() and '本会话继续运行' not in coding.inner_text()
        # Confirmed is a declared lifecycle input; current manager normally emits offered then running.
        page.evaluate("window.emitCoding({...window.codingFixture.proposed,session_id:'wait-confirmed',state:'confirmed'})")
        coding.get_by_role('button', name='← 返回主对话（会话尚未开始运行）', exact=True).wait_for()
        assert ' · 待启动' in coding.inner_text() and '本会话继续运行' not in coding.inner_text()
        checks.append('actual offered and declared confirmed UI inputs show waiting, not running')
        # Fresh actual App: keep the actual captured owner/session selected, retire while away,
        # then invoke followup and deliver the unchanged actual producer refusal (no guessed keys).
        retired = browser.new_page(viewport={'width':1000,'height':900})
        retired.set_default_timeout(6000)
        retired.on('pageerror', lambda error: errors.append(str(error)))
        retired.goto((Path(directory)/'index.html').as_uri())
        retired.wait_for_function('window.dispatchUI && window.fixtureState.activeThreadId')
        retired.evaluate("""payload => {
          window.codingFixture=payload;
          window.dispatchUI({type:'UPSERT_THREAD',thread:{...window.demoThreads[0],id:payload.stopped.thread_id,alias:'Actual retired owner'}});
          window.emitCoding(payload.stopped);
          for(let i=0;i<20;i++)window.emitCoding({...payload.stopped,session_id:'z-retired-'+i,thread_id:'z-retired-owner-'+i});
        }""", fixture)
        retired.wait_for_function("window.fixtureState.codingSessionsById['fixture-session'].cacheCompacted")
        retired.evaluate("window.dispatchUI({type:'SET_ACTIVE_THREAD',threadId:'owner-522'})")
        retired.wait_for_function("window.fixtureState.activeThreadId==='owner-522'")
        retired.evaluate("window.dispatchEvent(new Event('cmspark:open-coding-handoff'))")
        retired_panel = retired.get_by_role('dialog', name='编程接力 面板', exact=True)
        retired_panel.wait_for()
        retired_panel.get_by_text('此会话输出已收起。可返回所属主对话查看回传内容（如有）。', exact=True).wait_for()
        retired_panel.get_by_role('button', name='关闭', exact=True).click()
        retired_chip = retired.get_by_role('status', name='编程助手会话', exact=True)
        retired.evaluate("window.prompt=()=> 'synthetic retired followup'")
        retired_chip.get_by_role('button', name='追问', exact=True).click()
        assert retired.evaluate("window.sent.some(x=>x.type==='acp.session.followup'&&x.session_id==='fixture-session'&&x.thread_id==='owner-522')")
        retired.evaluate("window.emitCoding(window.codingFixture.followupRefused)")
        retired_chip.get_by_role('alert').filter(has_text=fixture['followupRefused']['error']).wait_for()
        assert retired.evaluate("window.fixtureState.codingSessionsById['fixture-session'].cacheCompacted && window.fixtureState.codingSessionsById['fixture-session'].handback===undefined")
        retired.evaluate("window.dispatchEvent(new Event('cmspark:open-coding-handoff'))")
        retired_panel.wait_for()
        retired_panel.get_by_role('alert').filter(has_text=fixture['followupRefused']['error']).wait_for()
        checks.append('actual compacted-owner return/followup refusal is visible without rich-cache resurrection')
        retired.close()
        assert not errors, errors
        browser.close()
print(json.dumps({'result':'PASS','checks':checks,'transport':'isolated; actual App/controls/reducer with recorded Companion JSON; no live terminal'}, ensure_ascii=False, indent=2))
