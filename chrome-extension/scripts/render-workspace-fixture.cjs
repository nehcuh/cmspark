// Synthetic transport fixture for actual App components. Never connects to live Companion.
const fs=require('fs'),path=require('path');
const root=process.cwd(),out=process.argv[2] || '/private/tmp/cmspark-workspace-ui';fs.mkdirSync(out,{recursive:true});
const store=path.join(root,'src/sidepanel/store/agentStore.tsx');
const hook=`import {useEffect} from 'react';import {useAgentStore} from ${JSON.stringify(store)};
export const shouldApplyStreamEvent=()=>true;
export function useWebSocket(){const {state,dispatch}=useAgentStore();window.fixtureState=state;useEffect(()=>{window.dispatchUI=dispatch;const threads=window.demoThreads;dispatch({type:'SET_CONNECTION',state:'connected'});dispatch({type:'SET_THREADS',threads});dispatch({type:'SET_ACTIVE_THREAD',threadId:threads[0].id});dispatch({type:'SET_MESSAGES',messages:[]});},[]);return {connectionState:state.connectionState};}`;
const source=`import {recordedThreadMutationResponses} from ${JSON.stringify(path.join(root,'tests/fixtures/thread-mutation-responses.ts'))};import {CockpitRoot} from ${JSON.stringify(path.join(root,'src/cockpit/CockpitApp.tsx'))};import React from 'react';import{createRoot}from'react-dom/client';import{App}from${JSON.stringify(path.join(root,'src/sidepanel/App.tsx'))};
const event={addListener(){},removeListener(){}};window.sent=[];window.runtimeListeners=new Set();window.emitRuntime=message=>{for(const fn of window.runtimeListeners)fn(message)};const runtimeEvent={addListener:fn=>window.runtimeListeners.add(fn),removeListener:fn=>window.runtimeListeners.delete(fn)};
window.demoThreads=['发布 v2.8 · 变更材料','支付服务 · 需求与测试追溯','本周运行状态巡检','整理架构评审记录'].map((alias,i)=>({id:'demo-'+i,alias,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),config_override:{},tool_whitelist:null,pinned_tabs:[],active_skill_ids:[],agent_role:'normal'}));
const tabs=[{id:1,title:'支付服务 · 版本 v2.8 — DevOps',url:'https://devops.example.test/releases/2.8',active:true}];
const respond=(value,cb)=>{if(typeof cb==='function')queueMicrotask(()=>cb(value));return Promise.resolve(value)};
window.mutationRequests=[];
window.finishThreadMutation=(m)=>{
 if(m.probe){window.emitRuntime(window.legacyEmptyProbe?{type:'error',id:m.id,error:'thread.batch_delete requires non-empty thread_ids'}:{...recordedThreadMutationResponses.capabilities,id:m.id});return;}
 const mode=m.type==='thread.restore'?'restore':m.mode;
 const ids=m.thread_ids, server=window.fixtureServerThreads || window.fixtureState.threads;
 const failed=ids.filter(id=>(window.mutationFailedIds||[]).includes(id) || (m.only_empty && server.find(t=>t.id===id)?.message_count>0)).map(id=>({id,reason:m.only_empty?'not_empty':'thread_busy'}));
 const ok=ids.filter(id=>!failed.some(f=>f.id===id));
 window.fixtureServerThreads=server.flatMap(t=>!ok.includes(t.id)?[t]:mode==='hard'?[]:[{...t,trashed_at:mode==='restore'?null:new Date().toISOString()}]);
 // Result fields come from the real companion router capture used by contract tests.
 const result={...recordedThreadMutationResponses[mode],id:m.id,failed};
 if(mode==='restore'){result.restored=ok;result.restored_count=ok.length;}
 else {result.ok=ok;result.deleted_ids=ok;result.deleted_count=ok.length;}
 window.emitRuntime(result);
};
window.chrome={runtime:{id:'preview',getURL:p=>p,onMessage:runtimeEvent,onConnect:event,sendMessage:(m,cb)=>{window.sent.push(m);let value={ok:true,id:m.id};if(m.type==='thread.update' && m.id && window.metadataReply!=='ack-only')setTimeout(()=>window.emitRuntime(window.metadataReply==='error'?{type:'error',id:m.id,error:'Fixture persistence failed'}:{type:'thread.updated',id:m.id,thread:{...window.fixtureState.threads.find(t=>t.id===m.thread_id),...m.updates}}),25);if(m.type==='thread.create')value={thread:{...window.demoThreads[0],id:'created-'+Date.now(),alias:''}};if(m.type==='thread.select')setTimeout(()=>window.dispatchUI({type:'SET_MESSAGES',messages:[]}),0);if(m.type==='thread.batch_delete'||m.type==='thread.restore'){window.mutationRequests.push(m);if(window.mutationReply==='offline')value={ok:false,id:m.id};else if(window.mutationReply!=='defer')setTimeout(()=>window.finishThreadMutation(m),25);}if(m.type==='thread.list' && window.fixtureServerThreads)setTimeout(()=>window.dispatchUI({type:'SET_THREADS',threads:window.fixtureServerThreads.filter(t=>m.include_trashed||!t.trashed_at)}),25);return respond(value,cb)},connect:()=>({onMessage:event,onDisconnect:event,postMessage(){},disconnect(){}})},storage:{local:{get:(keys,cb)=>respond({},cb),set:(v,cb)=>respond({},cb)},onChanged:event},tabs:{query:(q,cb)=>respond(tabs,cb),onActivated:event,onUpdated:event},windows:{getCurrent:(o,cb)=>respond({id:1},cb)},commands:{onCommand:event}};
createRoot(document.getElementById('root')).render(location.search.includes('cockpit') ? <CockpitRoot/> : <App/>);`;
require(path.join(root,'node_modules/esbuild')).build({stdin:{contents:source,resolveDir:root,loader:'tsx'},bundle:true,outfile:path.join(out,'app.js'),jsx:'automatic',loader:{'.css':'css','.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl'},plugins:[{name:'synthetic-transport',setup(b){b.onResolve({filter:/hooks\/useWebSocket$/},()=>({path:'fixture-hook',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:hook,loader:'tsx',resolveDir:root}));}}]}).then(()=>{fs.writeFileSync(path.join(out,'index.html'),'<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="app.css"><body style="margin:0"><div id="root"></div><script src="app.js"></script></body></html>');console.log(out)}).catch(e=>{console.error(e);process.exit(1)});
