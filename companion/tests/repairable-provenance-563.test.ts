/** #563 finite ordinary refusals: actual producers, no effective native/installation authority. */
import test,{before,beforeEach,afterEach,after,mock}from"node:test"
import assert from"node:assert/strict"
import fs from"node:fs"
import path from"node:path"
import cp=require("node:child_process")
import net from"node:net"
import ts from"typescript"
import AdmZip from"adm-zip"
import{initDataDir}from"../src/config"
import{runComputerTask}from"../src/computer/executor"
import{skillInstallOverwritePreview}from"../src/skills/skill-install"
import{classifyError,ERROR_CODE_LEVELS,DEFAULT_NON_RECOVERABLE_CODES}from"../src/security"
import{decideSameToolFailure}from"../src/llm/same-tool-guard"
import{securityPolicy}from"../src/security-policy"
let effects=0,enumerations=0
const receipts:unknown[]=[]
before(async()=>{assert.ok(process.env.CMSPARK_DATA_DIR);await initDataDir()})
beforeEach(()=>{effects=0;enumerations=0;const no=()=>{effects++;throw Error("ROOT_NO_PROCESS_NETWORK_ISSUER")};for(const k of["spawn","spawnSync","exec","execSync","execFile","execFileSync","fork"]as const)mock.method(cp,k,no as any);mock.method(net.Socket.prototype,"connect",no as any);mock.method(globalThis,"fetch",no as any);for(const k of["issueToken","issueTokenFor"]as const)mock.method(securityPolicy,k,no as any)})
afterEach(()=>{assert.equal(effects,0);mock.restoreAll()})
after(()=>{if(process.env.CMSPARK_REPAIR_563_RECEIPT)fs.writeFileSync(process.env.CMSPARK_REPAIR_563_RECEIPT,JSON.stringify(receipts,null,2)+"\n")})
function ast(name:string){const f=path.join(process.cwd(),"src",name);return ts.createSourceFile(f,fs.readFileSync(f,"utf8"),ts.ScriptTarget.Latest,true)}
function one(s:ts.SourceFile,p:(n:ts.Node)=>boolean){const a:ts.Node[]=[];function walk(n:ts.Node){if(p(n))a.push(n);ts.forEachChild(n,walk)}walk(s);assert.equal(a.length,1);return a[0]}
const l2=ast("tool/l2-admission.ts")
const previewObject=one(l2,n=>ts.isVariableDeclaration(n)&&n.name.getText(l2)==="result"&&!!n.initializer?.getText(l2).includes('"SKILL_INSTALL_PREVIEW_FAILED"')&&!!n.initializer?.getText(l2).includes("prev.error"))as ts.VariableDeclaration
const previewWire=new Function("prev",ts.transpileModule("return "+previewObject.initializer!.getText(l2),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)
const dispatch=ast("tool/companion-dispatch.ts")
const refusal=one(dispatch,n=>ts.isIfStatement(n)&&n.expression.getText(dispatch)==="!result.success"&&n.thenStatement.getText(dispatch).includes("evidence_dir"))as ts.IfStatement
assert.ok(ts.isBlock(refusal.thenStatement));const returned=refusal.thenStatement.statements.find(ts.isReturnStatement);assert.ok(returned)
const computerWire=new Function("result",ts.transpileModule(returned.getText(dispatch),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)
function checkRepair(wire:any,code:string){assert.equal(wire.success,false);assert.equal(wire.data.error_code,code);assert.equal(classifyError(wire.error,{error_code:wire.data.error_code}),"recoverable");for(const failCount of[0,1,2,3,4])assert.deepEqual(decideSameToolFailure({failCount,threshold:3,alreadyPivoted:false,errorCode:code,errorText:wire.error+" element_not_found"}),{action:failCount<3?"count":"stop"})}
function deps(name:string,throws?:string,disabled=false):any{
 const deny=()=>{effects++;throw Error("ROOT_NATIVE_CONFIRM_EVIDENCE_FORBIDDEN")},proxy=new Proxy({},{get:()=>deny})
 return{now:()=>1234,config:{apps:{enabled:true,entries:{"win.app.root-owned":{token:"win.app.root-owned",kind:"gui",display_name:name,source:"user",policy:"manual",enabled:true,coordinateAllowed:true,added_at:"owned",exe:{path:"C:/RootOwned/NoExecution.exe",user_writable_dir:false}}}},computer:{coordinateEnabled:!disabled}},windows:{enumerateByExe:async()=>{enumerations++;if(throws)throw Error(throws);return[]}},capturer:proxy,locator:proxy,injector:proxy,securityEnv:proxy,confirm:deny,evidenceFactory:deny}
}
const params={task:"Root finite window check",app:"win.app.root-owned",actions:[{action:"wait"as const,ms:0}]}
for(const name of["Root ordinary","TIMEOUT","element_not_found","Security Block: permission denied"])test("#563 actual empty window enumeration metadata stable: "+name,async()=>{
 const actual=await runComputerTask(params,deps(name)),wire=JSON.parse(JSON.stringify(computerWire(actual)));receipts.push({case:"empty-window",name,actual,wire});checkRepair(wire,"COMPUTER_WINDOW_ABSENT");assert.equal(actual.completedActions,0);assert.deepEqual(actual.steps,[]);assert.equal(actual.evidenceDir,"");assert.equal(enumerations,1);assert.ok(wire.error.includes(name))
})
for(const reason of["ROOT_ENUMERATION_FAILURE","timeout","element_not_found"])test("#563 arbitrary enumeration catch keeps original mixed code: "+reason,async()=>{
 const actual=await runComputerTask(params,deps("Root owned",reason)),wire=JSON.parse(JSON.stringify(computerWire(actual)));receipts.push({case:"enumeration-throw",reason,actual,wire});assert.equal(actual.errorCode,"APP_WINDOW_NOT_FOUND");assert.equal(ERROR_CODE_LEVELS.has("APP_WINDOW_NOT_FOUND"),false);assert.equal(classifyError(wire.error,{error_code:wire.data.error_code}),reason==="ROOT_ENUMERATION_FAILURE"?"non_recoverable":"recoverable");assert.equal(enumerations,1)
})
test("#563 disabled coordinate gate still refuses before enumeration",async()=>{const actual=await runComputerTask(params,deps("Root owned",undefined,true));assert.equal(actual.errorCode,"COMPUTER_DISABLED");assert.equal(enumerations,0);receipts.push({case:"disabled",actual})})
function zip(names:string[],corrupt=false){const dir=fs.mkdtempSync(path.join(process.env.CMSPARK_DATA_DIR!,"root-zip-")),file=path.join(dir,"owned.zip");if(corrupt)fs.writeFileSync(file,"owned not a ZIP");else{const z=new AdmZip();for(const name of names)z.addFile(name,Buffer.from("---\nname: root-owned-inert\n---\nNo executable or installation."));z.writeZip(file)}return file}
for(const folder of["root-ordinary","TIMEOUT","element_not_found","Security Block permission denied"])test("#563 real multi-SKILL ZIP corrective refusal: "+folder,()=>{
 const prev=skillInstallOverwritePreview({zip_path:zip(["skills/first/SKILL.md","skills/"+folder+"/SKILL.md"])}),wire=JSON.parse(JSON.stringify(previewWire(prev)));receipts.push({case:"zip-ambiguity",folder,prev,wire});assert.ok(prev.error);assert.equal(prev.candidates?.length,2);assert.equal(prev.name,null);assert.equal(prev.overwrite,false);checkRepair(wire,"SKILL_INSTALL_INPUT_AMBIGUOUS");assert.equal(wire.error,prev.error);assert.deepEqual(wire.data.candidates,prev.candidates);assert.match(wire.data.hint_zh,/解压/)
})
test("#563 no-SKILL ZIP keeps generic preview failure unchanged",()=>{const prev=skillInstallOverwritePreview({zip_path:zip(["readme.txt"])}),wire=JSON.parse(JSON.stringify(previewWire(prev)));assert.equal(prev.error,"Zip must contain a SKILL.md file");assert.equal(wire.data.error_code,"SKILL_INSTALL_PREVIEW_FAILED");assert.equal(ERROR_CODE_LEVELS.has("SKILL_INSTALL_PREVIEW_FAILED"),false);assert.equal(classifyError(wire.error,{error_code:wire.data.error_code}),"non_recoverable");receipts.push({case:"zip-no-skill",prev,wire})})
test("#563 single SKILL ZIP remains a successful read-only preview",()=>{const prev=skillInstallOverwritePreview({zip_path:zip(["skills/one/SKILL.md"])});assert.equal(prev.name,"root-owned-inert");assert.equal(prev.error,undefined);assert.equal(prev.overwrite,false);receipts.push({case:"zip-single",prev})})
test("#563 corrupt ZIP preview keeps best-effort original shape",()=>{const prev=skillInstallOverwritePreview({zip_path:zip([],true)});assert.deepEqual(prev,{mode:"zip",name:null,dest_path:null,overwrite:false});receipts.push({case:"zip-corrupt",prev})})
test("#563 two provenance rows join161 without broad mixed-code regrading",()=>{assert.equal(ERROR_CODE_LEVELS.size, 169);assert.equal(DEFAULT_NON_RECOVERABLE_CODES.length,59);for(const code of["COMPUTER_WINDOW_ABSENT","SKILL_INSTALL_INPUT_AMBIGUOUS"])assert.equal(ERROR_CODE_LEVELS.get(code),"recoverable");for(const code of["APP_WINDOW_NOT_FOUND","SKILL_INSTALL_PREVIEW_FAILED","INVALID_ACTION"])assert.equal(ERROR_CODE_LEVELS.has(code),false);for(const code of["APP_NOT_WHITELISTED","APP_COORDINATE_DENIED","SKILL_INSTALL_SOURCE_ZONE_DENIED"])assert.notEqual(ERROR_CODE_LEVELS.get(code),"recoverable")})
