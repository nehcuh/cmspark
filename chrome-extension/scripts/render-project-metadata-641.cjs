// Actual React ProjectPanel + reducer. Synthetic extension transport goes to actual owned router.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=process.argv[2];fs.mkdirSync(out,{recursive:true});
const source=`import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';
import{AgentStoreProvider,useAgentStore}from'./src/sidepanel/store/agentStore';
import{ProjectPanel}from'./src/sidepanel/components/ProjectPanel';import{workspaceCSS}from'./src/sidepanel/ui/workspace-styles';
const listeners=new Set();window.sent=[];window.emitProject=m=>listeners.forEach(f=>f(m));
window.chrome={runtime:{onMessage:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)},sendMessage:m=>{
window.sent.push(m);const{require_connected,...frame}=m;fetch('/fixture/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(frame)}).then(r=>r.json()).then(response=>window.emitProject(response));return Promise.resolve({ok:true})}}};
function Harness(){const{state,dispatch}=useAgentStore();const[filter,setFilter]=useState('*');
window.fixtureState=state;window.switchOwner=id=>dispatch({type:'SET_ACTIVE_THREAD',threadId:id});
window.reloadThreads=()=>fetch('/fixture/threads').then(r=>r.json()).then(result=>dispatch({type:'SET_THREADS',threads:result.threads}));
useEffect(()=>{fetch('/fixture/threads').then(r=>r.json()).then(result=>{dispatch({type:'SET_THREADS',threads:result.threads});dispatch({type:'SET_ACTIVE_THREAD',threadId:result.threads[0].id})});const receive=m=>{if(m.type==='thread.created'||m.type==='thread.updated')dispatch({type:'UPSERT_THREAD',thread:m.thread});if(m.type==='thread.created'&&!window.fixtureState.activeThreadId)dispatch({type:'SET_ACTIVE_THREAD',threadId:m.thread.id})};listeners.add(receive);return()=>listeners.delete(receive)},[]);
return <div className='cm-workspace'><style>{workspaceCSS}</style><aside className='cm-navigation'><ProjectPanel filter={filter}onFilter={setFilter}/><p data-owner>{state.activeThreadId}</p><p data-filter>{filter}</p><button onClick={()=>window.reloadThreads()}>重新读取对话</button></aside><main className='cm-workspace-main'><p>OWNED_SYNTHETIC_TRANSPORT_NO_MODEL</p></main></div>}
createRoot(document.getElementById('root')).render(<AgentStoreProvider><Harness/></AgentStoreProvider>);`;
require(path.join(root,'node_modules/esbuild')).build({stdin:{contents:source,resolveDir:root,loader:'tsx'},bundle:true,outfile:path.join(out,'app.js'),jsx:'automatic'}).then(()=>{fs.writeFileSync(path.join(out,'index.html'),'<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div><script src="app.js"></script></body></html>')}).catch(()=>{console.error('OWNED_REACT_BUILD_FAILED');process.exitCode=1});
