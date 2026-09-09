"""#496: real executor/adapter frames replayed through the real React WS hook.

Compile companion tests first. Run with Node 22 and uv --with playwright.
No live model, user attachments, installed extension or production data is used.
"""
import json
import re
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

project = Path(__file__).resolve().parent.parent
source = """
import React from 'react';import{createRoot}from'react-dom/client';
import{AgentStoreProvider,initialState,useAgentStore}from'./src/sidepanel/store/agentStore';
import{useWebSocket}from'./src/sidepanel/hooks/useWebSocket';
import{useScopedRunBusy}from'./src/sidepanel/hooks/use-scoped-run-busy';
import{ChatView}from'./src/sidepanel/components/ChatView';
const recorded=RECORDED;window.recorded=recorded;
const listeners=new Set(),event={addListener(){},removeListener(){}};window.listeners=listeners;
window.emit=m=>{for(const fn of listeners)fn(m)};
window.chrome={runtime:{onMessage:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)},sendMessage:(m,cb)=>{cb?.(m.type==='getStatus'?{connectionState:'connected'}:undefined);return Promise.resolve()},connect:()=>({disconnect(){},onMessage:event,onDisconnect:event})},storage:{local:{get:(k,cb)=>{cb?.({});return Promise.resolve({})},set(){},remove(){}},onChanged:event},tabs:{query:(q,cb)=>{cb?.([]);return Promise.resolve([])},onActivated:event,onUpdated:event}};
function Harness(){useWebSocket();const{state,dispatch}=useAgentStore();window.state=state;window.dispatchUI=dispatch;
const busy=useScopedRunBusy();return <><output id='busy'>{String(busy.threadBusy)}</output><ChatView/></>}
createRoot(document.getElementById('root')).render(<AgentStoreProvider initialState={{...initialState,threads:recorded.threads,activeThreadId:recorded.threads[0].id,connectionState:'connected'}}><Harness/></AgentStoreProvider>);
"""

with tempfile.TemporaryDirectory(prefix='cmspark-chat-run-496-') as directory:
    out = Path(directory)
    subprocess.run(['node', str(project.parent / 'companion/scripts/record-chat-run-fixture.cjs'), str(out / 'frames.json')], check=True)
    recorded = json.loads((out / 'frames.json').read_text())
    assert recorded['select']['run_status'] == 'idle'
    assert any(frame['type'] == 'chat.done' for frame in recorded['frames'])
    build = "const x=JSON.parse(require('fs').readFileSync(0,'utf8'));require('esbuild').buildSync({stdin:{contents:x.source,resolveDir:process.cwd(),loader:'tsx'},bundle:true,outfile:x.outfile,jsx:'automatic',loader:{'.css':'css','.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl'}});"
    subprocess.run(['node', '-e', build], cwd=project, input=json.dumps({'source': source.replace('RECORDED', json.dumps(recorded)), 'outfile': str(out / 'app.js')}), text=True, check=True)
    (out / 'index.html').write_text('<html><meta charset="utf-8"><div id="root"></div><script src="app.js"></script></html>')
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True)
        for iteration in range(3):
            page = browser.new_page(viewport={'width':390,'height':740})
            page.set_default_timeout(5000)
            errors = []
            page.on('pageerror', lambda error: (errors.append(str(error)), print('PAGE ERROR:', error, flush=True)))
            page.goto((out / 'index.html').as_uri())
            page.wait_for_function('Boolean(window.dispatchUI) && window.listeners.size > 0')
            assert not errors, errors
            for frame in recorded['frames']:
                page.evaluate('(frame)=>window.emit(frame)', frame)
            page.wait_for_function('window.state.messages.some(m=>m.role==="assistant")')
            assert page.locator('#busy').inner_text() == 'false', 'completed attachment run must be idle'
            assert not page.evaluate('window.state.messages.some(m=>m.tool_calls?.some(t=>t.status==="running"))')
            assert page.get_by_text(re.compile(r'执行中[:：]\s*list_tabs')).count() == 0
            # Cache-only switching must be correct even before hydration arrives.
            for thread in [recorded['threads'][1], recorded['threads'][0]]:
                page.evaluate('(id)=>window.dispatchUI({type:"SET_ACTIVE_THREAD",threadId:id})', thread['id'])
                page.wait_for_function('(id)=>window.state.activeThreadId===id', arg=thread['id'])
                assert page.locator('#busy').inner_text() == 'false', 'cached thread must not resurrect running tools'
                assert not page.evaluate('window.state.messages.some(m=>m.tool_calls?.some(t=>t.status==="running"))')
            page.evaluate('(frame)=>window.emit(frame)', recorded['select'])
            assert page.locator('#busy').inner_text() == 'false', 'idle history snapshot stays idle'
            assert not page.evaluate('window.state.messages.some(m=>m.tool_calls?.some(t=>t.status==="running"))')
            assert not errors, errors
            page.close()
            print(f'PASS {iteration+1}: attachment completion, new/old cached threads, history hydrate')
        browser.close()
