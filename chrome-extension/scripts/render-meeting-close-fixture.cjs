// Actual MeetingPanel + ContextPanelHost + local STT adapter. Only PCM input and
// transport are synthetic; no live Companion, microphone, or user data.
const fs = require('fs'), path = require('path');
const root = process.cwd(), out = process.argv[2];
if (!out) throw new Error('output directory required');
fs.mkdirSync(out, { recursive: true });
const source = `
import React,{useEffect,useState} from 'react';import{createRoot}from'react-dom/client';
import{AgentStoreProvider,initialState,useAgentStore}from'./src/sidepanel/store/agentStore';
import{ContextPanelHostProvider,ContextPanelHost,useContextPanelHost}from'./src/sidepanel/components/ContextPanelHost';
import{MeetingPanel}from'./src/sidepanel/components/MeetingPanel';
import{meetingResponses as recorded}from'./tests/fixtures/meeting-responses';
const listeners=new Set();window.sent=[];window.persisted=[];window.deferStart=false;window.failRead=false;window.deferEnd=false;window.failWrite=false;
window.recorded=recorded;window.owner=recorded.created.response.meeting.id;
window.emit=m=>{for(const fn of [...listeners])fn(m)};
window.snapshot=()=>({...structuredClone(recorded.read.response.meeting),transcript:window.persisted.map(text=>({...recorded.appended.response.meeting.transcript[0],text}))});
window.reply=(key,m)=>window.emit({...structuredClone(recorded[key].response),id:m.id,meeting:window.snapshot()});
window.replyEnd=()=>window.reply('ended',window.sent.findLast(m=>m.type==='meeting.end'));
const event={addListener(){},removeListener(){}};
window.chrome={runtime:{id:'fixture',onMessage:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)},sendMessage:(m,cb)=>{
window.sent.push(m);queueMicrotask(()=>{cb?.({ok:true});
if(m.type==='meeting.start'&&!window.deferStart)window.reply('started',m);
if(m.type==='meeting.create')window.reply('created',m);
if(m.type==='meeting.append_transcript'||m.type==='meeting.set_transcript'){
if(window.failWrite){window.emit({...recorded.denied.response,id:m.id});window.reply('appended',{id:'stale-write'});}
else{if(m.type==='meeting.append_transcript')window.persisted.push(m.text);else window.persisted=m.text.split(/\\n+/).map(t=>t.trim()).filter(Boolean);window.reply(m.type==='meeting.append_transcript'?'appended':'replaced',m)}}
if(m.type==='meeting.get'){if(window.failRead)window.emit({...recorded.denied.response,id:m.id,message:'尚未确认保存'});else window.reply('read',m)}
if(m.type==='meeting.end'&&!window.deferEnd)window.reply('ended',m);
});return Promise.resolve({ok:true})}},storage:{local:{get:(k,cb)=>{const r={meeting_privacy_ack_v1:true};cb?.(r);return Promise.resolve(r)},set:(v,cb)=>{cb?.();return Promise.resolve()}},onChanged:event},tabs:{query:(q,cb)=>{cb?.([]);return Promise.resolve([])}}};
function Harness(){const h=useContextPanelHost();const{state,dispatch}=useAgentStore();window.dispatchUI=dispatch;window.activePanel=h.activePanel;
useEffect(()=>h.openPanelForce('meeting'),[]);return <><button onClick={()=>h.openPanelForce('skills')}>切换技能</button><button onClick={()=>h.openPanelForce('knowledge')}>切换知识</button><button onClick={()=>dispatch({type:'SET_SETTINGS_OPEN',open:true})}>打开设置</button><span data-testid='settings-state'>{state.settingsOpen?'设置已打开':'设置未打开'}</span><ContextPanelHost/></>}
function Standalone(){const[open,setOpen]=useState(true);window.activePanel=open?'meeting':null;return open?<MeetingPanel onClose={()=>{window.sent.push({type:'fixture.closed'});setOpen(false)}} onSendToDraft={()=>{}}/>:<span>独立面板已关闭</span>}
createRoot(document.getElementById('root')).render(<AgentStoreProvider initialState={{...initialState,connectionState:'connected',activeThreadId:'thread-fixture',voicePrivacyAckV2:true,voiceRealtimeStreaming:true,voiceModel:{localModelId:'medium',binary:{status:'ready'},models:{medium:{status:'ready'}}}}}>{location.search.includes('standalone')?<Standalone/>:<ContextPanelHostProvider capabilityLevel='chat'><Harness/></ContextPanelHostProvider>}</AgentStoreProvider>);
`;
const capture = `export async function startPcmStreamCapture(opts){window.capture=opts;window.captureStops=0;window.captureAborts=0;return{backend:'scriptprocessor',stop:async()=>{window.captureStops++},abort:()=>{window.captureAborts++}}}`;
const audioImport = `export * from ${JSON.stringify(path.join(root,'src/sidepanel/voice/meeting-audio-import.ts'))};import{wrapPcmS16leAsWav}from ${JSON.stringify(path.join(root,'src/sidepanel/voice/pcm-encode.ts'))};export async function fileToWavSegments(){if(window.deferDecode)await new Promise(r=>window.finishDecode=r);const wav=wrapPcmS16leAsWav(new Uint8Array(32000),16000,1);return{ok:true,segments:[{wav},{wav}],durationSec:2}}`;
require(path.join(root,'node_modules/esbuild')).build({stdin:{contents:source,resolveDir:root,loader:'tsx'},bundle:true,outfile:path.join(out,'app.js'),jsx:'automatic',plugins:[{name:'synthetic-pcm',setup(b){b.onResolve({filter:/\/pcm-stream-capture$/},()=>({path:'pcm-fixture',namespace:'fixture'}));b.onResolve({filter:/\/meeting-audio-import$/},()=>({path:'import-fixture',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='import-fixture'?audioImport:capture,loader:'ts',resolveDir:root}));}}]}).then(()=>fs.writeFileSync(path.join(out,'index.html'),'<html lang="zh-CN"><meta charset="utf-8"><body><div id="root"></div><script src="app.js"></script></body></html>')).catch(e=>{console.error(e);process.exitCode=1});
