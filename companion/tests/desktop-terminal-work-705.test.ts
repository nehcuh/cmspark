/** Native local-work wire must use actual HMAC; all runtime effects injected. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {createHmac} from 'node:crypto'
import {DesktopIdentityRegistry} from '../src/desktop/identity'
import {createDesktopChannel} from '../src/desktop/channel'
import {DESKTOP_NATIVE_METHODS} from '../src/desktop/capabilities'
import {DESKTOP_TERMINAL_METHODS} from '../src/desktop/terminal-work'
import {SecurityConfirmationManager} from '../src/security-confirmation'
import {ThreadManager} from '../src/threads/thread-manager'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
const methods=['desktop.local.state','desktop.terminal.open','desktop.terminal.input','desktop.terminal.resize','desktop.terminal.ack','desktop.terminal.ping','desktop.terminal.close','desktop.terminal.return']
function fixture(t:any){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'local-work-476-'))),before=process.env.CMSPARK_DATA_DIR;process.env.CMSPARK_DATA_DIR=root
 const tm=new ThreadManager();const selected=path.join(root,'selected');fs.mkdirSync(selected);tm.create('Local work','local-work-A');tm.create('Sibling','local-work-B');tm.update('local-work-A',{workspace_root:selected})
 let output:((frame:any)=>void)|undefined
 const calls:string[]=[],registry=new DesktopIdentityRegistry(),manager=new SecurityConfirmationManager();const runtime={modules:()=>({terminal:true,agent:false}),activity:()=> 'idle',shell:()=>({file:'/owned/shell',args:[]}),agents:()=>[],openTerminal:(input:any)=>{calls.push('open');output=input.send;return{ok:true}},terminalContext:()=>true,input:()=>{calls.push('input');return{ok:true}},resize:()=>{calls.push('resize');return{ok:true}},ack:()=>{calls.push('ack');return{ok:true}},ping:()=>{calls.push('ping');return{ok:true}},close:()=>{calls.push('close');return{ok:true}},terminalBusy:()=>false}
 const channel=createDesktopChannel({registry,securityConfirmations:manager,services:{threads:tm,skills:{list:()=>[],listKnowledge:()=>[]},mcp:{listServers:()=>[]}},maxPayload:10485760,terminalRuntime:runtime} as any)
 const ws:any=new EventEmitter(),sent:any[]=[];ws.readyState=1;ws.send=(s:string)=>sent.push(JSON.parse(s));ws.close=ws.terminate=()=>{if(ws.readyState!==1)return;ws.readyState=3;ws.emit('close')};channel.wss.emit('connection',ws);assert.equal(sent.shift().type,'desktop.challenge.request');const cap=registry.issue('owned-local-host'),emit=(v:any)=>ws.emit('message',Buffer.from(typeof v==='string'?v:JSON.stringify(v)));emit({type:'desktop.hello',capability_id:cap.capabilityId,protocol_version:1});const challenge=sent.shift();emit({type:'desktop.authenticate',capability_id:cap.capabilityId,protocol_version:1,proof:createHmac('sha256',Buffer.from(cap.secret,'hex')).update(JSON.stringify(['cmspark.desktop.auth.v1',cap.capabilityId,challenge.connection_id,1,challenge.nonce])).digest('hex')});assert.equal(sent.shift().type,'desktop.ready')
 const tick=async()=>{for(let i=0;i<5;i++)await new Promise<void>(r=>setImmediate(r))},send=async(frame:any)=>{emit(frame);await tick();return sent.shift()}
 t.after(()=>{manager.rejectAll('disconnect');ws.terminate();channel.wss.emit('close');if(before===undefined)delete process.env.CMSPARK_DATA_DIR;else process.env.CMSPARK_DATA_DIR=before;fs.rmSync(root,{recursive:true,force:true})})
 return{output:(frame:any)=>output?.(frame),tm,root,selected,calls,registry,manager,ws,sent,emit,tick,send,runtime}
}
test('issued native method table contains exactly approved8 terminal-only methods',()=>{for(const m of methods)assert.ok((DESKTOP_NATIVE_METHODS as readonly string[]).includes(m),m)})
test('actual HMAC local state returns a fresh bound snapshot without starting runtime',async t=>{const f=fixture(t);const a=await f.send({type:'desktop.local.state',id:'state1',thread_id:'local-work-A'});assert.equal(a.type,'desktop.local.state.result');assert.equal(a.ok,true);assert.equal(a.state.bound,true);assert.match(a.state.revision,/^[a-f0-9]{64}$/);const b=await f.send({type:'desktop.local.state',id:'state2',thread_id:'local-work-A'});assert.notStrictEqual(a.state.revision,b.state.revision);assert.deepEqual(f.calls,[]);assert.equal(JSON.stringify(a).includes(f.selected),false)})

async function state(f:ReturnType<typeof fixture>){return f.send({type:'desktop.local.state',id:'state',thread_id:'local-work-A'})}
async function begin(f:ReturnType<typeof fixture>,id='open'){const s=await state(f);await f.send({type:'desktop.terminal.open',id,thread_id:'local-work-A',revision:s.state.revision,cols:80,rows:24});return f.sent.find(v=>v.type==='desktop.confirmation.request')}
async function open(f:ReturnType<typeof fixture>,id='open'){
 const beforeOpenCount=f.calls.filter(c=>c==='open').length
 const s=await state(f);const c=await f.send({type:'desktop.terminal.open',id,thread_id:'local-work-A',revision:s.state.revision,cols:80,rows:24});assert.equal(c.type,'desktop.confirmation.request');assert.equal(f.calls.filter(c=>c==='open').length,beforeOpenCount)
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
 const f=fixture(t),s=await state(f),c=await f.send({type:'desktop.terminal.open',id:'changed',thread_id:'local-work-A',revision:s.state.revision,cols:80,rows:24});f.runtime.modules=()=>({terminal:false,agent:false});await f.send({type:'desktop.confirmation.decision',purpose:'local-work',confirmation_id:c.confirmation_id,thread_id:'local-work-A',action_digest:c.action_digest,approved:true});assert.equal(f.calls.includes('open'),false);assert.equal(f.manager.pendingCount(),0)
 assert.equal(f.sent.find(v=>v.type==='desktop.terminal.open.result')?.error_code,'LOCAL_MODULE_DISABLED');f.sent.length=0;f.runtime.modules=()=>({terminal:true,agent:false});const s2=await state(f);await f.send({type:'desktop.terminal.open',id:'revoked',thread_id:'local-work-A',revision:s2.state.revision,cols:80,rows:24});f.registry.revokeHost('owned-local-host');await f.tick();assert.equal(f.ws.readyState,3);assert.equal(f.manager.pendingCount(),0);assert.equal(f.calls.includes('open'),false)
})
test('an unavailable canonical history after terminal selection yields unknown and cannot replay a second write',async t=>{
 const f=fixture(t);await open(f);t.mock.method(f.tm,'addMessage',()=>{throw Error('OWNED_WRITE_FAILURE')});const request={type:'desktop.terminal.return',id:'return-failure',thread_id:'local-work-A',operation_id:'open',text:'owned selected text'},c=await f.send(request);await f.send({type:'desktop.confirmation.decision',purpose:'local-work',confirmation_id:c.confirmation_id,thread_id:'local-work-A',action_digest:c.action_digest,approved:true});assert.equal(f.sent.find(v=>v.type==='desktop.terminal.return.result')?.status,'unknown');f.sent.length=0;const repeated=await f.send({...request,id:'return-failure-again'});assert.equal(repeated.status,'unknown');assert.equal(f.manager.pendingCount(),0);assert.equal(f.tm.readDesktopDialog('local-work-A').messages.length,0)
})

test('existing PTY heartbeat is emitted only to the original native operation without terminal text',async t=>{
 const f=fixture(t);await open(f);f.output({type:'terminal.heartbeat',id:'open'});assert.deepEqual(f.sent.shift(),{type:'desktop.terminal.heartbeat',thread_id:'local-work-A',operation_id:'open'});await f.send({type:'desktop.terminal.close',id:'stop',thread_id:'local-work-A',operation_id:'open'});f.sent.length=0;f.output({type:'terminal.heartbeat'});assert.equal(f.sent.length,0)
})


test('terminal-only leaf preserves shipped archive/browser and does not issue Agent authority',async t=>{
 for(const method of ['desktop.archive.list','desktop.archive.state','desktop.archive.set','desktop.browser.status','desktop.browser.tasks','desktop.browser.visibility','desktop.browser.retire'])assert.ok((DESKTOP_NATIVE_METHODS as readonly string[]).includes(method),method)
 assert.deepEqual([...DESKTOP_TERMINAL_METHODS],methods)
 const f=fixture(t)
 for(const method of ['desktop.agent.start','desktop.agent.prompt','desktop.agent.cancel']){
  assert.equal((DESKTOP_TERMINAL_METHODS as readonly string[]).includes(method),false)
  const id='terminal-only-'+method
  assert.deepEqual(await f.send({type:method,id,thread_id:'local-work-A'}),{type:'desktop.error',id,error_code:'DESKTOP_METHOD_DENIED'})
 }
 assert.deepEqual(f.calls,[])
 assert.equal(f.manager.pendingCount(),0)
})
test('null/foreign manager callers and forged decision framing cannot approve native terminal',async t=>{
 const f=fixture(t),s=await state(f),c=await f.send({type:'desktop.terminal.open',id:'guarded',thread_id:'local-work-A',revision:s.state.revision,cols:80,rows:24})
 assert.notStrictEqual(f.manager.respondFrom(c.confirmation_id,true,null as any).outcome,'resolved')
 assert.notStrictEqual(f.manager.respondFrom(c.confirmation_id,true,{readyState:1} as any).outcome,'resolved')
 for(const extra of [{thread_id:'local-work-B'},{purpose:'resource'},{action_digest:'0'.repeat(64)}]){await f.send({type:'desktop.confirmation.decision',purpose:'local-work',confirmation_id:c.confirmation_id,thread_id:'local-work-A',action_digest:c.action_digest,approved:true,...extra});assert.equal(f.calls.length,0);assert.equal(f.manager.pendingCount(),1)}
 await f.send({type:'desktop.confirmation.decision',purpose:'local-work',confirmation_id:c.confirmation_id,thread_id:'local-work-A',action_digest:c.action_digest,approved:false})
 assert.equal(f.calls.length,0);assert.equal(f.manager.pendingCount(),0)
})
test('close receipt does not release the real runtime closing slot, only exact child close does',async t=>{
 const f=fixture(t);await open(f);await f.send({type:'desktop.terminal.close',id:'stop',thread_id:'local-work-A',operation_id:'open'})
 let closing=true;f.runtime.terminalBusy=()=>closing;f.runtime.activity=()=>closing?'busy':'idle'
 const snapshot=await state(f),refused=await f.send({type:'desktop.terminal.open',id:'too-early',thread_id:'local-work-A',revision:snapshot.state.revision,cols:80,rows:24})
 assert.equal(refused.error_code,'LOCAL_BUSY');assert.deepEqual(f.calls,['open','close']);assert.equal(f.manager.pendingCount(),0)
 // This is the inert runtime's exact close notification, not a real OS close or reset.
 closing=false;await open(f,'after-close');assert.deepEqual(f.calls,['open','close','open'])
})
test('successful next open retires closed metadata but a failed next open preserves its explicit excerpt',async t=>{
 const f=fixture(t);await open(f,'prior');await f.send({type:'desktop.terminal.close',id:'stop-prior',thread_id:'local-work-A',operation_id:'prior'})
 const s=await state(f),c=await f.send({type:'desktop.terminal.open',id:'denied-next',thread_id:'local-work-A',revision:s.state.revision,cols:80,rows:24});await f.send({type:'desktop.confirmation.decision',purpose:'local-work',confirmation_id:c.confirmation_id,thread_id:'local-work-A',action_digest:c.action_digest,approved:false});f.sent.length=0
 const prior=await state(f);assert.ok(prior.state.operations.some((o:any)=>o.operation_id==='prior'))
 await open(f,'replacement');const after=await state(f);assert.deepEqual(after.state.operations.map((o:any)=>o.operation_id),['replacement'])
 assert.equal((await f.send({type:'desktop.terminal.return',id:'late-old',thread_id:'local-work-A',operation_id:'prior',text:'old excerpt'})).error_code,'LOCAL_NOT_OWNED')
})
test('lost selected-return receipt cannot duplicate a committed message',async t=>{
 const f=fixture(t);await open(f);const text='one explicit partial excerpt',c=await f.send({type:'desktop.terminal.return',id:'first-return',thread_id:'local-work-A',operation_id:'open',text})
 const original=f.ws.send;f.ws.send=(s:string)=>{const value=JSON.parse(s);if(value.type!=='desktop.terminal.return.result')original(s)}
 await f.send({type:'desktop.confirmation.decision',purpose:'local-work',confirmation_id:c.confirmation_id,thread_id:'local-work-A',action_digest:c.action_digest,approved:true});assert.equal(new ThreadManager().readDesktopDialog('local-work-A').messages.length,1);f.ws.send=original;f.sent.length=0
 const retry=await f.send({type:'desktop.terminal.return',id:'repeat-return',thread_id:'local-work-A',operation_id:'open',text});assert.equal(retry.status,'saved');assert.equal(new ThreadManager().readDesktopDialog('local-work-A').messages.length,1)
})
for(const failed of ['false','throw'] as const)test('failed actual next open preserves closed excerpt metadata '+failed,async t=>{
 const f=fixture(t);await open(f,'old');await f.send({type:'desktop.terminal.close',id:'stop-old',thread_id:'local-work-A',operation_id:'old'});f.runtime.openTerminal=()=>{if(failed==='throw')throw Error('OWNED_INERT_SPAWN_REJECT');return{ok:false}}
 const s=await state(f),c=await f.send({type:'desktop.terminal.open',id:'fails',thread_id:'local-work-A',revision:s.state.revision,cols:80,rows:24});await f.send({type:'desktop.confirmation.decision',purpose:'local-work',confirmation_id:c.confirmation_id,thread_id:'local-work-A',action_digest:c.action_digest,approved:true});f.sent.length=0
 const after=await state(f);assert.deepEqual(after.state.operations.map((o:any)=>o.operation_id),['old']);assert.equal(f.manager.pendingCount(),0)
})
test('late prior excerpt approval after replacement cannot commit or control the replacement',async t=>{
 const f=fixture(t);await open(f,'prior');await f.send({type:'desktop.terminal.close',id:'stop-prior',thread_id:'local-work-A',operation_id:'prior'});const c=await f.send({type:'desktop.terminal.return',id:'prior-return',thread_id:'local-work-A',operation_id:'prior',text:'must not commit late'})
 await state(f);f.sent.length=0;await open(f,'replacement');await f.send({type:'desktop.confirmation.decision',purpose:'local-work',confirmation_id:c.confirmation_id,thread_id:'local-work-A',action_digest:c.action_digest,approved:true});assert.equal(f.tm.readDesktopDialog('local-work-A').messages.length,0)
 const after=await state(f);assert.deepEqual(after.state.operations.map((o:any)=>o.operation_id),['replacement']);assert.equal(f.manager.pendingCount(),0);assert.deepEqual(f.calls,['open','close','open'])
})

test('pending native approval cancellation never closes a runtime session with the same opaque ID',async t=>{
 const f=fixture(t),s=await state(f),c=await f.send({type:'desktop.terminal.open',id:'pending-alias',thread_id:'local-work-A',revision:s.state.revision,cols:80,rows:24});assert.equal(c.type,'desktop.confirmation.request');f.runtime.terminalContext=()=>false
 await f.send({type:'desktop.terminal.close',id:'cancel-pending',thread_id:'local-work-A',operation_id:'pending-alias'});assert.deepEqual(f.calls,[]);assert.equal(f.manager.pendingCount(),0)
})
test('Stop rechecks actual runtime owner and cannot close a foreign replacement',async t=>{
 const f=fixture(t);await open(f);f.runtime.terminalContext=()=>false
 const refused=await f.send({type:'desktop.terminal.close',id:'foreign-stop',thread_id:'local-work-A',operation_id:'open'});assert.equal(refused.error_code,'LOCAL_NOT_OWNED');assert.deepEqual(f.calls,['open'])
})
test('closed operation Stop is idempotent and does not touch a later foreign runtime alias',async t=>{
 const f=fixture(t);await open(f);await f.send({type:'desktop.terminal.close',id:'stop-once',thread_id:'local-work-A',operation_id:'open'});f.runtime.terminalContext=()=>false
 assert.equal((await f.send({type:'desktop.terminal.close',id:'stop-again',thread_id:'local-work-A',operation_id:'open'})).ok,true);assert.deepEqual(f.calls,['open','close'])
})
test('connection retirement aborts pending approval without closing an unstarted runtime ID',async t=>{
 const f=fixture(t),s=await state(f);await f.send({type:'desktop.terminal.open',id:'pending-retire',thread_id:'local-work-A',revision:s.state.revision,cols:80,rows:24});f.runtime.terminalContext=()=>false;f.ws.terminate();await f.tick();assert.deepEqual(f.calls,[]);assert.equal(f.manager.pendingCount(),0)
})
test('connection retirement does not close an operation whose actual runtime owner changed',async t=>{
 const f=fixture(t);await open(f);f.runtime.terminalContext=()=>false;f.ws.terminate();await f.tick();assert.deepEqual(f.calls,['open']);assert.equal(f.manager.pendingCount(),0)
})

test('705 local acceptance ignores actual untracked retirement snapshots while preserving expected-state refusals',async t=>{
 const f=fixture(t),first=await f.send({type:'desktop.local.state',id:'owned-first',thread_id:'local-work-A'}),retirement=await f.send({type:'desktop.local.state',id:'owned-retirement',thread_id:'local-work-A'}),unbound=await f.send({type:'desktop.local.state',id:'owned-unbound',thread_id:'local-work-B'})
 assert.equal(first.state.bound,true);assert.equal(retirement.state.bound,true);assert.equal(unbound.state.bound,false);assert.deepEqual(f.calls,[])
 const actual=fs.readFileSync(path.resolve('tests/fixtures/desktop-476/local-form.js'),'utf8'),guard="   if(![1,9,13].includes(phase))return; // Actual hide/openDialog emits an untracked retirement state.\n"
 assert.equal(actual.split(guard).length,2)
 const run=(source:string,initial:any,extra?:any)=>{const out:string[]=[],button={disabled:false,focus(){},getAttribute:()=> 'native-local-A'},nodes:Record<string,any>={status:{textContent:''},list:{querySelectorAll:()=>[button]},'local-terminal-open':button},scope={documentGeneration:'owned',Uint8Array,TextDecoder,atob,document:{getElementById:(id:string)=>nodes[id],addEventListener(){}},window:{cmsparkDesktopReceive(){},chrome:{webview:{postMessage:(frame:any)=>out.push(frame.id)}}}};vm.runInNewContext(source,scope);const receive=scope.window.cmsparkDesktopReceive as (frame:any)=>void;receive({type:'thread.list'});receive(initial);if(extra)receive(extra);return out}
 const current=run(actual,first,retirement);assert.equal(current.filter(x=>x==='D476_LOCAL_KEY').length,2);assert.equal(current.includes('D476_LOCAL_FAIL'),false)
 const old=run(actual.replace(guard,''),first,retirement);assert.ok(old.includes('D476_LOCAL_FIRST_R_6'));assert.ok(old.includes('D476_LOCAL_FAIL'))
 const refused=run(actual,unbound);assert.ok(refused.includes('D476_LOCAL_FIRST_R_5'));assert.ok(refused.includes('D476_LOCAL_FAIL'));assert.deepEqual(f.calls,[])
})
