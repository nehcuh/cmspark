// Windows-only acceptance of the other four actual no-focus SDK actions.
// Invoke remains owned by the original uninstrumented + separate diagnostic tests.
import test, { type TestContext } from "node:test"
import { withSurface650, type SurfaceLease650 } from "../fixtures/native-surface-650"
import assert from "node:assert/strict"
import { execFile, type ChildProcess } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync, watch, copyFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { PsInputInjector, PsUiaLocator } from "../../src/computer/win-adapters"
import { resolvePowerShellExe, resolveWinScript, resolveComputerUiaNoFocusDll, runPs, type PsRunner } from "../../src/host-use/win/powershell"

type Mode572 = "setvalue" | "select" | "toggle" | "scroll"
type Loader572 = "missing" | "invalid-pe" | "wrong-architecture" | "missing-symbol"
type Child572 = { child: ChildProcess; closed: Promise<void>; isClosed(): boolean; launchError(): Error | undefined }
type Snapshot572 = { foreground: number; cursor: { got: boolean; x: number; y: number }; zorder: number[] }
const modes572: ReadonlyArray<{mode:Mode572;name:string;automationId:string}> = [
  {mode:"setvalue",name:"OwnedSetValue572",automationId:"owned_setvalue572"},
  {mode:"select",name:"OwnedSelect572",automationId:"owned_select572"},
  {mode:"toggle",name:"OwnedToggle572",automationId:"owned_toggle572"},
  {mode:"scroll",name:"OwnedScroll572",automationId:"owned_scroll572"},
]
function startMode572(args:string[],remaining:number):Child572 {
  let ended=false,failure:Error|undefined
  const child=execFile(resolvePowerShellExe(),["-NoProfile","-NonInteractive","-STA","-ExecutionPolicy","Bypass","-File",path.resolve("tests/fixtures/win/uia-no-focus-modes-572.ps1"),...args],{encoding:"utf8",windowsHide:true,timeout:remaining,maxBuffer:4096},error=>{if(error)failure=error})
  const closed=new Promise<void>(resolve=>child.once("close",()=>{ended=true;resolve()}))
  return{child,closed,isClosed:()=>ended,launchError:()=>failure}
}
function waitModeFile572<T>(file:string,owner:Child572,deadline:number,parse:(text:string)=>T):Promise<T> {
  return new Promise((resolve,reject)=>{
    let settled=false
    const finish=(error?:unknown,value?:T)=>{if(settled)return;settled=true;clearTimeout(timer);try{watcher.close()}catch{};if(error)reject(error);else resolve(value as T)}
    const check=()=>{try{if(existsSync(file))finish(undefined,parse(readFileSync(file,"utf8")))}catch(error){finish(error)}}
    const watcher=watch(path.dirname(file),check)
    const timer=setTimeout(()=>finish(new Error("UIA572_MODE_RECEIPT_DEADLINE")),Math.max(1,deadline-performance.now()))
    void owner.closed.then(()=>finish(owner.launchError()??new Error("UIA572_MODE_OWNER_CLOSED")))
    check()
  })
}
async function cleanupMode572(children:Child572[],remove:()=>void,primary:unknown,settled?:()=>void):Promise<void> {
  let cleanup:unknown
  for(const owner of [...children].reverse()){
    try{if(!owner.isClosed()){owner.child.ref();if(!owner.child.kill())throw new Error("UIA572_MODE_TERMINATE_FAILED")}}catch(error){cleanup??=error}
    try{await owner.closed}catch(error){cleanup??=error}
  }
  try{remove()}catch(error){cleanup??=error}
  if(cleanup===undefined&&children.every(c=>c.isClosed()))try{settled?.()}catch(error){cleanup??=error}
  if(primary!==undefined)throw primary
  if(cleanup!==undefined)throw cleanup
}
function assertModeDesktop572(target:number,sibling:number,before:Snapshot572,after:Snapshot572,verdict:Record<string,unknown>,siblingMarker:boolean):void {
  assert.ok(Number.isSafeInteger(target)&&target>0&&Number.isSafeInteger(sibling)&&sibling>0&&target!==sibling)
  for(const shot of [before,after]){
    assert.equal(shot.foreground,sibling,"owned sibling must retain actual foreground")
    assert.equal(shot.cursor.got,true);assert.ok(Number.isFinite(shot.cursor.x)&&Number.isFinite(shot.cursor.y))
    assert.ok(Array.isArray(shot.zorder)&&shot.zorder.length>0&&shot.zorder.length<=16)
    assert.ok(shot.zorder.every(n=>Number.isSafeInteger(n)&&n>0));assert.ok(shot.zorder.includes(target)&&shot.zorder.includes(sibling))
  }
  assert.deepEqual(after.zorder,before.zorder);assert.equal(after.cursor.x,before.cursor.x);assert.equal(after.cursor.y,before.cursor.y)
  assert.equal(verdict.ok,true);assert.equal(verdict.delivery,"uia-pattern");assert.equal(verdict.target_hwnd,target)
  for(const key of ["focus_kept","zorder_kept","cursor_kept","no_leaked_input","background_verified"])assert.equal(verdict[key],true)
  assert.equal(verdict.no_leaked_input_kind,"derived");assert.equal(siblingMarker,false)
}
function replaceNoFocusLibrary572(args:string[],value:string):string[] {
  const positions=args.flatMap((arg,i)=>arg==="-NoFocusLibrary"?[i]:[])
  assert.equal(positions.length,1,"actual production adapter must supply one private library argument")
  const i=positions[0];assert.ok(i+1<args.length)
  const result=[...args];result[i+1]=value;return result
}
// Read PE metadata only. These helpers never load or execute a binary.
function peInfo572(bytes:Buffer):{pe:number;machine:number;optional:number;sections:number;table:number} {
  assert.ok(bytes.length>=64&&bytes.toString("ascii",0,2)==="MZ")
  const pe=bytes.readUInt32LE(60);assert.ok(pe>=64&&pe+24<=bytes.length)
  assert.equal(bytes.readUInt32LE(pe),0x4550)
  const sections=bytes.readUInt16LE(pe+6),size=bytes.readUInt16LE(pe+20),optional=pe+24
  assert.ok(sections>0&&sections<=96&&size>=120&&optional+size+sections*40<=bytes.length)
  return{pe,machine:bytes.readUInt16LE(pe+4),optional,sections,table:optional+size}
}
function withoutActionExport572(bytes:Buffer):Buffer {
  const info=peInfo572(bytes);assert.equal(info.machine,0x8664);assert.equal(bytes.readUInt16LE(info.optional),0x20b)
  const offset=(rva:number,length:number)=>{
    assert.ok(Number.isSafeInteger(rva)&&rva>=0&&length>0)
    for(let i=0;i<info.sections;i++){
      const at=info.table+i*40,va=bytes.readUInt32LE(at+12),size=bytes.readUInt32LE(at+16),raw=bytes.readUInt32LE(at+20)
      if(rva>=va&&rva-va+length<=size){const result=raw+rva-va;assert.ok(result+length<=bytes.length);return result}
    }
    throw new Error("UIA572_OWNED_EXPORT_RVA")
  }
  const directory=offset(bytes.readUInt32LE(info.optional+112),40),count=bytes.readUInt32LE(directory+24)
  assert.ok(count>0&&count<=4096)
  const names=offset(bytes.readUInt32LE(directory+32),count*4),matches:number[]=[]
  for(let i=0;i<count;i++){
    const at=offset(bytes.readUInt32LE(names+i*4),10)
    if(bytes.toString("ascii",at,at+10)==="CUiAction\0")matches.push(at)
  }
  assert.equal(matches.length,1,"the real built DLL must have one exact CUiAction export")
  const copy=Buffer.from(bytes);copy[matches[0]+8]="X".charCodeAt(0);return copy
}
async function runMode572(mode:Mode572,loader?:Loader572|"abi-invalid",t?:Pick<TestContext,"diagnostic">,surfaceLease?:SurfaceLease650):Promise<void> {
  surfaceLease?.checkpoint()
  const dir=mkdtempSync(path.join(tmpdir(),"uia-no-focus-native572-")),children:Child572[]=[]
  surfaceLease?.retain()
  const deadline=performance.now()+45_000
  const remaining=()=>{const ms=Math.floor(deadline-performance.now());assert.ok(ms>0,"original owned45s lifetime exhausted");return ms}
  const boundedRunner:PsRunner=(script,args,opts)=>{surfaceLease?.checkpoint();return runPs(script,args,{timeoutMs:Math.min(opts?.timeoutMs??15_000,remaining())})}
  const oracle=async(args:string[])=>{assert.ok(children.every(c=>!c.isClosed()));await boundedRunner(resolveWinScript("computer-bg-oracles.ps1"),args)}
  let primary:unknown
  /*UIA572_MODE_FAILURE_BEGIN*/let observedPhase572="UNKNOWN",readyRole572="UNKNOWN",beforeRole572="UNKNOWN",afterRole572="UNKNOWN",observedTarget572=0
  let actionStarted572=false,actionReturned572=false,markerSeen572=false
  const role572=(value:unknown,target:number,sibling:number)=>typeof value!=="number"||!Number.isSafeInteger(value)||value<0?"UNKNOWN":value===0?"NONE":value===target&&target>0?"TARGET":value===sibling&&sibling>0?"SIBLING":"OTHER"
  /*UIA572_MODE_FAILURE_END*/
  try{
    assert.equal(process.arch,"x64");assert.equal(existsSync(resolvePowerShellExe()),true,"real Windows PowerShell is mandatory")
    const marker=path.join(dir,"target.marker"),siblingMarker=path.join(dir,"sibling.marker")
    const launch=async(role:"target"|"sibling")=>{
      surfaceLease?.checkpoint()
      const ready=path.join(dir,role+".json"),owner=startMode572(["-Role",role,"-Mode",mode,"-Marker",role==="target"?marker:siblingMarker,"-Ready",ready],remaining());children.push(owner)
      const proof=await waitModeFile572(ready,owner,deadline,text=>JSON.parse(text) as {schema:number;hwnd:number;foreground:number;active:boolean;initialUnchanged:boolean})
      assert.equal(proof.schema,1);assert.ok(Number.isSafeInteger(proof.hwnd)&&proof.hwnd>0);assert.equal(proof.initialUnchanged,true)
      /*UIA572_MODE_FAILURE_BEGIN*/if(role==="target")observedTarget572=proof.hwnd;/*UIA572_MODE_FAILURE_END*/if(role==="sibling"){/*UIA572_MODE_FAILURE_BEGIN*/readyRole572=role572(proof.foreground,observedTarget572,proof.hwnd);/*UIA572_MODE_FAILURE_END*/assert.equal(proof.foreground,proof.hwnd);assert.equal(proof.active,true)}
      return proof.hwnd
    }
    const target=await launch("target"),sibling=await launch("sibling"),intent=modes572.find(value=>value.mode===mode)!;/*UIA572_MODE_FAILURE_BEGIN*/observedPhase572="READY_CONFIRMED";/*UIA572_MODE_FAILURE_END*/
    assert.equal(existsSync(marker),false);assert.equal(existsSync(siblingMarker),false)
    const hit=await new PsUiaLocator(boundedRunner).locate(target,intent.name);/*UIA572_MODE_FAILURE_BEGIN*/observedPhase572="LOCATOR_RETURNED";/*UIA572_MODE_FAILURE_END*/assert.ok(hit);assert.equal(hit.automationId,intent.automationId)
    const beforePath=path.join(dir,"before.json"),afterPath=path.join(dir,"after.json"),verdictPath=path.join(dir,"verdict.json")
    await oracle(["-Mode","snapshot","-TargetHwnd",String(target),"-Out",beforePath]);const before=JSON.parse(readFileSync(beforePath,"utf8")) as Snapshot572
    /*UIA572_MODE_FAILURE_BEGIN*/observedPhase572="BEFORE_CAPTURED";beforeRole572=role572(before.foreground,target,sibling);/*UIA572_MODE_FAILURE_END*/assert.equal(before.foreground,sibling)
    let runner=boundedRunner
    if(loader&&loader!=="abi-invalid"){
      let actualLibrary=""
      // The real adapter still constructs its production argv; only the one private
      // local library value is substituted for these owned negative cases.
      runner=async(script,args,opts)=>{
        if(path.basename(script)==="computer-uia-select.ps1") return boundedRunner(script,args,opts)
        assert.equal(path.basename(script),"computer-uia-act.ps1")
        const i=args.indexOf("-NoFocusLibrary");assert.ok(i>=0&&i+1<args.length);actualLibrary=args[i+1]
        const selected=path.join(dir,loader+".dll")
        if(loader==="invalid-pe")writeFileSync(selected,"OWNED_INERT_NOT_PE")
        if(loader==="wrong-architecture"){
          const x86=path.join(path.dirname(path.dirname(path.dirname(resolvePowerShellExe()))),"..","SysWOW64","version.dll")
          const bytes=readFileSync(x86),info=peInfo572(bytes);assert.equal(info.machine,0x14c);assert.equal(bytes.readUInt16LE(info.optional),0x10b);copyFileSync(x86,selected)
        }
        if(loader==="missing-symbol")writeFileSync(selected,withoutActionExport572(readFileSync(actualLibrary)))
        return boundedRunner(script,replaceNoFocusLibrary572(args,selected),opts)
      }
    }
    /*UIA572_MODE_FAILURE_BEGIN*/actionStarted572=true;/*UIA572_MODE_FAILURE_END*/if(loader==="abi-invalid"){
      const proof=JSON.parse(await boundedRunner(path.resolve("tests/fixtures/win/uia-no-focus-abi-572.ps1"),["-Hwnd",String(target),"-Library",resolveComputerUiaNoFocusDll()]))
      /*UIA572_MODE_FAILURE_BEGIN*/actionReturned572=true;observedPhase572="ACTION_RETURNED";/*UIA572_MODE_FAILURE_END*/assert.deepEqual(proof,{schema:1,kind:"UIA572_ABI_INVALID",cases:10,allRejected:true});assert.equal(existsSync(marker),false)
    }else{
    const result=await new PsInputInjector(runner,path.join(dir,"absent.stop")).invokeUia(target,hit.name,mode,{expectControlType:hit.controlType,expectAutomationId:hit.automationId,...(mode==="setvalue"?{value:"Owned572 中文 value"}:{}),...(mode==="scroll"?{direction:"down" as const,scrollAmount:1}:{})})
    /*UIA572_MODE_FAILURE_BEGIN*/actionReturned572=true;observedPhase572="ACTION_RETURNED";/*UIA572_MODE_FAILURE_END*/if(loader){assert.equal(result.ok,false);if(result.ok)throw new Error("UIA572_LOADER_ACCEPTED");assert.equal(result.reason,"pattern_unavailable");assert.equal(result.terminal,true);assert.equal(result.detail,"background UIA terminal refusal");assert.doesNotMatch(result.detail,/\.dll|uia-no-focus-native572/);assert.equal(existsSync(marker),false)}
    else{assert.equal(result.ok,true);if(!result.ok)throw new Error("UIA572_MODE_REFUSED");assert.equal(result.mode,mode);assert.equal(result.foreground,false);const receipt=await waitModeFile572(marker,children[0],deadline,text=>JSON.parse(text));/*UIA572_MODE_FAILURE_BEGIN*/markerSeen572=true;/*UIA572_MODE_FAILURE_END*/assert.deepEqual(receipt,{schema:1,role:"target",mode,changed:true});/*UIA572_MODE_FAILURE_BEGIN*/observedPhase572="TARGET_MARKER_CONFIRMED";/*UIA572_MODE_FAILURE_END*/}
    }
    await oracle(["-Mode","snapshot","-TargetHwnd",String(target),"-Out",afterPath]);/*UIA572_MODE_FAILURE_BEGIN*/observedPhase572="AFTER_CAPTURED";/*UIA572_MODE_FAILURE_END*/
    await oracle(["-Mode","compare","-Before",beforePath,"-After",afterPath,"-TargetHwnd",String(target),"-Delivery","uia-pattern","-Out",verdictPath])
    /*UIA572_MODE_FAILURE_BEGIN*/observedPhase572="COMPARE_RETURNED";const observedAfter572=JSON.parse(readFileSync(afterPath,"utf8")) as Snapshot572;afterRole572=role572(observedAfter572.foreground,target,sibling);/*UIA572_MODE_FAILURE_END*/assertModeDesktop572(target,sibling,before,observedAfter572,JSON.parse(readFileSync(verdictPath,"utf8")),existsSync(siblingMarker))
    assert.ok(children.every(c=>!c.isClosed()))
  }catch(error){primary=error}
  finally{/*UIA572_MODE_FAILURE_BEGIN*/if(primary!==undefined)try{t?.diagnostic("UIA572_MODE_FAILURE_OBSERVATION "+JSON.stringify({schema:1,phase:observedPhase572,readyRole:readyRole572,beforeRole:beforeRole572,afterRole:afterRole572,actionStarted:actionStarted572,actionReturned:actionReturned572,markerSeen:markerSeen572,childrenAlive:children.length===2&&children.every(c=>!c.isClosed())}))}catch{/* Passive observation cannot replace primary or prevent owned cleanup. */}/*UIA572_MODE_FAILURE_END*/await cleanupMode572(children,()=>rmSync(dir,{recursive:true,force:true}),primary,()=>{if(!existsSync(dir))surfaceLease?.settled()})}
  assert.equal(children.length,2);assert.ok(children.every(c=>c.isClosed()))
  console.log("UIA572_NO_FOCUS_NATIVE "+JSON.stringify({schema:1,mode,kind:loader??"action",targetChanged:loader===undefined,siblingUnchanged:true,allFourOracles:true,childrenClosed:2}))
}
// Registered by the original integration file so default canonical file workers
// cannot run two independent #572 foreground owners concurrently.
export function registerNoFocusNativeTests572():void {
for(const intent of modes572)test(`#572 actual no-focus ${intent.mode} changes target state with all four desktop oracles`,{skip:process.platform!=="win32",timeout:45_000},(t)=>withSurface650(t,(owned,lease)=>runMode572(intent.mode,undefined,owned,lease)))
for(const loader of ["missing","invalid-pe","wrong-architecture","missing-symbol"] as const)test(`#572 actual loader ${loader} refuses with no target action`,{skip:process.platform!=="win32",timeout:45_000},(t)=>withSurface650(t,(owned,lease)=>runMode572("setvalue",loader,owned,lease)))

test("#572 actual CUiAction ABI rejects ten invalid argument shapes without target action",{skip:process.platform!=="win32",timeout:45_000},(t)=>withSurface650(t,(owned,lease)=>runMode572("setvalue","abi-invalid",owned,lease)))

}

// Portable source helpers are controlled separately; no fabricated native PASS DTO.
test("#572 private library substitution changes exactly one existing argv value",()=>{
  const args=["-Hwnd","1","-NoFocusLibrary","OWNED_ORIGINAL.dll","-Name","Owned"]
  assert.deepEqual(replaceNoFocusLibrary572(args,"OWNED_NEGATIVE.dll"),["-Hwnd","1","-NoFocusLibrary","OWNED_NEGATIVE.dll","-Name","Owned"]);assert.equal(args[3],"OWNED_ORIGINAL.dll")
  for(const bad of [[],["-NoFocusLibrary"],["-NoFocusLibrary","a","-NoFocusLibrary","b"]])assert.throws(()=>replaceNoFocusLibrary572(bad,"owned.dll"))
})
test("#572 strict desktop oracle rejects foreground cursor zorder and sibling mutations",()=>{
  const before={foreground:2,cursor:{got:true,x:0,y:-1},zorder:[2,1]},verdict={ok:true,delivery:"uia-pattern",target_hwnd:1,focus_kept:true,zorder_kept:true,cursor_kept:true,no_leaked_input:true,background_verified:true,no_leaked_input_kind:"derived"}
  assertModeDesktop572(1,2,before,structuredClone(before),verdict,false)
  for(const after of [{...before,foreground:1},{...before,cursor:{got:false,x:0,y:-1}},{...before,cursor:{got:true,x:1,y:-1}},{...before,zorder:[1,2]}])assert.throws(()=>assertModeDesktop572(1,2,before,after,verdict,false))
  assert.throws(()=>assertModeDesktop572(1,2,before,before,verdict,true));assert.throws(()=>assertModeDesktop572(1,2,before,before,{...verdict,no_leaked_input_kind:"physical"},false))
})
test("#572 owned PE export fixture changes only the export name and rejects malformed metadata",()=>{
  // Synthetic metadata, explicitly not a native executable or a Windows success.
  const bytes=Buffer.alloc(1024);bytes.write('MZ');bytes.writeUInt32LE(128,60);bytes.writeUInt32LE(0x4550,128);bytes.writeUInt16LE(0x8664,132);bytes.writeUInt16LE(1,134);bytes.writeUInt16LE(240,148);bytes.writeUInt16LE(0x20b,152);bytes.writeUInt32LE(0x1000,264)
  bytes.writeUInt32LE(0x1000,404);bytes.writeUInt32LE(512,408);bytes.writeUInt32LE(512,412);bytes.writeUInt32LE(1,536);bytes.writeUInt32LE(0x1028,544);bytes.writeUInt32LE(0x1030,552);bytes.write('CUiAction\0',560,'ascii')
  const copy=withoutActionExport572(bytes);assert.equal(copy.toString('ascii',560,570),'CUiActioX\0');assert.equal(bytes.toString('ascii',560,570),'CUiAction\0');assert.deepEqual([...copy].flatMap((n,i)=>n!==bytes[i]?[i]:[]),[568])
  for(const mutate of [(b:Buffer)=>b.writeUInt16LE(0x14c,132),(b:Buffer)=>b.writeUInt32LE(0xffffffff,264),(b:Buffer)=>b.writeUInt32LE(4097,536),(b:Buffer)=>b.write('OTHERNAME\0',560,'ascii')]){const bad=Buffer.from(bytes);mutate(bad);assert.throws(()=>withoutActionExport572(bad))}
  for(const bad of [Buffer.alloc(0),Buffer.alloc(63),Buffer.from('OWNED_NOT_PE')])assert.throws(()=>peInfo572(bad))
})
test("#572 mode cleanup preserves primary and attempts every owned child",async()=>{
  const primary=new Error('OWNED_PRIMARY'),calls:string[]=[],owner=(id:string)=>({child:{ref(){calls.push(id+':ref')},kill(){calls.push(id+':kill');return true}},closed:Promise.resolve(),isClosed:()=>false,launchError:()=>undefined} as unknown as Child572)
  await assert.rejects(()=>cleanupMode572([owner('A'),owner('B')],()=>{calls.push('remove');throw new Error('OWNED_CLEANUP')},primary),e=>e===primary)
  assert.deepEqual(calls,['B:ref','B:kill','A:ref','A:kill','remove'])
})
