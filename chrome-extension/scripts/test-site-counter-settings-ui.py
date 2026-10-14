"""Actual App DOM: recorded #533 router outputs plus explicit synthetic transport.
Never connects to a live Companion or alters user configuration/profile.
"""
import argparse,json,subprocess,tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
parser=argparse.ArgumentParser();parser.add_argument('--fixture',required=True);parser.add_argument('--out',required=True);parser.add_argument('--include-timeout',action='store_true');parser.add_argument('--owner-only',action='store_true');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
recorded=json.loads(Path(args.fixture).read_text());cases=[];errors=[];failures=[];owner_observations=[]
try:
 with tempfile.TemporaryDirectory(prefix='cmspark-533-ui-') as bundle:
  subprocess.run(['node','scripts/render-workspace-fixture.cjs',bundle],cwd=root,check=True)
  with sync_playwright() as p:
   browser=p.chromium.launch(headless=True);page=browser.new_page(viewport={'width':1200,'height':850});page.set_default_timeout(3000)
   page.route('http*://**',lambda route:route.abort());page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto((Path(bundle)/'index.html').as_uri());page.wait_for_function('Boolean(window.dispatchUI)')
   page.evaluate('''r=>{
    window.siteRecorded=r;window.siteMode='auto';window.siteRequests=[];window.sitePending=[];
    window.siteReply=(m,kind)=>window.emitRuntime({...r[kind],id:m.id,thread_id:m.thread_id});
    const original=chrome.runtime.sendMessage;
    chrome.runtime.sendMessage=(m,cb)=>{
     if(!['site.counter.status','site.counter.reset'].includes(m.type))return original(m,cb);
     window.siteRequests.push(m);
     if(window.siteMode==='throw')throw Error('SYNTHETIC_PRIVATE_THROW');
     if(window.siteMode==='last-error'){chrome.runtime.lastError={message:'SYNTHETIC_PRIVATE_LASTERROR'};try{cb?.(undefined)}finally{delete chrome.runtime.lastError}return;}
     if(window.siteMode==='false'){cb?.({ok:false});return Promise.resolve({ok:false});}
     if(window.siteMode==='reply-before-ack')window.siteReply(m,m.type==='site.counter.reset'?'reset':'status');
     cb?.({ok:true,id:m.id,context_tab_id:r.status.context_tab_id});
     if(window.siteMode==='defer')window.sitePending.push(m);
     else queueMicrotask(()=>window.siteReply(m,m.type==='site.counter.reset'?'reset':'status'));
     return Promise.resolve({ok:true});
    };
    window.siteEventListeners={activated:new Set(),updated:new Set()};
    chrome.tabs.onActivated={addListener:f=>window.siteEventListeners.activated.add(f),removeListener:f=>window.siteEventListeners.activated.delete(f)};
    chrome.tabs.onUpdated={addListener:f=>window.siteEventListeners.updated.add(f),removeListener:f=>window.siteEventListeners.updated.delete(f)};
   }''',recorded)
   page.evaluate("window.dispatchUI({type:'OPEN_SETTINGS_SECTION',section:'security'})")
   region=page.get_by_role('region',name='站点失败计数',exact=True);region.wait_for()
   reset=region.get_by_role('button',name='重置当前对话此站点的失败计数',exact=True);refresh=region.get_by_role('button',name='刷新站点状态',exact=True)
   def flush():
    page.evaluate("()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
   def ready():
    page.evaluate("window.siteMode='auto'");refresh.click();region.get_by_text('失败计数：4 / 4',exact=True).wait_for()
   # Real canonical selection actions, including React's batched A -> B -> A.
   # Wire semantic fields come from the actual paired WS producer; only request
   # correlation and transport timing are controlled, never invented health.
   for variant in ['no-switch','ordinary-rerender','separate-return','batched-return','null-return','late-refusal','current-refusal']:
    ready();page.evaluate("window.siteMode='defer'");reset.click();old=page.evaluate('window.sitePending.pop()')
    initial=page.evaluate('({owner:window.fixtureState.activeThreadId,revision:window.fixtureState.activeThreadSelectionRevision,requests:window.siteRequests.length})')
    if variant=='ordinary-rerender':
     page.evaluate("window.dispatchUI({type:'SET_CONNECTION',state:'connected'})");flush()
    elif variant=='separate-return':
     page.evaluate("window.siteMode='auto';window.dispatchUI({type:'SET_ACTIVE_THREAD',threadId:'demo-1'})");flush();region.get_by_text('失败计数：4 / 4',exact=True).wait_for()
     page.evaluate('(id)=>window.dispatchUI({type:"SET_ACTIVE_THREAD",threadId:id})',initial['owner']);flush();region.get_by_text('失败计数：4 / 4',exact=True).wait_for()
    elif variant in ['batched-return','late-refusal']:
     page.evaluate('(id)=>{window.siteMode="auto";window.dispatchUI({type:"SET_ACTIVE_THREAD",threadId:"demo-1"});window.dispatchUI({type:"SET_ACTIVE_THREAD",threadId:id})}',initial['owner']);flush()
    elif variant=='null-return':
     page.evaluate('(id)=>{window.siteMode="auto";const rows=window.fixtureState.threads;window.dispatchUI({type:"SET_THREADS",threads:[]});window.dispatchUI({type:"SET_THREADS",threads:rows});window.dispatchUI({type:"SET_ACTIVE_THREAD",threadId:id})}',initial['owner']);flush()
    before=page.evaluate('({owner:window.fixtureState.activeThreadId,revision:window.fixtureState.activeThreadSelectionRevision,requests:window.siteRequests.length})')
    page.evaluate('(x)=>window.siteReply(x.message,x.kind)',{'message':old,'kind':'busy' if variant in ['late-refusal','current-refusal'] else 'reset'});flush()
    text=region.inner_text();unchanged=variant in ['no-switch','ordinary-rerender'];current_refusal=variant=='current-refusal'
    passed=('失败计数：0 / 4' in text and '失败计数已重置' in text and before['requests']==initial['requests']) if unchanged else ('失败计数：4 / 4' in text and '失败计数：0 / 4' not in text and '失败计数已重置' not in text)
    if current_refusal:passed=passed and '当前对话仍有任务或确认未结束' in text
    elif not unchanged:passed=passed and '当前对话仍有任务或确认未结束' not in text and before['requests']>initial['requests']
    owner_observations.append({'variant':variant,'initial':initial,'beforeRelease':before,'afterRelease':{'text':text,'waiting':reset.is_disabled()},'PASS':passed})
    if passed:cases.append('canonical owner control '+variant)
   assert all(row['PASS'] for row in owner_observations),'CANONICAL_SELECTION_STALE_COUNTER_REPLY'
   if args.owner_only:
    assert not errors;browser.close();raise SystemExit(0)
   ready();assert recorded['status']['origin'] in region.inner_text();assert 'UNKNOWN' in region.inner_text();assert 'synthetic' not in region.inner_text();cases.append('recorded current scope/count/UNKNOWN visible')
   page.evaluate("window.siteMode='defer'");reset.click();assert '失败计数：4 / 4' in region.inner_text();assert '失败计数：0 / 4' not in region.inner_text()
   page.evaluate("window.siteReply(window.sitePending.pop(),'reset')");region.get_by_text('失败计数：0 / 4',exact=True).wait_for();assert 'UNKNOWN' in region.inner_text();assert '未确认恢复' in region.inner_text();cases.append('ack does not reset; correlated actual reply count0/UNKNOWN/noREADY')
   ready();page.evaluate("window.siteMode='defer'");reset.click();page.evaluate("window.emitRuntime({...window.siteRecorded.busy,id:window.sitePending.pop().id,thread_id:window.fixtureState.activeThreadId})")
   region.get_by_text('当前对话仍有任务或确认未结束，请完成后重试。',exact=True).wait_for();assert '失败计数：4 / 4' in region.inner_text();cases.append('actual recorded busy refusal, no optimistic reset')
   for mode in ['last-error','false','throw']:
    ready();page.evaluate('(m)=>window.siteMode=m',mode);reset.click();region.get_by_text('请求未送达，请检查连接后重试。',exact=True).wait_for();assert '失败计数：4 / 4' in region.inner_text();assert 'SYNTHETIC_PRIVATE' not in region.inner_text();cases.append('fixed transport feedback '+mode)
   ready();page.evaluate("window.siteMode='defer'");reset.click();old=page.evaluate('window.sitePending.pop()')
   page.evaluate("window.siteMode='auto';window.dispatchUI({type:'SET_ACTIVE_THREAD',threadId:'demo-1'})")
   region.get_by_text('失败计数：4 / 4',exact=True).wait_for();page.evaluate('(m)=>window.siteReply(m,"reset")',old);flush();assert '失败计数：4 / 4' in region.inner_text();cases.append('late reset prior owner ignored')
   ready();page.evaluate("window.siteMode='defer'");reset.click();old=page.evaluate('window.sitePending.pop()')
   page.evaluate("for(const f of window.siteEventListeners.activated)f({tabId:8,windowId:1})")
   page.evaluate('(m)=>window.siteReply(m,"reset")',old);flush();assert '失败计数：0 / 4' not in region.inner_text();assert reset.is_disabled();cases.append('tab switch invalidates scope; late reset ignored')
   ready();page.evaluate("window.siteMode='defer'");reset.click();pending=page.evaluate('window.sitePending.pop()')
   page.evaluate('(m)=>window.siteReply({...m,id:"wrong-id"},"reset")',pending);flush();assert '失败计数：4 / 4' in region.inner_text();assert reset.is_disabled()
   page.evaluate('(m)=>window.siteReply({...m,thread_id:"wrong-owner"},"reset")',pending);flush();assert '失败计数：4 / 4' in region.inner_text()
   page.evaluate('(m)=>window.emitRuntime({...window.siteRecorded.reset,id:m.id,thread_id:m.thread_id,context_tab_id:8})',pending);flush();assert '失败计数：4 / 4' in region.inner_text();assert reset.is_disabled()
   page.evaluate('(m)=>window.siteReply(m,"reset")',pending);region.get_by_text('失败计数：0 / 4',exact=True).wait_for();cases.append('wrong id/owner ignored; correlated response settles')
   ready();page.evaluate("window.dispatchUI({type:'SET_CONNECTION',state:'disconnected'})");expect(reset).to_be_disabled();expect(region).not_to_contain_text('失败计数：4 / 4');cases.append('disconnect clears stale scope and disables reset')
   page.evaluate("window.siteMode='auto';window.dispatchUI({type:'SET_CONNECTION',state:'connected'})");region.get_by_text('失败计数：4 / 4',exact=True).wait_for()
   page.evaluate("for(const f of window.siteEventListeners.updated)f(8,{url:'https://other533.test/'})");flush();assert '失败计数：4 / 4' in region.inner_text();assert not reset.is_disabled();cases.append('unrelated tab navigation does not revoke known current scope')
   page.evaluate("window.siteMode='reply-before-ack'");refresh.click();region.get_by_text('失败计数：4 / 4',exact=True).wait_for();expect(reset).to_be_enabled();cases.append('early canonical reply waits for matching tab ack')
   ready();page.evaluate("window.siteMode='defer'");refresh.click();pending=page.evaluate('window.sitePending.pop()')
   page.evaluate('(m)=>window.emitRuntime({...window.siteRecorded.status,id:m.id,thread_id:m.thread_id,fails:-1})',pending);flush();assert reset.is_disabled();assert '失败计数：0 / 4' not in region.inner_text()
   page.evaluate('(m)=>window.siteReply(m,"status")',pending);expect(reset).to_be_enabled();cases.append('invalid counter reply cannot settle owned request')
   page.evaluate("window.siteMode='defer';window.dispatchUI({type:'SET_CONNECTION',state:'disconnected'})");flush();page.evaluate("window.dispatchUI({type:'SET_CONNECTION',state:'connected'})");flush();pending=page.evaluate('window.sitePending.pop()')
   page.evaluate("for(const f of window.siteEventListeners.updated)f(7,{url:'https://scope533.test:8443/changed'})");page.evaluate('(m)=>window.siteReply(m,"status")',pending);flush();assert reset.is_disabled();assert '失败计数：4 / 4' not in region.inner_text();cases.append('navigation while initial status pending revokes late reply')
   ready()
   if args.include_timeout:
    page.evaluate("window.siteMode='defer'");reset.click();region.get_by_text('站点状态响应超时，请刷新后重试。',exact=True).wait_for(timeout=7000);assert '失败计数：4 / 4' in region.inner_text();cases.append('actual bounded 5s UI timeout is visible without optimistic reset');ready()
   page.screenshot(path=str(out/'site-counter-settings.png'));assert not errors
   (out/'requests.json').write_text(json.dumps(page.evaluate('window.siteRequests'),ensure_ascii=False,indent=2)+'\n')
   assert all(m.get('source')=='settings' for m in page.evaluate('window.siteRequests'))
   assert not page.evaluate('window.sent.some(m=>m.type==="config.set" || m.type==="terminal.start")');browser.close()
except Exception as error:
 failures.append(str(error));raise
finally:
 (out/'receipt.json').write_text(json.dumps({'cases':cases,'passed':len(cases),'failures':failures,'page_errors':errors,'owner_observations':owner_observations,'classification':'actual App DOM/canonical reducer; real router recorded responses; declared synthetic transport/owner/tab; bundled Chromium, not native Chrome153/SSO'},ensure_ascii=False,indent=2)+'\n')
