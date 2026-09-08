"""#482: execute the real summoner HTML with synthetic microphone/recognizer/HTTP.

No microphone permission, audio files, model service, or installed app are touched.
Run after nvm use 22: uv run --no-project --with playwright python scripts/test-summoner-voice-ui.py
"""
from pathlib import Path
from urllib.parse import urlparse
import json
import subprocess
import tempfile
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
bootstrap = """
window.EventSource=class {constructor(){window.fixtureEvents=this} addEventListener(){} close(){}};
window.resizeTo=()=>{};window.moveTo=()=>{};
const fixtureSetTimeout=window.setTimeout.bind(window);
window.fixturePartialTimers=[];
window.setTimeout=(fn,ms,...args)=>{
  if(ms===1400){const id=fixtureSetTimeout(()=>{},999999);window.fixturePartialTimers.push({id,fn});return id}
  return fixtureSetTimeout(fn,ms,...args);
};
window.fixtureFirePartial=()=>{const item=window.fixturePartialTimers.shift();clearTimeout(item.id);item.fn()};
window.SpeechRecognition=class {
  constructor(){window.fixtureRecognition=this}
  start(){queueMicrotask(()=>this.onstart?.())}
  stop(){queueMicrotask(()=>this.onend?.())}
  abort(){}
};
Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop(){window.fixtureStopped=true}}]})}});
window.AudioContext=class {
  state='running';sampleRate=16000;
  createMediaStreamSource(){return {connect(){},disconnect(){}}}
  createScriptProcessor(){return window.fixtureProcessor={connect(){},disconnect(){}}}
  createGain(){return {gain:{value:0},connect(){},disconnect(){}}}
  close(){return Promise.resolve()}
};
"""
with tempfile.TemporaryDirectory() as out:
    subprocess.run(['node', 'scripts/render-web-surface-fixtures.cjs', out], cwd=root, check=True)
    html = (Path(out) / 'capture.html').read_text().replace('%%CRUISE_LABEL%%', '每次确认')
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True)
        for engine, scenario in [('browser', 'normal'), ('local', 'normal'), ('system', 'normal'), ('local', 'pending-partial'), ('local', 'pagehide')]:
            page = browser.new_page(viewport={'width': 360, 'height': 600})
            page.set_default_timeout(6000)
            page.add_init_script(bootstrap)
            requests, errors, pending_routes = [], [], {}
            page.on('pageerror', lambda error: errors.append(str(error)))
            def route(r):
                path = urlparse(r.request.url).path
                body = r.request.post_data_json if r.request.post_data else {}
                requests.append((path, body))
                if path == '/':
                    r.fulfill(content_type='text/html', body=html)
                    return
                if scenario == 'pending-partial' and path in ['/api/stt/partial', '/api/stt/end']:
                    pending_routes[path] = (r, body)
                    return
                if path == '/api/voice-settings': data = {'sttEngine': engine, 'localModelId': 'medium', 'lang': 'zh-CN'}
                elif path == '/api/threads': data = {'threads': [{'id': 'thread-a', 'alias': '语音验收'}]}
                elif path == '/api/thread': data = {'messages': [], 'run_status': 'idle'}
                elif path == '/api/stt/end': data = {'type': 'voice.stt.result', 'sessionId': body['sessionId'], 'text': '本机识别结果'}
                else: data = {'type': 'ok'}
                r.fulfill(content_type='application/json', body=json.dumps(data))
            page.route('http://voice.fixture/**', route)
            page.goto('http://voice.fixture/')
            page.locator('#mic').click()
            page.locator('#voicePrivacyAck').click()
            page.wait_for_function('document.querySelector("#voiceStatus").textContent.includes("正在听写")')
            if engine == 'browser':
                page.evaluate('window.fixtureRecognition.onresult({resultIndex:0,results:[{0:{transcript:"浏览器结果"},isFinal:true}]})')
            else:
                page.evaluate('window.fixtureProcessor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(16000)}})')
            if scenario == 'pagehide':
                with page.expect_request('**/api/stt/abort'):
                    page.evaluate('window.dispatchEvent(new PageTransitionEvent("pagehide"))')
                assert page.evaluate('window.fixtureStopped === true')
                assert page.locator('#text').input_value() == ''
                assert not errors, errors
                page.close()
                continue
            if scenario == 'pending-partial':
                with page.expect_request('**/api/stt/partial'):
                    page.evaluate('window.fixtureFirePartial()')
            page.locator('#mic').click()
            if scenario == 'pending-partial':
                # End must reach HTTP while partial remains unresolved.
                page.wait_for_function('document.querySelector("#voiceStatus").textContent.includes("正在识别")')
                page.evaluate('Promise.resolve()')
                assert '/api/stt/end' in pending_routes, 'partial must not block final end'
                end_route, end_body = pending_routes['/api/stt/end']
                sid = end_body['sessionId']
                page.evaluate('(sid)=>window.fixtureEvents.onmessage({data:JSON.stringify({type:"voice.stt.result",sessionId:sid,text:"重复结果"})})', sid)
                assert page.locator('#text').input_value() == ''
                partial_route, _ = pending_routes['/api/stt/partial']
                partial_route.fulfill(content_type='application/json', body=json.dumps({'type': 'voice.stt.result', 'sessionId': sid, 'text': '重复结果'}))
                end_route.fulfill(content_type='application/json', body=json.dumps({'type': 'voice.stt.result', 'sessionId': sid, 'text': '唯一结果'}))
            page.wait_for_function('document.querySelector("#text").value.includes("结果")')
            if scenario == 'pending-partial':
                assert page.locator('#text').input_value() == '唯一结果'
                page.evaluate('(sid)=>window.fixtureEvents.onmessage({data:JSON.stringify({type:"voice.stt.result",sessionId:sid,text:"重复结果"})})', sid)
                assert page.locator('#text').input_value() == '唯一结果'
            assert not errors, errors
            if engine == 'browser':
                assert not any(path.startswith('/api/stt/') for path, _ in requests)
            else:
                actual = [(path, body) for path, body in requests if path in ['/api/stt/start', '/api/stt/chunk', '/api/stt/end']]
                assert [path for path, _ in actual] == ['/api/stt/start', '/api/stt/chunk', '/api/stt/end'], actual
                assert actual[0][1]['engine'] == engine
                assert actual[-1][1]['totalSeq'] == 1
                assert page.evaluate('window.fixtureStopped === true')
            assert page.locator('#voiceStatus').is_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.close()
        browser.close()
print('PASS: real summoner HTML; browser/local/system selection, privacy action, visible recording state, ordered HTTP upload; pending partial does not block end; duplicate SSE/partial finals never commit; final HTTP commits once; pagehide cancels microphone/session. Synthetic capture only.')
