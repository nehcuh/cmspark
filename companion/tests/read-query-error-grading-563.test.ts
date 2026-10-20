/** #563 finite query refusals: actual production helpers/AST/JSON/adapter, owned empty data only. */
import test, { beforeEach, afterEach, mock } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import cp = require("node:child_process")
import net from "node:net"
import { pathToFileURL } from "node:url"
import ts from "typescript"
import { classifyError, ERROR_CODE_LEVELS, DEFAULT_NON_RECOVERABLE_CODES } from "../src/security"
import { securityPolicy } from "../src/security-policy"
import { tryParseToolArgs } from "../src/bridge/tool-schemas"
import { runSearchThreads, runSearchKnowledge } from "../src/tool/llm-search"
const expectedCode="READ_QUERY_INPUT_INVALID", queryMarker="OWNED_QUERY_NOT_FOR_LOG_563"
let effects={process:0,network:0,issuer:0}
beforeEach(()=>{
 effects={process:0,network:0,issuer:0}
 for(const k of["spawn","spawnSync","exec","execSync","execFile","execFileSync","fork"]as const)mock.method(cp,k,(()=>{effects.process++;throw Error("OWNED_PROCESS_DENIED")})as any)
 mock.method(net.Socket.prototype,"connect",(()=>{effects.network++;throw Error("OWNED_NETWORK_DENIED")})as any)
 mock.method(globalThis,"fetch",(()=>{effects.network++;throw Error("OWNED_FETCH_DENIED")})as any)
 for(const k of["issueToken","issueTokenFor"]as const)mock.method(securityPolicy,k,(()=>{effects.issuer++;throw Error("OWNED_ISSUER_DENIED")})as any)
})
afterEach(()=>{assert.deepEqual(effects,{process:0,network:0,issuer:0});mock.restoreAll()})
function parse(file:string){return ts.createSourceFile(file,fs.readFileSync(path.join(process.cwd(),"src",file),"utf8"),ts.ScriptTarget.Latest,true)}
function one(root:ts.Node,p:(n:ts.Node)=>boolean){const found:ts.Node[]=[];function walk(n:ts.Node){if(p(n))found.push(n);ts.forEachChild(n,walk)}walk(root);assert.equal(found.length,1);return found[0]}
const dispatcher=parse("tool/companion-dispatch.ts"),adapter=parse("llm/adapter.ts")
function compile(body:string,...args:string[]){return new Function(...args,ts.transpileModule(body,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText)}
function actualCase(name:string){const clause=one(dispatcher,n=>ts.isCaseClause(n)&&n.expression.getText(dispatcher)===JSON.stringify(name))as ts.CaseClause;let body=clause.statements[0].getText(dispatcher)
 body=body.replace(/import\((['"])([^'"]+)\1\)/g,(_all,_quote,module)=>{const file=module==="../threads/thread-recall"?"threads/thread-recall.js":module==="./llm-search"?"tool/llm-search.js":null;assert.ok(file,"Only actual local read helper imports");return`import(${JSON.stringify(pathToFileURL(path.join(process.cwd(),".test-dist/src",file)).href)})`})
 return compile(`return (async function(params,threadManager,skillEngine,logger)${body})` )()
}
const code=one(adapter,n=>ts.isVariableDeclaration(n)&&n.name.getText(adapter)==="classCode")
const level=one(adapter,n=>ts.isVariableDeclaration(n)&&n.name.getText(adapter)==="errorLevel"&&!!n.initializer?.getText(adapter).includes("classifyError(toolResult.error"))
const halt=one(adapter,n=>ts.isIfStatement(n)&&n.expression.getText(adapter)==='errorLevel === "security" || errorLevel === "non_recoverable"')as ts.IfStatement
const consume=compile(`const ${code.getText(adapter)};const ${level.getText(adapter)};return{classCode,errorLevel,stop:${halt.expression.getText(adapter)}}`,"toolResult","toolName","classifyError")
const emptyThreads={list:()=>[],getMessages:()=>[]},emptyKnowledge={listKnowledge:()=>[]}
async function produce(tool:string,params:Record<string,unknown>){const logs:unknown[]=[];const value=await actualCase(tool)(params,emptyThreads,emptyKnowledge,{info:(...args:unknown[])=>logs.push(args)});assert.equal(JSON.stringify(logs).includes(queryMarker),false,"Query text must not enter host logs");return JSON.parse(JSON.stringify(value))}
for(const tool of["thread_recall","search_threads","search_knowledge"])for(const [label,query]of[["empty",""],["space"," "],["unicode","\t\r\n\u3000"],["missing",undefined],["null",null]]as const){
 test(`#563 ${tool} ${label} query actual refusal remains model-repairable`,async()=>{
  const parsed=tryParseToolArgs(tool,{query,__thread_id:"OWNED_THREAD",error_code:"NETSEC_TARGETS_DENIED"});assert.equal(parsed.ok,true);if(!parsed.ok)return
  const wire=await produce(tool,parsed.args);assert.equal(wire.success,false);assert.equal(wire.error,"query required");assert.equal(wire.data?.error_code,expectedCode)
  assert.deepEqual(consume(wire,tool,classifyError),{classCode:expectedCode,errorLevel:"recoverable",stop:false})
 })
}
test("#563 recall keeps its existing200 bound and repair feedback without logging query",async()=>{const wire=await produce("thread_recall",{query:queryMarker+"x".repeat(201),__thread_id:"OWNED_THREAD"});assert.equal(wire.error,"query too long (max 200)");assert.equal(wire.data?.error_code,expectedCode);assert.equal(JSON.stringify(wire).includes(queryMarker),false);assert.equal(consume(wire,"thread_recall",classifyError).stop,false)})
for(const tool of["thread_recall","search_threads","search_knowledge"])test(`#563 ${tool} nonempty no-hit success shape and query privacy stay`,async()=>{const wire=await produce(tool,{query:queryMarker,__thread_id:"OWNED_THREAD",max_hits:99,limit:99});assert.equal(wire.success,true);assert.deepEqual(wire.data.hits,[]);assert.equal(wire.data.error_code,undefined);if(tool==="thread_recall"){assert.equal(wire.data.total_scanned,0);assert.equal(wire.data.thread_id,"OWNED_THREAD")}else assert.deepEqual(Object.keys(wire.data),["hits"])})
test("#563 missing recall thread stays hard before query/helper despite caller code",async()=>{const wire=await produce("thread_recall",{query:"",error_code:expectedCode});assert.equal(wire.error,"thread_recall requires active thread");assert.equal(wire.data,undefined);assert.equal(consume(wire,"thread_recall",classifyError).stop,true)})
test("#563 actual local-search helpers own only normalized-empty typed provenance",()=>{for(const fn of[runSearchThreads,runSearchKnowledge]){const bad=fn([]," \t");assert.equal(bad.ok,false);if(bad.ok)continue;assert.equal((bad as any).error_code,expectedCode);assert.equal(bad.error,"query required");const good=fn([],queryMarker,99);assert.equal(good.ok,true);assert.equal((good as any).error_code,undefined)}})
test("#563 future untyped or unknown search-helper failure cannot inherit new grade",()=>{for(const tool of["search_threads","search_knowledge"]){const clause=one(dispatcher,n=>ts.isCaseClause(n)&&n.expression.getText(dispatcher)===JSON.stringify(tool))as ts.CaseClause;const guard=one(clause,n=>ts.isIfStatement(n)&&n.expression.getText(dispatcher)==="!result.ok");const outlet=compile(guard.getText(dispatcher),"result");for(const error_code of[undefined,"UNREGISTERED_QUERY_CODE",{toString:()=>expectedCode}]){const wire=JSON.parse(JSON.stringify(outlet({ok:false,error:"owned future helper failure",error_code})));assert.equal(wire.data,undefined);assert.equal(consume(wire,tool,classifyError).stop,true)}}})
test("#563 finite read-query code cannot alter protected codes or locator pivot",()=>{assert.equal(ERROR_CODE_LEVELS.size, 169);assert.equal(DEFAULT_NON_RECOVERABLE_CODES.length,59);assert.equal(ERROR_CODE_LEVELS.get(expectedCode),"recoverable");for(const error_code of["NETSEC_TARGETS_DENIED","DANGER_DENIED_BY_USER","ACK_REQUIRED","GRANT_REQUIRED","INVALID_ARGS"]){assert.notEqual(classifyError("owned neutral",{error_code}),"recoverable")}for(const error of["owned neutral","element_not_found timeout","Security Block: permission denied"]){assert.equal(classifyError(error,{error_code:expectedCode}),"recoverable")}})
