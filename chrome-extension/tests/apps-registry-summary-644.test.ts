import test from "node:test"
import assert from "node:assert/strict"
import {agentReducer,initialState} from "../src/sidepanel/store/agentStore"
const row={name:"Owned",source:"registry",path:"C:\\Owned644\\App.exe"}
const apply=(state:any,candidates:any,registrySummary?:any)=>agentReducer(state,{type:"SET_APPS_CANDIDATES",candidates,registrySummary} as any) as any
test("#644 current candidate result stores validated partial0 atomically and clears old summary",()=>{
 const partial={status:"partial",reasons:["OUTPUT_LIMIT"]}
 let state=apply(initialState,[],partial);assert.deepEqual(state.appRegistrySummary,partial)
 state=apply(state,null);assert.equal(state.appRegistrySummary,null)
 state=apply(state,[],partial);state=apply(state,[row]);assert.equal(state.appRegistrySummary,null)
 assert.equal(state.appCandidates[0].source,"registry")
})
test("#644 invalid/contradictory view metadata never becomes a trusted note",()=>{
 for(const summary of [{status:"complete",reasons:["OUTPUT_LIMIT"]},{status:"partial",reasons:[]},{status:"unavailable",reasons:["VALUE_LIMIT"]},{status:"partial",reasons:["OUTPUT_LIMIT","OUTPUT_LIMIT"]},{status:"partial",reasons:["PRIVATE"]},{status:"partial",reasons:["OUTPUT_LIMIT"],private:"path"},{status:"unavailable",reasons:["ACCESS_DENIED"]}])assert.equal(apply(initialState,[row],summary).appRegistrySummary,null)
})
