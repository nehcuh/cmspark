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
let delivered571=0
for(const framework of ['APPKIT','WKWEBVIEW'] as const)test(`#571 actual external AX press ${framework}: target marker and all background oracles`,{skip:process.platform!=='darwin',timeout:20_000},t=>withSurface650(t,async(t,lease)=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ax-native571-')),owned=fs.lstatSync(dir,{bigint:true}),root=path.resolve('dist/ax-native-571'),host=path.join(root,'cmspark-host'),fixture=path.join(root,'owned-target')
 const deadline=performance.now()+20_000,remaining=()=>{t.signal.throwIfAborted();const n=Math.floor(deadline-performance.now());assert.ok(n>0,'AX571_DEADLINE');return n}
 const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',TMPDIR:dir}
 let child:ChildProcess|undefined,closed:Promise<void>=Promise.resolve(),ended=false,failed=false,primary:unknown
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
  assert.equal(ax571Identity(JSON.parse(fs.readFileSync(path.join(root,'identity.json'),'utf8'))),true,'AX571_SIGNED_IDENTITY_REQUIRED')
  // Read-only trust observation, no prompt or live permission alteration.
  const security=await command(['security-check']);assert.equal(security.ok,true,'AX571_SECURITY_UNREADABLE');assert.equal(typeof security.axTrusted,'boolean','AX571_SECURITY_UNREADABLE');assert.equal(typeof security.secureInput,'boolean','AX571_SECURITY_UNREADABLE')
  t.diagnostic('AX571_PERMISSION '+JSON.stringify({schema:1,framework,axTrusted:security.axTrusted,secureInput:security.secureInput,identifierExpected:true,route:'DIRECT_CLI_NODE_PARENT',tccResponsibility:'UNKNOWN'}))
  lease.checkpoint();lease.retain()
  child=execFile(fixture,[framework,ready,marker,siblingMarker],{env,timeout:remaining(),maxBuffer:4096,signal:t.signal},()=>{})
  closed=new Promise<void>(resolve=>child!.once('close',()=>{ended=true;resolve()}))
  const proof=await waitFile(ready);assert.equal(proof.schema,1,'AX571_INVALID_RECEIPT');assert.equal(proof.framework,framework,'AX571_INVALID_RECEIPT');const target=proof.target,sibling=proof.sibling
  assert.ok(Number.isSafeInteger(target)&&target>0&&Number.isSafeInteger(sibling)&&sibling>0&&target!==sibling,'AX571_OWNED_WINDOWS_INVALID')
  const snapshot=async(name:string)=>{const file=path.join(dir,name);await new Promise<void>((resolve,reject)=>execFile('/bin/bash',[path.resolve('../scripts/computer-bg-oracles.sh'),'snapshot','-out',file,'--host-bin',host],{env,timeout:Math.min(15_000,remaining()),maxBuffer:4096,signal:t.signal},error=>error?reject(Error('AX571_SNAPSHOT_FAILED')):resolve()));return JSON.parse(fs.readFileSync(file,'utf8')) as Ax571Snapshot}
  const before=await snapshot('before.json');assert.ok(before.foreground===sibling,'AX571_INITIAL_SIBLING_REQUIRED');assert.equal(fs.existsSync(marker),false,'AX571_PREEXISTING_MARKER')
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
  let cleanup:unknown
  try{if(child&&!ended)child.kill();await closed}catch{cleanup=Error('AX571_OWNER_CLEANUP_FAILED')}
  if(!child||ended){try{const now=fs.lstatSync(dir,{bigint:true});assert.ok(now.isDirectory()&&!now.isSymbolicLink()&&now.dev===owned.dev&&now.ino===owned.ino,'AX571_CLEANUP_IDENTITY');fs.rmSync(dir,{recursive:true});lease.settled()}catch(error){cleanup=error}}
  else cleanup=Error('AX571_OWNER_NOT_REAPED')
  if(failed)throw primary;if(cleanup!==undefined)throw cleanup
 }
}))
test('#571 at least one actual external AX press has target effect and all three observed oracles',{skip:process.platform!=='darwin'},()=>assert.ok(delivered571>0,'AX571_NO_DELIVERED_ROW'))
