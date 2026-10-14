import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { contextReadParams } from "../src/site-context/admission"
const root=path.resolve(__dirname,"../.."),repo=path.dirname(root)
const {loadOwnedCounterBridge}=require(path.join(root,"tests/fixtures/site-counter-533-browser.cjs"))

test("#533 trusted metadata option alone imposes active-tab proof; model flags stripped",()=>{
 assert.deepEqual(contextReadParams("list_tabs",{__site_context_tab_id:8,__site_context_require_active:true}),{})
 assert.deepEqual(contextReadParams("list_tabs",{__site_context_require_active:false},7,true),{__site_context_tab_id:7,__site_context_require_active:true})
 assert.deepEqual(contextReadParams("get_page_text",{__site_context_require_active:true},7,true),{})
})
test("#533 actual BrowserBridge metadata rejects active-tab/navigation changes across awaits",async()=>{
 const fixture=loadOwnedCounterBridge(repo)
 try {
  const params=contextReadParams("list_tabs",{},7,true)
  const good=await fixture.bridge.execute("list_tabs",params)
  assert.equal(good.success,true);assert.equal(good.data.site_target.origin,"https://scope533.test:8443");assert.doesNotMatch(JSON.stringify(good),/private|synthetic/)
  fixture.state.active=8
  assert.equal((await fixture.bridge.execute("list_tabs",params)).success,false)
  fixture.state.active=7;fixture.state.queries=0
  fixture.state.mutateAfterQuery=(count:number)=>{if(count===2)fixture.state.active=8}
  assert.equal((await fixture.bridge.execute("list_tabs",params)).success,false)
  fixture.state.active=7;fixture.state.queries=0
  fixture.state.mutateAfterQuery=(count:number)=>{if(count===2)fixture.state.url="https://scope533.test:8443/changed"}
  assert.equal((await fixture.bridge.execute("list_tabs",params)).success,false)
  assert.equal(fixture.state.effects,0)
 }finally{fixture.close()}
})
