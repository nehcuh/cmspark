import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"

const root=path.resolve(__dirname,"../..")
const read=(name:string)=>fs.readFileSync(path.join(root,name),"utf8")
const build=require(path.join(root,"scripts/build-desktop-windows.mjs"))

function requireBootstrapObservation480(text:string){
 assert.match(text,/HANDLE input=bootstrap\.pipe;D480Acceptance::InheritanceScope identityScope;D480Acceptance::preConsume\(input\);/)
 assert.equal(text.split("HANDLE input=bootstrap.pipe;D480Acceptance::InheritanceScope identityScope;D480Acceptance::preConsume(input);").length,2)
 assert.match(text,/CloseHandle\(input\);D480Acceptance::inputClosed\(input\);bootstrap\.pipe=nullptr;/)
 const finish=text.indexOf("d480_client_finish(&bootstrap,parent)"),closed=text.indexOf("CloseHandle(input);D480Acceptance::inputClosed(input);"),parent=text.indexOf("d480_client_close(&bootstrap);D480Acceptance::parentCleared(parent);")
 assert.ok(finish>=0&&closed>finish&&parent>closed)
 assert.ok(text.indexOf("std::thread([parent]",parent)>parent)
}

test("Windows bootstrap adaptation observes actual close before any subsequent cleanup and keeps inverse bytes",()=>{
 const original=read("src/desktop/native/DesktopHost.cpp"),fixture=read("tests/fixtures/desktop-480/native-acceptance.cpp")
 const generated=build.desktopAcceptanceVariant("cpp",original,fixture)
 assert.equal(generated.inverse,original)
 for(const hostCRLF of[false,true])for(const fixtureCRLF of[false,true]){
  const host=original.replace(/\r\n/g,"\n").replace(/\n/g,hostCRLF?"\r\n":"\n"),controller=fixture.replace(/\r\n/g,"\n").replace(/\n/g,fixtureCRLF?"\r\n":"\n")
  assert.equal(build.desktopAcceptanceVariant("cpp",host,controller).inverse,host)
 }
 requireBootstrapObservation480(generated.source)
})

test("normal Windows compile plan links system RNG without shipping a test carrier",()=>{
 const plan=build.desktopWindowsCompilePlan({cl:"cl",root:"C:\\owned",output:"C:\\out",headers:"C:\\headers",generated:"C:\\generated",sdk:"C:\\sdk",nodeLib:"C:\\node.lib"})
 assert.ok(plan[0][1].includes("bcrypt.lib"))
 assert.equal(plan.flat(2).some((v:string)=>/malformed|inheritance|D480_/.test(v)),false)
 const {desktopIntegrity}=require(path.join(root,"scripts/desktop-artifacts.mjs"))
 assert.equal(typeof desktopIntegrity,"function")
})

test("all three malformed bodies come from the actual fixed carrier formatter and remain distinct parser refusals",()=>{
 const carrier=read("tests/fixtures/desktop-480/windows-malformed-bootstrap.c")
 const version=/const char\* version=([^;]+);/.exec(carrier)?.[1]
 const format=/snprintf\(body,sizeof\(body\),"((?:\\.|[^"\\])*)",url_json,version,/.exec(carrier)?.[1]
 const url=/const char\* url_json=([^;]+);/.exec(carrier)?.[1]
 assert.ok(version&&format&&url)
 const actualFormat=JSON.parse('"'+format+'"') as string
 const versions=[0,1,2].map(variant=>new Function("variant",`return ${version}`)(variant) as string)
 const bodies=versions.map((value,variant)=>actualFormat.replace("%s",new Function("variant",`return ${url}`)(variant) as string).replace("%s",value).replace("%llu","48"))
 assert.equal(JSON.parse(bodies[0]).protocol_version,true)
 for(const body of bodies.slice(1)){
  const keys=[...body.matchAll(/"((?:\\.|[^"\\])*)"\s*:/g)].map(m=>JSON.parse('"'+m[1]+'"'))
  assert.equal(keys.filter(key=>key==="protocol_version").length,2)
 }
 assert.notEqual(bodies[1],bodies[2]);assert.match(bodies[2],/\\u0070rotocol_version/)
 const nativeTest=read("tests/desktop-native-windows-480.test.ts")
 assert.match(nativeTest,/for\(const variant of \[0,1,2\]\)/)
 assert.match(nativeTest,/receipt\.boundExactChild,true/);assert.match(nativeTest,/receipt\.actualChildSettled,true/)
 assert.match(nativeTest,/receipt\.acknowledged,false/);assert.match(nativeTest,/receipt\.exitCode,15/)
})

test("actual owned peer-refusal oracle rejects missing capture, incomplete settlement and either side effect",()=>{
 const source=read("tests/desktop-native-windows-480.test.ts"),tree=ts.createSourceFile("owned.ts",source,ts.ScriptTarget.Latest,true)
 const fn=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="requireOwnedPeerRefusal")
 assert.ok(fn)
 const compiled=ts.transpileModule(fn.getText(tree),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
 const check=new Function("assert",compiled+";return requireOwnedPeerRefusal")(assert) as (value:unknown)=>void
 const good={actualChildCaptured:true,actualChildSettled:true,createdCount:1,peerQueryCalls:1,injectedPeerMismatches:1,targetParentDuplicates:0,bootstrapWriteBytes:0}
 check(good)
 for(const bad of[undefined,{}, {...good,actualChildCaptured:false},{...good,actualChildSettled:false},{...good,createdCount:0},{...good,peerQueryCalls:0},{...good,injectedPeerMismatches:0},{...good,targetParentDuplicates:1},{...good,bootstrapWriteBytes:1}])assert.throws(()=>check(bad))
})

test("controlled C fixture includes the actual header once and confines real launcher mismatch to the unshipped addon",()=>{
 const source=read("tests/fixtures/desktop-480/windows-bootstrap-controls.c")
 assert.equal((source.match(/#include "\.\.\/\.\.\/\.\.\/src\/desktop\/native\/windows-bootstrap\.h"/g)||[]).length,1)
 assert.equal((source.match(/#include "\.\.\/\.\.\/\.\.\/src\/desktop\/native\/launcher\.c"/g)||[]).length,1)
 assert.match(source,/#ifdef DESKTOP_BOOTSTRAP_REFUSAL_ADDON/)
 assert.match(source,/BOOL ok=GetNamedPipeClientProcessId\(pipe,pid\);peer_queries\+\+/)
 assert.match(source,/SYNCHRONIZE,FALSE,0\)/)
 assert.doesNotMatch(source,/OpenProcess\([^\n]*PROCESS_(?:ALL_ACCESS|TERMINATE|VM_|DUP_HANDLE)/)
 assert.match(source,/g\.late_final_creation&&g\.creation_calls==2\)g\.now=110/);assert.match(source,/g\.creation_calls==2&&g\.now==110&&child\.deadline==110/)
 const expected=(source.match(/\bCHECK\(/g)||[]).length-1;assert.ok(expected>0)
})

test("fixed carrier URL controls reach child validation with numeric foreign and zero-port payloads",()=>{
 const carrier=read("tests/fixtures/desktop-480/windows-malformed-bootstrap.c"),selection=/const char\* url_json=([^;]+);/.exec(carrier)?.[1]
 assert.ok(selection,"The fixed URL payloads must exist in the actual native carrier")
 const values=[3,4,5].map(variant=>new Function("variant",`return ${selection}`)(variant) as string)
 assert.deepEqual(values.map(value=>JSON.parse(value)),[1,"ws://foreign.invalid:1/desktop","ws://127.0.0.1:0/desktop"])
 const format=/snprintf\(body,sizeof\(body\),"((?:\\.|[^"\\])*)",url_json,version,/.exec(carrier)?.[1],version=/const char\* version=([^;]+);/.exec(carrier)?.[1]
 assert.ok(format&&version)
 const actualFormat=JSON.parse('"'+format+'"') as string
 for(let i=0;i<3;i++){
  const body=actualFormat.replace("%s",values[i]).replace("%s",new Function("variant",`return ${version}`)(i+3) as string).replace("%llu","48")
  const parsed=JSON.parse(body);assert.equal(parsed.url,JSON.parse(values[i]));assert.equal(parsed.protocol_version,1)
 }
 const nativeTest=read("tests/desktop-native-windows-480.test.ts")
 assert.match(nativeTest,/for\(const variant of \[3,4,5\]\)/)
})

test("bootstrap acceptance observation refuses missing, duplicate and reordered lifetime hooks",()=>{
 const original=read("src/desktop/native/DesktopHost.cpp"),fixture=read("tests/fixtures/desktop-480/native-acceptance.cpp")
 const source=build.desktopAcceptanceVariant("cpp",original,fixture).source
 const exact="HANDLE input=bootstrap.pipe;D480Acceptance::InheritanceScope identityScope;D480Acceptance::preConsume(input);"
 assert.equal(source.split(exact).length,2)
 for(const replacement of[
  "HANDLE input=bootstrap.pipe;D480Acceptance::preConsume(input);",
  exact+exact,
  "HANDLE input=bootstrap.pipe;D480Acceptance::preConsume(input);D480Acceptance::InheritanceScope identityScope;",
 ])assert.throws(()=>requireBootstrapObservation480(source.replace(exact,replacement)))
})
