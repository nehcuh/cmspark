/** CPU source/build projection only; never a native compiler or OS UI claim. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { DESKTOP_READ_METHODS, DESKTOP_RENDERER_METHODS, DESKTOP_NATIVE_METHODS, DESKTOP_METHOD_SET_VERSION } from "../src/desktop/capabilities"
const root=path.resolve(__dirname,"../.."),read=(p:string)=>fs.readFileSync(path.join(root,p),"utf8")
for (const language of ["cpp", "swift"] as const) test(`#476 ${language} metadata controller bounds the renderer id before UUID replacement`,()=>{
 const source=read("src/desktop/native/DesktopHost."+language)
 const guard=source.split("\n").find(line=>language==="cpp"
  ? line.includes('if(type==L"desktop.thread.metadata.edit"||type==L"desktop.thread.metadata.save")')
  : line.includes('if ["desktop.thread.metadata.edit","desktop.thread.metadata.save"].contains(type)'))
 assert.ok(guard,"the actual metadata admission guard must exist")
 // CPU source contract only. UTF-16 matches the Companion id.length boundary;
 // no native execution or security approval is implied by this projection.
 assert.ok(guard.includes(language==="cpp" ? 'text(frame,L"id").size()>200' : 'id.utf16.count<=200'))
})
test("#476 issued method set3 keeps six reads and controller-only decision outside renderer",()=>{
 assert.equal(DESKTOP_READ_METHODS.length,6);assert.equal(DESKTOP_METHOD_SET_VERSION,3);assert.deepEqual([...DESKTOP_RENDERER_METHODS],[...DESKTOP_READ_METHODS,"desktop.mcp.edit","desktop.mcp.save","desktop.thread.metadata.edit","desktop.thread.metadata.save"]);assert.deepEqual([...DESKTOP_NATIVE_METHODS],[...DESKTOP_RENDERER_METHODS,"desktop.confirmation.decision"])
 const builder=read("scripts/build-desktop-native.mjs");assert.equal(builder.includes("DESKTOP_RENDERER_METHODS.map"),true);assert.equal(builder.includes("DESKTOP_READ_METHODS.map"),false)
 const launcher=read("src/desktop/native/launcher.c");assert.equal((launcher.match(/issued_method_set_version\\":3/g)||[]).length,2);assert.equal((launcher.match(/protocol_version\\":1/g)||[]).length,2)
})
test("#476 two unshipped native acceptance variants preserve complete production bytes",async()=>{
 const {desktopMcpFixture}=await (new Function("u","return import(u)"))(pathToFileURL(path.join(root,"scripts/desktop-mcp-fixture.mjs")).href)
 const oldBuild=await (new Function("u","return import(u)"))(pathToFileURL(path.join(root,"scripts/build-desktop-windows.mjs")).href)
 const form=read("tests/fixtures/desktop-476/native-form.js")
 for(const language of ["cpp","swift"]){const original=read("src/desktop/native/DesktopHost."+language),fixture=read("tests/fixtures/desktop-476/native-acceptance."+language),built=desktopMcpFixture(language,original,fixture,form)
  assert.equal(built.inverse,original);for(const eol of ["\n","\r\n"]){const variant=original.replace(/\r\n/g,"\n").replace(/\n/g,eol);assert.equal(desktopMcpFixture(language,variant,fixture,form).inverse,variant);assert.equal(oldBuild.desktopAcceptanceVariant(language,variant,read("tests/fixtures/desktop-480/native-acceptance."+language)).inverse,variant)};assert.ok(built.source.length>original.length);assert.equal(built.source.includes("D476_FORM_SOURCE"),false)
  for(const bad of [original+original,original.replace(language==="cpp"?"class Desktop {":"self.retireConfirmation(response == .alertSecondButtonReturn)}","missing anchor")])assert.throws(()=>desktopMcpFixture(language,bad,fixture,form))
 }
})
test("#476 private confirmation paths return before ordinary WebView reply projection",()=>{
 for(const [file,request,terminal,generic]of [
  ["cpp",'if(type==L"desktop.confirmation.request"){begin_confirmation(flat(body));return;}','if(type==L"desktop.confirmation.resolved")','auto request=std::find_if(requests.begin()'],
  ["swift",'if type=="desktop.confirmation.request" {beginConfirmation(f,task);return}','if type=="desktop.confirmation.resolved"','guard let id=f["id"] as? String,let pair='],
 ]){const source=read("src/desktop/native/DesktopHost."+file);assert.ok(source.indexOf(request)>0);assert.ok(source.indexOf(terminal)>source.indexOf(request));assert.ok(source.indexOf(generic)>source.indexOf(terminal))}
 const cpp=read("src/desktop/native/DesktopHost.cpp"),swift=read("src/desktop/native/DesktopHost.swift")
 assert.ok(cpp.indexOf("auto value=std::move(confirmation)")<cpp.indexOf("DestroyWindow(value->window)"));assert.ok(swift.indexOf("confirmation=nil;p.timer?.invalidate()")<swift.indexOf("parent.endSheet"))
 assert.match(cpp,/value->epoch==epoch&&value->generation==generation&&wall_ms\(\)<value->deadline/);assert.match(swift,/socket === p.task,p.generation==generation,Date\(\).timeIntervalSince1970\*1000<p.deadline/)
})
