/** #563 MCP meta arguments use existing correction, never weaken selection/auth/confirmation. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"
import { tryParseToolArgs } from "../src/bridge/tool-schemas"
import { classifyError } from "../src/security"
const cases=[["mcp_list_resources","server"],["mcp_read_resource","server"],["mcp_read_resource","uri"],["mcp_get_prompt","server"],["mcp_get_prompt","name"]]as const
const src=(name:string)=>{const p=path.resolve(name);return ts.createSourceFile(p,fs.readFileSync(p,"utf8"),ts.ScriptTarget.Latest,true)}
const adapter=src("src/llm/adapter.ts");const blocks:ts.IfStatement[]=[]
function scan(n:ts.Node){if(ts.isIfStatement(n)&&n.expression.getText(adapter)==="!parsed.ok")blocks.push(n);ts.forEachChild(n,scan)}scan(adapter);assert.equal(blocks.length,1)
const correction=new Function("parsed","record",ts.transpileModule(`const tc={id:"owned",function:{arguments:"{}"}},threadId="OWNED_HOST",toolName="owned-meta",toolResults=[];const logger={warn(){}},rememberToolResult=()=>{},threadManager={addMessage(){}},createToolResultMessage=()=>({}),sendToExtension=(v)=>record.push(v),wrapUntrusted=(v)=>v;let dispatched=0;for(const once of [0]){${blocks[0].getText(adapter)}dispatched++}return{record,dispatched,results:toolResults}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText)
for(const [tool,field]of cases){
 for(const [label,value]of[["missing",undefined],["null",null],["empty",""],["ASCII blank"," \t\n"],["Unicode blank","\u3000\u00a0"],["number",3]]as const)test(`${tool}.${field}: ${label} corrects before authorization or MCP dispatch`,()=>{
  const parsed=tryParseToolArgs(tool,{server:"owned",uri:"owned:uri",name:"owned",[field]:value});assert.equal(parsed.ok,false);const out=correction(parsed,[]);assert.equal(out.dispatched,0);assert.equal(out.record.length,1);assert.equal(out.record[0].type,"tool.result");assert.equal(out.results.length,1)
 })
 for(const value of["owned"," own value ","知识"])test(`${tool}.${field}: accepted bytes and optional arguments are retained (${value.length})`,()=>{
  const params={server:"owned",uri:"owned:uri",name:"owned",arguments:{n:"value",nested:{a:1}},extra:"not-a-new-authority",[field]:value};const result=tryParseToolArgs(tool,params);assert.equal(result.ok,true);if(result.ok)assert.deepEqual(result.args,params)
 })
}
const dispatch=src("src/mcp/dispatch.ts")
function fn(name:string){const nodes=dispatch.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)as ts.FunctionDeclaration[];assert.equal(nodes.length,1);return nodes[0].getText(dispatch).replace(/^export /,"")}
for(const mode of["exclude","deny","revoke"]as const)test(`meta input repair retains actual selection/auth/confirmation ${mode} refusal`,async()=>{
 let auth:string|undefined="INERT_AUTH_ID_NOT_A_TOKEN",calls=0,confirms=0
 const deps={requireRt:()=>({getThreadManager:()=>({get:()=>mode==="exclude"?{id:"OWNED_HOST",mcp_selection_mode:"manual",active_mcp_server_ids:[]}:{id:"OWNED_HOST"}}),securityConfirmations:{request:async()=>{confirms++;if(mode==="revoke")auth=undefined;return{approved:mode!=="deny",reason:mode==="deny"?"denied":"approved"}}}}),getMcpManager:()=>({getAuthorizationIdentity:()=>auth,getTrustLevel:()=>"manual",readResource:async()=>{calls++;return{contents:[]}}}),CRITICAL_MCP_META_TOOLS:new Set(["mcp_read_resource","mcp_get_prompt"]),getMcpConfirmCache:()=>({isApproved:()=>false}),getConfig:()=>({security:{allow_all_schemes:false,auto_approve_dangerous:false,auto_approve_enterprise_tools:false}}),isFullAutonomyCruise:()=>false,logger:{info(){},warn(){}},confirmChannel:async()=>({originWs:{},send(){}}),safeJsonStringify:JSON.stringify}
 const execute=new Function(...Object.keys(deps),ts.transpileModule(dispatch.statements.filter(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&["nativeMcpStale","nativeMcpStaleResult"].includes(d.name.text))).map(n=>n.getText(dispatch)).join("\n")+"\n"+fn("createMcpServerSelectionGate")+"\n"+fn("executeMcpMetaTool")+"\nreturn executeMcpMetaTool",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText)(...Object.values(deps));const parsed=tryParseToolArgs("mcp_read_resource",{server:"owned",uri:"owned:uri",__thread_id:"OWNED_HOST"});assert.equal(parsed.ok,true);if(!parsed.ok)return
 const result=await execute("mcp_read_resource",parsed.args,"connection",{});assert.equal(result.success,false);assert.equal(calls,0);assert.equal(confirms,mode==="exclude"?0:1);assert.equal(classifyError(result.error),mode==="deny"?"security":"non_recoverable")
})
