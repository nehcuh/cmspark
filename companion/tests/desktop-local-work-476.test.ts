/** Native local-work wire must use actual HMAC; all runtime effects injected. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {createHmac} from 'node:crypto'
import {DesktopIdentityRegistry} from '../src/desktop/identity'
import {createDesktopChannel} from '../src/desktop/channel'
import {DESKTOP_NATIVE_METHODS} from '../src/desktop/capabilities'
import {SecurityConfirmationManager} from '../src/security-confirmation'
import {ThreadManager} from '../src/threads/thread-manager'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const methods=['desktop.local.state','desktop.terminal.open','desktop.terminal.input','desktop.terminal.resize','desktop.terminal.ack','desktop.terminal.ping','desktop.terminal.close','desktop.terminal.return','desktop.agent.start','desktop.agent.prompt','desktop.agent.cancel']
function fixture(t:any){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'local-work-476-'))),before=process.env.CMSPARK_DATA_DIR;process.env.CMSPARK_DATA_DIR=root
 const tm=new ThreadManager();const selected=path.join(root,'selected');fs.mkdirSync(selected);tm.create('Local work','local-work-A');tm.create('Sibling','local-work-B');tm.update('local-work-A',{workspace_root:selected})
 let output:((frame:any)=>void)|undefined
 const calls:string[]=[],registry=new DesktopIdentityRegistry(),manager=new SecurityConfirmationManager();const runtime={modules:()=>({terminal:true,agent:true}),activity:()=> 'idle',shell:()=>({file:'/owned/shell',args:[]}),agents:()=>[],openTerminal:(input:any)=>{calls.push('open');output=input.send;return{ok:true}},terminalContext:()=>true,input:()=>{calls.push('input');return{ok:true}},resize:()=>{calls.push('resize');return{ok:true}},ack:()=>{calls.push('ack');return{ok:true}},ping:()=>{calls.push('ping');return{ok:true}},close:()=>{calls.push('close');return{ok:true}},terminalBusy:()=>false}
 const channel=createDesktopChannel({registry,securityConfirmations:manager,services:{threads:tm,skills:{list:()=>[],listKnowledge:()=>[]},mcp:{listServers:()=>[]}},maxPayload:10485760,localRuntime:runtime} as any)
 const ws:any=new EventEmitter(),sent:any[]=[];ws.readyState=1;ws.send=(s:string)=>sent.push(JSON.parse(s));ws.close=ws.terminate=()=>{if(ws.readyState!==1)return;ws.readyState=3;ws.emit('close')};channel.wss.emit('connection',ws);assert.equal(sent.shift().type,'desktop.challenge.request');const cap=registry.issue('owned-local-host'),emit=(v:any)=>ws.emit('message',Buffer.from(typeof v==='string'?v:JSON.stringify(v)));emit({type:'desktop.hello',capability_id:cap.capabilityId,protocol_version:1});const challenge=sent.shift();emit({type:'desktop.authenticate',capability_id:cap.capabilityId,protocol_version:1,proof:createHmac('sha256',Buffer.from(cap.secret,'hex')).update(JSON.stringify(['cmspark.desktop.auth.v1',cap.capabilityId,challenge.connection_id,1,challenge.nonce])).digest('hex')});assert.equal(sent.shift().type,'desktop.ready')
 const tick=async()=>{for(let i=0;i<5;i++)await new Promise<void>(r=>setImmediate(r))},send=async(frame:any)=>{emit(frame);await tick();return sent.shift()}
 t.after(()=>{manager.rejectAll('disconnect');ws.terminate();channel.wss.emit('close');if(before===undefined)delete process.env.CMSPARK_DATA_DIR;else process.env.CMSPARK_DATA_DIR=before;fs.rmSync(root,{recursive:true,force:true})})
 return{output:(frame:any)=>output?.(frame),tm,root,selected,calls,registry,manager,ws,sent,emit,tick,send,runtime}
}
test('issued native method table contains exactly approved11 local-work methods',()=>{for(const m of methods)assert.ok((DESKTOP_NATIVE_METHODS as readonly string[]).includes(m),m)})
test('actual HMAC local state returns a fresh bound snapshot without starting runtime',async t=>{const f=fixture(t);const a=await f.send({type:'desktop.local.state',id:'state1',thread_id:'local-work-A'});assert.equal(a.type,'desktop.local.state.result');assert.equal(a.ok,true);assert.equal(a.state.bound,true);assert.match(a.state.revision,/^[a-f0-9]{64}$/);const b=await f.send({type:'desktop.local.state',id:'state2',thread_id:'local-work-A'});assert.notEqual(a.state.revision,b.state.revision);assert.deepEqual(f.calls,[]);assert.equal(JSON.stringify(a).includes(f.selected),false)})

async function state(f:ReturnType<typeof fixture>){return f.send({type:'desktop.local.state',id:'state',thread_id:'local-work-A'})}
async function begin(f:ReturnType<typeof fixture>,id='open'){const s=await state(f);await f.send({type:'desktop.terminal.open',id,thread_id:'local-work-A',revision:s.state.revision,cols:80,rows:24});return f.sent.find(v=>v.type==='desktop.confirmation.request')}
async function open(f:ReturnType<typeof fixture>,id='open'){
 const s=await state(f);const c=await f.send({type:'desktop.terminal.open',id,thread_id:'local-work-A',revision:s.state.revision,cols:80,rows:24});assert.equal(c.type,'desktop.confirmation.request');assert.equal(f.calls.includes('open'),false)
 await f.send({type:'desktop.confirmation.decision',purpose:'local-work',confirmation_id:c.confirmation_id,thread_id:'local-work-A',action_digest:c.action_digest,approved:true});const result=f.sent.find(v=>v.type==='desktop.terminal.open.result');assert.equal(result?.ok,true);f.sent.length=0;return c
}
test('actual HMAC→native manager approves one private PTY then input/resize/ping/ACK dispatch only exact owned operation',async t=>{
 const f=fixture(t);await open(f);assert.deepEqual(f.calls,['open']);assert.equal(f.manager.pendingCount(),0)
 const input={type:'desktop.terminal.input',id:'input',thread_id:'local-work-A',operation_id:'open',seq:1,b64:Buffer.from('owned').toString('base64')};assert.equal((await f.send(input)).ok,true);assert.equal((await f.send(input)).error_code,'LOCAL_INPUT_INVALID');assert.equal((await f.send({...input,id:'wrong',thread_id:'local-work-B',seq:2})).error_code,'LOCAL_NOT_OWNED')
 assert.equal((await f.send({type:'desktop.terminal.resize',id:'resize',thread_id:'local-work-A',operation_id:'open',cols:90,rows:30})).ok,true)
 f.output({type:'terminal.data',seq:1,b64:Buffer.from('owned').toString('base64')});const data=f.sent.shift();assert.equal(data.type,'desktop.terminal.data');assert.equal(data.thread_id,'local-work-A');assert.equal(data.operation_id,'open')
 assert.equal((await f.send({type:'desktop.terminal.ack',id:'ack',thread_id:'local-work-A',operation_id:'open',seq:2})).error_code,'LOCAL_INPUT_INVALID');assert.equal((await f.send({type:'desktop.terminal.ack',id:'ack',thread_id:'local-work-A',operation_id:'open',seq:1})).ok,true)
 assert.equal((await f.send({type:'desktop.terminal.ping',id:'ping',thread_id:'local-work-A',operation_id:'open'})).ok,true);assert.deepEqual(f.calls,['open','input','resize','ack','ping'])
})
test('state switch preserves A ownership while B cannot inject; owner ACK/keepalive/Stop remain bound A',async t=>{
 const f=fixture(t);await open(f);await f.send({type:'desktop.local.state',id:'state-B',thread_id:'local-work-B'});
 assert.equal((await f.send({type:'desktop.terminal.input',id:'late',thread_id:'local-work-A',operation_id:'open',seq:1,b64:'YQ=='})).error_code,'LOCAL_STALE');assert.equal((await f.send({type:'desktop.terminal.ping',id:'ping-A',thread_id:'local-work-A',operation_id:'open'})).ok,true)
 const stop=await f.send({type:'desktop.terminal.close',id:'stop-A',thread_id:'local-work-A',operation_id:'open'});assert.equal(stop.ok,true);f.output({type:'terminal.data',seq:1,b64:'YQ=='});assert.equal(f.sent.length,0);assert.deepEqual(f.calls,['open','ping','close'])
})
test('pending open cancel and late native approval have zero opens',async t=>{
 const f=fixture(t),s=await state(f),c=await f.send({type:'desktop.terminal.open',id:'pending',thread_id:'local-work-A',revision:s.state.revision,cols:80,rows:24});assert.equal(c.type,'desktop.confirmation.request');await f.send({type:'desktop.terminal.close',id:'cancel',thread_id:'local-work-A',operation_id:'pending'});await f.send({type:'desktop.confirmation.decision',purpose:'local-work',confirmation_id:c.confirmation_id,thread_id:'local-work-A',action_digest:c.action_digest,approved:true});assert.equal(f.calls.includes('open'),false);assert.equal(f.manager.pendingCount(),0)
})
test('root replacement and revocation during native confirmation refuse before runtime',async t=>{
 const f=fixture(t),s=await state(f),c=await f.send({type:'desktop.terminal.open',id:'pending',thread_id:'local-work-A',revision:s.state.revision,cols:80,rows:24});fs.renameSync(f.selected,f.selected+'.old');fs.mkdirSync(f.selected);await f.send({type:'desktop.confirmation.decision',purpose:'local-work',confirmation_id:c.confirmation_id,thread_id:'local-work-A',action_digest:c.action_digest,approved:true});assert.equal(f.calls.includes('open'),false);assert.equal(f.manager.pendingCount(),0)
})
test('selected terminal return requires separate exact native confirmation and one real canonical saved message',async t=>{
 const f=fixture(t);await open(f);const c=await f.send({type:'desktop.terminal.return',id:'return',thread_id:'local-work-A',operation_id:'open',text:'owned terminal excerpt'});assert.equal(c.type,'desktop.confirmation.request');assert.equal(f.tm.readDesktopDialog('local-work-A').messages.length,0)
 await f.send({type:'desktop.confirmation.decision',purpose:'local-work',confirmation_id:c.confirmation_id,thread_id:'local-work-A',action_digest:c.action_digest,approved:true});const saved=f.sent.find(v=>v.type==='desktop.terminal.return.result');assert.equal(saved?.status,'saved');assert.equal(new ThreadManager().readDesktopDialog('local-work-A').messages.length,1);assert.equal(f.tm.readDesktopDialog('local-work-B').messages.length,0);f.sent.length=0
 const duplicate=await f.send({type:'desktop.terminal.return',id:'return-again',thread_id:'local-work-A',operation_id:'open',text:'owned terminal excerpt'});assert.equal(duplicate.message_id,saved.message_id);assert.equal(f.tm.readDesktopDialog('local-work-A').messages.length,1);assert.equal((await f.send({type:'desktop.terminal.return',id:'altered',thread_id:'local-work-A',operation_id:'open',text:'different'})).error_code,'LOCAL_CONFLICT')
})
for(const extra of [{cwd:'/ignored'},{file:'/ignored'},{user_gesture:true},{env:'{}'},{cols:0}])test('new open strict schema rejects renderer authority or invalid dimensions '+Object.keys(extra)[0],async t=>{
 const f=fixture(t),s=await state(f);const r=await f.send({type:'desktop.terminal.open',id:'open',thread_id:'local-work-A',revision:s.state.revision,cols:80,rows:24,...extra});assert.equal(r.ok,false);assert.equal(r.error_code,'LOCAL_INPUT_INVALID');assert.equal(f.manager.pendingCount(),0);assert.deepEqual(f.calls,[])
})

test('local snapshot never invokes mutable legacy getter or initializes runtime state',async t=>{
 const f=fixture(t);t.mock.method(f.tm,'get',()=>{throw Error('LEGACY_GET_MUST_NOT_RUN')})
 const a=await state(f);assert.equal(a.ok,true);assert.equal(a.state.bound,true)
 const c=await f.send({type:'desktop.terminal.open',id:'pure',thread_id:'local-work-A',revision:a.state.revision,cols:80,rows:24})
 assert.equal(c.type,'desktop.confirmation.request');assert.equal(JSON.parse(c.action_json).payload.thread_title,'Local work');assert.deepEqual(f.calls,[])
})
test('actual private agent owner is retained for Stop after signal abort and permission cannot outlive navigation',async t=>{
 const f=fixture(t);let captured:any,cancelOwner:any,events:any
 Object.assign(f.runtime,{agents:()=>[{id:'owned',label:'Owned',identity:'fixed'}],startAgent:async(input:any)=>{captured=input.owner;events=input.event;return{ok:true,sessionId:'private-session'}},cancelAgent:(id:string,owner:any)=>{assert.equal(id,'private-session');cancelOwner=owner}})
 const s=await state(f),c=await f.send({type:'desktop.agent.start',id:'agent',thread_id:'local-work-A',revision:s.state.revision,agent_id:'owned',goal:'owned exact goal'})
 await f.send({type:'desktop.confirmation.decision',purpose:'local-work',confirmation_id:c.confirmation_id,thread_id:'local-work-A',action_digest:c.action_digest,approved:true});assert.ok(captured.current());f.sent.length=0
 events({status:'running',tail:'owned progress'});assert.equal(f.sent.shift().type,'desktop.agent.event')
 const pending=captured.requestPermission({title:'owned permission',detail:'owned operation'});await f.tick();assert.equal(f.sent.shift().purpose,'local-work')
 await f.send({type:'desktop.local.state',id:'B',thread_id:'local-work-B'});assert.equal(await pending,false)
 await f.send({type:'desktop.agent.cancel',id:'cancel-agent',thread_id:'local-work-A',operation_id:'agent'});assert.equal(cancelOwner,captured);assert.equal(cancelOwner.signal.aborted,true)
 f.sent.length=0;events({status:'saved',message_id:'late'});assert.equal(f.sent.length,0)
})
for(const mode of ['disabled','unbound','worker','readonly','busy','unknown'] as const)test('actual owner admission refuses '+mode+' before any native action',async t=>{
 const f=fixture(t)
 if(mode==='disabled')f.runtime.modules=()=>({terminal:false,agent:false})
 if(mode==='unbound')f.tm.update('local-work-A',{workspace_root:undefined})
 if(mode==='worker')f.tm.update('local-work-A',{agent_role:'worker'} as any)
 if(mode==='readonly')f.tm.update('local-work-A',{execution_policy:'plan_readonly'} as any)
 if(mode==='busy'||mode==='unknown')f.runtime.activity=()=>mode
 const s=await state(f)
 if(mode==='worker'||mode==='readonly'){assert.equal(s.ok,false);assert.equal(s.error_code,'LOCAL_DENIED')}
 else if(mode==='disabled'||mode==='unbound'){assert.equal(s.state.bound,false);assert.equal(s.state.revision,null)}
 else{const r=await f.send({type:'desktop.terminal.open',id:'denied',thread_id:'local-work-A',revision:s.state.revision,cols:80,rows:24});assert.equal(r.error_code,mode==='busy'?'LOCAL_BUSY':'LOCAL_ACTIVITY_UNKNOWN')}
 assert.deepEqual(f.calls,[]);assert.equal(f.manager.pendingCount(),0)
})
test('module change after approval and registry revoke cancel confirmation with zero spawn',async t=>{
 const f=fixture(t),s=await state(f),c=await f.send({type:'desktop.terminal.open',id:'changed',thread_id:'local-work-A',revision:s.state.revision,cols:80,rows:24});f.runtime.modules=()=>({terminal:false,agent:true});await f.send({type:'desktop.confirmation.decision',purpose:'local-work',confirmation_id:c.confirmation_id,thread_id:'local-work-A',action_digest:c.action_digest,approved:true});assert.equal(f.calls.includes('open'),false);assert.equal(f.manager.pendingCount(),0)
 assert.equal(f.sent.find(v=>v.type==='desktop.terminal.open.result')?.error_code,'LOCAL_MODULE_DISABLED');f.sent.length=0;f.runtime.modules=()=>({terminal:true,agent:true});const s2=await state(f);await f.send({type:'desktop.terminal.open',id:'revoked',thread_id:'local-work-A',revision:s2.state.revision,cols:80,rows:24});f.registry.revokeHost('owned-local-host');await f.tick();assert.equal(f.ws.readyState,3);assert.equal(f.manager.pendingCount(),0);assert.equal(f.calls.includes('open'),false)
})
test('an unavailable canonical history after terminal selection yields unknown and cannot replay a second write',async t=>{
 const f=fixture(t);await open(f);t.mock.method(f.tm,'addMessage',()=>{throw Error('OWNED_WRITE_FAILURE')});const request={type:'desktop.terminal.return',id:'return-failure',thread_id:'local-work-A',operation_id:'open',text:'owned selected text'},c=await f.send(request);await f.send({type:'desktop.confirmation.decision',purpose:'local-work',confirmation_id:c.confirmation_id,thread_id:'local-work-A',action_digest:c.action_digest,approved:true});assert.equal(f.sent.find(v=>v.type==='desktop.terminal.return.result')?.status,'unknown');f.sent.length=0;const repeated=await f.send({...request,id:'return-failure-again'});assert.equal(repeated.status,'unknown');assert.equal(f.manager.pendingCount(),0);assert.equal(f.tm.readDesktopDialog('local-work-A').messages.length,0)
})

test('existing PTY heartbeat is emitted only to the original native operation without terminal text',async t=>{
 const f=fixture(t);await open(f);f.output({type:'terminal.heartbeat',id:'open'});assert.deepEqual(f.sent.shift(),{type:'desktop.terminal.heartbeat',thread_id:'local-work-A',operation_id:'open'});await f.send({type:'desktop.terminal.close',id:'stop',thread_id:'local-work-A',operation_id:'open'});f.sent.length=0;f.output({type:'terminal.heartbeat'});assert.equal(f.sent.length,0)
})

/** R2 regression family: real native HMAC/confirmation, runtime acceptance is the only seam. */
async function approveAgent(f:ReturnType<typeof fixture>,id:string){
 const s=await state(f),c=await f.send({type:'desktop.agent.start',id,thread_id:'local-work-A',revision:s.state.revision,agent_id:'owned',goal:'owned exact goal'})
 assert.equal(c.type,'desktop.confirmation.request');const first=await f.send({type:'desktop.confirmation.decision',purpose:'local-work',confirmation_id:c.confirmation_id,thread_id:'local-work-A',action_digest:c.action_digest,approved:true})
 const frames=[first,...f.sent.splice(0)].filter(Boolean);return frames.find(v=>v.type==='desktop.agent.start.result')
}
for(const variant of ['false','reject','missing','no-session','empty-session'] as const)test('R2 native Agent startup without an accepted session retires only the failed operation '+variant,async t=>{
 const f=fixture(t);let attempts=0,captured:any
 Object.assign(f.runtime,{agents:()=>[{id:'owned',label:'Owned',identity:'fixed'}]})
 if(variant!=='missing')Object.assign(f.runtime,{startAgent:async(input:any)=>{captured=input.owner;attempts++;if(variant==='reject')throw Error('OWNED_START_REJECT');if(variant==='false')return{ok:false};return variant==='empty-session'?{ok:true,sessionId:''}:{ok:true}},cancelAgent:()=>assert.fail('a sessionless start has no owned session to cancel')})
 const first=await approveAgent(f,'failed-agent');assert.equal(first?.ok,false);assert.equal(first?.error_code,'LOCAL_UNAVAILABLE');if(captured)assert.equal(captured.signal.aborted,true)
 const fresh=await state(f);assert.deepEqual(fresh.state.operations,[]);const retry=await f.send({type:'desktop.agent.start',id:'retry-agent',thread_id:'local-work-A',revision:fresh.state.revision,agent_id:'owned',goal:'owned retry'})
 assert.equal(retry.type,'desktop.confirmation.request');assert.equal(attempts,variant==='missing'?0:1);assert.equal(f.tm.readDesktopDialog('local-work-A').messages.length,0)
})
for(const phase of ['starting','running','closing'] as const)test('R2 accepted Agent retains exact owner and global busy protection while '+phase,async t=>{
 const f=fixture(t);let attempts=0,captured:any;const cancellations:any[]=[]
 Object.assign(f.runtime,{agents:()=>[{id:'owned',label:'Owned',identity:'fixed'}],startAgent:async(input:any)=>{attempts++;captured=input.owner;if(phase!=='starting')input.event({status:phase==='running'?'running':'closed'});return{ok:true,sessionId:'owned-real-session'}},cancelAgent:(id:string,owner:any)=>cancellations.push({id,owner})})
 const first=await approveAgent(f,'accepted-agent');assert.equal(first?.ok,true);assert.equal(captured.signal.aborted,false);assert.equal(captured.current(),true)
 // A closed actor row is not proof that the backend's actual closing child has released its slot.
 if(phase==='closing')f.runtime.activity=()=> 'busy'
 const fresh=await state(f);assert.deepEqual(fresh.state.operations,[{operation_id:'accepted-agent',kind:'agent',status:phase==='closing'?'closed':phase}]);const retry=await f.send({type:'desktop.agent.start',id:'must-not-start',thread_id:'local-work-A',revision:fresh.state.revision,agent_id:'owned',goal:'not a second child'})
 assert.equal(retry.error_code,'LOCAL_BUSY');assert.equal(attempts,1);assert.equal(cancellations.length,0)
 const stop=await f.send({type:'desktop.agent.cancel',id:'stop-accepted',thread_id:'local-work-A',operation_id:'accepted-agent'});assert.equal(stop.ok,true);assert.equal(cancellations.length,1);assert.equal(cancellations[0].id,'owned-real-session');assert.equal(cancellations[0].owner,captured);assert.equal(captured.signal.aborted,true)
 f.runtime.activity=()=> 'busy';const after=await state(f);assert.equal((await f.send({type:'desktop.agent.start',id:'still-closing',thread_id:'local-work-A',revision:after.state.revision,agent_id:'owned',goal:'must await child close'})).error_code,'LOCAL_BUSY');assert.equal(attempts,1)
})
for(const retirement of ['stop','owner-revoke'] as const)test('R2 late accepted Agent after '+retirement+' cancels only captured session and never emits saved progress',async t=>{
 const f=fixture(t);let captured:any,emit:any,resolve!:(value:any)=>void;const cancellations:any[]=[]
 Object.assign(f.runtime,{agents:()=>[{id:'owned',label:'Owned',identity:'fixed'}],startAgent:(input:any)=>{captured=input.owner;emit=input.event;return new Promise(r=>{resolve=r})},cancelAgent:(id:string,owner:any)=>cancellations.push({id,owner})})
 const s=await state(f),c=await f.send({type:'desktop.agent.start',id:'late-agent',thread_id:'local-work-A',revision:s.state.revision,agent_id:'owned',goal:'owned pending start'});assert.equal(c.type,'desktop.confirmation.request')
 await f.send({type:'desktop.confirmation.decision',purpose:'local-work',confirmation_id:c.confirmation_id,thread_id:'local-work-A',action_digest:c.action_digest,approved:true});assert.ok(captured);assert.equal(captured.signal.aborted,false)
 if(retirement==='stop'){const stopped=await f.send({type:'desktop.agent.cancel',id:'stop-late',thread_id:'local-work-A',operation_id:'late-agent'});assert.equal(stopped.ok,true)}else{f.registry.revokeHost('owned-local-host');await f.tick();assert.equal(f.ws.readyState,3)}
 assert.equal(captured.signal.aborted,true);resolve({ok:true,sessionId:'late-owned-session'});await f.tick();assert.equal(cancellations.length,1);assert.equal(cancellations[0].id,'late-owned-session');assert.equal(cancellations[0].owner,captured)
 f.sent.length=0;emit({status:'saved',message_id:'must-not-save'});assert.equal(f.sent.length,0);assert.equal(f.tm.readDesktopDialog('local-work-A').messages.length,0)
})

test('R2 cloud disclosure is exact server-owned Agent confirmation content and digest-bound',async t=>{
 const f=fixture(t);Object.assign(f.runtime,{agents:()=>[{id:'owned',label:'Owned',identity:'fixed'}]});const s=await state(f),c=await f.send({type:'desktop.agent.start',id:'cloud-agent',thread_id:'local-work-A',revision:s.state.revision,agent_id:'owned',goal:'owned task'});assert.equal(c.type,'desktop.confirmation.request')
 const action=JSON.parse(c.action_json);assert.equal(action.payload.cloud_model_notice,'注意: 代码/页面摘要可能发送到该 Agent 的云模型');assert.equal(c.action_digest,require('node:crypto').createHash('sha256').update(c.action_json).digest('hex'));assert.equal(f.calls.length,0)
})
test('R2 cloud disclosure does not invent an Agent cloud field for user terminal confirmation',async t=>{
 const f=fixture(t),s=await state(f),c=await f.send({type:'desktop.terminal.open',id:'local-shell',thread_id:'local-work-A',revision:s.state.revision,cols:80,rows:24});assert.equal(c.type,'desktop.confirmation.request');assert.equal(Object.hasOwn(JSON.parse(c.action_json).payload,'cloud_model_notice'),false);assert.equal(f.calls.length,0)
})
