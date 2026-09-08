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
  errors=[];requests=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.add_init_script('window.EventSource=class {addEventListener(){} close(){}};window.resizeTo=()=>{};window.moveTo=()=>{};')
  def route(r):
   req=r.request;path=urlparse(req.url).path;requests.append((req.method,path))
   if path=='/':r.fulfill(content_type='text/html',body=html);return
   if path=='/api/threads':data={'thread':{'id':'fixture-1'}} if req.method=='POST' else {'threads':[{'id':'fixture-1','alias':'演示对话'}]}
   elif path=='/api/thread':data={'messages':[],'run_status':'idle'}
   else:data={'ok':True}
   r.fulfill(content_type='application/json',body=json.dumps(data))
  page.route('http://fixture.test/**',route);page.goto('http://fixture.test/')
  text=page.get_by_role('textbox',name='发送到当前对话',exact=True);text.wait_for()
  page.wait_for_timeout(200);assert not errors,errors
  page.get_by_role('button',name='新对话',exact=True).first.click()
  page.wait_for_function('document.querySelector("#empty strong")')
  assert page.locator('.mark').count()==0 and '山' not in page.locator('#empty').inner_text()
  assert ('POST','/api/threads') in requests
  page.get_by_role('button',name='历史',exact=True).click();assert page.locator('.hud.history .list').is_visible()
  page.get_by_role('button',name='完成',exact=True).click()
  for width,height in [(320,420),(390,740),(1000,800)]:
   page.set_viewport_size({'width':width,'height':height})
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   assert page.locator('.composer-actions button:visible').evaluate_all('(els)=>els.map(el=>el.id)')==['attachFile','mic','sendGo']
   assert page.get_by_role('button',name='新对话',exact=True).count()==1
   field=text.bounding_box();send=page.get_by_role('button',name='发送',exact=True).bounding_box()
   assert field and send and field['y']+field['height']<=send['y']+1 and send['y']+send['height']<=height
   page.screenshot(path=str(shots/f'summoner-{width}.png'))
  with page.expect_file_chooser():page.get_by_role('button',name='添加附件',exact=True).click()
  text.fill('请整理变更材料');page.get_by_role('button',name='发送',exact=True).click()
  page.wait_for_timeout(200);assert ('POST','/api/chat') in requests
  assert not errors,errors
  b.close()
print('PASS: real summoner script, reset without mark, history, input/action DOM order, keyboard-native attachment, send; synthetic HTTP/SSE only.')
