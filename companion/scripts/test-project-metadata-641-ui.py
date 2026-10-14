"""Actual React/actual summoner HTML -> actual isolated router/disk. Synthetic UI, no native Agent/model."""
from pathlib import Path
import json, os, subprocess, tempfile, time
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parent.parent
out=Path(tempfile.mkdtemp(prefix='cmspark-project-641-ui-'))
subprocess.run(['node',str(root.parent/'chrome-extension/scripts/render-project-metadata-641.cjs'),str(out)],check=True)
proc=subprocess.Popen(['node',str(root/'scripts/project-metadata-641-ui-server.cjs'),str(out)],stdout=(out/'server.stdout').open('w'),stderr=(out/'server.stderr').open('w'),env={'PATH':os.environ['PATH'],'HOME':str(out),'CMSPARK_SKIP_LOGIN_ENV':'1'})
cases=[];errors=[]
try:
 for _ in range(120):
  if (out/'ready').exists():break
  if proc.poll() is not None:raise RuntimeError('OWNED_SERVER_SETUP_FAILED')
  time.sleep(.05)
 else:raise RuntimeError('OWNED_SERVER_READY_TIMEOUT')
 endpoints=json.loads((out/'private-ui-endpoints.json').read_text())
 with sync_playwright() as p:
  executable=Path.home()/'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
  browser=p.chromium.launch(headless=True,executable_path=str(executable),args=['--use-mock-keychain','--password-store=basic'])
  context=browser.new_context(viewport={'width':1040,'height':760})
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.set_default_timeout(6000)
  page.goto(endpoints['react']);page.wait_for_function('window.fixtureState?.activeThreadId==="owned641B" || window.fixtureState?.activeThreadId==="owned641A"')
  page.evaluate('window.switchOwner("owned641A")')
  page.get_by_text('项目',exact=True).click()
  page.get_by_label('新项目名称',exact=True).fill('OWNED_UI_PROJECT')
  page.get_by_role('button',name='创建项目',exact=True).click()
  page.get_by_text('项目记录已保存。',exact=True).wait_for()
  project=page.get_by_label('管理项目',exact=True).input_value()
  assert project
  page.get_by_label('选择当前对话项目',exact=True).select_option(project)
  page.wait_for_function('window.fixtureState.threads.find(t=>t.id==="owned641A").project_id!==null && window.fixtureState.threads.find(t=>t.id==="owned641A").project_id!==undefined')
  cases.append('actual React create/association authoritative receipt')
  page.evaluate('fetch("/fixture/control",{method:"POST",body:JSON.stringify({restart:true})})')
  page.get_by_role('button',name='重新读取对话',exact=True).click();page.get_by_role('button',name='刷新项目',exact=True).click()
  assert page.get_by_label('选择当前对话项目',exact=True).input_value()==project
  cases.append('actual canonical store restart/no duplicate Thread store')
  page.evaluate('fetch("/fixture/control",{method:"POST",body:JSON.stringify({busy:true})})')
  page.get_by_label('选择当前对话项目',exact=True).select_option('')
  page.get_by_role('alert').filter(has_text='结束执行').wait_for()
  assert page.evaluate('window.fixtureState.threads.find(t=>t.id==="owned641A").project_id')==project
  cases.append('actual busy backend refusal surfaced in React')
  page.evaluate('fetch("/fixture/control",{method:"POST",body:JSON.stringify({busy:false,hold:true})})')
  page.get_by_label('选择当前对话项目',exact=True).select_option('')
  page.wait_for_function('window.sent.filter(m=>m.type==="thread.project.set").length>=3')
  page.evaluate('window.switchOwner("owned641B")')
  page.evaluate('fetch("/fixture/control",{method:"POST",body:JSON.stringify({release:true,hold:false})})')
  page.wait_for_timeout(100)
  assert page.evaluate('window.fixtureState.activeThreadId')=='owned641B'
  assert not page.evaluate('window.fixtureState.threads.find(t=>t.id==="owned641B").project_id')
  cases.append('actual committed late association cannot overwrite newly active B')
  for variant in ['sequential','batched']:
   page.evaluate('window.switchOwner("owned641A")')
   page.get_by_role('button',name='刷新项目',exact=True).click()
   page.get_by_label('管理项目',exact=True).select_option(project)
   page.evaluate('fetch("/fixture/control",{method:"POST",body:JSON.stringify({hold:true})})')
   previous=page.evaluate('window.sent.filter(m=>m.type==="thread.project.set").length')
   page.get_by_role('button',name='项目内新对话',exact=True).click()
   page.wait_for_function('(count)=>window.sent.filter(m=>m.type==="thread.project.set").length>count',arg=previous)
   page.wait_for_timeout(30)
   if variant=='sequential':
    page.evaluate('window.switchOwner("owned641B")');page.wait_for_function('window.fixtureState.activeThreadId==="owned641B"');page.evaluate('window.switchOwner("owned641A")')
   else:page.evaluate('window.switchOwner("owned641B");window.switchOwner("owned641A")')
   page.evaluate('fetch("/fixture/control",{method:"POST",body:JSON.stringify({hold:false,release:true})})')
   page.wait_for_timeout(100)
   assert page.evaluate('window.fixtureState.activeThreadId')=='owned641A'
   page.get_by_role('status').filter(has_text='刷新核实').wait_for()
  cases.append('actual React sequential and same-event batched A-to-B-to-A cannot consume old new-Thread receipt')
  page.get_by_role('button',name='刷新项目',exact=True).click()
  page.get_by_label('管理项目',exact=True).select_option(project)
  page.get_by_label('项目新名称',exact=True).fill('OWNED_RENAMED')
  page.get_by_role('button',name='改名',exact=True).click()
  page.get_by_role('button',name='归档项目',exact=True).click()
  page.get_by_role('button',name='恢复项目',exact=True).wait_for();page.get_by_role('button',name='恢复项目',exact=True).click()
  page.get_by_role('button',name='归档项目',exact=True).wait_for()
  cases.append('actual React rename/archive/recover')
  page.get_by_label('搜索项目',exact=True).fill('no matching synthetic Project')
  assert page.get_by_label('管理项目',exact=True).input_value()==project
  page.get_by_label('搜索项目',exact=True).fill('')
  page.evaluate('fetch("/fixture/control",{method:"POST",body:JSON.stringify({conflict:true})})')
  page.get_by_label('项目新名称',exact=True).fill('OWNED_CONFLICT_DRAFT')
  page.get_by_role('button',name='改名',exact=True).click()
  page.get_by_role('alert').filter(has_text='已变化').wait_for()
  assert page.get_by_label('项目新名称',exact=True).input_value()=='OWNED_CONFLICT_DRAFT'
  page.get_by_role('button',name='刷新项目',exact=True).click()
  page.get_by_label('项目新名称',exact=True).fill('OWNED_RENAMED')
  page.get_by_role('button',name='项目内新对话',exact=True).click()
  page.get_by_text('项目记录已保存。',exact=True).wait_for()
  page.wait_for_function('window.fixtureState.activeThreadId!=="owned641B"')
  created=page.evaluate('window.fixtureState.threads.find(t=>t.id===window.fixtureState.activeThreadId)')
  assert created['project_id']==project
  assert not created.get('workspace_root') and not created.get('user_tags') and not created.get('topic_folder')
  cases.append('actual React search/preserved conflict draft/two-step new Thread without authority inheritance')
  page.evaluate('window.switchOwner(null)')
  page.get_by_role('button',name='项目内新对话',exact=True).click()
  page.get_by_text('项目记录已保存。',exact=True).wait_for()
  assert page.evaluate('window.fixtureState.threads.find(t=>t.id===window.fixtureState.activeThreadId).project_id')==project
  cases.append('actual React empty-owner stock auto-selection semantic preserves the exact new Thread admission')
  page.evaluate('fetch("/fixture/control",{method:"POST",body:JSON.stringify({confirmationCount:1})})')
  page.get_by_role('button',name='项目内新对话',exact=True).click()
  page.get_by_role('alert').filter(has_text='新对话已创建在项目外').wait_for()
  outside=page.evaluate('window.fixtureState.threads.find(t=>t.id===window.fixtureState.activeThreadId)')
  assert not outside.get('project_id')
  page.evaluate('fetch("/fixture/control",{method:"POST",body:JSON.stringify({confirmationCount:0})})')
  cases.append('actual React failed second step truthfully retains outside Thread')
  for width,height in [(320,420),(390,480),(759,480),(760,480)]:
   page.set_viewport_size({'width':width,'height':height})
   page.get_by_role('button',name='刷新项目',exact=True).scroll_into_view_if_needed()
   assert page.get_by_role('button',name='刷新项目',exact=True).is_visible()
  page.get_by_label('新项目名称',exact=True).focus();page.keyboard.press('Escape')
  assert not page.locator('.cm-project-controls').count()
  assert page.locator('summary').evaluate('(e)=>e===document.activeElement')
  cases.append('actual React narrow/short/Escape focus return')
  # Actual production summoner HTML, authenticated using owned ephemeral cookie bootstrap.
  context.add_cookies([{'name':'cmspark_overlay','value':endpoints['owned_cookie'],'domain':'127.0.0.1','path':'/','httpOnly':True,'sameSite':'Strict'}])
  summ=context.new_page();summ.on('pageerror',lambda e:errors.append(str(e)));summ.set_default_timeout(6000);summ.goto(endpoints['summoner'])
  unauth=browser.new_context();denied=unauth.request.get(endpoints['summoner']+'api/projects');assert denied.status==403;unauth.close()
  assert context.request.post(endpoints['summoner']+'api/projects',headers={'Origin':'https://owned-untrusted.invalid'},data={}).status==403
  invalid=context.request.post(endpoints['summoner']+'api/projects',data={'name':'OWNED_NO_CHANGE','workspace_root':'OWNED_FORBIDDEN_FIELD'})
  assert invalid.status==400 and invalid.json()['error_code']=='PROJECT_INVALID'
  malformed=context.request.post(endpoints['summoner']+'api/projects',headers={'Content-Type':'application/json'},data='{OWNED_INVALID_JSON')
  assert malformed.status==400 and malformed.json()['error']=='项目请求格式无效。'
  assert context.request.delete(endpoints['summoner']+'api/projects').status==405
  cases.append('actual summoner HTTP unauthenticated/foreign-origin/mixed-authority/malformed/method gates')
  summ.locator('#projectOrganization summary').click()
  summ.locator('#projectSelected option').filter(has_text='OWNED_RENAMED').wait_for(state='attached')
  summ.locator('#projectSelected').select_option(project)
  summ.locator('#projectNewName').fill('OWNED_SUMMONER_RENAME');summ.locator('#projectRename button').click()
  summ.locator('#projectNotice').filter(has_text='已保存').wait_for()
  summ.locator('#projectArchive').click();summ.locator('#projectRestore').wait_for(state='visible');summ.locator('#projectRestore').click()
  summ.locator('#projectArchive').wait_for(state='visible')
  cases.append('actual summoner same persisted Project rename/archive/recover')
  summ.locator('#projectName').fill('OWNED_SUMMONER_NEW');summ.locator('#projectCreate button').click()
  summ.locator('#projectSelected').get_by_text('OWNED_SUMMONER_NEW',exact=True).wait_for(state='attached')
  summ.locator('#projectSelected').select_option(label='OWNED_SUMMONER_NEW')
  summ.locator('#projectNewThread').click();summ.locator('#projectCurrent').filter(has_text='OWNED_SUMMONER_NEW').wait_for()
  cases.append('actual summoner name-only Project + honest two-step project new Thread')
  for width,height in [(320,420),(390,480),(760,480)]:
   summ.set_viewport_size({'width':width,'height':height})
   if not summ.locator('#projectRefresh').is_visible():summ.locator('#historyOpen').click()
   summ.locator('#projectRefresh').scroll_into_view_if_needed();assert summ.locator('#projectRefresh').is_visible()
  summ.locator('#projectName').focus();summ.keyboard.press('Escape')
  assert not summ.locator('#projectOrganization').evaluate('(e)=>e.open')
  assert summ.locator('#projectOrganization summary').evaluate('(e)=>e===document.activeElement')
  cases.append('actual summoner narrow/short/Escape focus return')
  assert not errors,errors
  browser.close()
 print(json.dumps({'PASS':True,'cases':cases,'artifact_root':str(out),'browser_synthetic':True,'actual_backend':True,'actual_full_extension_auth_claim':False},ensure_ascii=False))
except Exception as error:
 print(json.dumps({'PASS':False,'completed_cases':cases,'artifact_root':str(out),'error_count':len(errors)},ensure_ascii=False))
 detail=str(error)
 if 'endpoints' in locals():
  detail=detail.replace(endpoints.get('summoner','UNUSED'),'OWNED_SUMMONER_URL_REDACTED')
  detail=detail.replace(endpoints.get('owned_cookie','UNUSED'),'OWNED_COOKIE_REDACTED')
 (out/'failure.txt').write_text(detail)
 raise RuntimeError('OWNED_UI_ASSERTION_FAILED: '+type(error).__name__) from None
finally:
 proc.terminate()
 try:proc.wait(timeout=10)
 except subprocess.TimeoutExpired:proc.kill();proc.wait(timeout=5)
 (out/'private-ui-endpoints.json').unlink(missing_ok=True)
