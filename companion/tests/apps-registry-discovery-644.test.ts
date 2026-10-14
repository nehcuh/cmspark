/** Controlled parser inputs from the approved #644 process contract, not a
 * claimed native Registry recording. The Windows integration runs real producer. */
import test from "node:test"
import assert from "node:assert/strict"
import * as api from "../src/apps/enumerate"
const legacy={name:"Legacy",source:"startapps",aumid:"Owned644!App"}
const candidate={name:"Owned Registry",source:"registry",path:"C:\\Owned644\\App.exe"}
const runner=(data:any)=>async(_script:string,args:string[],opts:any)=>{assert.deepEqual(args,[]);assert.equal(opts.timeoutMs,20000);return JSON.stringify(data)}
const detailed=(data:any)=>{const fn=(api as any).enumerateAppsDetailed;assert.equal(typeof fn,"function","typed producer detail must exist");return fn(runner(data))}
test("#644 actual legacy parser admits finite registry provenance without changing old array API",async()=>{
 const result=await api.enumerateApps(runner({apps:[legacy,candidate]}));assert.deepEqual(result,[legacy,candidate])
})
test("#644 detailed real parser preserves zero-row OUTPUT_LIMIT and nullable legacy",async()=>{
 const result=await detailed({apps:[legacy],registry_summary:{status:"partial",reasons:["OUTPUT_LIMIT"]}})
 assert.deepEqual(result.candidates,[legacy]);assert.deepEqual(result.registry_summary,{status:"partial",reasons:["OUTPUT_LIMIT"]})
 assert.equal((await detailed({apps:[legacy]})).registry_summary,null)
})
test("#644 finite complete/unavailable schema and malformed optional summaries retain old rows",async()=>{
 for(const summary of [{status:"complete",reasons:[]},{status:"unavailable",reasons:["ACCESS_DENIED"]}])assert.deepEqual((await detailed({apps:[legacy],registry_summary:summary})).registry_summary,summary)
 for(const summary of [{status:"complete",reasons:["OUTPUT_LIMIT"]},{status:"partial",reasons:[]},{status:"unavailable",reasons:["KEY_LIMIT"]},{status:"partial",reasons:["OUTPUT_LIMIT","OUTPUT_LIMIT"]},{status:"partial",reasons:["PRIVATE_RAW"]},{status:"partial",reasons:["OUTPUT_LIMIT"],raw:"private"}]){
  const result=await detailed({apps:[legacy],registry_summary:summary});assert.deepEqual(result.candidates,[legacy]);assert.equal(result.registry_summary,null)
 }
 assert.equal((await detailed({apps:[candidate],registry_summary:{status:"unavailable",reasons:["REGISTRY_READ_FAILED"]}})).registry_summary,null)
})
test("#644 malformed registry rows never coerce source/AUMID/control/namespace fields",async()=>{
 const rows=[{...candidate,aumid:"Owned!Bad"},{...candidate,bundleId:"bad"},{...candidate,path:"relative.exe"},{...candidate,path:"C:\\app.dll"},{...candidate,path:"\\\\server\\app.exe"},{...candidate,name:"bad\nprivate"},{...candidate,path:"C:\\app.exe:stream"},{...candidate,source:"REGISTRY"},{...candidate,path:"C:\\\\app.exe"}]
 assert.deepEqual(await api.enumerateApps(runner({apps:[legacy,...rows]})),[legacy])
})
test("#644 whole payload/transport failures remain rejection, not partial fake success",async()=>{
 await assert.rejects(api.enumerateApps(runner({apps:null})),/apps array/)
 await assert.rejects(api.enumerateApps(async()=>"not JSON"),/invalid JSON/)
 await assert.rejects(api.enumerateApps(async()=>{throw Error("OWNED_TRANSPORT_FAILURE")}),/OWNED_TRANSPORT_FAILURE/)
})
