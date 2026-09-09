// Real MeetingPanel, STT adapter and meeting handler/store. Only PCM/STT/LLM
// boundaries are synthetic. Server data lives in a disposable directory.
const fs = require('fs'), path = require('path');
const root = process.cwd(), out = process.argv[2];
if (!out) throw new Error('output directory required');
fs.mkdirSync(out, { recursive: true });
const source = `
import React from 'react';import{createRoot}from'react-dom/client';
import{AgentStoreProvider,initialState,useAgentStore}from'./src/sidepanel/store/agentStore';
import{MeetingPanel}from'./src/sidepanel/components/MeetingPanel';
const listeners=new Set();window.sent=[];window.responses=[];window.failWrite=false;window.deferRefine=true;
window.emit=m=>{window.responses.push(m);for(const fn of [...listeners])fn(m)};
const event={addListener(){},removeListener(){}};
window.chrome={runtime:{id:'fixture',onMessage:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)},sendMessage:(m,cb)=>{
window.sent.push(m);cb?.({ok:true});
if(m.type.startsWith('meeting.'))fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:m,failWrite:window.failWrite,failLlm:window.failLlm})}).then(r=>r.json()).then(window.emit);
if(m.type==='voice.refine.request'&&!window.deferRefine)queueMicrotask(()=>window.emit({type:'voice.refine.result',sessionId:m.sessionId,refineGen:m.refineGen,text:m.text}));
return Promise.resolve({ok:true})}},storage:{local:{get:(k,cb)=>{const r={meeting_privacy_ack_v1:true};cb?.(r);return Promise.resolve(r)},set:(v,cb)=>{cb?.();return Promise.resolve()}},onChanged:event},tabs:{query:(q,cb)=>{cb?.([]);return Promise.resolve([])}}};
function Harness(){const{dispatch}=useAgentStore();window.dispatchUI=dispatch;return <MeetingPanel onClose={()=>{window.closed=true}} onSendToDraft={text=>window.draft=text}/>}
createRoot(document.getElementById('root')).render(<AgentStoreProvider initialState={{...initialState,connectionState:'connected',activeThreadId:'thread-fixture',voicePrivacyAckV2:true,voiceRealtimeStreaming:true,voiceModel:{sttEngine:'local',localModelId:'medium',binary:{status:'ready'},models:{medium:{status:'ready'}}}}}><Harness/></AgentStoreProvider>);
`;
const capture = `export async function startPcmStreamCapture(opts){window.capture=opts;window.captureStops=0;return{backend:'scriptprocessor',stop:async()=>{window.captureStops++},abort:()=>{}}}`;
const esbuild=require(path.join(root,'node_modules/esbuild'));
const plugins=process.argv.includes('--real-mic')?[]:[{name:'synthetic-pcm',setup(b){b.onResolve({filter:/\/pcm-stream-capture$/},()=>({path:'pcm-fixture',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:capture,loader:'ts',resolveDir:root}));}}];
if(process.argv.includes('--baseline'))plugins.push({name:'baseline-panel',setup(b){b.onLoad({filter:/\/MeetingPanel\.tsx$/},args=>({contents:require('child_process').execFileSync('git',['show','e7be0d2f:chrome-extension/src/sidepanel/components/MeetingPanel.tsx'],{cwd:root,encoding:'utf8'}),loader:'tsx',resolveDir:path.dirname(args.path)}));}});
esbuild.build({stdin:{contents:source,resolveDir:root,loader:'tsx'},bundle:true,outfile:path.join(out,'app.js'),jsx:'automatic',plugins}).then(()=>fs.writeFileSync(path.join(out,'index.html'),'<html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0}*{box-sizing:border-box}</style><body><div id="root"></div><script src="app.js"></script></body></html>')).catch(e=>{console.error(e);process.exitCode=1});
