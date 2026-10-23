import { computerFailureEnvelope } from "./helpers/computer-failure-envelope"
/** #563 finite draft refusals: actual schema/executor/wire/consumer, no native authority. */
import test, { before, beforeEach, afterEach, after, mock } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import cp = require("node:child_process")
import net from "node:net"
import ts from "typescript"
import { initDataDir } from "../src/config"
import { runComputerTask, type ComputerExecutorDeps } from "../src/computer/executor"
import { ComputerError, MAX_TYPE_TEXT_CHARS } from "../src/computer/types"
import { parseComputerJson, assertInjectOk } from "../src/computer/darwin-adapters"
import { tryParseToolArgs } from "../src/bridge/tool-schemas"
import { classifyError, ERROR_CODE_LEVELS, DEFAULT_NON_RECOVERABLE_CODES } from "../src/security"
import { decideSameToolFailure } from "../src/llm/same-tool-guard"
import { securityPolicy } from "../src/security-policy"
const receipts: unknown[] = []
let effects = { process: 0, network: 0, issuer: 0, native: 0, confirm: 0, evidence: 0 }, gateReads = 0
let dispatch: typeof import("../src/tool/companion-dispatch")
before(async () => { assert.ok(process.env.CMSPARK_DATA_DIR); await initDataDir(); dispatch = await import("../src/tool/companion-dispatch") })
beforeEach(() => {
 effects = { process: 0, network: 0, issuer: 0, native: 0, confirm: 0, evidence: 0 }; gateReads = 0
 for (const k of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const) mock.method(cp, k, (() => { effects.process++; throw Error("OWNED_PROCESS_FORBIDDEN") }) as any)
 mock.method(net.Socket.prototype, "connect", (() => { effects.network++; throw Error("OWNED_NETWORK_FORBIDDEN") }) as any)
 mock.method(globalThis, "fetch", (() => { effects.network++; throw Error("OWNED_FETCH_FORBIDDEN") }) as any)
 for (const k of ["issueToken", "issueTokenFor"] as const) mock.method(securityPolicy, k, (() => { effects.issuer++; throw Error("OWNED_ISSUER_FORBIDDEN") }) as any)
})
afterEach(() => { assert.deepEqual(effects, { process: 0, network: 0, issuer: 0, native: 0, confirm: 0, evidence: 0 }); mock.restoreAll() })
after(() => { if (process.env.CMSPARK_DRAFT_563_RECEIPT) fs.writeFileSync(process.env.CMSPARK_DRAFT_563_RECEIPT, JSON.stringify(receipts, null, 2) + "\n") })
function tree(name: string) { const file=path.join(process.cwd(),"src",name); return ts.createSourceFile(file,fs.readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true) }
function one(ast: ts.SourceFile, predicate: (n: ts.Node) => boolean) { const found: ts.Node[]=[];function walk(n: ts.Node) { if(predicate(n)) found.push(n);ts.forEachChild(n,walk) };walk(ast);assert.equal(found.length,1);return found[0] }
const ds=tree("tool/companion-dispatch.ts")
const refusal=one(ds,n=>ts.isIfStatement(n)&&n.expression.getText(ds)==="!result.success"&&n.thenStatement.getText(ds).includes("evidence_dir")) as ts.IfStatement
assert.ok(ts.isBlock(refusal.thenStatement)); const ret=refusal.thenStatement.statements.find(ts.isReturnStatement);assert.ok(ret)
const wireFromActual = computerFailureEnvelope(ts.transpileModule(ret.getText(ds),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)
const ad=tree("llm/adapter.ts")
const code=one(ad,n=>ts.isVariableDeclaration(n)&&n.name.getText(ad)==="classCode")
const level=one(ad,n=>ts.isVariableDeclaration(n)&&n.name.getText(ad)==="errorLevel"&&!!n.initializer?.getText(ad).includes("classifyError(toolResult.error"))
const halt=one(ad,n=>ts.isIfStatement(n)&&n.expression.getText(ad)==='errorLevel === "security" || errorLevel === "non_recoverable"') as ts.IfStatement
const consume=new Function("toolResult","toolName","classifyError",ts.transpileModule(`const ${code.getText(ad)};const ${level.getText(ad)};return{classCode,errorLevel,stop:${halt.expression.getText(ad)}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)
function deps(): ComputerExecutorDeps {
 const trap=(kind:"native"|"confirm"|"evidence")=>(()=>{effects[kind]++;throw Error("OWNED_"+kind+"_FORBIDDEN")})
 const inert=new Proxy({},{get:()=>trap("native")})
 const d:any={now:()=>1000,capturer:inert,locator:inert,injector:inert,windows:inert,securityEnv:inert,confirm:trap("confirm"),evidenceFactory:trap("evidence")}
 Object.defineProperty(d,"config",{get(){gateReads++;return{apps:{enabled:true,entries:{}},computer:{coordinateEnabled:false}}}})
 return d
}
const base={task:"Owned draft",app:"win.app.owned",actions:[{action:"screenshot"}]}
const ordinary: Array<{name:string;patch:any;schema:boolean}> = [
 {name:"blank task",patch:{task:" "},schema:true},
 {name:"anchorless click",patch:{actions:[{action:"click"}]},schema:true},
 {name:"cmd alias",patch:{actions:[{action:"key",keys:["cmd","enter"]}]},schema:true},
 {name:"anchorless double_click",patch:{actions:[{action:"double_click"}]},schema:true},
 {name:"anchorless right_click",patch:{actions:[{action:"right_click"}]},schema:true},
 {name:"meta alias",patch:{actions:[{action:"key",keys:["meta","enter"]}]},schema:true},
 {name:"command alias",patch:{actions:[{action:"key",keys:["command","enter"]}]},schema:true},
 // Direct-executor negatives: schema rejects these; never represented as schema-admitted.
 {name:"nonstring task",patch:{task:42},schema:false},
 {name:"empty draft",patch:{actions:[]},schema:false},
 {name:"malformed action",patch:{actions:[null]},schema:false},
 {name:"empty type",patch:{actions:[{action:"type",text:""}]},schema:false},
 {name:"empty chord",patch:{actions:[{action:"key",keys:[]}]},schema:false},
 {name:"long chord",patch:{actions:[{action:"key",keys:["ctrl","alt","shift","win","enter"]}]},schema:false},
 {name:"nonstring key",patch:{actions:[{action:"key",keys:[42]}]},schema:false},
 ...["timeout","element_not_found","Security Block: permission denied"].map(key=>({name:"poison key "+key,patch:{actions:[{action:"key",keys:[key]}]},schema:false})),
 {name:"scroll coordinates",patch:{actions:[{action:"scroll",x:1.5,y:0,delta:1}]},schema:false},
 {name:"scroll zero delta",patch:{actions:[{action:"scroll",x:0,y:0,delta:0}]},schema:false},
 {name:"drag coordinate",patch:{actions:[{action:"drag",x:0,y:0,x2:0.5,y2:0}]},schema:false},
 {name:"negative wait",patch:{actions:[{action:"wait",ms:-1}]},schema:false},
 {name:"unknown action",patch:{actions:[{action:"owned_unknown"}]},schema:false},
]
for(const row of ordinary)test("#563 actual Computer draft corrective refusal: "+row.name,async()=>{
 const raw={...base,...row.patch},parsed=tryParseToolArgs("host_computer",raw);assert.equal(parsed.ok,row.schema)
 const params=parsed.ok?parsed.args:raw
 const actual=await runComputerTask(params as any,deps()); const wire=JSON.parse(JSON.stringify(wireFromActual(actual)));const consumer=consume(wire,"host_computer",classifyError)
 receipts.push({name:row.name,schemaAccepted:parsed.ok,actual,wire,consumer,gateReads,effects:{...effects}})
 assert.equal(actual.success,false);assert.equal(actual.completedActions,0);assert.equal(actual.evidenceDir,"");assert.deepEqual(actual.steps,[]);assert.equal(gateReads,0)
 assert.equal(actual.errorCode,"COMPUTER_INPUT_INVALID");assert.equal(wire.success,false);assert.equal(wire.error,actual.error);assert.equal(wire.data.error_code,actual.errorCode)
 assert.deepEqual(consumer,{classCode:"COMPUTER_INPUT_INVALID",errorLevel:"recoverable",stop:false})
 for(const failCount of [0,1,2,3,4])assert.deepEqual(decideSameToolFailure({failCount,threshold:3,errorCode:consumer.classCode,errorText:wire.error+" element_not_found",alreadyPivoted:false}),{action:failCount<3?"count":"stop"})
})
for(const actions of [[{action:"click",x:0,y:0}],[{action:"key",keys:["ctrl","enter"]}],[{action:"wait",ms:0}]])test("#563 valid draft reaches unchanged disabled coordinate gate: "+actions[0].action,async()=>{
 const parsed=tryParseToolArgs("host_computer",{...base,actions});assert.equal(parsed.ok,true);if(!parsed.ok)return
 const actual=await runComputerTask(parsed.args as any,deps());assert.equal(actual.errorCode,"COMPUTER_DISABLED");assert.equal(gateReads,1)
 const wire=JSON.parse(JSON.stringify(wireFromActual(actual)));assert.equal(consume(wire,"host_computer",classifyError).errorLevel,"non_recoverable")
 receipts.push({positiveDraftOnly:true,actual,wire,gateReads})
})
for(const aggregate of [false,true])test("#563 X4 type cap remains hard and unchanged: "+aggregate,async()=>{
 const actions=aggregate?[{action:"type",text:"x".repeat(1500)},{action:"type",text:"y".repeat(1500)}]:[{action:"type",text:"x".repeat(2001)}]
 const parsed=tryParseToolArgs("host_computer",{...base,actions});assert.equal(parsed.ok,aggregate)
 const actual=await runComputerTask({...base,actions} as any,deps());assert.equal(actual.errorCode,"TYPE_TEXT_TOO_LONG");assert.equal(gateReads,0)
 const wire=JSON.parse(JSON.stringify(wireFromActual(actual)));assert.equal(consume(wire,"host_computer",classifyError).errorLevel,"non_recoverable");assert.equal(MAX_TYPE_TEXT_CHARS,2000)
 receipts.push({X4:true,aggregate,schemaAccepted:parsed.ok,actual,wire})
})
test("#563 actual native helper INVALID_ACTION and unknown fallback remain mixed",()=>{
 assert.equal(ERROR_CODE_LEVELS.has("INVALID_ACTION"),false)
 for(const label of ["owned native","timeout","element_not_found"]){try{parseComputerJson("{",label);assert.fail("expected invalid JSON")}catch(error){assert.ok(error instanceof ComputerError);assert.equal(error.code,"INVALID_ACTION");assert.equal(classifyError(error.message,{error_code:error.code}),label==="owned native"?"non_recoverable":"recoverable")}}
 assert.throws(()=>assertInjectOk(JSON.stringify({ok:false,error:"owned native failure"})),(e:unknown)=>e instanceof ComputerError&&e.code==="INVALID_ACTION")
 for(const error_code of [undefined,"OWNED_UNKNOWN_CODE","COMPUTER_INPUT_INVALID "]){assert.equal(classifyError("timeout",{error_code}),"recoverable");assert.equal(classifyError("owned neutral",{error_code}),"non_recoverable")}
})
test("#563 missing and invalid token still deny before Computer effects",async()=>{
 dispatch.bindCompanionDispatchRuntime({getThreadManager:()=>null,getSkillEngine:()=>null,getComputerEstopEnsureOverride:()=>()=>{effects.native++;throw Error("NO_NATIVE_ADMISSION")}} as any)
 for(const token of [undefined,"owned-invalid-token-not-issued"]){const wire=JSON.parse(JSON.stringify(await dispatch.executeCompanionTool("host_computer",{...base,security_token:token})));assert.equal(wire.success,false);assert.match(wire.error,token?/Invalid or expired security token/:/requires L2 security_token/);assert.equal(consume(wire,"host_computer",classifyError).errorLevel,"non_recoverable");receipts.push({authorizationNegative:true,tokenPresent:!!token,wire})}
})
test("#563 draft provenance remains corrective in the current intrinsic map, default59/generic controls retained",()=>{
 assert.equal(ERROR_CODE_LEVELS.size, 170);assert.equal(DEFAULT_NON_RECOVERABLE_CODES.length,59);assert.equal(ERROR_CODE_LEVELS.get("COMPUTER_INPUT_INVALID"),"recoverable")
 assert.equal(ERROR_CODE_LEVELS.get("MCP_EDIT_MATCH_NOT_FOUND"),"recoverable")
 for(const error_code of ["COMPUTER_DISABLED","APP_NOT_WHITELISTED","APP_COORDINATE_DENIED","APP_COORDINATE_STRUCTURAL","SECURITY_TOKEN_INVALID","TYPE_TEXT_NOT_CONFIRMED"])assert.equal(classifyError("timeout element_not_found",{error_code}),"non_recoverable")
 assert.equal(ERROR_CODE_LEVELS.has("INVALID_ACTION"),false);assert.equal(ERROR_CODE_LEVELS.has("TYPE_TEXT_TOO_LONG"),false)
})
