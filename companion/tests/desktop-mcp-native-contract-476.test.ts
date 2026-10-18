/** CPU source/build projection only; never a native compiler or OS UI claim. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
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
test("#476 issued method set4 keeps six reads and controller-only decision outside renderer",()=>{
 assert.equal(DESKTOP_READ_METHODS.length,6);assert.equal(DESKTOP_METHOD_SET_VERSION,5);assert.deepEqual([...DESKTOP_RENDERER_METHODS],[...DESKTOP_READ_METHODS,"desktop.mcp.edit","desktop.mcp.save","desktop.thread.metadata.edit","desktop.thread.metadata.save","desktop.thread.create","desktop.thread.open","desktop.chat.send","desktop.chat.stop","desktop.resource.read","desktop.resource.import","desktop.resource.update","desktop.resource.remove"]);assert.deepEqual([...DESKTOP_NATIVE_METHODS],[...DESKTOP_RENDERER_METHODS,"desktop.confirmation.decision"])
 const builder=read("scripts/build-desktop-native.mjs");assert.equal(builder.includes("DESKTOP_RENDERER_METHODS.map"),true);assert.equal(builder.includes("DESKTOP_READ_METHODS.map"),false)
 const launcher=read("src/desktop/native/launcher.c");assert.equal((launcher.match(/issued_method_set_version\\":5/g)||[]).length,2);assert.equal((launcher.match(/protocol_version\\":1/g)||[]).length,2)
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
test("#476 dialog hosted variants preserve complete production source and fail on missing hooks",async()=>{
 const {desktopDialogFixture}=await(new Function("u","return import(u)"))(pathToFileURL(path.join(root,"scripts/desktop-mcp-fixture.mjs")).href)
 for(const language of["cpp","swift"]){const original=read("src/desktop/native/DesktopHost."+language),fixture=read("tests/fixtures/desktop-476/native-acceptance."+language),form=read("tests/fixtures/desktop-476/dialog-form.js"),dialog=read("tests/fixtures/desktop-476/dialog-acceptance."+language);for(const eol of["\n","\r\n"]){const source=original.replace(/\r\n/g,"\n").replace(/\n/g,eol),built=desktopDialogFixture(language,source,fixture,form,dialog);assert.equal(built.inverse,source);assert.ok(built.source.includes("D476_DIALOG_SEND_KEY"));assert.ok(built.source.includes("D476.dialog.offline"));assert.equal(built.source.includes("D476_FORM_SOURCE"),false)}assert.throws(()=>desktopDialogFixture(language,original.replace(language==="cpp"?"class Desktop {":"D476_MISSING_NEVER_IN_SOURCE","missing"),fixture,form,language==="cpp"?dialog:""));assert.throws(()=>desktopDialogFixture(language,original+original,fixture,form,dialog))}
 const hosted=read("tests/desktop-native-thread-metadata-476.test.ts");assert.ok(hosted.includes('acceptance/dialog'));assert.ok(hosted.includes('createNativeDialogRuntime'));assert.ok(hosted.includes('nativeKeys":7'));assert.ok(hosted.includes('lostUserAck":true'));assert.equal(read("tests/fixtures/desktop-476/dialog-form.js").includes("KeyboardEvent("),false)
})

test("#476 dialog native acceptance cannot pass on normal close or missing real offline receipt",async()=>{const source=read("tests/desktop-native-thread-metadata-476.test.ts"),index=source.indexOf("// Same Node file");assert.ok(index>0);const end=source.indexOf("// Same native file/surface lease",index);assert.ok(end>index);const statements=source.slice(index,end).split(/\r?\n/).filter(line=>line.trimStart().startsWith("assert.equal(await Promise.race([exit,"));assert.equal(statements.length,1);const actual=statements[0].replace(/new Promise<never>/g,"new Promise"),check=(code:number)=>vm.runInNewContext(`(async()=>{${actual}})()`,{assert,Promise,Error,exit:Promise.resolve(code),failure:new Promise(()=>{}),t:{signal:{addEventListener(){}}}},{timeout:1000})as Promise<void>;for(const n of[0,1,64,75,77])await assert.rejects(check(n));await check(76)})

for(const language of ["cpp","swift"])test(`#476 ${language} actual native key guards permit denial then a separate streamed request`,()=>{
 const source=read("tests/fixtures/desktop-476/dialog-acceptance."+language)
 let keys=0,saves=0,stops=0
 for(const [suffix,after]of [["NEW", ""],["SEND","save"],["FOLLOWUP","save"],["STOP","stop"],["OTHER",""],["REOPEN",""],["LOST_ACK","save"]]as const){
  const row=source.split(/\r?\n/).find(line=>line.includes('"D476_DIALOG_'+suffix+'_KEY"'));assert.ok(row,suffix)
  const match=language==="cpp"?row.match(/\{if\(([^)]+)\)\{failure\(h\);return;\}keys=(\d);/):row.match(/\{guard (.+) else\{failure\(h\);return\};keys=(\d);/)
  assert.ok(match,"select the actual bounded native guard and next key state")
  const expression=match[1].replaceAll(",","&&"),evaluate=new Function("keys","saves","stops","return "+expression)
  const allowed=(k:number,s:number,t:number)=>Boolean(evaluate(k,s,t))===(language==="swift")
  assert.equal(allowed(keys,saves,stops),true,suffix+" guard must permit its genuine predecessor")
  assert.equal(allowed(keys+10,saves,stops),false,suffix+" stale key state must refuse")
  keys=Number(match[2]);if(after==="save")saves++;if(after==="stop")stops++
 }
 assert.deepEqual({keys,saves,stops},{keys:7,saves:3,stops:1})
})

test("actual Windows launcher snprintf bytes bind both memcmp receivers and every malformed field carrier",()=>{
 function format(source:string,name:string){const values=[...source.matchAll(new RegExp('snprintf\\(\\s*'+name+'\\s*,\\s*sizeof\\('+name+'\\)\\s*,\\s*("(?:\\\\.|[^"\\\\])*")','g'))].map(m=>JSON.parse(m[1])as string).filter(s=>s.includes('"issued_method_set_version"')&&s.includes('"parent_handle"'));assert.equal(values.length,1,name+" actual unique parent format");return values[0]}
 function printf(fmt:string,args:string[]){let i=0;const s=fmt.replace(/%llu|%s/g,()=>{assert.ok(i<args.length);return args[i++]});assert.equal(i,args.length);return s}
 const launcher=format(read("src/desktop/native/launcher.c"),"boot"),handle="7000";
 for(const [name,cap,secret]of[["synchronize-handle-probe.c","11".repeat(16),"22".repeat(32)],["windows-inheritance.c","01".repeat(16),"02".repeat(32)]]){const source=read("tests/fixtures/desktop-480/"+name),actual=printf(launcher,[cap,secret,"ws://127.0.0.1:1/desktop",handle]),expected=printf(format(source,"expected"),[handle]);assert.equal(actual,expected,name+" complete bootstrap/parent/newline bytes");assert.equal(JSON.parse(actual).issued_method_set_version,DESKTOP_METHOD_SET_VERSION);assert.ok(source.includes("memcmp(bytes,expected,"));assert.ok(source.includes("d480_client_finish(&bootstrap,parent)"));assert.ok(source.includes("d480_client_close(&bootstrap)"));const oldVersion=actual.replace('"issued_method_set_version":'+DESKTOP_METHOD_SET_VERSION,'"issued_method_set_version":'+(DESKTOP_METHOD_SET_VERSION-1));assert.notEqual(oldVersion,expected,"stale methodset cannot pass equality")}
 const malformed=read("tests/fixtures/desktop-480/windows-malformed-bootstrap.c"),body=format(malformed,"body"),expression=(name:string)=>{const match=malformed.match(new RegExp('const char\\* '+name+'=([^;]+);'));assert.ok(match,name);return match[1]};
 for(let variant=0;variant<6;variant++){const version=vm.runInNewContext(expression("version"),{variant},{timeout:1000}),url=vm.runInNewContext(expression("url_json"),{variant},{timeout:1000}),actual=printf(body,[url,version,handle]);assert.ok(actual.includes('"issued_method_set_version":'+DESKTOP_METHOD_SET_VERSION),"malformed probe reaches its own intended field with current methodset");if(variant===0)assert.equal(JSON.parse(actual).protocol_version,true);if(variant===1)assert.equal((actual.match(/"protocol_version"/g)||[]).length,2);if(variant===2)assert.ok(actual.includes('"\\u0070rotocol_version"'));if(variant===3)assert.equal(JSON.parse(actual).url,1);if(variant===4)assert.equal(JSON.parse(actual).url,"ws://foreign.invalid:1/desktop");if(variant===5)assert.equal(JSON.parse(actual).url,"ws://127.0.0.1:0/desktop")}
 assert.ok(malformed.includes("d480_server_send(&channel,pi.hProcess,pi.dwProcessId,body,(DWORD)length)"));assert.ok(malformed.includes("channel.deadline=case_started+5000u"));
})
