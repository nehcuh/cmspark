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
import {nativePhaseNames} from "./fixtures/desktop-480/native-phase-observation"

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
