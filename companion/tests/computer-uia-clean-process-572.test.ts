import test from "node:test"
import assert from "node:assert/strict"
import { PsInputInjector } from "../src/computer/win-adapters"
import { performance } from "node:perf_hooks"
import type { PsRunner } from "../src/host-use/win/powershell"
const selected = { schema: 1, hwnd: 777, rootPid: 123, selectedPid: 123, runtime: [42],
  controlTypeId: 50000, controlType: "Button", automationId: "owned", name: "SubmitTest",
  x: 12, y: 13, bbox: { x: 10, y: 11, w: 4, h: 4 }, patterns: [{ mode: "invoke", state: "ready" }] }
test("#572 actual adapter selects then acts in two direct runner calls under remaining budget", async () => {
  const calls: {script:string;args:string[];timeout:number|undefined}[]=[]
  const runner:PsRunner=async(script,args,opts)=>{
    calls.push({script,args,timeout:opts?.timeoutMs})
    if(script.endsWith("computer-uia-select.ps1")) return JSON.stringify(selected)
    assert.ok(script.endsWith("computer-uia-act.ps1"),"action must use a clean fixed script")
    assert.equal(args.includes("-SelectionJson"),true)
    assert.equal(args[args.indexOf("-StopFile")+1],"owned.stop")
    return JSON.stringify({ok:true,mode:"invoke",tried:["invoke:ok"]})
  }
  const result=await new PsInputInjector(runner,"owned.stop").invokeUia(777,"SubmitTest","invoke",{expectAutomationId:"owned"})
  assert.equal(result.ok,true)
  assert.equal(calls.length,2)
  assert.ok(calls[0].script.endsWith("computer-uia-select.ps1"))
  assert.ok(calls.every(c=>typeof c.timeout==="number"&&c.timeout>0&&c.timeout<=15000))
  assert.ok(calls[1].timeout!<=calls[0].timeout!)
})

function fixedResult(mode = "invoke") { return JSON.stringify({ok:true,mode,tried:[mode+":ok"]}) }
function receipt(mode = "invoke", value?: string) {
  const modes=mode==="auto"?["invoke",...(value?["setvalue"]:[]),"select","toggle"]:[mode]
  return {...selected,patterns:modes.map(mode=>({mode,state:"ready"}))}
}
async function withClock(run:(advance:(ms:number)=>void)=>Promise<void>) {
  const descriptor=Object.getOwnPropertyDescriptor(performance,"now")
  let now=1000
  Object.defineProperty(performance,"now",{configurable:true,value:()=>now})
  try { await run(ms=>{now+=ms}) }
  finally { if(descriptor) Object.defineProperty(performance,"now",descriptor); else delete (performance as any).now }
}
test("#572 actual total deadline leaves only6000ms after9000ms selection",async()=>{
  await withClock(async advance=>{
    const timeouts:number[]=[]
    const runner:PsRunner=async(script,_args,opts)=>{
      timeouts.push(opts!.timeoutMs!)
      if(script.endsWith("select.ps1")){advance(9000);return JSON.stringify(selected)}
      assert.equal(opts!.timeoutMs,6000)
      return fixedResult()
    }
    assert.equal((await new PsInputInjector(runner).invokeUia(777,"SubmitTest","invoke")).ok,true)
    assert.deepEqual(timeouts,[15000,6000])
  })
})
test("#572 exhausted total deadline never calls action or passes timeout0",async()=>{
  await withClock(async advance=>{
    let calls=0
    const runner:PsRunner=async(_script,_args,opts)=>{calls++;assert.equal(opts!.timeoutMs,15000);advance(15000);return JSON.stringify(selected)}
    const result=await new PsInputInjector(runner).invokeUia(777,"SubmitTest","invoke")
    assert.equal(result.ok,false);if(!result.ok)assert.equal(result.terminal,true)
    assert.equal(calls,1)
  })
})
test("#572 selection rejection cannot trigger an action or retry",async()=>{
  const mutations=[null,[],{...selected,extra:true},{...selected,hwnd:778},{...selected,rootPid:0},
    {...selected,selectedPid:0x100000000},{...selected,runtime:[]},{...selected,runtime:[1.5]},
    {...selected,runtime:Array(65).fill(1)},{...selected,controlTypeId:0},
    {...selected,controlType:"Edit"},{...selected,automationId:"OTHER"},
    {...selected,name:"a\0b"},{...selected,name:""},{...selected,controlType:""},{...selected,bbox:{...selected.bbox,w:150001}},
    {...selected,patterns:{mode:"invoke",state:"ready"}},{...selected,patterns:[{mode:"toggle",state:"ready"}]},
    {...selected,patterns:[{mode:"invoke",state:"OTHER"}]},{...selected,patterns:[{mode:"invoke",state:"ready",extra:true}]}]
  for(const data of mutations){
    let calls=0
    const result=await new PsInputInjector(async()=>{calls++;return JSON.stringify(data)}).invokeUia(777,"SubmitTest","invoke",{expectControlType:"Button",expectAutomationId:"owned"})
    assert.equal(result.ok,false);if(!result.ok)assert.equal(result.terminal,true);assert.equal(calls,1)
  }
  for(const text of ["{foreign-secret", "x".repeat(16385)]){
    let calls=0
    const result=await new PsInputInjector(async()=>{calls++;return text}).invokeUia(777,"SubmitTest","invoke")
    assert.equal(result.ok,false);assert.equal(calls,1);assert.equal(JSON.stringify(result).includes("foreign-secret"),false)
  }
})
test("#572 action keeps all modes, UTF16 values, private tuple and sameStopFile",async()=>{
  for(const mode of ["invoke","setvalue","select","toggle","scroll","auto"] as const){
    const calls:{script:string;args:string[]}[]=[]
    const runner:PsRunner=async(script,args)=>{
      calls.push({script,args})
      if(script.endsWith("select.ps1"))return JSON.stringify(receipt(mode,"原值😀"))
      const data=JSON.parse(args[args.indexOf("-SelectionJson")+1])
      assert.deepEqual(data.runtime,[42]);assert.equal(data.rootPid,123);assert.equal(data.selectedPid,123)
      assert.equal(args[args.indexOf("-Value")+1],"原值😀")
      assert.equal(args[args.indexOf("-Direction")+1],"left")
      assert.equal(args[args.indexOf("-ScrollAmount")+1],"2")
      return fixedResult(mode==="auto"?"invoke":mode)
    }
    assert.equal((await new PsInputInjector(runner,"owned.stop").invokeUia(777,"SubmitTest",mode,{value:"原值😀",direction:"left",scrollAmount:2})).ok,true)
    assert.equal(calls.length,2)
    for(const c of calls)assert.deepEqual(c.args.slice(-2),["-StopFile","owned.stop"])
    assert.equal(calls[0].args.includes("-NoFocusLibrary"),false)
    assert.equal(calls[1].args.filter(a=>a==="-NoFocusLibrary").length,1)
  }
})
test("#572 action terminal stops after one action, preserving fixed error and no retry",async()=>{
  for(const code of ["STOPPED","UIA_ELEMENT_MISMATCH","UIA_METHOD_FAILED","UIA_PATTERN_UNAVAILABLE"]){
    let calls=0
    const runner:PsRunner=async script=>{calls++;if(script.endsWith("select.ps1"))return JSON.stringify(selected);throw Object.assign(new Error("owned"),{stderr:"UIA_TERMINAL:"+code})}
    const result=await new PsInputInjector(runner).invokeUia(777,"SubmitTest","invoke")
    assert.equal(result.ok,false);if(!result.ok){assert.equal(result.terminal,true);assert.equal(result.detail,"background UIA terminal refusal")}
    assert.equal(calls,2)
  }
})
test("#572 stop during selection cannot start action",async()=>{
  let calls=0
  const result=await new PsInputInjector(async()=>{calls++;throw Object.assign(new Error("owned"),{stderr:"STOPPED:owned"})},"owned.stop").invokeUia(777,"SubmitTest","invoke")
  assert.equal(result.ok,false);if(!result.ok)assert.equal(result.reason,"aborted");assert.equal(calls,1)
})
