"""Actual App manual-entry DOM contract with recorded producer and isolated transport/clipboard.
Use nvm use22 and a uv-selected Playwright Python environment; no livemodel/terminal/network.
"""
import json,os,subprocess,tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
project=Path(os.environ.get('CMSPARK_CODING_FIXTURE_ROOT',str(Path(__file__).resolve().parent.parent)))
fixture_path=Path(os.environ.get('CMSPARK_MANUAL_ENTRY_FIXTURE',str(project/'tests/fixtures/coding-manual-entry-522.json')))
fixture=json.loads(fixture_path.read_text())
assert all(key in fixture for key in ('progress','prepared','wrong')), 'missing actual producer sections'
old=json.loads(Path(os.environ.get('CMSPARK_CODING_CONTROL_FIXTURE',str(project/'tests/fixtures/coding-control-522.json'))).read_text())
temporary=tempfile.TemporaryDirectory(prefix='cmspark-manual-entry-ui-')
bundle=Path(os.environ.get('CMSPARK_CODING_UI_BUNDLE',temporary.name))
if not os.environ.get('CMSPARK_CODING_UI_BUNDLE'):
 subprocess.run(['node',str(project/'scripts/render-workspace-fixture.cjs'),str(bundle)],cwd=project,check=True)
results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True, **({'channel': os.environ['CMSPARK_TEST_BROWSER_CHANNEL']} if os.environ.get('CMSPARK_TEST_BROWSER_CHANNEL') else {}))
 def setup(variant='default-off',record=None):
  page=browser.new_page(viewport={'width':1100,'height':1000});page.set_default_timeout(5000)
  page.fixture_errors=[]
  page.on('pageerror',lambda error:page.fixture_errors.append(str(error)))
  page.route('**/*',lambda route:route.abort())
  page.set_content('<div id="root"></div>');page.add_style_tag(content=(bundle/'app.css').read_text())
  page.add_script_tag(content=(bundle/'app.js').read_text())
  page.evaluate("""() => {window.copyCount=0;window.copyValues=[];window.sent=[];window.prepareRequests=[];
   Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{if(window.clipboardFail)throw new Error('OWNED_CLIPBOARD_FAIL');window.copyCount++;window.copyValues.push(text)}}});
   document.execCommand=()=>false;
  }""")
  page.wait_for_function('window.dispatchUI && window.fixtureState.activeThreadId')
  frame=dict(record if record is not None else fixture['progress'])
  if variant=='expired':
   frame['terminal_command_line']=old['progress']['terminal_command_line'];frame['terminal_command_expires_at']=old['progress']['terminal_command_expires_at']
  page.evaluate("""frame => {window.frame=frame;window.dispatchUI({type:'SET_ACP_LIST',enabled:true,agents:[]});
   window.dispatchUI({type:'UPSERT_THREAD',thread:{...window.demoThreads[0],id:frame.thread_id,alias:'Manual entry synthetic owner'}});
   window.dispatchUI({type:'SET_ACTIVE_THREAD',threadId:frame.thread_id});window.emitCoding(frame);
  }""",frame)
  page.wait_for_function('window.fixtureState.activeThreadId===window.frame.thread_id && window.fixtureState.acpEnabled')
  page.evaluate("window.dispatchEvent(new Event('cmspark:open-coding-handoff'))")
  panel=page.get_by_role('dialog',name='编程接力 面板',exact=True);panel.wait_for()
  return page,panel
 def prepare(page,panel):
  panel.get_by_role('button',name='准备交互启动命令',exact=True).click()
  page.wait_for_function('window.prepareRequests.length>0')
  return page.evaluate('window.prepareRequests.at(-1)')
 def reply(page,request,patch=None,key='prepared'):
  frame={**fixture[key],'request_id':request['request_id']}
  if patch:frame.update(patch)
  page.evaluate('f=>window.emitCoding(f)',frame)
 def zero_auto(page):
  assert page.evaluate('window.copyCount')==0
  bad=page.evaluate(r"window.sent.filter(m=>/^(?:terminal\.|shell_exec|acp\.ui_start|acp\.session\.(?:prompt|followup))/.test(m.type))")
  assert bad==[],bad
 def case(name,fn):
  selected=os.environ.get('CMSPARK_TEST_CASE_FILTER')
  if selected and not any(part in name for part in selected.split('|')):return
  try:fn();results.append({'case':name,'result':'PASS'})
  except Exception as e:results.append({'case':name,'result':'FAIL','error':str(e)[:1500]})
  print(json.dumps(results[-1],ensure_ascii=False),flush=True)
 for variant in ['default-off','missing','expired']:
  def positive(variant=variant):
   page,panel=setup(variant)
   try:
    assert not panel.get_by_role('button',name='复制本次启动命令',exact=True).count()
    req=prepare(page,panel);assert req['user_gesture'] is True
    zero_auto(page);assert not panel.get_by_role('button',name='复制交互启动命令',exact=True).count()
    reply(page,req);copy=panel.get_by_role('button',name='复制交互启动命令',exact=True);copy.wait_for()
    zero_auto(page);before=page.evaluate('window.sent.length');copy.press('Enter')
    page.wait_for_function('window.copyCount===1')
    assert page.evaluate('window.copyValues')==[fixture['prepared']['command_line']]
    assert page.evaluate('window.sent.length')==before
    assert '不会自动执行' in panel.inner_text() and '新开交互 Agent' in panel.inner_text()
   finally:page.close()
  case(variant+' prepare→real correlated reply→explicit keyboard copy',positive)
 for mode,text in [('last-error','OWNED_PREPARE_LASTERROR'),('false','OWNED_PREPARE_REFUSED'),('throw','OWNED_PREPARE_THROW')]:
  def failure(mode=mode,text=text):
   page,panel=setup()
   try:
    page.evaluate('m=>window.prepareReply=m',mode);req=prepare(page,panel)
    panel.get_by_role('alert').filter(has_text=text).wait_for();zero_auto(page)
    assert not panel.get_by_role('button',name='复制交互启动命令',exact=True).count()
    page.evaluate('window.prepareReply=undefined');new=prepare(page,panel)
    assert new['request_id']!=req['request_id'];reply(page,req)
    assert not panel.get_by_role('button',name='复制交互启动命令',exact=True).count()
    reply(page,new);panel.get_by_role('button',name='复制交互启动命令',exact=True).wait_for();zero_auto(page)
   finally:page.close()
  case('runtime '+mode+' visible + retry ignores old request',failure)
 def clipboard_failure():
  page,panel=setup()
  try:
   req=prepare(page,panel);reply(page,req);copy=panel.get_by_role('button',name='复制交互启动命令',exact=True);copy.wait_for()
   page.evaluate('window.clipboardFail=true');copy.click();panel.get_by_role('alert').filter(has_text='复制交互启动命令失败').wait_for();zero_auto(page)
   page.evaluate('window.clipboardFail=false');copy.click();page.wait_for_function('window.copyCount===1')
  finally:page.close()
 case('clipboard failure visible, retry explicit only',clipboard_failure)
 def wrong_owner():
  page,panel=setup()
  try:
   req=prepare(page,panel);reply(page,req,{'thread_id':'foreign-owner'})
   assert not panel.get_by_role('button',name='复制交互启动命令',exact=True).count();zero_auto(page)
   reply(page,req);panel.get_by_role('button',name='复制交互启动命令',exact=True).wait_for();zero_auto(page)
  finally:page.close()
 case('wrong owner cannot offer Copy; matching owner can',wrong_owner)
 def refusal():
  page,panel=setup()
  try:
   req=prepare(page,panel);reply(page,req,key='wrong');panel.get_by_role('alert').filter(has_text=fixture['wrong']['error']).wait_for();zero_auto(page)
   assert not panel.get_by_role('button',name='复制交互启动命令',exact=True).count()
  finally:page.close()
 case('actual owner-stamped denial is visible, no Copy',refusal)
 def navigation():
  page,panel=setup()
  try:
   req=prepare(page,panel);page.evaluate("window.dispatchUI({type:'SET_ACTIVE_THREAD',threadId:'demo-0'})")
   page.wait_for_function("window.fixtureState.activeThreadId==='demo-0'");reply(page,req);zero_auto(page)
   assert page.evaluate('window.fixtureState.codingManualEntry') is None
  finally:page.close()
 case('navigation rejects late reply with zero copy/execute',navigation)
 def replacement():
  page,panel=setup()
  try:
   req=prepare(page,panel);page.evaluate("window.emitCoding({...window.frame,session_id:'replacement-session'})")
   page.wait_for_function("window.fixtureState.codingSessionIdByThread[window.frame.thread_id]==='replacement-session'")
   reply(page,req);zero_auto(page);assert page.evaluate('window.fixtureState.codingManualEntry') is None
  finally:page.close()
 case('new session selection rejects old reply with zero copy/execute',replacement)
 def lost_receipt():
  page,panel=setup()
  try:
   req=prepare(page,panel);panel.get_by_role('alert').filter(has_text='未收到交互入口准备回执').wait_for(timeout=11500)
   reply(page,req);assert not panel.get_by_role('button',name='复制交互启动命令',exact=True).count();zero_auto(page)
  finally:page.close()
 case('missing receipt timeout rejects late success',lost_receipt)
 def ready_lifetime():
  page,panel=setup()
  try:
   req=prepare(page,panel);reply(page,req);copy=panel.get_by_role('button',name='复制交互启动命令',exact=True);copy.wait_for()
   page.wait_for_timeout(12500)
   assert copy.count()==1,'Actual closed-session chip auto-dismissed a ready manual entry before the human copied it'
   zero_auto(page)
  finally:page.close()
 case('closed result keeps ready entry while user reads before explicit Copy',ready_lifetime)
 def pending_then_ready():
  page,panel=setup()
  try:
   req=prepare(page,panel);page.wait_for_timeout(8000)
   assert page.evaluate('window.fixtureState.codingManualEntry.pending') is True
   assert page.evaluate("window.fixtureState.codingSessionIdByThread[window.frame.thread_id]")==fixture['progress']['session_id']
   zero_auto(page);reply(page,req);copy=panel.get_by_role('button',name='复制交互启动命令',exact=True);copy.wait_for()
   page.wait_for_timeout(5000);assert copy.count()==1;zero_auto(page)
  finally:page.close()
 case('supplement: pending at 8 s then real reply remains beyond original closed deadline',pending_then_ready)
 def error_lifetime():
  page,panel=setup()
  try:
   page.evaluate("window.prepareReply='false'");prepare(page,panel)
   alert=panel.get_by_role('alert').filter(has_text='OWNED_PREPARE_REFUSED');alert.wait_for()
   page.wait_for_timeout(12500);assert alert.count()==1
   assert panel.get_by_role('button',name='准备交互启动命令',exact=True).is_enabled();zero_auto(page)
  finally:page.close()
 case('supplement: error retains explicit retry beyond original closed deadline',error_lifetime)
 def explicit_clear_ready():
  page,panel=setup()
  try:
   req=prepare(page,panel);reply(page,req);panel.get_by_role('button',name='复制交互启动命令',exact=True).wait_for()
   panel.get_by_role('button',name='清除会话',exact=True).click()
   page.wait_for_function('window.fixtureState.codingManualEntry===null')
   assert page.evaluate("window.fixtureState.codingSessionIdByThread[window.frame.thread_id]") is None
   assert not panel.get_by_role('button',name='复制交互启动命令',exact=True).count();reply(page,req);zero_auto(page)
   assert page.evaluate('window.fixtureState.codingManualEntry') is None
  finally:page.close()
 case('supplement: explicit clear removes ready entry and rejects replay',explicit_clear_ready)
 def navigate_ready():
  page,panel=setup()
  try:
   req=prepare(page,panel);reply(page,req);panel.get_by_role('button',name='复制交互启动命令',exact=True).wait_for()
   page.evaluate("window.dispatchUI({type:'SET_ACTIVE_THREAD',threadId:'demo-0'})")
   page.wait_for_function("window.fixtureState.activeThreadId==='demo-0' && window.fixtureState.codingManualEntry===null")
   reply(page,req);zero_auto(page);assert page.evaluate('window.fixtureState.codingManualEntry') is None
  finally:page.close()
 case('supplement: navigating away from ready entry clears it and rejects replay',navigate_ready)

 # Parent-nit counterfactuals: recorded actual producer payloads are copied unchanged
 # unless an explicit transport/lifecycle mutation accepted by CodingSessionEvent is stated.
 def assert_terminal(page,frame,cancel=False):
  row=page.evaluate("sid=>window.fixtureState.codingSessionsById[sid]",frame['session_id'])
  assert row['state']=='closed',row
  if cancel:assert row.get('cancelled') and row.get('cancelConfirmed'),row
  assert page.evaluate('window.fixtureState.activeThreadId')==frame['thread_id']
  assert page.evaluate("owner=>window.fixtureState.codingSessionIdByThread[owner]",frame['thread_id'])==frame['session_id']
  assert page.evaluate('window.copyCount')==0
  assert page.evaluate(r"window.sent.filter(m=>/^(?:terminal\.|shell_exec|acp\.ui_start)/.test(m.type)).length")==0
 def cancelled_presentation():
  page,panel=setup(record=old['stopped'])
  try:
   page.evaluate('f=>window.emitCoding(f)',old['receipt'])
   panel.get_by_text('已收到停止确认',exact=True).wait_for()
   assert '已停止' in panel.inner_text()
   assert panel.get_by_text('cancelled',exact=True).count()<=1,'raw cancelled duplicated in panel output/error'
   assert not panel.get_by_text('cancelled',exact=True).evaluate_all("els=>els.some(el=>getComputedStyle(el).color==='rgb(220, 38, 38)'||getComputedStyle(el).color==='rgb(185, 28, 28)')"),'raw cancelled rendered as red error'
   panel.get_by_role('button',name='关闭',exact=True).click()
   chip=page.get_by_role('status',name='编程助手会话',exact=True)
   assert '已停止' in chip.inner_text()
   assert chip.get_by_text('cancelled',exact=True).count()<=1,'raw cancelled duplicated in chip'
   assert not chip.get_by_text('cancelled',exact=True).evaluate_all("els=>els.some(el=>getComputedStyle(el).color==='rgb(220, 38, 38)'||getComputedStyle(el).color==='rgb(185, 28, 28)')"),'raw cancelled rendered as red error'
   assert_terminal(page,old['stopped'],True)
  finally:page.close()
 case('parent-nit: actual stopped cancelled has human stop status, no duplicate/red sentinel',cancelled_presentation)
 def real_failure_presentation():
  # error is an existing string event field; this is a declared synthetic failure,
  # distinct from the exact recorded cancellation sentinel.
  frame={**old['stopped'],'error':'OWNED_REAL_PROCESS_FAILURE','progress_tail':'OWNED_PARTIAL_OUTPUT'}
  page,panel=setup(record=frame)
  try:
   panel.get_by_text('OWNED_REAL_PROCESS_FAILURE',exact=True).wait_for()
   panel.get_by_role('button',name='关闭',exact=True).click()
   page.get_by_role('status',name='编程助手会话',exact=True).get_by_text('OWNED_REAL_PROCESS_FAILURE',exact=True).wait_for()
   assert_terminal(page,frame)
  finally:page.close()
 case('parent-nit: declared genuine process failure remains visible in panel and chip',real_failure_presentation)
 for compact in [False,True]:
  for returned in [False,True]:
   def notice(compact=compact,returned=returned):
    # output_truncated is a real accepted wire field. Compaction is generated by
    # the production reducer with >16 inactive closed records, never hand-set.
    frame={**old['stopped'],'output_truncated':True}
    page,panel=setup(record=frame)
    try:
     if compact:
      page.evaluate("window.dispatchUI({type:'SET_ACTIVE_THREAD',threadId:'demo-0'})")
      page.wait_for_function("window.fixtureState.activeThreadId==='demo-0'")
      page.evaluate("f=>{for(let i=0;i<20;i++)window.emitCoding({...f,session_id:'nit-buffer-'+i,thread_id:'nit-owner-'+i})}",old['stopped'])
      page.wait_for_function("window.fixtureState.codingSessionsById['fixture-session'].cacheCompacted")
      page.evaluate("window.dispatchUI({type:'SET_ACTIVE_THREAD',threadId:'owner-522'})")
      page.wait_for_function("window.fixtureState.activeThreadId==='owner-522'")
     if returned:
      # Real manager's handback value; SET_MESSAGES is the actual hydration reducer.
      # This explicitly controlled returned message is not a persistence receipt.
      page.evaluate("content=>window.dispatchUI({type:'SET_MESSAGES',messages:[{id:'controlled-returned-content',role:'assistant',content}]})",fixture['progress']['handback'])
      page.wait_for_function('window.fixtureState.messages.length===1')
     page.evaluate("window.dispatchEvent(new Event('cmspark:open-coding-handoff'))")
     panel.wait_for()
     status=panel.get_by_role('status').filter(has_text='此会话输出已收起' if compact else '此处仅显示部分输出')
     status.wait_for()
     text=status.inner_text()
     assert '已保存的结果' not in text,'notice promises saved result without a persistence receipt: '+text
     assert '如有' in text,'returned-content hint must be conditional, without promising persistence: '+text
     assert page.evaluate('window.copyCount')==0
    finally:page.close()
   case('parent-nit: '+('compacted' if compact else 'truncated')+' notice returned-content='+str(returned),notice)
 def operation_setup(op,closed=True,surface='panel'):
  # CLI is intentionally one-shot. ACP is an existing allowed transport; this
  # declared mutation exercises the real prompt composer (no model or host call).
  frame={**old['stopped' if closed else 'progress'],'transport':'acp','local_terminal':'skipped','open_local_terminal':False}
  if op=='apply':frame.update(mode='propose_diff',pending_diffs=[{'applyable':True}])
  page,panel=setup(record=frame)
  if closed:page.evaluate('f=>window.emitCoding(f)',old['receipt'])
  if surface=='chip':
   panel.get_by_role('button',name='关闭',exact=True).click()
   target=page.get_by_role('status',name='编程助手会话',exact=True)
  else:target=panel
  return page,panel,target,frame
 def send_operation(page,target,op):
  if op=='prompt':
   target.locator('input:enabled').last.fill('Synthetic owner-scoped prompt')
   target.get_by_role('button',name='发送',exact=True).click()
  elif op=='followup':
   page.evaluate("window.prompt=()=> 'Synthetic owner-scoped followup'")
   target.get_by_role('button',name='追问',exact=True).click()
  else:target.get_by_role('button',name='应用 diff',exact=True).click()
  kind={'prompt':'acp.session.prompt','followup':'acp.session.followup','apply':'acp.apply_diff'}[op]
  page.wait_for_function('kind=>window.sent.some(m=>m.type===kind)',arg=kind)
  sent=page.evaluate('kind=>window.sent.filter(m=>m.type===kind).at(-1)',kind)
  assert sent['session_id']==old['stopped']['session_id'] and sent['thread_id']==old['stopped']['thread_id'],sent
 for op,surface in [('prompt','panel'),('followup','chip'),('apply','panel'),('apply','chip')]:
  for mode,marker in [('last-error','OWNED_OPERATION_LASTERROR'),('false','OWNED_OPERATION_REFUSED'),('throw','OWNED_OPERATION_THROW')]:
   def operation_failure(op=op,surface=surface,mode=mode,marker=marker):
    page,panel,target,frame=operation_setup(op,surface=surface)
    try:
     page.evaluate('mode=>window.operationReply=mode',mode)
     send_operation(page,target,op)
     target.get_by_role('alert').filter(has_text=marker).wait_for()
     assert '已停止' in target.inner_text()
     assert_terminal(page,frame,True)
     page.evaluate('f=>window.emitCoding(f)',old['progress'])
     assert_terminal(page,frame,True)
     # Actual recorded wrong-owner error cannot replace the operation notice.
     denied={**old[{'prompt':'promptRefused','followup':'followupRefused','apply':'applyRefused'}[op]],'thread_id':'foreign-owner'}
     page.evaluate('f=>window.emitCoding(f)',denied)
     assert marker in target.inner_text() and denied['error'] not in target.inner_text()
     assert not page.fixture_errors,page.fixture_errors
    finally:page.close()
   case('parent-nit: '+op+' '+surface+' '+mode+' visible without clearing cancelled/closed/owner',operation_failure)
 for op,surface in [('prompt','panel'),('followup','chip'),('apply','panel')]:
  def forwarding(op=op,surface=surface):
   page,panel,target,frame=operation_setup(op,closed=op!='prompt',surface=surface)
   try:
    before=page.evaluate('sid=>window.fixtureState.codingSessionsById[sid]',frame['session_id'])
    send_operation(page,target,op)
    after=page.evaluate('sid=>window.fixtureState.codingSessionsById[sid]',frame['session_id'])
    assert before==after,'runtime forwarding success altered lifecycle'
    assert not page.fixture_errors,page.fixture_errors
    assert page.evaluate('window.fixtureState.codingOperationError') is None
    assert page.evaluate('window.copyCount')==0
    if op=='prompt':assert after['state']=='running' and not after.get('cancelConfirmed')
    else:assert_terminal(page,frame,True)
   finally:page.close()
  case('parent-nit: '+op+' successful forwarding is not lifecycle completion',forwarding)

 def pending_stop_operation():
  page,panel,target,frame=operation_setup('prompt',closed=False)
  try:
   page.evaluate("window.stopReply='defer';window.operationReply='false'")
   panel.get_by_role('button',name='停止编程会话',exact=True).click()
   panel.get_by_text('停止请求已发送，等待本机会话确认。',exact=True).wait_for()
   send_operation(page,panel,'prompt')
   panel.get_by_role('alert').filter(has_text='OWNED_OPERATION_REFUSED').wait_for()
   row=page.evaluate('sid=>window.fixtureState.codingSessionsById[sid]',frame['session_id'])
   assert row['state']=='running' and row['stopPending'] and not row.get('cancelConfirmed'),row
   assert panel.get_by_role('button',name='停止编程会话',exact=True).is_disabled()
   assert '已停止' not in panel.inner_text() and page.evaluate('window.copyCount')==0
   assert not page.fixture_errors,page.fixture_errors
  finally:page.close()
 case('parent-nit: prompt failure does not clear real pending Stop or claim cancellation',pending_stop_operation)
 for ownerchange in ['navigate','replacement','clear']:
  def late_operation(ownerchange=ownerchange):
   page,panel,target,frame=operation_setup('prompt')
   try:
    page.evaluate("window.operationReply='defer'")
    send_operation(page,target,'prompt')
    page.wait_for_function('window.operationCallbacks.length===1')
    if ownerchange=='navigate':page.evaluate("window.dispatchUI({type:'SET_ACTIVE_THREAD',threadId:'demo-0'})")
    elif ownerchange=='replacement':page.evaluate('f=>window.emitCoding({...f,session_id:"replacement-session"})',frame)
    else:panel.get_by_role('button',name='清除会话',exact=True).click()
    page.wait_for_function("window.fixtureState.activeThreadId==='demo-0' || window.fixtureState.codingSessionIdByThread['owner-522']!=='fixture-session'")
    before=page.evaluate('({active:window.fixtureState.activeThreadId,selection:window.fixtureState.codingSessionIdByThread,rows:window.fixtureState.codingSessionsById})')
    page.evaluate("window.finishOperation(undefined,'LATE_OLD_OWNER_FAILURE')")
    page.wait_for_timeout(30)
    after=page.evaluate('({active:window.fixtureState.activeThreadId,selection:window.fixtureState.codingSessionIdByThread,rows:window.fixtureState.codingSessionsById})')
    assert before==after,'late callback changed owner/selection/lifecycle'
    assert not page.fixture_errors,page.fixture_errors
    assert page.evaluate('window.fixtureState.codingOperationError') is None
    assert 'LATE_OLD_OWNER_FAILURE' not in page.locator('body').inner_text()
    assert page.evaluate('window.copyCount')==0
   finally:page.close()
  case('parent-nit: delayed operation after '+ownerchange+' does not contaminate owner/closed lifecycle',late_operation)
 browser.close()
if os.environ.get('CMSPARK_TEST_RESULTS'):
 Path(os.environ['CMSPARK_TEST_RESULTS']).write_text(json.dumps({'producer':str(fixture_path),'results':results},ensure_ascii=False,indent=2))
print(json.dumps(results,ensure_ascii=False,indent=2))
raise SystemExit(2 if not results else 1 if any(r['result']=='FAIL' for r in results) else 0)
