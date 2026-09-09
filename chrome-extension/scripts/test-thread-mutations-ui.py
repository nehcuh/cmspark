"""#488 actual App + recorded server payload shapes, isolated synthetic transport.
No live Chrome profile, conversation, microphone, or configuration is accessed.
"""
from pathlib import Path
import subprocess, tempfile
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parent.parent
shots=Path('/private/tmp/cmspark-488-shots');shots.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory() as out:
 subprocess.run(['node','scripts/render-workspace-fixture.cjs',out],cwd=root,check=True)
 with sync_playwright() as p:
  browser=p.chromium.launch(channel='chrome',headless=True)
  errors=[]
  def setup(count=60,trash=False,width=390,height=740):
   page=browser.new_page(viewport={'width':width,'height':height});page.set_default_timeout(7000)
   page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto((Path(out)/'index.html').as_uri());page.wait_for_function('Boolean(window.dispatchUI)')
   page.evaluate('''({count,trash})=>{
    const threads=Array.from({length:count},(_,i)=>({...window.demoThreads[0],id:'t'+i,alias:'对话 '+i,message_count:4,user_tags:[i<2?'支付':'架构'],trashed_at:trash?'2026-09-09T00:00:00Z':null}));
    window.fixtureServerThreads=structuredClone(threads);
    window.dispatchUI({type:'SET_THREADS',threads});window.dispatchUI({type:'SET_ACTIVE_THREAD',threadId:'t0'});
   }''',{'count':count,'trash':trash})
   page.get_by_role('button',name='对话管理（历史对话）',exact=True).click()
   manager=page.get_by_role('dialog',name='历史对话列表',exact=True);manager.wait_for()
   if trash:
    manager.get_by_role('button',name='回收站',exact=True).click()
    manager.get_by_text(f'回收站 · {count}',exact=False).wait_for()
   return page,manager
  def select_all(manager):manager.get_by_role('button',name='全选',exact=True).click()
  def confirm_delete(manager,hard=False):
   manager.locator('.cm-thread-selection-bar').get_by_role('button',name='永久删除' if hard else '移入回收站',exact=True).click()
   dialog=manager.get_by_role('alertdialog',name='确认删除会话');dialog.wait_for()
   assert dialog.get_by_role('button',name='取消',exact=True).evaluate('(el)=>el===document.activeElement')
   dialog.get_by_role('button',name='永久删除' if hard else '移入回收站',exact=True).click()

  # A visible tag filter is the complete selection boundary.
  page,m=setup();m.get_by_role('button',name='标签',exact=True).click();m.get_by_role('button',name='#支付 2',exact=True).click()
  select_all(m);m.get_by_text('已选 2',exact=True).wait_for()
  page.evaluate('window.mutationReply="defer"');confirm_delete(m)
  assert page.evaluate('window.mutationRequests[0].thread_ids')==['t0','t1']
  assert page.evaluate('window.fixtureState.threads.length')==60
  page.evaluate('window.finishThreadMutation(window.mutationRequests[0])')
  page.wait_for_function('window.fixtureState.threads.length===58');page.close()

  # Single-row deletion also goes through the correlated batch protocol.
  page,m=setup(3);page.evaluate('window.mutationReply="defer"')
  m.locator('[data-thread-id="t1"]').get_by_role('button',name='删除 对话 1',exact=False).click()
  m.get_by_role('alertdialog').get_by_role('button',name='移入回收站',exact=True).click()
  assert page.evaluate('window.mutationRequests.map(m=>({type:m.type,ids:m.thread_ids}))')==[{'type':'thread.batch_delete','ids':['t1']}]
  assert page.evaluate('window.fixtureState.threads.length')==3
  assert not page.evaluate('window.sent.some(m=>m.type==="thread.delete")')
  page.evaluate('window.finishThreadMutation(window.mutationRequests[0])')
  page.wait_for_function('window.fixtureState.threads.length===2');page.close()

  # More than 50 items are sent serially; a transport ACK never removes rows.
  page,m=setup();page.evaluate('window.mutationReply="defer"');select_all(m);confirm_delete(m)
  assert page.evaluate('window.mutationRequests.map(m=>m.thread_ids.length)')==[50]
  assert page.evaluate('window.fixtureState.threads.length')==60
  page.evaluate('window.finishThreadMutation(window.mutationRequests[0])')
  page.wait_for_function('window.mutationRequests.length===2')
  assert page.evaluate('window.mutationRequests.map(m=>m.thread_ids.length)')==[50,10]
  page.evaluate('window.finishThreadMutation(window.mutationRequests[1])')
  page.wait_for_function('window.fixtureState.threads.length===0');page.close()

  # Busy/filter changes only shrink a selection; no deletion of another row.
  for change in ['busy','filter']:
   page,m=setup(3);m.get_by_role('button',name='选择',exact=True).click()
   m.locator('[data-thread-id="t0"] input[type="checkbox"]').check()
   if change=='busy':page.evaluate('window.dispatchUI({type:"SET_THREAD_BUSY",threadId:"t0",busy:true})')
   else:m.get_by_role('searchbox').fill('对话 1')
   m.get_by_text('已选 0',exact=True).wait_for()
   assert m.locator('.cm-thread-selection-bar').get_by_role('button',name='移入回收站',exact=True).is_disabled()
   assert page.evaluate('window.mutationRequests.length')==0;page.close()

  # Confirmation re-checks busy state even after the target preview was opened.
  page,m=setup(2);select_all(m)
  m.locator('.cm-thread-selection-bar').get_by_role('button',name='移入回收站',exact=True).click()
  page.evaluate('window.dispatchUI({type:"SET_THREAD_BUSY",threadId:"t0",busy:true})')
  m.get_by_role('alertdialog').get_by_role('button',name='移入回收站',exact=True).click()
  m.get_by_role('status').filter(has_text='状态已变化').wait_for()
  assert page.evaluate('window.mutationRequests.length')==0;page.close()

  # Offline and partial failures retain failed records with an actionable result.
  page,m=setup(3);page.evaluate('window.mutationReply="offline"');select_all(m);confirm_delete(m)
  m.get_by_role('status').filter(has_text='未发送').wait_for()
  assert page.evaluate('window.fixtureState.threads.length')==3;page.close()
  page,m=setup(3);page.evaluate('window.mutationFailedIds=["t1"]');select_all(m);confirm_delete(m)
  page.wait_for_function('window.fixtureState.threads.length===1')
  assert page.evaluate('window.fixtureState.threads[0].id')=='t1'
  m.get_by_role('status').filter(has_text='已移入回收站 2').wait_for();page.close()

  # Restore waits for persistence, then refreshes including remaining trash rows.
  page,m=setup(3,trash=True);page.evaluate('window.mutationReply="defer";window.mutationFailedIds=["t1"]');select_all(m)
  m.locator('.cm-thread-selection-bar').get_by_role('button',name='恢复',exact=True).click()
  assert page.evaluate('window.fixtureState.threads.filter(t=>t.trashed_at).length')==3
  page.evaluate('window.finishThreadMutation(window.mutationRequests[0])')
  page.wait_for_function('window.fixtureState.threads.filter(t=>t.trashed_at).length===1')
  assert page.evaluate('window.fixtureState.threads.find(t=>t.trashed_at).id')=='t1'
  assert page.evaluate('window.sent.filter(m=>m.type==="thread.list").at(-1).include_trashed') is True
  page.close()

  # Empty cleanup uses an in-app preview, probes safely, and rechecks server content.
  for legacy in [False,True]:
   page,m=setup(3)
   page.evaluate('''legacy=>{window.legacyEmptyProbe=legacy;
    const threads=window.fixtureState.threads.map(t=>({...t,message_count:0}));
    window.dispatchUI({type:'SET_THREADS',threads});
    window.fixtureServerThreads=threads.map(t=>({...t,message_count:t.id==='t1'?1:0}));
   }''',legacy)
   m.get_by_title('更多',exact=True).click()
   page.get_by_role('menu').get_by_role('button',name='🧹 清理空白',exact=True).click()
   m.get_by_role('alertdialog').get_by_role('button',name='永久删除',exact=True).click()
   if legacy:
    m.get_by_role('status').filter(has_text='请更新 Companion').wait_for()
    assert page.evaluate('window.mutationRequests.map(m=>m.thread_ids)')==[[]]
    assert page.evaluate('window.fixtureState.threads.length')==3
   else:
    page.wait_for_function('window.fixtureState.threads.length===2')
    assert page.evaluate('window.mutationRequests.map(m=>m.thread_ids)')==[[],['t1','t2']]
    assert page.evaluate('window.fixtureState.threads.map(t=>t.id)')==['t0','t1']
   page.close()

  # Cleanup's checkboxes and bulk-list selection are visibly separate scopes.
  page,m=setup(4)
  page.evaluate('window.dispatchEvent(new CustomEvent("cmspark:cleanup_suggestions",{detail:{suggestions:[{thread_id:"t1",reason:"thin",detail:"test",precheck:true},{thread_id:"t2",reason:"thin",detail:"test"}]}}))')
  cleanup=m.get_by_role('region',name='整理建议');cleanup.wait_for()
  select_all(m)
  assert cleanup.locator('input:checked').count()==1
  cleanup.get_by_role('button',name='全选建议',exact=True).click()
  assert cleanup.locator('input:checked').count()==2
  m.get_by_role('button',name='取消全选',exact=True).click()
  assert cleanup.locator('input:checked').count()==2
  cleanup.get_by_role('button',name='清空建议选择',exact=True).click()
  assert cleanup.get_by_role('button',name='移入回收站（0）',exact=True).is_disabled();page.close()

  # Short windows retain scrollable rows, all management tools and outside stop.
  for width,height in [(320,480),(390,740),(760,740),(1440,900)]:
   page,m=setup(6,width=width,height=height)
   for view in ['时间','标签','手动分组','AI 分组']:
    m.get_by_role('button',name=view,exact=True).click()
    assert m.locator('.cm-thread-management-list').bounding_box()['height']>=100
    assert m.evaluate('(el)=>el.scrollWidth<=el.clientWidth')
   m.get_by_role('button',name='时间',exact=True).click();select_all(m)
   m.locator('.cm-thread-selection-bar').get_by_role('button',name='移入回收站',exact=True).scroll_into_view_if_needed()
   assert m.locator('.cm-thread-selection-bar').get_by_role('button',name='移入回收站',exact=True).evaluate('(el)=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}')
   m.get_by_role('button',name='取消选择',exact=True).click()
   row=m.locator('[data-thread-id="t0"]')
   for title in ['列表内相关','提取要点 / 标签','提炼为知识（需确认）','编辑标签与分组','导出此线程摘要为 Markdown','删除线程']:
    button=row.get_by_title(title,exact=True);button.scroll_into_view_if_needed();button.click(trial=True)
    assert button.evaluate('(el)=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}')
   page.screenshot(path=str(shots/f'row-actions-{width}.png'))
   for label in ['AI 提取标签','整理助手','关系图谱','回收站']:
    button=m.get_by_role('button',name=label,exact=True);button.scroll_into_view_if_needed();assert button.is_visible()
   m.evaluate('(el)=>el.scrollTop=0');page.screenshot(path=str(shots/f'manager-{width}.png'));page.close()
  assert not errors,errors
  browser.close()
print('PASS: actual App selection boundaries, busy/filter race, 60-item batching, ACK vs persisted result, offline/partial failure, restore, independent cleanup scope and responsive management capabilities.')
