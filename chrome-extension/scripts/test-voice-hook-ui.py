"""#482 real React useVoiceInput + production PCM adapter, synthetic capture/runtime.

After nvm use 22: uv run --no-project --with playwright python scripts/test-voice-hook-ui.py
No installed extension, audio device, or model service is used.
"""
import json
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

project = Path(__file__).resolve().parent.parent
hook = json.dumps(str(project / 'src/sidepanel/hooks/useVoiceInput.ts'))
source = """
import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useVoiceInput} from HOOK_PATH;
window.sent=[];window.drafts=[];window.voiceListeners=new Set();
window.pushVoice=msg=>{for(const handler of window.voiceListeners)handler(msg)};
window.chrome={runtime:{sendMessage:msg=>{window.sent.push(msg);return Promise.resolve()},onMessage:{addListener:fn=>window.voiceListeners.add(fn),removeListener:fn=>window.voiceListeners.delete(fn)}}};
Object.defineProperty(navigator,'permissions',{value:{query:async()=>({state:'granted'})}});
Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:()=>new Promise(resolve=>{window.grantCapture=()=>resolve({getTracks:()=>[{stop(){window.captureStopped=true}}]})})}});
window.AudioContext=class {
  state='running';sampleRate=16000;
  createMediaStreamSource(){return {connect(){},disconnect(){}}}
  createScriptProcessor(){return window.captureProcessor={connect(){},disconnect(){}}}
  createGain(){return {gain:{value:0},connect(){},disconnect(){}}}
  close(){return Promise.resolve()}
};
window.MediaRecorder=class {};
function Fixture(){
  const [draft,setDraft]=useState('已有草稿');const ref=useRef(draft);ref.current=draft;
  const [owner,setOwner]=useState('thread-a');
  const voice=useVoiceInput({getBaseText:()=>ref.current,onDraft:text=>{window.drafts.push(text);setDraft(text)},threadId:owner,
    allowStart:true,enabled:true,privacyAck:true,privacyAckV2:true,privacyAckV3:true,onNeedPrivacyAck(){throw new Error('unexpected privacy request')},onNeedPermissionBootstrap(){throw new Error('unexpected permission bootstrap')},
    sttEngine:'local',companionConnected:true,localReady:{model:true,binary:true},localStateHydrated:true,autoFallbackToBrowser:false,modelId:'medium',dictationMode:'classic',realtimeStreaming:true});
  return <><p id='phase'>{voice.phase}</p><textarea id='preview' readOnly value={voice.liveOverlay??draft}/><p id='draft'>{draft}</p><button id='toggle' onClick={()=>voice.toggle()}>听写</button><button id='switch' onClick={()=>setOwner('thread-b')}>切换</button></>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
""".replace('HOOK_PATH', hook)

with tempfile.TemporaryDirectory(prefix='cmspark-voice-hook-') as directory:
    root = Path(directory)
    build = "const x=JSON.parse(require('fs').readFileSync(0,'utf8'));require('esbuild').buildSync({stdin:{contents:x.source,resolveDir:process.cwd(),loader:'tsx'},bundle:true,outfile:x.outfile,jsx:'automatic'});"
    subprocess.run(['node', '-e', build], cwd=project, input=json.dumps({'source': source, 'outfile': str(root / 'app.js')}), text=True, check=True)
    (root / 'index.html').write_text('<html><meta charset="utf-8"><div id="root"></div><script src="app.js"></script></html>')
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True)
        for scenario in ['final', 'switch']:
            page = browser.new_page();page.set_default_timeout(5000)
            errors = [];page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto((root / 'index.html').as_uri());page.locator('#toggle').click()
            page.wait_for_function('document.querySelector("#phase").textContent==="starting" && typeof window.grantCapture==="function"')
            assert not page.evaluate('window.sent.some(m=>m.type==="voice.stt.start")')
            page.evaluate('window.grantCapture()')
            page.wait_for_function('document.querySelector("#phase").textContent==="listening"')
            sid = page.evaluate('window.sent.find(m=>m.type==="voice.stt.start").sessionId')
            page.evaluate('window.captureProcessor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(16000)}})')
            page.evaluate('(sid)=>window.pushVoice({type:"voice.stt.partial",sessionId:sid,status:"hypothesis",text:"预览文字"})', sid)
            page.wait_for_function('document.querySelector("#preview").value.includes("预览文字")')
            assert page.locator('#draft').inner_text() == '已有草稿'
            page.locator('#toggle').click()
            page.wait_for_function('document.querySelector("#phase").textContent==="processing"')
            if scenario == 'switch':
                page.locator('#switch').click()
                page.wait_for_function('window.sent.some(m=>m.type==="voice.stt.abort")')
            page.evaluate('(sid)=>window.pushVoice({type:"voice.stt.result",sessionId:sid,text:"最终文字"})', sid)
            page.wait_for_function('document.querySelector("#phase").textContent==="idle"')
            if scenario == 'final':
                page.wait_for_function('document.querySelector("#draft").textContent.includes("最终文字")')
                assert page.locator('#draft').inner_text().count('最终文字') == 1
                assert '预览文字' not in page.locator('#draft').inner_text()
            else:
                assert page.locator('#draft').inner_text() == '已有草稿'
                assert page.evaluate('window.drafts.length') == 0
            assert page.evaluate('window.captureStopped===true')
            assert not page.evaluate('window.sent.some(m=>m.type.startsWith("chat."))')
            assert not errors, errors
            page.close()
        browser.close()
print('PASS: real React useVoiceInput and PCM adapter; pending capture remains starting; readiness enters listening; interim stays preview; final commits once; thread switch discards late final; no auto-send.')
