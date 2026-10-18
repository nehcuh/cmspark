// External AX only. Never execute this fixture on an agent's local desktop.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {execFile, type ChildProcess} from 'node:child_process'
import {performance} from 'node:perf_hooks'
import {withSurface650} from './fixtures/native-surface-650'

type Ax571Snapshot={foreground:number|null;zorder:number[];cursor:{x:number;y:number}|null}
function ax571Code(value:unknown):string {
 try {const item=value as Record<string,unknown>,code=item?.error_code??item?.code;return typeof code==='string'&&['TASK_ABORTED','HWND_DEAD','AX_WINDOW_GONE','ELEMENT_NOT_FOUND','AX_ELEMENT_MISMATCH','AX_ACTION_UNAVAILABLE','AX_ACTION_FAILED','AX_FAILED','INVALID_ACTION'].includes(code)?code:'UNKNOWN'}catch{return 'UNKNOWN'}
}
// Fixture diagnostics are a closed category, never native stderr/error text or authority.
function ax571LaunchBoundary(value:unknown):string {
 if(typeof value!=="string"||Buffer.byteLength(value,"utf8")>4096)return "UNKNOWN"
 const markers=value.match(/^AX571_LAUNCH_(OPEN_ERROR|NO_RETURNED_APP|PARENT_CHANGED|RETURNED_PID(?:_NONPOSITIVE|_SELF)?|RETURNED_TERMINATED|BUNDLE_ID|BUNDLE_URL|EXECUTABLE_URL)\r?$/gm)
 return markers?.length===1?markers[0].trimEnd().slice("AX571_LAUNCH_".length):"UNKNOWN"
}
// Two fixed lifecycle snapshots only. Missing/invalid observations confer no authority.
function ax571LaunchLifecycle(value:unknown):{entry:{pidAvailable:boolean;terminated:boolean;finishedLaunching:boolean}|null;refused:{pidAvailable:boolean;terminated:boolean;finishedLaunching:boolean}|null}|null {
 if(typeof value!=="string"||Buffer.byteLength(value,"utf8")>4096)return null
 let entry:{pidAvailable:boolean;terminated:boolean;finishedLaunching:boolean}|null=null,refused:{pidAvailable:boolean;terminated:boolean;finishedLaunching:boolean}|null=null
 for(const line of value.split(/\r?\n/)){
  if(!line.includes("AX571_LIFECYCLE_"))continue
  const m=/^AX571_LIFECYCLE_(ENTRY|REFUSED)_([0-7])$/.exec(line);if(!m)return null
  const bits=Number(m[2]),shot={pidAvailable:!!(bits&1),terminated:!!(bits&2),finishedLaunching:!!(bits&4)}
  if(m[1]==="ENTRY"){if(entry!==null)return null;entry=shot}else{if(refused!==null)return null;refused=shot}
 }
 return entry!==null||refused!==null?{entry,refused}:null
}
function requireAx571Oracles(before:Ax571Snapshot,after:Ax571Snapshot,verdict:Record<string,unknown>,target:number,sibling:number):void {
 assert.ok(Number.isSafeInteger(target)&&target>0&&Number.isSafeInteger(sibling)&&sibling>0&&target!==sibling,'AX571_OWNED_WINDOWS_INVALID')
 for(const shot of [before,after]){
  assert.ok(shot.foreground===sibling,'AX571_FOREGROUND_CHANGED');assert.ok(shot.cursor&&Number.isFinite(shot.cursor.x)&&Number.isFinite(shot.cursor.y),'AX571_CURSOR_UNREADABLE')
  assert.ok(Array.isArray(shot.zorder)&&shot.zorder.length>0&&shot.zorder.includes(target)&&shot.zorder.includes(sibling),'AX571_ZORDER_UNREADABLE')
 }
 assert.ok(JSON.stringify(after.zorder)===JSON.stringify(before.zorder),'AX571_ZORDER_CHANGED');assert.ok(after.cursor?.x===before.cursor?.x&&after.cursor?.y===before.cursor?.y,'AX571_CURSOR_CHANGED')
 for(const key of ['focus_kept','zorder_kept','cursor_kept','no_leaked_input','background_verified'])assert.equal(verdict[key],true,'AX571_ORACLE_REFUSED')
 assert.equal(verdict.no_leaked_input_kind,'derived','AX571_LEAK_KIND')
}
function ax571Identity(value:unknown):boolean {try{const v=value as Record<string,unknown>;return v?.schema===1&&v.identifierExpected===true&&v.signatureVerified===true&&v.route==='DIRECT_CLI_NODE_PARENT'&&v.tccResponsibility==='UNKNOWN'}catch{return false}}
function ax571Setup(value:unknown):{schema:1;appActive:boolean;siblingKey:boolean;targetBound:boolean;siblingBound:boolean;firstRole:string}|null {
 try {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='appActive,firstRole,schema,siblingBound,siblingKey,targetBound')return null
  const d=Object.getOwnPropertyDescriptors(value),get=(k:string)=>d[k]&&'value'in d[k]?d[k].value:undefined
  if(get('schema')!==1||!['appActive','siblingKey','targetBound','siblingBound'].every(k=>typeof get(k)==='boolean')||!['UNKNOWN','NONE','TARGET','SIBLING','OTHER'].includes(get('firstRole')))return null
  return {schema:1,appActive:get('appActive'),siblingKey:get('siblingKey'),targetBound:get('targetBound'),siblingBound:get('siblingBound'),firstRole:get('firstRole')}
 } catch {return null}
}
// These dedicated native entry exits precede its sole launch request.
// Existing/malformed/unreadable evidence is never classified as absent.
function ax571PrelaunchRefused(closed:boolean,code:number|null,signal:NodeJS.Signals|null,files:string[]):boolean {
 if(!closed||(code!==78&&code!==79)||signal!==null)return false
 for(const file of files){try{fs.lstatSync(file);return false}catch(error){
  if(!error||typeof error!=="object"||Object.getOwnPropertyDescriptor(error,"code")?.value!=="ENOENT")return false
 }}
 return true
}
// Private owned-file evidence: launcher close alone never proves the app closed.
function ax571OwnerReceipt(value:unknown,framework:string,terminated:boolean,pid?:number):{pid:number}|null {
 try {
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join(",")!=="framework,pid,schema,terminated,urlBound")return null
  const d=Object.getOwnPropertyDescriptors(value),get=(k:string)=>d[k]&&"value"in d[k]?d[k].value:undefined,n=get("pid")
  if(get("schema")!==1||get("framework")!==framework||get("urlBound")!==true||get("terminated")!==terminated||!Number.isSafeInteger(n)||n<=0||n>2147483647||(pid!==undefined&&n!==pid))return null
  return {pid:n}
 }catch{return null}
}
let delivered571=0
for(const framework of ['APPKIT','WKWEBVIEW'] as const)test(`#571 actual external AX press ${framework}: target marker and all background oracles`,{skip:process.platform!=='darwin',timeout:20_000},t=>withSurface650(t,async(t,lease)=>{
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ax-native571-'))),owned=fs.lstatSync(dir,{bigint:true}),root=path.resolve('dist/ax-native-571'),host=path.join(root,'cmspark-host'),fixture=path.join(root,'OwnedAX571.app/Contents/MacOS/owned-target')
 const deadline=performance.now()+20_000,remaining=()=>{t.signal.throwIfAborted();const n=Math.floor(deadline-performance.now());assert.ok(n>0,'AX571_DEADLINE');return n}
 const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TMPDIR:dir}
 let child:ChildProcess|undefined,closed:Promise<void>=Promise.resolve(),ended=false,failed=false,primary:unknown,appPID:number|undefined,launcherExit:number|null=null,launcherSignal:NodeJS.Signals|null=null
 let launchBoundary="UNKNOWN",launchLifecycle:ReturnType<typeof ax571LaunchLifecycle>=null,waitStage:"NOT_STARTED"|"OWNER_STARTED"|"APP_READY"|"ACTION"="NOT_STARTED"
 const json=async(bin:string,args:string[],limit=15_000)=>new Promise<any>((resolve,reject)=>{execFile(bin,args,{encoding:'utf8',env,timeout:Math.min(limit,remaining()),maxBuffer:65536,signal:t.signal},(error,stdout)=>{if(error){reject(Error('AX571_CHILD_FAILED'));return}try{resolve(JSON.parse(stdout))}catch{reject(Error('AX571_INVALID_JSON'))}})})
 const command=async(args:string[],limit=15_000)=>json(host,args,limit)
 const marker=path.join(dir,'target.json'),siblingMarker=path.join(dir,'sibling.json'),ready=path.join(dir,'ready.json'),stop=path.join(dir,'stop')
 const waitFile=(file:string)=>new Promise<any>((resolve,reject)=>{
  let settled=false;const finish=(error?:Error,value?:any)=>{if(settled)return;settled=true;clearTimeout(timer);watcher.close();t.signal.removeEventListener('abort',aborted);error?reject(error):resolve(value)}
  const check=()=>{try{if(fs.existsSync(file))finish(undefined,JSON.parse(fs.readFileSync(file,'utf8')))}catch{finish(Error('AX571_INVALID_RECEIPT'))}}
  const watcher=fs.watch(dir,check),timer=setTimeout(()=>finish(Error('AX571_RECEIPT_DEADLINE')),remaining()),aborted=()=>finish(Error('AX571_ABORTED'))
  t.signal.addEventListener('abort',aborted,{once:true});void closed.then(()=>finish(Error('AX571_OWNER_CLOSED')));check();if(t.signal.aborted)aborted()
 })
 try{
  const identity=JSON.parse(fs.readFileSync(path.join(root,'identity.json'),'utf8'));assert.equal(ax571Identity(identity),true,'AX571_SIGNED_IDENTITY_REQUIRED');assert.equal(identity.fixtureBundleVerified,true,'AX571_SIGNED_FIXTURE_REQUIRED');assert.equal(identity.fixtureIdentifierExpected,true,'AX571_SIGNED_FIXTURE_REQUIRED')
  // Read-only trust observation, no prompt or live permission alteration.
  const security=await command(['security-check']);assert.equal(security.ok,true,'AX571_SECURITY_UNREADABLE');assert.equal(typeof security.axTrusted,'boolean','AX571_SECURITY_UNREADABLE');assert.equal(typeof security.secureInput,'boolean','AX571_SECURITY_UNREADABLE')
  t.diagnostic('AX571_PERMISSION '+JSON.stringify({schema:1,framework,axTrusted:security.axTrusted,secureInput:security.secureInput,identifierExpected:true,route:'DIRECT_CLI_NODE_PARENT',tccResponsibility:'UNKNOWN'}))
  lease.checkpoint();lease.retain()
  child=execFile(fixture,['--launch-owned',framework,ready,marker,siblingMarker,String(remaining())],{env,timeout:remaining(),maxBuffer:4096,signal:t.signal},(_error,_stdout,stderr)=>{launchBoundary=ax571LaunchBoundary(stderr);launchLifecycle=ax571LaunchLifecycle(stderr)})
  closed=new Promise<void>(resolve=>child!.once('close',(code,signal)=>{launcherExit=code;launcherSignal=signal;ended=true;resolve()}))
  waitStage='OWNER_STARTED'
  const started=ax571OwnerReceipt(await waitFile(ready+'.owner-started'),framework,false);assert.ok(started,'AX571_APP_OWNER_REQUIRED');appPID=started.pid;assert.ok(appPID!==child.pid,'AX571_APP_NOT_LAUNCHER');
  waitStage='APP_READY'
  const proof=await waitFile(ready);assert.ok(proof.appPID===appPID,'AX571_READY_APP_IDENTITY');assert.equal(proof.schema,1,'AX571_INVALID_RECEIPT');assert.equal(proof.framework,framework,'AX571_INVALID_RECEIPT');const setup=ax571Setup(proof.setup);assert.ok(setup&&setup.appActive&&setup.siblingKey&&setup.targetBound&&setup.siblingBound,'AX571_OWNED_READY_REQUIRED');const target=proof.target,sibling=proof.sibling
  assert.ok(Number.isSafeInteger(target)&&target>0&&Number.isSafeInteger(sibling)&&sibling>0&&target!==sibling,'AX571_OWNED_WINDOWS_INVALID')
  waitStage='ACTION'
  const snapshot=async(name:string)=>{const file=path.join(dir,name);await new Promise<void>((resolve,reject)=>execFile('/bin/bash',[path.resolve('../scripts/computer-bg-oracles.sh'),'snapshot','-out',file,'--host-bin',host],{env,timeout:Math.min(15_000,remaining()),maxBuffer:4096,signal:t.signal},error=>error?reject(Error('AX571_SNAPSHOT_FAILED')):resolve()));return JSON.parse(fs.readFileSync(file,'utf8')) as Ax571Snapshot}
  const before=await snapshot('before.json');t.diagnostic('AX571_INITIAL '+JSON.stringify({schema:1,framework,firstRole:before.foreground===null?'NONE':before.foreground===target?'TARGET':before.foreground===sibling?'SIBLING':'OTHER',targetPresent:before.zorder.includes(target),siblingPresent:before.zorder.includes(sibling)}));assert.ok(before.foreground===sibling,'AX571_INITIAL_SIBLING_REQUIRED');assert.equal(fs.existsSync(marker),false,'AX571_PREEXISTING_MARKER')
  // Entry estop precedes traversal/TCC and must cause no action.
  fs.writeFileSync(stop,'1',{flag:'wx',mode:0o600});const stopped=await command(['ax-invoke','--window-id',String(target),'--target','OwnedAX571Press','--action','press','--estop-flag',stop],8000);assert.equal(ax571Code(stopped),'TASK_ABORTED','AX571_ESTOP_REFUSAL');assert.equal(fs.existsSync(marker),false,'AX571_ESTOP_EFFECT');fs.unlinkSync(stop)
  if(!security.axTrusted){
   const denied=await command(['ax-invoke','--window-id',String(target),'--target','OwnedAX571Press','--action','press','--estop-flag',stop],8000)
   const code=ax571Code(denied);t.diagnostic('AX571_ROW '+JSON.stringify({schema:1,framework,action:'press',status:'Gap',code,permission:false,reason:'ACTUAL_PERMISSION_PRECONDITION_FALSE'}));assert.notEqual(denied.ok,true,'AX571_UNTRUSTED_ACTION');assert.notEqual(code,'UNKNOWN','AX571_UNCLASSIFIED_REFUSAL');assert.equal(fs.existsSync(marker),false,'AX571_UNTRUSTED_EFFECT');throw Error('AX571_PERMISSION_REQUIRED')
  }
  assert.equal(security.secureInput,false,'AX571_SECURE_INPUT_ACTIVE')
  const hit=await command(['ax-locate','--window-id',String(target),'--target','OwnedAX571Press']);assert.equal(hit.found,true,'AX571_LOCATE_FAILED');assert.ok(hit.name==='OwnedAX571Press','AX571_IDENTITY');assert.equal(typeof hit.role,'string','AX571_IDENTITY')
  const args=['ax-invoke','--window-id',String(target),'--target',hit.name,'--action','press','--expect-role',hit.role,'--expect-name',hit.name,'--estop-flag',stop]
  const mismatchArgs=[...args],roleIndex=mismatchArgs.indexOf('--expect-role');assert.ok(roleIndex>=0&&mismatchArgs.lastIndexOf('--expect-role')===roleIndex,'AX571_ROLE_ARGV');mismatchArgs[roleIndex+1]='AX571_WRONG_ROLE'
  const mismatch=await command(mismatchArgs,8000)
  assert.equal(ax571Code(mismatch),'AX_ELEMENT_MISMATCH','AX571_IDENTITY_REFUSAL');assert.equal(fs.existsSync(marker),false,'AX571_IDENTITY_EFFECT')
  lease.checkpoint();const result=await command(args,8000);const code=ax571Code(result)
  if(result.ok===true){const receipt=await waitFile(marker);assert.ok(receipt&&Object.keys(receipt).sort().join(',')==='changed,framework,schema'&&receipt.schema===1&&receipt.framework===framework&&receipt.changed===true,'AX571_TARGET_MARKER')}
  else assert.ok(['AX_ACTION_UNAVAILABLE','AX_ACTION_FAILED'].includes(code),'AX571_ACTION_REFUSAL')
  const after=await snapshot('after.json'),verdictFile=path.join(dir,'verdict.json')
  await new Promise<void>((resolve,reject)=>execFile('/bin/bash',[path.resolve('../scripts/computer-bg-oracles.sh'),'compare','-before',path.join(dir,'before.json'),'-after',path.join(dir,'after.json'),'-out',verdictFile,'--target-hwnd',String(target),'--delivery','ax-action'],{env,timeout:Math.min(15_000,remaining()),maxBuffer:4096,signal:t.signal},error=>error?reject(Error('AX571_COMPARE_FAILED')):resolve()))
  requireAx571Oracles(before,after,JSON.parse(fs.readFileSync(verdictFile,'utf8')),target,sibling);assert.equal(fs.existsSync(siblingMarker),false,'AX571_SIBLING_EFFECT')
  if(result.ok===true)delivered571++;else assert.equal(fs.existsSync(marker),false,'AX571_REFUSAL_EFFECT')
  t.diagnostic('AX571_ROW '+JSON.stringify({schema:1,framework,action:'press',status:result.ok===true?'Delivered':'Refused',code:result.ok===true?'OK':code,targetChanged:result.ok===true,focusKept:true,zorderKept:true,cursorKept:true,noLeakedInput:true,noLeakedInputKind:'derived'}))
 }catch(error){failed=true;primary=error}
 finally{
  let setup:null|ReturnType<typeof ax571Setup>=null;try{const b=fs.readFileSync(ready+'.setup','utf8');if(Buffer.byteLength(b,'utf8')<=2048)setup=ax571Setup(JSON.parse(b))}catch{}
  try{t.diagnostic('AX571_SETUP '+JSON.stringify({schema:1,framework,observed:setup!==null,...(setup??{})}))}catch{/* Diagnostics cannot replace primary or cleanup. */}
  try{t.diagnostic('AX571_LIFETIME '+JSON.stringify({schema:1,framework,closed:ended,prelaunch:launcherExit===78?'ADMISSION_REFUSED':launcherExit===79?'POLICY_REFUSED':'UNPROVEN',signalObserved:launcherSignal!==null,waitStage,launchBoundary,launchLifecycle}))}catch{/* Finite observation cannot replace primary or cleanup. */}
  let cleanup:unknown
  let actualAppClosed=!child
  try{if(child&&!ended)child.kill();await closed;if(child){if(ax571PrelaunchRefused(ended,launcherExit,launcherSignal,[ready,ready+'.owner-started',ready+'.owner-closed',ready+'.setup',marker,siblingMarker]))actualAppClosed=true;else{const start=ax571OwnerReceipt(JSON.parse(fs.readFileSync(ready+'.owner-started','utf8')),framework,false,appPID);assert.ok(start,'AX571_APP_OWNER_REQUIRED');assert.ok(start.pid!==child.pid,'AX571_APP_NOT_LAUNCHER');const receipt=ax571OwnerReceipt(JSON.parse(fs.readFileSync(ready+'.owner-closed','utf8')),framework,true,start.pid);assert.ok(receipt,'AX571_APP_NOT_REAPED');actualAppClosed=true}}}catch{cleanup=Error('AX571_OWNER_CLEANUP_FAILED')}
  if((!child||ended)&&actualAppClosed){try{const now=fs.lstatSync(dir,{bigint:true});assert.ok(now.isDirectory()&&!now.isSymbolicLink()&&now.dev===owned.dev&&now.ino===owned.ino,'AX571_CLEANUP_IDENTITY');fs.rmSync(dir,{recursive:true});lease.settled()}catch(error){cleanup=error}}
  else cleanup=Error('AX571_OWNER_NOT_REAPED')
  if(failed)throw primary;if(cleanup!==undefined)throw cleanup
 }
}))
test('#571 at least one actual external AX press has target effect and all three observed oracles',{skip:process.platform!=='darwin'},()=>assert.ok(delivered571>0,'AX571_NO_DELIVERED_ROW'))
