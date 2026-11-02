import test from "node:test"
import assert from "node:assert/strict"
import { acceptanceDiagnostic,observeAcceptanceResponses } from "./fixtures/desktop-480/native-acceptance-controller"
import {EventEmitter} from "node:events"
import {createHmac} from "node:crypto"
import {DesktopIdentityRegistry} from "../src/desktop/identity"
import {createDesktopChannel} from "../src/desktop/channel"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import {nativePhaseNames,observeNativePhaseResponses} from "./fixtures/desktop-480/native-phase-observation"

test("native acceptance diagnostics admit only fixed phases, names and bounded counts", () => {
  const counts = { auths: 1, issues: 1, launches: 1, exits: 0, listReads: 4 }
  const observations: any[] = [{ kind: "fixed", name: "AUTH_1", proof: "never-log" }, { kind: "fixed", name: "raw-proof-never-log" }, { kind: "fixed", name: "AUTH_1" }, { kind: "window", secret: "never-log", view: "compact" }]
  const value = acceptanceDiagnostic("deadline", "waiting-reconnect-auth", "reconnect", counts, observations)
  assert.deepEqual(value, { reason: "deadline", phase: "waiting-reconnect-auth", mode: "reconnect", ...counts, lastExitCode: null, fixed: ["AUTH_1"], inheritance: [], identity: [], windows: 1 })
  assert.doesNotMatch(JSON.stringify(value), /never-log|proof|secret|endpoint/)
  const unknown = acceptanceDiagnostic("raw-proof-never-log", "raw-proof-never-log", "raw-proof-never-log", { auths: Infinity, issues: -1, launches: 1.5, exits: 1001, listReads: 0 }, [])
  assert.deepEqual(unknown, { reason: "unknown", phase: "unknown", mode: "unknown", auths: null, issues: null, launches: null, exits: null, listReads: 0, lastExitCode: null, fixed: [], inheritance: [], identity: [], windows: 0 })
})

test("native acceptance exit codes preserve bounded 32-bit callback values without coercion", () => {
  const counts = { auths: 1, issues: 1, launches: 1, exits: 1, listReads: 1 }
  const report = (lastExitCode: unknown) => acceptanceDiagnostic("cleanup", "waiting-reconnect-auth", "reconnect", { ...counts, lastExitCode: lastExitCode as number }, [])
  // The existing N-API int32 callback represents high-bit Windows statuses as negative.
  for (const code of [0, 41, 45, 177, -1, -0x80000000, -1073741819, 0xc0000005, 0xffffffff]) assert.equal(report(code).lastExitCode, code)
  for (const code of [undefined, null, -0x80000001, 0x100000000, NaN, Infinity, 1.5, "45", { valueOf() { throw Error("must-not-coerce") } }]) assert.equal(report(code).lastExitCode, null)
})


function actualNativePhaseProducer480(send:(frame:unknown)=>void){
 const cpp=fs.readFileSync(path.resolve('src/desktop/native/DesktopHost.cpp'),'utf8'),body=(name:string)=>{const start=cpp.indexOf('void '+name+'(');assert.ok(start>=0);assert.equal(cpp.indexOf('void '+name+'(',start+1),-1);const open=cpp.indexOf('{',start),end=cpp.indexOf('\n }',open);assert.ok(end>open);return cpp.slice(open+1,end)}
 const note=body('test_note'),navigation=body('test_navigation'),decl=/static wchar_t const\* names\[\]=\{([^}]+)\};/.exec(note);assert.ok(decl);assert.deepEqual([...decl[1].matchAll(/L"([a-z_]+)"/g)].map(m=>m[1]),[...nativePhaseNames])
 const replace=(text:string,old:string,next:string)=>{assert.equal(text.split(old).length,2);return text.replace(old,next)}
 const common=(text:string)=>{text=replace(text,'JsonObject frame;','const frame={};');text=replace(text,'(void)send(frame);','send(frame);');return text.replace(/\bL(["'])/g,'$1').replace(/\b(\d+)u\b/g,'$1').replace('catch(...)','catch')}
 let n=replace(note,'auto index=static_cast<unsigned>(value);','const index=value;');n=replace(n,decl[0],'const names=['+decl[1]+'];');n=replace(n,'std::wstring(L"DESKTOP_480_PHASE_")','"DESKTOP_480_PHASE_"');n=common(n)
 let v=replace(navigation,'constexpr unsigned index=3;','const index=3;');v=replace(v,'COREWEBVIEW2_WEB_ERROR_STATUS status=COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;auto error_hr=args->get_WebErrorStatus(&status);','let status=0;const error_hr=args.get_WebErrorStatus(value=>{status=value});');v=replace(v,'std::wstring id=L"DESKTOP_480_NAV_H";','let id="DESKTOP_480_NAV_H";');v=replace(v,'auto code=static_cast<int>(status);','const code=status;');v=replace(v,'std::to_wstring(code)','String(code)');v=common(v)
 for(const text of[n,v])assert.doesNotMatch(text,/static_cast|JsonObject|std::|constexpr|wchar_t|->|\(void\)|\b\d+u\b/)
 const scope={ready:true,test_phase_attempts:0,SUCCEEDED:(hr:number)=>hr>=0,put:(frame:Record<string,unknown>,key:string,value:unknown)=>{frame[key]=value},send};vm.createContext(scope);vm.runInContext('globalThis.note=value=>{'+n+'};globalThis.navigation=(success_hr,ok,source_hr,own,ready_sample,args)=>{'+v+'}',scope)
 return{note:(value:number)=>(scope as any).note(value),navigation:(bits:boolean[],status=0)=>(scope as any).navigation(bits[0]?0:-1,bits[1],bits[2]?0:-1,bits[3],bits[4],{get_WebErrorStatus(write:(value:number)=>void){write(status);return bits[5]?0:-1}}),setReady:(value:boolean)=>{scope.ready=value}}
}

test('acceptance native lifetime phases use actual HMAC-owned pong responses and never become success receipts',()=>{
 const registry=new DesktopIdentityRegistry(),owned=registry.issue('owned-phase-observer'),foreign=registry.issue('foreign-phase-observer'),receipts:unknown[]=[],proofs:string[]=[]
 let observer!:ReturnType<typeof observeAcceptanceResponses>
 const channel=createDesktopChannel({registry,maxPayload:10240,services:{threads:{},skills:{},mcp:{}} as any,onAuthenticated:host=>{observer.authenticated(host)}})
 observer=observeAcceptanceResponses(channel.wss,()=>({host:'owned-phase-observer',capabilityId:owned.capabilityId}),registry,r=>receipts.push(r),value=>proofs.push(value))
 const open=(boot?:{capabilityId:string;secret:string})=>{const ws:any=new EventEmitter(),sent:any[]=[];ws.readyState=1;ws.send=(raw:string)=>{if(ws.sendError)throw ws.sendError;sent.push(JSON.parse(raw));return 'original-send'};ws.close=ws.terminate=()=>{if(ws.readyState===3)return;ws.readyState=3;ws.emit('close')};const emit=(frame:unknown)=>ws.emit('message',Buffer.from(JSON.stringify(frame)));channel.wss.emit('connection',ws);assert.equal(sent.shift().type,'desktop.challenge.request');if(boot){emit({type:'desktop.hello',capability_id:boot.capabilityId,protocol_version:1});const challenge=sent.shift();assert.equal(challenge.type,'desktop.challenge');emit({type:'desktop.authenticate',capability_id:boot.capabilityId,protocol_version:1,proof:createHmac('sha256',Buffer.from(boot.secret,'hex')).update(JSON.stringify(['cmspark.desktop.auth.v1',boot.capabilityId,challenge.connection_id,1,challenge.nonce])).digest('hex')});assert.equal(sent.shift().type,'desktop.ready')}return{ws,emit,sent}}
 const ready='DESKTOP_480_PHASE_ready_accepted',env='DESKTOP_480_PHASE_env_callback',nav='DESKTOP_480_NAV_H1B1S1O1R1E1W00'
 try{
  const unauthed=open();unauthed.emit({type:'system.ping',id:ready});assert.equal(unauthed.ws.readyState,3);assert.deepEqual(observer.nativeLifetime().phases,[])
  const other=open(foreign);other.emit({type:'system.ping',id:ready});assert.deepEqual(observer.nativeLifetime().phases,[])
  let failedSends=0;const failedProducer=actualNativePhaseProducer480(()=>{failedSends++;throw Error('OWNED_DIAGNOSTIC_SEND')});failedProducer.note(0);failedProducer.note(0);assert.equal(failedSends,1,'actual producer marks before failed send without retry');const good=open(owned),producer=actualNativePhaseProducer480(frame=>good.emit(frame));producer.setReady(false);producer.note(0);assert.deepEqual(observer.nativeLifetime().phases,[]);producer.setReady(true);producer.note(0);producer.note(0);producer.navigation([true,true,true,true,true,true]);const first=observer.nativeLifetime();assert.deepEqual(first.phases,['ready_accepted','navigation_callback']);assert.equal(first.navigation?.webErrorStatus,0);assert.equal(first.scope,'mode-union');assert.equal(first.producerScope,'process-lifetime-once');assert.equal(first.reconnectEpochAttributed,false);assert.equal(first.processInstanceAttributed,false);assert.deepEqual(receipts,[])
  for(const id of [env+'_PRIVATE',env+'\n','DESKTOP_480_PHASE_navigation_callback','DESKTOP_480_NAV_H1B1S1O1R1E1W19'])good.emit({type:'system.ping',id});good.emit({type:'system.ping',id:env,extra:true});assert.equal(good.sent.at(-1).type,'desktop.error');assert.equal(good.sent.at(-1).error_code,'DESKTOP_METHOD_DENIED');assert.equal(good.ws.readyState,1);assert.equal(observer.currentSocket(),good.ws);good.ws.send(JSON.stringify({type:'system.pong',id:env,extra:true}));good.ws.send(JSON.stringify({type:'desktop.error',id:env}));assert.deepEqual(observer.nativeLifetime(),first);const originalFailure=Error('OWNED_SEND');good.ws.sendError=originalFailure;assert.throws(()=>good.ws.send(JSON.stringify({type:'system.pong',id:env})),error=>error===originalFailure);good.ws.sendError=undefined;assert.deepEqual(observer.nativeLifetime(),first)
  const retired=observer.currentSocket();assert.ok(retired);good.ws.terminate();const renewed=open(owned),secondProcess=actualNativePhaseProducer480(frame=>renewed.emit(frame));secondProcess.note(0);secondProcess.navigation([false,false,false,false,false,false]);assert.deepEqual(observer.nativeLifetime(),first,'reconnect cannot re-attribute/reset lifetime-once producer slots')
  assert.equal(retired.send(JSON.stringify({type:'system.pong',id:env})),'original-send');assert.deepEqual(observer.nativeLifetime(),first,'retired socket late output is ignored')
  secondProcess.note(1);assert.deepEqual(observer.nativeLifetime().phases,['ready_accepted','env_callback','navigation_callback']);assert.equal(observer.nativeLifetime().navigation?.isSuccess,true)
  const active=observer.currentSocket();assert.ok(active);registry.revoke(owned.capabilityId);assert.equal(observer.currentSocket(),undefined);active.send(JSON.stringify({type:'system.pong',id:'DESKTOP_480_PHASE_renderer_callback'}));assert.deepEqual(observer.nativeLifetime().phases,['ready_accepted','env_callback','navigation_callback']);assert.deepEqual(receipts,[]);assert.equal(proofs.length,2)
 }finally{registry.revokeAll();for(const ws of channel.wss.clients)ws.terminate();channel.wss.emit('close')}
})


// #773: interpret only the actual unshipped record/format bodies, not a shadow producer.
function actualBootstrapProducer773(cpp:string,emitSource:string,send:(frame:unknown)=>void,format:(value:number)=>string=String,owner='D480Acceptance'){
 const between=(start:string,end:string)=>{assert.equal(cpp.split(start).length,2);const a=cpp.indexOf(start)+start.length,b=cpp.indexOf(end,a);assert.ok(b>a);return cpp.slice(a,b)}
 const replace=(text:string,old:string,next:string)=>{assert.equal(text.split(old).length,2);return text.replace(old,next)}
 let record=between(`void ${owner}::obRecord773(unsigned point,unsigned ordinal,unsigned edge,unsigned code,unsigned present){`,`\n}\nvoid ${owner}::obFlush773`)
 record=replace(record,'auto elapsed=GetTickCount64()-obStart773;','const elapsed=GetTickCount64()-obStart773;')
 record=replace(record,'unsigned bucket=elapsed<90000?static_cast<unsigned>(elapsed/250):361;','const bucket=elapsed<90000?Math.floor(elapsed/250):361;')
 record=replace(record,'ObRow773 row{point,ordinal,edge,bucket,code,present};','const row={point,ordinal,edge,bucket,code,present};')
 record=replace(record,'catch(...)','catch')
 let flush=between(`void ${owner}::obFlush773(){`,'\n}\n')
 const observation='D476Snapshot825::Observation observation825(2,row.point,row.edge);'
 // Bind the actual MCP-only numeric hook without translating or shadowing its
 // native state machine (the compiled C++ worker/reader test covers that).
 if(flush.includes(observation))flush=replace(flush,observation,'observations825.push([2,row.point,row.edge]);')
 flush=replace(flush,'auto const& row=','const row=');flush=replace(flush,'emit(*obHost773,','emit(')
 for(const field of ['point','ordinal','edge','bucket','code','present'])flush=replace(flush,'std::to_wstring(row.'+field+')','String(row.'+field+')')
 flush=replace(flush,'catch(...)','catch');flush=flush.replace(/\bL"/g,'"')
 let emit:string,rawEmit=''
 if(owner==='D476Acceptance'){
  const methodBody=(signature:string)=>{
   assert.equal(emitSource.split(signature).length,2,'one actual C++ method')
   const start=emitSource.indexOf(signature)+signature.length
   let depth=1,quote='',line=false,block=false
   for(let i=start;i<emitSource.length;i++){
    const c=emitSource[i],next=emitSource[i+1]
    if(line){if(c==='\n')line=false;continue}
    if(block){if(c==='*'&&next==='/'){block=false;i++}continue}
    if(quote){if(c==='\\'){i++;continue}if(c===quote)quote='';continue}
    if(c==='/'&&next==='/'){line=true;i++;continue}
    if(c==='/'&&next==='*'){block=true;i++;continue}
    if(c==='"'||c==="'"){quote=c;continue}
    if(c==='{')depth++
    if(c==='}'&&--depth===0)return emitSource.slice(start,i)
   }
   assert.fail('actual C++ method closing brace is required')
  }
  emit=methodBody('void D476Acceptance::emit(Desktop& h,std::wstring const& value){');emit=replace(emit,'emit(h,','emitRaw(');emit=replace(emit,'.c_str()','');emit=emit.replace(/\bL"/g,'"')
  rawEmit=methodBody('void D476Acceptance::emit(Desktop& h,wchar_t const* id){');rawEmit=replace(rawEmit,'JsonObject frame;','const frame={};');rawEmit=replace(rawEmit,'h.send(frame);','send(frame);');rawEmit=rawEmit.replace(/\bL"/g,'"')
 }else{
  const a=emitSource.indexOf('void D480Acceptance::emit(Desktop& h,std::wstring const& value){'),b=emitSource.indexOf('\nvoid D480Acceptance::script',a);assert.ok(a>=0&&b>a)
  emit=emitSource.slice(a+'void D480Acceptance::emit(Desktop& h,std::wstring const& value){'.length,b).trimEnd();assert.ok(emit.endsWith('}'));emit=emit.slice(0,-1)
  emit=replace(emit,'JsonObject out;','const out={};');emit=replace(emit,'(void)h.send(out);','send(out);');emit=replace(emit,'catch(...)','catch');emit=emit.replace(/\bL"/g,'"')
 }
 for(const value of [record,flush,emit])assert.doesNotMatch(value,/std::|static_cast|JsonObject|\(void\)|auto const&|ObRow773/)
 let clock=1000
 const scope:any={observations825:[],String:format,obRows773:[],obSeen773:Array.from({length:31},()=>Array.from({length:9},()=>Array(3).fill(false))),obCount773:0,obSent773:0,obStarted773:false,obStart773:0,obHost773:false,GetTickCount64:()=>clock,put:(out:Record<string,unknown>,key:string,value:unknown)=>{out[key]=value},send}
 vm.createContext(scope);vm.runInContext('globalThis.emitRaw=id=>{'+rawEmit+'};globalThis.emit=value=>{'+emit+'};globalThis.obFlush773=()=>{'+flush+'};globalThis.record=(point,ordinal,edge,code,present)=>{'+record+'}',scope)
 return{record:(point:number,ordinal:number,edge:number,code=0,present=2)=>scope.record(point,ordinal,edge,code,present),host:(value:boolean)=>{scope.obHost773=value;scope.obFlush773()},clock:(value:number)=>{clock=value},counts:()=>({stored:scope.obCount773,sent:scope.obSent773}),observations:()=>JSON.parse(JSON.stringify(scope.observations825))}
}

test('773 bootstrap observations use actual producer bodies and HMAC-owned responses without manufacturing metadata',async()=>{
 const build=require(path.resolve('scripts/build-desktop-windows.mjs')),observed=require(path.resolve('scripts/desktop-bootstrap-observation-fixture.mjs'))
 const original=fs.readFileSync(path.resolve('src/desktop/native/DesktopHost.cpp'),'utf8'),fixture=fs.readFileSync(path.resolve('tests/fixtures/desktop-480/native-acceptance.cpp'),'utf8')
 const base=build.desktopAcceptanceVariant('cpp',original,fixture),generated=observed.desktopBootstrapObservationFixture773(base.source);assert.equal(generated.inverse,base.source)
 const registry=new DesktopIdentityRegistry(),owned=registry.issue('owned-bootstrap-observer'),foreign=registry.issue('foreign-bootstrap-observer'),receipts:unknown[]=[],proofs:string[]=[]
 let observer!:ReturnType<typeof observeAcceptanceResponses>
 const channel=createDesktopChannel({registry,maxPayload:10240,services:{threads:{},skills:{},mcp:{}} as any,onAuthenticated:host=>{observer.authenticated(host)}})
 observer=observeAcceptanceResponses(channel.wss,()=>({host:'owned-bootstrap-observer',capabilityId:owned.capabilityId}),registry,r=>receipts.push(r),value=>proofs.push(value))
 const open=(boot?:{capabilityId:string;secret:string})=>{const ws:any=new EventEmitter(),sent:any[]=[];ws.readyState=1;ws.send=(raw:string)=>{if(ws.sendError)throw ws.sendError;sent.push(JSON.parse(raw));return 'original-send'};ws.close=ws.terminate=()=>{if(ws.readyState===3)return;ws.readyState=3;ws.emit('close')};const emit=(frame:unknown)=>ws.emit('message',Buffer.from(JSON.stringify(frame)));channel.wss.emit('connection',ws);assert.equal(sent.shift().type,'desktop.challenge.request');if(boot){emit({type:'desktop.hello',capability_id:boot.capabilityId,protocol_version:1});const challenge=sent.shift();assert.equal(challenge.type,'desktop.challenge');emit({type:'desktop.authenticate',capability_id:boot.capabilityId,protocol_version:1,proof:createHmac('sha256',Buffer.from(boot.secret,'hex')).update(JSON.stringify(['cmspark.desktop.auth.v1',boot.capabilityId,challenge.connection_id,1,challenge.nonce])).digest('hex')});assert.equal(sent.shift().type,'desktop.ready')}return{ws,emit,sent}}
 const cpuFrames:any[]=[];const native=actualBootstrapProducer773(generated.source,fixture,frame=>cpuFrames.push(frame))
 try{
  native.record(8,1,0);assert.equal(cpuFrames.length,0);native.host(true);assert.equal(cpuFrames.length,1)
  const goodFrame=cpuFrames[0];assert.equal(goodFrame.type,'system.ping')
  const unauthed=open();unauthed.emit(goodFrame);assert.equal(unauthed.ws.readyState,3);assert.deepEqual(observer.bootstrapObservation773().rows,[])
  const other=open(foreign);other.emit(goodFrame);assert.deepEqual(observer.bootstrapObservation773().rows,[])
  const good=open(owned);const producer=actualBootstrapProducer773(generated.source,fixture,frame=>good.emit(frame))
  producer.record(8,1,0);producer.host(true);producer.record(8,1,2,0,1);producer.record(8,1,2,5,0)
  assert.deepEqual(observer.bootstrapObservation773().rows,[[8,1,0,0,0,2],[8,1,2,0,0,1]])
  producer.clock(1251);producer.record(9,1,0);producer.record(9,1,1,0x80004005)
  const first=observer.bootstrapObservation773();assert.deepEqual(first.rows.slice(-2),[[9,1,0,1,0,2],[9,1,1,1,0x80004005,2]])
  assert.equal(first.clock,'native-first-hook-250ms');assert.equal(first.processInstanceAttributed,false)
  // Every invalid wire derives from the actual native formatter; no invented successful snapshot.
  const id=goodFrame.id as string
  for(const bad of [id.replace('_8_1_0_','_31_1_0_'),id.replace('_8_1_0_','_8_9_0_'),id.replace('_8_1_0_','_8_1_3_'),id.replace('_0_0_2','_362_0_2'),id.replace('_0_0_2','_0_4294967296_2'),id.replace('_0_0_2','_0_0_3'),id+'_PRIVATE',id+'\n'])good.emit({type:'system.ping',id:bad})
  good.emit({...goodFrame,extra:true});good.ws.send(JSON.stringify({type:'system.pong',id,extra:true}));good.ws.send(JSON.stringify({type:'desktop.error',id}));assert.deepEqual(observer.bootstrapObservation773(),first)
  const originalError=Error('OWNED_BOOTSTRAP_SEND');good.ws.sendError=originalError;assert.throws(()=>good.ws.send(JSON.stringify({type:'system.pong',id})),error=>error===originalError);good.ws.sendError=undefined;assert.deepEqual(observer.bootstrapObservation773(),first)
  let failed=0;const failedProducer=actualBootstrapProducer773(generated.source,fixture,()=>{failed++;throw Error('OWNED_OBSERVATION_SEND')});failedProducer.host(true);failedProducer.record(1,1,0);failedProducer.record(1,1,0);assert.equal(failed,1)
  // The actual auth path invokes flush directly, outside record's catch. Formatter failure must be inert there too.
  let formatterCalls=0,originalCallerContinued=0
  const formatterFailure=actualBootstrapProducer773(generated.source,fixture,()=>{throw Error('UNREACHABLE_SEND')},()=>{formatterCalls++;throw Error('OWNED_FORMATTER_FAILURE')})
  formatterFailure.record(1,1,0)
  assert.doesNotThrow(()=>{formatterFailure.host(true);originalCallerContinued++})
  assert.equal(originalCallerContinued,1);assert.equal(formatterCalls,1);assert.deepEqual(formatterFailure.counts(),{stored:1,sent:1})
  formatterFailure.host(true);assert.equal(formatterCalls,1,'failed formatting consumes the original slot without retry')
  const retired=observer.currentSocket();assert.ok(retired);good.ws.terminate();const renewed=open(owned);retired.send(JSON.stringify({type:'system.pong',id:id.replace('_8_1_0_','_10_1_0_')}));assert.deepEqual(observer.bootstrapObservation773(),first)
  registry.revoke(owned.capabilityId);renewed.emit(goodFrame);assert.deepEqual(observer.bootstrapObservation773(),first);assert.deepEqual(receipts,[]);assert.equal(proofs.length,2)
 }finally{registry.revokeAll();for(const ws of channel.wss.clients)ws.terminate();channel.wss.emit('close')}
})

test('825 actual MCP 773 recorder and both emit bodies feed only authenticated bounded pong observations',()=>{
 const {desktopMcpFixture}=require(path.resolve('scripts/desktop-mcp-fixture.mjs')),{desktopMcpBootstrapObservationFixture773}=require(path.resolve('scripts/desktop-bootstrap-observation-fixture.mjs'))
 const original=fs.readFileSync(path.resolve('src/desktop/native/DesktopHost.cpp'),'utf8'),fixture=fs.readFileSync(path.resolve('tests/fixtures/desktop-476/native-acceptance.cpp'),'utf8'),form=fs.readFileSync(path.resolve('tests/fixtures/desktop-476/native-form.js'),'utf8')
 const base=desktopMcpFixture('cpp',original,fixture,form),generated=desktopMcpBootstrapObservationFixture773(base.source)
 assert.equal(generated.inverse,base.source)
 const registry=new DesktopIdentityRegistry(),owned=registry.issue('owned-mcp-bootstrap'),rows:number[][]=[],seen=new Set<string>(),phases=new Set<string>()
 const channel=createDesktopChannel({registry,maxPayload:10240,services:{threads:{},skills:{},mcp:{}} as any})
 const open=(boot?:typeof owned)=>{
  const ws:any=new EventEmitter(),sent:any[]=[];ws.readyState=1;ws.send=(raw:string)=>{if(ws.sendError)throw ws.sendError;sent.push(JSON.parse(raw));return 'owned-send'};ws.close=ws.terminate=()=>{ws.readyState=3;ws.emit('close')}
  const emit=(frame:unknown)=>ws.emit('message',Buffer.from(JSON.stringify(frame)))
  channel.wss.emit('connection',ws);observeNativePhaseResponses(ws,phases,{}, {rows,seen});assert.equal(sent.shift().type,'desktop.challenge.request')
  if(boot){emit({type:'desktop.hello',capability_id:boot.capabilityId,protocol_version:1});const challenge=sent.shift();emit({type:'desktop.authenticate',capability_id:boot.capabilityId,protocol_version:1,proof:createHmac('sha256',Buffer.from(boot.secret,'hex')).update(JSON.stringify(['cmspark.desktop.auth.v1',boot.capabilityId,challenge.connection_id,1,challenge.nonce])).digest('hex')});assert.equal(sent.shift().type,'desktop.ready')}
  return{ws,emit,sent}
 }
 const frames:any[]=[],producer=actualBootstrapProducer773(generated.source,generated.source,frame=>frames.push(frame),String,'D476Acceptance')
 try{
  producer.record(8,1,0);assert.equal(frames.length,0);producer.host(true);producer.record(8,1,2,0,1);producer.clock(1251);producer.record(29,1,0);producer.record(29,1,1,0x80070057)
  assert.equal(frames[0].type,'system.ping');assert.equal(frames[0].id,'D480A_BOOT_8_1_0_0_0_2')
  const unauth=open();unauth.emit(frames[0]);assert.equal(unauth.ws.readyState,3);assert.deepEqual(rows,[])
  const active=open(owned);for(const frame of frames)active.emit(frame)
  assert.deepEqual(rows,[[8,1,0,0,0,2],[8,1,2,0,0,1],[29,1,0,1,0,2],[29,1,1,1,0x80070057,2]])
  const before=JSON.stringify(rows),id=frames[0].id
  for(const bad of [id.replace('_8_1_0_','_31_1_0_'),id.replace('_8_1_0_','_8_9_0_'),id.replace('_8_1_0_','_8_1_3_'),id.replace('_0_0_2','_362_0_2'),id.replace('_0_0_2','_0_4294967296_2'),id.replace('_0_0_2','_0_0_3'),id+'_PRIVATE',id+'\n'])active.emit({type:'system.ping',id:bad})
  active.emit({...frames[0],extra:true});active.ws.send(JSON.stringify({type:'desktop.error',id}));active.ws.send(JSON.stringify({type:'system.pong',id,extra:true}));assert.equal(JSON.stringify(rows),before)
  const failure=Error('owned-original-send-failure');active.ws.sendError=failure;assert.throws(()=>active.ws.send(JSON.stringify({type:'system.pong',id:id.replace('_8_1_0_','_9_1_0_')})),error=>error===failure);assert.equal(JSON.stringify(rows),before);active.ws.sendError=undefined
  // Even after all eight old phases are seen, boot rows retain their own bound.
  for(const phase of nativePhaseNames)phases.add(phase)
  const fill=actualBootstrapProducer773(generated.source,generated.source,frame=>active.emit(frame),String,'D476Acceptance');fill.host(true)
  for(let point=1;point<=30;point++)for(let ordinal=1;ordinal<=9;ordinal++)for(let edge=0;edge<2;edge++)fill.record(point,ordinal,edge)
  assert.equal(fill.counts().stored,192);assert.equal(rows.length,192);assert.equal(seen.size,192)
  let attempted=0;const sendFail=actualBootstrapProducer773(generated.source,generated.source,()=>{attempted++;throw Error('owned-diagnostic-send')},String,'D476Acceptance');sendFail.host(true);sendFail.record(9,1,0);sendFail.record(9,1,0);assert.equal(attempted,1)
  let formatted=0,continued=0;const formatFail=actualBootstrapProducer773(generated.source,generated.source,()=>{throw Error('unreachable-send')},()=>{formatted++;throw Error('owned-diagnostic-format')},'D476Acceptance');formatFail.record(8,1,0);assert.doesNotThrow(()=>{formatFail.host(true);continued++});formatFail.host(true);assert.equal(formatted,1);assert.equal(continued,1)
 }finally{registry.revokeAll();for(const ws of channel.wss.clients)ws.terminate();channel.wss.emit('close')}
})

for(const sampled of [false,true])for(const hostEol of ['\n','\r\n'])for(const fixtureEol of ['\n','\r\n'])test(`825 actual MCP consumer ${sampled?'with independent snapshot':'legacy'} handles host ${hostEol==='\n'?'LF':'CRLF'} and fixture ${fixtureEol==='\n'?'LF':'CRLF'} without reading the next C++ method`,()=>{
 const {desktopMcpFixture}=require(path.resolve('scripts/desktop-mcp-fixture.mjs')),{desktopMcpBootstrapObservationFixture773}=require(path.resolve('scripts/desktop-bootstrap-observation-fixture.mjs'))
 const original=fs.readFileSync(path.resolve('src/desktop/native/DesktopHost.cpp'),'utf8'),fixture=fs.readFileSync(path.resolve('tests/fixtures/desktop-476/native-acceptance.cpp'),'utf8'),form=fs.readFileSync(path.resolve('tests/fixtures/desktop-476/native-form.js'),'utf8')
 // Only derived inputs vary EOL; production and build evidence are never rewritten.
 const snapshot=sampled?fs.readFileSync(path.resolve('tests/fixtures/desktop-476/mcp-snapshot-825.h'),'utf8'):undefined
 const base=desktopMcpFixture('cpp',original.replace(/\r?\n/g,hostEol),fixture.replace(/\r?\n/g,fixtureEol),form),generated=desktopMcpBootstrapObservationFixture773(base.source,snapshot)
 assert.equal(generated.inverse,base.source)
 const frames:any[]=[],producer=actualBootstrapProducer773(generated.source,generated.source,frame=>frames.push(frame),String,'D476Acceptance')
 producer.record(8,1,0);assert.equal(frames.length,0);producer.host(true);producer.record(8,1,2,0,1);producer.clock(1251);producer.record(29,1,0);producer.record(29,1,1,0x80070057)
 assert.deepEqual(frames.map(frame=>[frame.type,frame.id]),[
  ['system.ping','D480A_BOOT_8_1_0_0_0_2'],['system.ping','D480A_BOOT_8_1_2_0_0_1'],
  ['system.ping','D480A_BOOT_29_1_0_1_0_2'],['system.ping','D480A_BOOT_29_1_1_1_2147942487_2'],
 ])
 assert.deepEqual(producer.observations(),sampled?[[2,8,0],[2,8,2],[2,29,0],[2,29,1]]:[])
 for(const row of [[8,1,0],[31,1,0],[8,9,0],[8,1,3],[8,2,0,0,3]])producer.record(row[0],row[1],row[2],row[3],row[4])
 assert.equal(frames.length,4);assert.deepEqual(producer.counts(),{stored:4,sent:4})
 const raw='void D476Acceptance::emit(Desktop& h,wchar_t const* id){'
 for(const changed of [generated.source.replace(raw,'void MissingRawEmit(){'),generated.source+'\n'+raw+'}\n'])assert.throws(()=>actualBootstrapProducer773(generated.source,changed,()=>{},String,'D476Acceptance'))
 let sends=0;const failed=actualBootstrapProducer773(generated.source,generated.source,()=>{sends++;throw Error('owned-diagnostic-send')},String,'D476Acceptance')
 failed.host(true);failed.record(8,1,0);failed.record(8,1,0);assert.equal(sends,1)
})
