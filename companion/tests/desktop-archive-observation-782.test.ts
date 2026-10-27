/** Inert source-derived controls. No host, desktop, provider or network calls. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import * as ts from "typescript"
import {createHash} from "node:crypto"
import {createArchiveFirstFailure782,archiveObservationInverse782} from "./fixtures/archive-first-failure-782"
const root=path.resolve(__dirname,"../.."),read=(file:string)=>fs.readFileSync(path.join(root,file),"utf8")
const frame=(id:unknown)=>({type:"system.ping",id})
test("782 Archive observation accepts only closed own-data markers and freezes the first failure",()=>{
 for(const origin of ["R","W","S"]){const limit=origin==="R"?10:origin==="W"?8:2;for(let site=1;site<=limit;site++){
  const f=createArchiveFirstFailure782("win32");f.observe(frame(`D476_ARCHIVE_FIRST_${origin}_${site}`));f.failure("D476_FAIL_ARCHIVE_PHASE");assert.deepEqual(f.snapshot(),{schema:1,first:{origin,site},kind:"ARCHIVE_PHASE"})
 }}
 let reads=0;const accessor=Object.defineProperty({type:"system.ping"},"id",{enumerable:true,get(){reads++;throw Error("OWNED_PRIVATE")}}),revoked=Proxy.revocable({},{});revoked.revoke()
 for(const value of [null,{},frame("D476_ARCHIVE_FIRST_R_11"),frame("D476_ARCHIVE_FIRST_W_9"),frame("D476_ARCHIVE_FIRST_S_3"),frame("D476_ARCHIVE_FIRST_R_01"),frame("D476_ARCHIVE_FIRST_R_1\n"),frame("D476_ARCHIVE_FIRST_R_1\r\n"),frame("D476_ARCHIVE_FIRST_R_1".repeat(20)),frame({toString(){reads++;return"D476_ARCHIVE_FIRST_R_1"}}),accessor,revoked.proxy,{...frame("D476_ARCHIVE_FIRST_R_1"),extra:true},{...frame("D476_ARCHIVE_FIRST_R_1"),[Symbol()]:true}]){
  const f=createArchiveFirstFailure782("win32");f.observe(value);assert.deepEqual(f.snapshot(),{schema:1,first:null,kind:null})
 }
 assert.equal(reads,0)
 const f=createArchiveFirstFailure782("win32");f.observe(frame("D476_ARCHIVE_FIRST_R_2"));f.observe(frame("D476_ARCHIVE_FIRST_W_4"));f.failure("D476_FAIL_SCRIPT");f.failure("DUPLICATE");f.observe(frame("D476_ARCHIVE_FIRST_S_1"));assert.deepEqual(f.snapshot(),{schema:1,first:{origin:"R",site:2},kind:"SCRIPT"});assert(Buffer.byteLength(JSON.stringify(f.snapshot()))<1024)
 for(const id of["D476_ARCHIVE_FIRST_W_1","D476_ARCHIVE_FIRST_S_1"]){const mac=createArchiveFirstFailure782("darwin");mac.observe(frame(id));assert.equal(mac.snapshot().first,null)}
})

function actualRenderer(){
 const file=read("tests/desktop-archive-renderer-476.test.ts"),ast=ts.createSourceFile("actual.ts",file,ts.ScriptTarget.Latest,true),functions=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&["element","renderer"].includes(n.name?.text??"")).map(n=>n.getText(ast)).join("\n")
 assert.equal(ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&["element","renderer"].includes(n.name?.text??"")).length,2)
 const scope:any={source:read,vm};vm.runInNewContext(ts.transpileModule(functions+"\nglobalThis.make=renderer",{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope,{timeout:1000});return scope.make()
}
test("782 actual Archive form preserves every refusal and emits its real fixed site first",()=>{
 for(let site=1;site<=10;site++){
  const f=actualRenderer();f.posted.length=0;f.ids.status.textContent="not ready";const source=read("tests/fixtures/desktop-476/archive-form.js"),phase=site===8?3:site===9?4:site===10?7:0
  assert.equal(source.split("let phase=0,").length,2)
  // Explicit CPU phase seam only; all actual predicates and emissions remain.
  const form=source.replace("let phase=0,",`let phase=${phase},`)
  if(site===2){const create=f.document.createElement;f.document.createElement=(id:string)=>{const el=create(id);el.focus=()=>{};return el}}
  vm.runInNewContext("const documentGeneration='owned-doc';"+form,{window:f.window,document:f.document},{timeout:1000})
  if(site===1||site===10)f.list([])
  if(site===2||site===3){f.list([{id:"native-archive-A",title:"owned"}]);if(site===3)f.document.events.keydown({key:"Enter",isTrusted:false,target:f.document.activeElement})}
  if(site===4)f.receive({type:"desktop.archive.state.result",id:"archive-state-owned",ok:false})
  if(site===5)f.receive({type:"desktop.archive.state.result",id:"archive-state-owned",ok:true,thread_id:"native-archive-A",state:{archived:false,activity:"idle"}})
  if(site===6)f.receive({type:"desktop.archive.set.result",ok:false})
  if(site===7)f.receive({type:"desktop.archive.set.result",ok:true,saved:true,thread_id:"native-archive-A",archived:true})
  if(site===8)f.receive({type:"desktop.archive.list.result",ok:false})
  if(site===9)f.receive({type:"desktop.thread.open.result",ok:false})
  const ids=f.posted.filter((x:any)=>x.type==="system.ping").map((x:any)=>x.id),marker=`D476_ARCHIVE_FIRST_R_${site}`,index=ids.indexOf(marker);assert(index>=0,`actual renderer R${site}`);assert.equal(ids[index+1],"D476_FAIL_ARCHIVE_PHASE");assert.equal(ids.filter((x:string)=>x.startsWith("D476_ARCHIVE_FIRST_")).length,1)
  const collector=createArchiveFirstFailure782("win32");for(const id of ids){collector.observe(frame(id));if(id==="D476_FAIL_ARCHIVE_PHASE")collector.failure(id)}assert.equal(collector.snapshot().first?.site,site)
 }
})

test("782 Windows original key branches emit their own site without extra API calls",()=>{
 for(const eol of ["\n","\r\n"]){
 const source=read("tests/fixtures/desktop-476/archive-acceptance.cpp").replace(/\r?\n/g,eol),begin="void D476ArchiveAcceptance::key(Desktop& h,WORD code){",body=source.split(begin)[1]?.split(/\r?\n}\r?\n/)[0];assert(body)
 const lower=(text:string)=>text.replaceAll("owner!=&h","owner!==h").replaceAll("->",".").replace("GUITHREADINFO info{};","let info={};").replace("sizeof(info)","64").replaceAll("&info","info").replace("const LPARAM scan=(LPARAM)","const scan=").replaceAll("((LPARAM)1","(1").replace("0xffu","0xff")
 const lowered=lower(body),prior=source.split(begin)[1]?.split("\n}\n")[0];assert(prior)
 if(eol==="\r\n"){assert.notEqual(prior,body);assert.throws(()=>new vm.Script("(function(){"+lower(prior)+"})()"),{name:"SyntaxError"})}else assert.equal(prior,body)
 for(const mode of["guard","move","foreground","gui","post","pass"]as const){
  const calls:string[]=[],sites:number[]=[],h={ready:true,generation:"owned",controller:{MoveFocus(){calls.push("move");return mode==="move"?-1:0}},window:{}},scope:any={h,owner:mode==="guard"?{}:h,loss:false,document:"owned",code:13,IsWindowVisible(){calls.push("visible");return true},SetForegroundWindow(){calls.push("foreground-request");return false},FAILED:(x:number)=>x<0,COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC:0,GetForegroundWindow(){calls.push("foreground-read");return mode==="foreground"?{}:h.window},GetGUIThreadInfo(_zero:number,info:any){calls.push("gui");info.hwndFocus={};return mode!=="gui"},GetAncestor(){calls.push("ancestor");return h.window},GA_ROOT:2,MapVirtualKeyW(){calls.push("scan");return 0},MAPVK_VK_TO_VSC:0,PostMessageW(){calls.push("post");return mode!=="post"},WM_KEYDOWN:1,WM_KEYUP:2,failure(_h:any,site:number){sites.push(site)}}
  vm.runInNewContext("(function(){"+lowered+"})()",scope,{timeout:1000});assert.deepEqual(sites,mode==="pass"?[]:[{guard:2,move:3,foreground:4,gui:5,post:6}[mode]])
  for(const name of["visible","foreground-request","move","foreground-read","gui","ancestor","scan"])assert(calls.filter(x=>x===name).length<=1,name)
  assert.equal(calls.filter(x=>x==="post").length,mode==="pass"?2:mode==="post"?1:0,"original short circuit is retained")
 }
 }
})

test("782 Archive-only generated script distinguishes immediate and completion refusal",async()=>{
 const {pathToFileURL}=require("node:url"),{desktopArchiveFixture}=await(new Function("u","return import(u)"))(pathToFileURL(path.join(root,"scripts/desktop-mcp-fixture.mjs")).href),built=desktopArchiveFixture("cpp",read("src/desktop/native/DesktopHost.cpp"),read("tests/fixtures/desktop-476/native-acceptance.cpp"),read("tests/fixtures/desktop-476/archive-form.js"),read("tests/fixtures/desktop-476/archive-acceptance.cpp"))
 for(const eol of ["\n","\r\n"]){
 const source=built.source.replace(/\r?\n/g,eol),declaration="void D476Acceptance::document(Desktop& h){",original=source.split(declaration)[1]?.split(/\r?\n}\r?\n/)[0];assert(original)
 const lower=(text:string)=>text.replace(/std::wstring code=[^\n]+;/,"const code='owned script';").replace("auto result=h.web->ExecuteScript(code.c_str(),Callback<ICoreWebView2ExecuteScriptCompletedHandler>([&h](HRESULT code,LPCWSTR)->HRESULT{","const result=execute(code,(code)=>{").replace("}).Get());","});").replaceAll("catch(...)","catch(_error)")
 const body=lower(original),prior=source.split(declaration)[1]?.split("\n}\n")[0];assert(prior)
 if(eol==="\r\n"){assert.notEqual(prior,original);assert.throws(()=>new vm.Script("(function(){"+lower(prior).replaceAll('L"','"')+"})()"),{name:"SyntaxError"})}else assert.equal(prior,original)
 for(const mode of["immediate","completion","success","observer-throws"]){const ids:string[]=[],trace:string[]=[],scope={S_OK:0,FAILED:(x:number)=>x<0,execute(_script:string,callback:(code:number)=>void){trace.push("execute");if(mode!=="immediate")callback(mode==="success"?0:-1);return mode==="immediate"?-1:0},emit(_h:any,id:string){if(mode==="observer-throws"&&id.startsWith("D476_ARCHIVE_FIRST_"))throw Error("OWNED");ids.push(id)},h:{}};vm.runInNewContext("(function(){"+body.replaceAll('L"','"')+"})()",scope,{timeout:1000});assert.equal(trace.length,1);assert.deepEqual(ids,mode==="success"?[]:mode==="observer-throws"?["D476_FAIL_SCRIPT"]:[`D476_ARCHIVE_FIRST_S_${mode==="immediate"?1:2}`,"D476_FAIL_SCRIPT"])}
 }
})

for(const eol of["\n","\r\n"])test(`782 new observation inverse preserves the entire previous native source ${eol==="\n"?"LF":"CRLF"}`,()=>{
 const raw=read("tests/desktop-native-thread-metadata-476.test.ts").replace(/\r?\n/g,eol),prior=archiveObservationInverse782(raw),expected=eol==="\n"?"33b233999fcfcc764b4882749d7264aa534fc45938ff717dd23bcc51f4cdeaa6":"f4b0ae09fd52e2ed4fa2d112ebc041e1a33e5323776ddc3e00291c1a4bea4675"
 assert.equal(createHash("sha256").update(prior).digest("hex"),expected);assert.throws(()=>archiveObservationInverse782(prior));assert.throws(()=>archiveObservationInverse782(raw+raw));assert.throws(()=>archiveObservationInverse782(raw.replace('timeout:20000','timeout:20001')));assert.equal(raw.split('{ llmKey: true }').length,2);assert.throws(()=>archiveObservationInverse782(raw.replace('{ llmKey: true }','{ llmKey: false }')));assert.throws(()=>archiveObservationInverse782(raw.replace(', { llmKey: true }','')));assert.throws(()=>archiveObservationInverse782(raw.replace(', { llmKey: true }',', { llmKey: true }, { llmKey: true }')))
})
