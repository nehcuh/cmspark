"""Actual summoner HTML script, synthetic HTTP responses; no installed Companion."""
from pathlib import Path
from urllib.parse import urlparse
import json,subprocess,tempfile
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
shots=Path('/private/tmp/cmspark-471-shots');shots.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory() as out:
 subprocess.run(['node','scripts/render-web-surface-fixtures.cjs',out],cwd=root,check=True)
 html=(Path(out)/'capture.html').read_text().replace('%%CRUISE_LABEL%%','每次确认')
 with sync_playwright() as p:
  b=p.chromium.launch(channel='chrome',headless=True);page=b.new_page(viewport={'width':390,'height':740});page.set_default_timeout(6000)
  browser_status={'connected':False}
  errors=[];requests=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.add_init_script('window.EventSource=class {constructor(){window.fixtureEvents=this} addEventListener(){} close(){}};window.resizeTo=()=>{};window.moveTo=()=>{};')
  def route(r):
   req=r.request;path=urlparse(req.url).path;requests.append((req.method,path))
   if path=='/':r.fulfill(content_type='text/html',body=html);return
   if path=='/api/threads':data={'thread':{'id':'fixture-1'}} if req.method=='POST' else {'threads':[{'id':'fixture-1','alias':'演示对话'}]}
   elif path=='/api/thread':data={'messages':[],'run_status':'idle'}
   elif path=='/api/mcp':data={'servers':[]}
   elif path=='/api/browser-status':data=browser_status
   else:data={'ok':True}
   r.fulfill(content_type='application/json',body=json.dumps(data))
  page.route('http://fixture.test/**',route);page.goto('http://fixture.test/')
  text=page.get_by_role('textbox',name='发送到当前对话',exact=True);text.wait_for()
  page.wait_for_timeout(200);assert not errors,errors
  page.get_by_role('button',name='新对话',exact=True).first.click()
  page.wait_for_function('document.querySelector("#empty strong")')
  assert page.locator('.mark').count()==0 and '山' not in page.locator('#empty').inner_text()
  assert ('POST','/api/threads') in requests
  page.get_by_role('button',name='导航',exact=True).click();assert page.locator('.hud.history .list').is_visible()
  page.get_by_role('button',name='完成',exact=True).click()
  assert page.locator('#historyOpen').evaluate('(el)=>el===document.activeElement')
  for width,height in [(320,420),(360,420),(390,740),(760,740),(1000,800),(1440,900)]:
   page.set_viewport_size({'width':width,'height':height})
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   assert page.locator('.composer-actions button:visible').evaluate_all('(els)=>els.map(el=>el.id)')==['attachFile','mic','sendGo']
   assert page.get_by_role('button',name='新对话',exact=True).count()>=1
   field=text.bounding_box();send=page.get_by_role('button',name='发送',exact=True).bounding_box()
   assert field and send and field['y']+field['height']<=send['y']+1 and send['y']+send['height']<=height
   page.screenshot(path=str(shots/f'summoner-{width}.png'))
  page.set_viewport_size({'width':1040,'height':760})
  page.get_by_role('searchbox',name='搜索对话').fill('不存在')
  assert page.locator('#threads .trow').count()==0
  page.get_by_role('searchbox',name='搜索对话').fill('演示')
  assert page.locator('#threads .trow').count()==1
  page.get_by_role('button',name='MCP',exact=True).click()
  page.get_by_text('尚未配置 MCP 服务',exact=True).wait_for()
  assert not any(path=='/api/mcp/toggle' for method,path in requests)
  page.get_by_role('button',name='浏览器',exact=True).click()
  page.get_by_text('尚未连接 CMspark 扩展',exact=True).wait_for()
  page.get_by_role('button',name='后台连接',exact=True).click()
  assert ('POST','/api/attach') in requests
  page.get_by_role('button',name='展示浏览器',exact=True).click()
  browser_status.clear();browser_status['error']='unavailable'
  page.get_by_role('button',name='浏览器',exact=True).click()
  page.get_by_text('无法读取浏览器连接状态',exact=True).wait_for()
  assert '尚未连接 CMspark 扩展' not in page.locator('#composeList').inner_text()
  page.get_by_role('button',name='对话',exact=True).click()
  page.set_viewport_size({'width':320,'height':480})
  page.get_by_role('button',name='导航',exact=True).click()
  page.evaluate('window.fixtureEvents.onmessage({data:JSON.stringify({type:"run_status",thread_id:"fixture-1",status:"llm"})})')
  for selector in ['#text','#sendGo','#stopGo']:
   assert page.locator(selector).evaluate('(el)=>{const r=el.getBoundingClientRect();return r.bottom<=innerHeight && el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}')
  page.get_by_role('button',name='停止',exact=True).click()
  assert ('POST','/api/abort') in requests
  page.evaluate('window.fixtureEvents.onmessage({data:JSON.stringify({type:"chat.aborted",thread_id:"fixture-1"})})')
  assert not page.locator('#stopGo').is_visible()
  page.keyboard.press('Escape')
  assert not page.locator('#hud').evaluate('(el)=>el.classList.contains("history")')
  page.screenshot(path=str(shots/'summoner-477-narrow.png'))
  page.get_by_role('button',name='导航',exact=True).click()
  page.set_viewport_size({'width':1000,'height':800});page.keyboard.press('Escape')
  assert page.locator('#newChat').evaluate('(el)=>el===document.activeElement')
  with page.expect_file_chooser():page.get_by_role('button',name='添加附件',exact=True).click()
  text.fill('请整理变更材料');page.get_by_role('button',name='发送',exact=True).click()
  page.wait_for_timeout(200);assert ('POST','/api/chat') in requests
  assert not errors,errors
  b.close()
print('PASS: real summoner script, reset without mark, history, input/action DOM order, keyboard-native attachment, send; synthetic HTTP/SSE only.')
