/** #563 D3: actual typed producer and AST outward/adapter expressions.
 * Controlled PsRunner errors, no native input, usable token, authorized task or model.
 */
import test, {before, after, mock} from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import ts from "typescript"
const owned=fs.mkdtempSync(path.join(os.tmpdir(),"cmspark-occlusion-563-"))
process.env.CMSPARK_DATA_DIR=owned
process.env.CMSPARK_SKIP_LOGIN_ENV="1"
process.env.CMSPARK_SECURITY_SECRET="OWNED_D3_NO_TOKEN"
let security:typeof import("../src/security"),native:typeof import("../src/computer/win-adapters"),guard:typeof import("../src/llm/same-tool-guard")
let effects=0,tokens=0
before(async()=>{
 const cp=require("node:child_process")
 for(const key of ["spawn","spawnSync","exec","execSync","execFile","execFileSync"])mock.method(cp,key,()=>{effects++;throw Error("NATIVE_EFFECT_FORBIDDEN")})
 security=await import("../src/security");native=await import("../src/computer/win-adapters");guard=await import("../src/llm/same-tool-guard")
 const policy=(await import("../src/security-policy")).securityPolicy
 for(const key of ["issueToken","issueTokenFor"] as const){assert.equal(typeof policy[key],"function");mock.method(policy,key,()=>{tokens++;throw Error("TOKEN_ISSUANCE_FORBIDDEN")})}
})
after(()=>{assert.equal(effects,0);assert.equal(tokens,0);mock.restoreAll();fs.rmSync(owned,{recursive:true,force:true})})
function source(relative:string){const file=path.resolve(__dirname,"../../src",relative);return ts.createSourceFile(file,fs.readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true)}
function unique(root:ts.Node,predicate:(n:ts.Node)=>boolean){const found:ts.Node[]=[];function walk(n:ts.Node){if(predicate(n))found.push(n);ts.forEachChild(n,walk)}walk(root);assert.equal(found.length,1,"unique actual producer/adapter AST required");return found[0]}
function body(args:string[],statement:string){return new Function(...args,ts.transpileModule(statement,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText)}
const executor=source("computer/executor.ts"),fail=unique(executor,n=>ts.isVariableDeclaration(n)&&n.name.getText(executor)==="fail")
const returned=unique(fail,n=>ts.isReturnStatement(n)&&n.getText(executor).includes("errorCode: err.code"))
const taskResult=body(["err","taskId","evidence","steps","params"],returned.getText(executor))
const dispatcher=source("tool/companion-dispatch.ts")
const envelope=body(["result"],unique(dispatcher,n=>ts.isReturnStatement(n)&&n.getText(dispatcher).includes("error_code: result.errorCode")).getText(dispatcher))
const adapter=source("llm/adapter.ts")
const variable=(name:string)=>unique(adapter,n=>ts.isVariableDeclaration(n)&&n.name.getText(adapter)===name) as ts.VariableDeclaration
const classify=body(["toolResult","toolName","classifyError"],`const classCode=${variable("classCode").initializer!.getText(adapter)};const errorLevel=${variable("errorLevel").initializer!.getText(adapter)};const failCode=${variable("failCode").initializer!.getText(adapter)};return {classCode,errorLevel,failCode};`)
const halt=unique(adapter,n=>ts.isIfStatement(n)&&n.expression.getText(adapter)==='errorLevel === "security" || errorLevel === "non_recoverable"') as ts.IfStatement
const shouldHalt=body(["errorLevel"],"return "+halt.expression.getText(adapter))
const threshold=Number(variable("MAX_SAME_TOOL_RECOVERABLE_FAILURES").initializer!.getText(adapter));assert.equal(threshold,3)
async function actualRefusal(prefix:"OCCLUDED"|"FOCUSLOST",basename:string){
 let calls=0
 const detail=prefix==="OCCLUDED"?"point (110,150) lands on hwnd 9, not target hwnd 424242 — injection would be intercepted by another window":"target hwnd 424242 is not foreground after force — refusing to inject"
 const injector=new native.PsInputInjector(async(file,args)=>{calls++;assert.equal(path.basename(file),"computer-input.ps1");assert.deepEqual(args,["-Hwnd","424242","-Action","click","-X","110","-Y","150"]);throw Object.assign(Error("DECLARED_NATIVE_STDERR"),{stderr:`${prefix}:${detail} | fg_hwnd=9 fg_pid=8 fg_exe=${basename} target_hwnd=424242`})})
 const {ComputerError}=await import("../src/computer/types")
 let error:InstanceType<typeof ComputerError>|undefined
 try{await injector.click(424242,110,150,"click")}catch(err){assert.ok(err instanceof ComputerError);error=err}
 assert.ok(error);assert.equal(calls,1)
 const code=prefix==="OCCLUDED"?"CLICK_OCCLUDED":"FOCUS_LOST";assert.equal(error.code,code)
 // Genuine return bodies, not invented task/tool dictionaries. Full executor
 // admission, capture/cleanup and dispatcher authorization are not run here.
 const result=taskResult(error,"owned-task",null,[],{actions:[{action:"click",x:110,y:150}]})
 const wire=JSON.parse(JSON.stringify(envelope(result)))
 assert.equal(wire.success,false);assert.equal(wire.error,error.message);assert.equal(wire.data.error_code,code)
 return {wire,classified:classify(wire,"host_computer",security.classifyError)}
}
for(const prefix of ["OCCLUDED","FOCUSLOST"] as const)for(const basename of ["ordinary","timeout","element_not_found-helper","not found-helper","security block","permission denied","forbidden","ordinary\n timeout"]){
 test(`#563 D3 ${prefix} actual outward refusal stays intrinsic with ${JSON.stringify(basename)}`,async()=>{
  const {wire,classified}=await actualRefusal(prefix,basename)
  assert.equal(classified.classCode,wire.data.error_code);assert.equal(classified.errorLevel,"non_recoverable");assert.equal(shouldHalt(classified.errorLevel),true)
  const decision=(count:number,issued=false)=>guard.decideSameToolFailure({failCount:count,threshold,errorCode:classified.failCode,errorText:wire.error,alreadyPivoted:issued})
  assert.equal(decision(2).action,"count","standalone helper budget unchanged; live hard refusal halts before helper")
  assert.equal(decision(3).action,"stop");assert.equal(decision(3,true).action,"stop")
 })
}
test("#563 D3 unknown/no-code fallback, default59 and safety/correction families stay unchanged",()=>{
 assert.equal(security.DEFAULT_NON_RECOVERABLE_CODES.length,59)
 for(const errorCode of [undefined,"OWNED_UNKNOWN_CODE"]){assert.equal(security.classifyError("timeout element_not_found",{error_code:errorCode}),"recoverable");assert.equal(guard.decideSameToolFailure({failCount:3,threshold,errorCode,errorText:"timeout element_not_found",alreadyPivoted:false}).action,"pivot");assert.equal(guard.decideSameToolFailure({failCount:3,threshold,errorCode,errorText:"timeout element_not_found",alreadyPivoted:true}).action,"stop")}
 for(const message of ["user_gesture required","task authorization required","host_read requires L2 security_token confirmation"])assert.equal(security.classifyError(message),"non_recoverable")
 assert.equal(security.classifyError("Security Block",{error_code:"COOKIE_TRUST_DENIED"}),"security")
 assert.equal(security.ERROR_CODE_LEVELS.has("OUT_OF_BOUNDS"),false);assert.equal(security.ERROR_CODE_LEVELS.has("TYPE_NO_EFFECT"),false)
})
test("#563 D3 actual dispatcher denies missing/invalid tokens before native admission",async()=>{
 const api=await import("../src/tool/companion-dispatch")
 api.bindCompanionDispatchRuntime({getThreadManager:()=>null,getSkillEngine:()=>null,getComputerEstopEnsureOverride:()=>()=>{effects++;throw Error("ADMISSION_FORBIDDEN")}} as any)
 for(const token of [undefined,"OWNED_INVALID_NOT_ISSUED"]){const produced=await api.executeCompanionTool("host_computer",{app:"win.app.test",task:"owned refusal",actions:[{action:"click",target:"owned target"}],security_token:token});const wire=JSON.parse(JSON.stringify(produced));assert.equal(wire.success,false);assert.match(wire.error,token?/Invalid or expired security token/:/requires L2 security_token confirmation/);assert.equal(security.classifyError(wire.error),"non_recoverable")}
})
