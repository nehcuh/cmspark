/** CPU projections of actual unshipped acceptance hooks; no native execution. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import { pathToFileURL } from "node:url"
const root=path.resolve(__dirname,"../.."),read=(p:string)=>fs.readFileSync(path.join(root,p),"utf8")
const expected=["D476_SAVE_APPROVED","D476_SAVE_DENIED","D476_NATIVE_DONE","D476_FAIL_ROW","D476_FAIL_APPROVE","D476_FAIL_DENY","D476_FAIL_ADD","D476_FAIL_RENDERER_SECRET"]
for(const language of ["cpp","swift"])test(`#476 ${language} acceptance observes finite renderer receipts before production ID remapping`,async()=>{
 const original=read("src/desktop/native/DesktopHost."+language),fixture=read("tests/fixtures/desktop-476/native-acceptance."+language)
 const {desktopMcpFixture}=await(new Function("u","return import(u)"))(pathToFileURL(path.join(root,"scripts/desktop-mcp-fixture.mjs")).href)
 const variant=desktopMcpFixture(language,original,fixture,read("tests/fixtures/desktop-476/native-form.js"))
 const hook=language==="cpp"?"D476Acceptance::renderer(*this,frame);":"D476Acceptance.renderer(self,f);"
 const remap=language==="cpp"?'frame.Remove(L"generation");put(frame,L"id",id);send(frame);':'var out=f;if type=="desktop.chat.stop"{out["run_id"]=requests["desktop.chat.send"]?.nativeId};out.removeValue(forKey:"generation");out["id"]=id;transmit(out,to:socket)'
 assert.ok(variant.source.includes(hook+remap),"test receipt hook must precede the unchanged real remapping/send")
 assert.equal(variant.inverse,original)
 const start=fixture.indexOf(language==="cpp"?"void D476Acceptance::renderer(":"static func renderer(")
 assert.ok(start>=0)
 const body=fixture.slice(start),list=body.match(/(?:names\[\]|names:Set<String>)=\{?\[([^\n]+)\]/) || body.match(/names\[\]=\{([^\n]+)\}/)
 assert.ok(list,"closed receipt allowlist")
 const ids=[...list[1].matchAll(/(?:L)?"(D476_[A-Z_]+)"/g)].map(m=>m[1]);assert.deepEqual(ids,expected)
 assert.ok(body.includes(language==="cpp"?'text(frame,L"type")!=L"system.ping"':'f["type"] as? String=="system.ping"'))
 // Execute the actual form's post helper. A production UUID is deliberately
 // different: backend D476 filtering alone loses every renderer receipt.
 const form=read("tests/fixtures/desktop-476/native-form.js"),post=form.match(/const post=id=>(.+);\r?\n/);assert.ok(post)
 const emitted:string[]=[],normal:string[]=[],window={webkit:{messageHandlers:{desktop:{postMessage:(f:any)=>{if(f.type==="system.ping"&&ids.includes(f.id))emitted.push(f.id);normal.push("owned-remapped-uuid")}}}}}
 const context=vm.createContext({window,documentGeneration:"owned-current"});vm.runInContext("const post=id=>"+post[1]+";",context,{timeout:1000})
 for(const id of expected)vm.runInContext("post("+JSON.stringify(id)+")",context,{timeout:1000})
 assert.deepEqual(emitted,expected);assert.equal(normal.filter(id=>id.startsWith("D476_")).length,0)
 vm.runInContext('post("D476_UNKNOWN");post("arbitrary")',context,{timeout:1000});assert.equal(emitted.length,expected.length)
 assert.equal(normal.length,expected.length+2,"normal forwarding still occurs; observation never consumes requests")
})
test("#476 hosted scenario explicitly requests its real authenticated window without changing native visibility assertions",()=>{
 const source=read("tests/desktop-native-mcp-476.test.ts")
 assert.ok(source.includes('onAuthenticated:host=>{auth=true;windowRequested=channel.window(host,"workspace")}'))
 assert.ok(source.includes('assert.equal(windowRequested,true)'))
 assert.ok(source.includes('timeout:20000'))
 assert.ok(read("tests/fixtures/desktop-476/native-acceptance.swift").includes('p.alert.window.isVisible,p.alert.window.sheetParent === h.window'))
 assert.ok(read("tests/fixtures/desktop-476/native-acceptance.cpp").includes('IsWindowVisible(h.confirmation->window)'))
})
function actualNativeFinally(source:string):string{
 const file=ts.createSourceFile("actual-native-mcp.ts",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
 assert.equal((file as any).parseDiagnostics.length,0,"the actual native fixture must parse")
 const callbacks:ts.ArrowFunction[]=[]
 function findCallback(node:ts.Node){
  if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==="withSurface650"){
   const callback=node.arguments[1];assert.ok(callback&&ts.isArrowFunction(callback)&&ts.isBlock(callback.body));callbacks.push(callback)
  }
  ts.forEachChild(node,findCallback)
 }
 findCallback(file);assert.equal(callbacks.length,1,"select the unique actual leased native callback")
 const blocks:ts.Block[]=[]
 function hasCall(block:ts.Block,receiver:string,method:string){return block.statements.some(statement=>{
  if(!ts.isExpressionStatement(statement)||!ts.isCallExpression(statement.expression))return false
  const member=statement.expression.expression
  return ts.isPropertyAccessExpression(member)&&ts.isIdentifier(member.expression)&&member.expression.text===receiver&&member.name.text===method
 })}
 function findFinally(node:ts.Node){
  if(ts.isTryStatement(node)&&node.finallyBlock&&hasCall(node.finallyBlock,"manager","rejectAll")&&hasCall(node.finallyBlock,"fs","rmSync"))blocks.push(node.finallyBlock)
  ts.forEachChild(node,findFinally)
 }
 findFinally(callbacks[0].body);assert.equal(blocks.length,1,"select the complete actual native cleanup, including the lease")
 return source.slice(blocks[0].getStart(file)+1,blocks[0].end-1)
}
for(const eol of ["LF","CRLF"] as const)for(const diagnosticThrows of [false,true])test(`#476 actual native finally preserves primary failure and all cleanup when diagnosticThrows=${diagnosticThrows} ${eol}`,async()=>{
 const source=read("tests/desktop-native-mcp-476.test.ts"),body=actualNativeFinally(eol==="CRLF"?source.replace(/\r?\n/g,"\r\n"):source)
 const calls:string[]=[],primary=new Error("owned-primary"),diagnostic=new Error("owned-diagnostic")
 const process={stdout:{write:()=>{calls.push("diagnostic");if(diagnosticThrows)throw diagnostic}},env:{CMSPARK_DATA_DIR:"owned-current"}}
 const ctx={process,primary,auth:false,windowRequested:false,receipts:new Set(),settled:true,exit:Promise.resolve(0),old:"owned-original",dir:"owned-current",
  surfaceLease:{retain:()=>calls.push("surfaceRetain"),settled:()=>calls.push("surfaceSettled")},
  manager:{rejectAll:()=>calls.push("rejectAll")},child:{terminate:()=>calls.push("terminate")},
  channel:{wss:{clients:[{terminate:()=>calls.push("socketTerminate")}],close:(cb:()=>void)=>{calls.push("channelClose");cb()}}},
  legacy:{close:(cb:()=>void)=>{calls.push("legacyClose");cb()}},server:{close:(cb:()=>void)=>{calls.push("serverClose");cb()}},fs:{rmSync:()=>calls.push("rmOwned")}}
 const script="async function execute(ctx:any){const {process,primary,auth,windowRequested,receipts,settled,exit,old,dir,manager,child,channel,legacy,server,fs,surfaceLease}=ctx;try{throw primary}finally{"+body+"}}"
 const run=new Function("ctx",ts.transpileModule(script,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText+";return execute(ctx)")
 await assert.rejects(run(ctx),e=>e===primary,"passive diagnostics cannot replace the original test failure")
 assert.deepEqual(calls,["surfaceRetain","diagnostic","rejectAll","terminate","socketTerminate","channelClose","legacyClose","serverClose","rmOwned","surfaceSettled"])
 assert.equal(process.env.CMSPARK_DATA_DIR,"owned-original")
})
test("#476 cleanup projection refuses a missing or ambiguous leased callback",()=>{
 const source=read("tests/desktop-native-mcp-476.test.ts")
 assert.throws(()=>actualNativeFinally(source.replace('manager.rejectAll("disconnect")','manager.otherMethod("disconnect")')))
 assert.throws(()=>actualNativeFinally(source+"\n"+source))
})
