"""Real App, isolated runtime transport. No live threads or configuration."""
from pathlib import Path
import subprocess,tempfile
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
shots=Path('/private/tmp/cmspark-473-shots');shots.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory() as out:
 subprocess.run(['node','scripts/render-workspace-fixture.cjs',out],cwd=root,check=True)
 with sync_playwright() as p:
  b=p.chromium.launch(channel='chrome',headless=True);page=b.new_page(viewport={'width':390,'height':740});page.set_default_timeout(7000)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto((Path(out)/'index.html').as_uri());page.wait_for_function('Boolean(window.dispatchUI)')
  page.evaluate("window.dispatchUI({type:'SET_THREADS',threads:window.demoThreads.map((t,i)=>({...t,message_count:4,user_message_count:2,topic_folder:i===0?'人工项目':null,digest:i<2?{tldr:'发布与测试',tags:['支付','发布'],bullets:['核对版本'],extracted_at:new Date().toISOString(),source:'manual'}:null}))})")
  manager=page.get_by_role('dialog',name='历史对话列表',exact=True)
  for width,height in [(320,480),(390,740),(759,740),(760,740),(1440,900)]:
   page.set_viewport_size({'width':width,'height':height})
   if width<760:
    new=page.locator('.cm-header-new');assert new.is_visible();box=new.bounding_box();assert box['x']>=0 and box['x']+box['width']<=width
   else:assert not page.locator('.cm-header-new').is_visible()
   page.get_by_role('button',name='对话管理（历史对话）',exact=True).click();manager.wait_for()
   for label in ['时间','标签','手动分组','AI 分组']:
    manager.get_by_role('button',name=label,exact=True).click()
    assert manager.evaluate('(el)=>el.scrollWidth<=el.clientWidth'),(width,label)
   for label in ['AI 提取标签','整理助手','关系图谱','回收站']:
    button=manager.get_by_role('button',name=label,exact=True);button.scroll_into_view_if_needed();assert button.is_visible()
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
   manager.evaluate('(el)=>el.scrollTop=0');page.screenshot(path=str(shots/f'manager-{width}.png'))
   manager.get_by_role('button',name='关闭历史对话',exact=True).click()
  page.get_by_role('button',name='对话管理（历史对话）',exact=True).click()
  manager.get_by_role('button',name='选择',exact=True).click()
  page.locator('.cm-composer-dock textarea').click()
  assert not manager.is_visible()
  page.get_by_role('button',name='对话管理（历史对话）',exact=True).click()
  manager.get_by_role('button',name='选择',exact=True).wait_for()
  manager.get_by_role('button',name='关闭历史对话',exact=True).click()
  # Existing AI grouping is a read projection; opening it must not write manual folders.
  assert not page.evaluate('window.sent.some(m=>m.type==="thread.update")')
  page.get_by_role('button',name='管理对话',exact=True).click();manager.wait_for()
  manager.get_by_role('button',name='手动分组',exact=True).click()
  manager.get_by_title('编辑标签与分组',exact=True).first.click()
  form=manager.get_by_role('form',name='编辑对话分类');form.wait_for()
  form.get_by_label('人工标签',exact=True).fill('负责人，需复核')
  form.get_by_label('手动分组',exact=True).fill('手动发布')
  form.get_by_role('button',name='保存分类',exact=True).click();manager.get_by_role('status').filter(has_text='分类已保存').wait_for()
  page.wait_for_function('window.fixtureState.threads.some(t=>t.topic_folder==="手动发布" && t.user_tags?.includes("负责人"))')
  saved_id=page.evaluate('window.sent.filter(m=>m.type==="thread.update").at(-1).thread_id')
  page.evaluate('(id)=>{const t=window.fixtureState.threads.find(t=>t.id===id);window.dispatchUI({type:"UPSERT_THREAD",thread:{...t,digest:{...t.digest,tags:["新的AI标签"]}}})}',saved_id)
  manager.get_by_role('button',name='标签',exact=True).click();manager.get_by_role('button',name='#负责人 1',exact=True).click();manager.get_by_role('searchbox').fill('负责人')
  manager.get_by_title('编辑标签与分组',exact=True).first.click();form.wait_for()
  assert form.get_by_label('人工标签',exact=True).input_value()=='负责人，需复核'
  page.evaluate('window.metadataReply="error"')
  form.get_by_label('手动分组',exact=True).fill('不得假保存')
  form.get_by_role('button',name='保存分类',exact=True).click();form.get_by_role('alert').wait_for()
  assert form.get_by_label('手动分组',exact=True).input_value()=='不得假保存'
  assert not page.evaluate('window.fixtureState.threads.some(t=>t.topic_folder==="不得假保存")')
  form.get_by_role('button',name='取消',exact=True).click();manager.get_by_role('searchbox').fill('')
  manager.get_by_role('button',name='关系图谱',exact=True).click()
  assert page.evaluate('window.sent.some(m=>m.type==="thread_graph.open" && m.threads.some(t=>t.user_tags?.includes("负责人") && !t.digest?.tags?.includes("负责人")))')
  page.get_by_role('button',name='对话管理（历史对话）',exact=True).click();manager.wait_for()
  manager.get_by_role('button',name='AI 提取标签',exact=True).click()
  assert page.evaluate('window.sent.some(m=>m.type==="thread.extract_digest" && m.thread_ids.length<=20)')
  manager.get_by_role('button',name='整理助手',exact=True).click()
  assert page.evaluate('window.sent.some(m=>m.type==="thread.suggest_cleanup")')
  manager.get_by_role('button',name='关闭历史对话',exact=True).click()
  page.set_viewport_size({'width':320,'height':480});before=page.evaluate('window.sent.filter(m=>m.type==="thread.create").length')
  page.locator('.cm-header-new').click()
  assert page.evaluate('window.sent.filter(m=>m.type==="thread.create").length')==before+1
  # At 320 short height the header risk control and running stop stay directly hittable.
  page.evaluate("window.dispatchUI({type:'SET_THREAD_BUSY',threadId:window.fixtureState.activeThreadId,busy:true});window.dispatchUI({type:'SET_CONFIG',config:{auto_approve_dangerous:true}})")
  stop=page.get_by_title('停止本轮',exact=True);stop.wait_for()
  page.get_by_role('button',name='对话管理（历史对话）',exact=True).click();manager.wait_for()
  risk=page.locator('.cm-status-rail button[aria-label$="点击解除"]');risk.wait_for()
  for control in [stop,risk,page.locator('.cm-header-new')]:
   assert control.evaluate('(el)=>{const r=el.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}')
  manager.get_by_title('更多',exact=True).click()
  assert stop.evaluate('(el)=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}')
  stop.click();manager.wait_for(state='hidden')
  assert page.evaluate('window.sent.some(m=>m.type==="chat.abort")')
  page.get_by_role('button',name='对话管理（历史对话）',exact=True).click();manager.wait_for()
  page.evaluate("window.dispatchUI({type:'ADD_SECURITY_CONFIRMATION',request:{confirmation_id:'management-fixture',tool_name:'shell_exec',dangerous_apis:['shell'],code_preview:'git diff',risk_level:'high',requested_at:new Date().toISOString(),timeout_ms:45000}})")
  manager.wait_for(state='hidden')
  assert page.get_by_role('button',name='对话管理（历史对话）',exact=True).is_disabled()
  gate=page.get_by_role('alertdialog').first
  for label in ['允许','拒绝','停止']:
   assert gate.get_by_role('button',name=label,exact=True).evaluate('(el)=>{const r=el.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}')
  assert not page.evaluate('window.sent.some(m=>m.type==="security.confirmation.response")')
  assert not errors,errors
  b.close()
print('PASS: responsive new chat+manager, tags/manual/AI groups, persisted metadata+failure, AI label retention, explicit AI/cleanup/graph paths, no automatic metadata writes.')
