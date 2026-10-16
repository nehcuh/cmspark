/** #563 existing argument-correction route: finite two blank fields, no generic severity regrade. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"
import { tryParseToolArgs } from "../src/bridge/tool-schemas"
import { classifyError } from "../src/security"
for(const [tool,field]of[["use_skill","name"],["loop_declare_blocked","item_id"]]as const){
 for(const [label,value]of[["missing",undefined],["null",null],["empty",""],["ASCII blank"," \t\n"],["Unicode blank","\u3000\u00a0"],["number",3],["object",{}]]as const)test(`${tool}: ${label} required field goes to argument correction before dispatch`,()=>{
  const result=tryParseToolArgs(tool,{[field]:value});assert.equal(result.ok,false)
 })
 for(const value of["owned"," own name ","知識","x".repeat(121)])test(`${tool}: accepted nonblank field preserves original bytes (${value.length})`,()=>{
  const result=tryParseToolArgs(tool,{[field]:value});assert.equal(result.ok,true);if(result.ok)assert.equal(result.args[field],value)
 })
}
test("two-field repair does not remove trusted host thread injection or missing-context hard refusal",async()=>{
 const file=path.resolve("src/llm/adapter.ts"),tree=ts.createSourceFile(file,fs.readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true);let declarations:ts.VariableDeclaration[]=[]
 function scan(n:ts.Node){if(ts.isVariableDeclaration(n)&&n.name.getText(tree)==="execParams"&&n.initializer?.getText(tree).includes("__thread_id: threadId"))declarations.push(n);ts.forEachChild(n,scan)}scan(tree);assert.equal(declarations.length,1)
 const parsed=tryParseToolArgs("loop_declare_blocked",{item_id:"owned-item",__thread_id:"MODEL_CANNOT_SET_OWNER"});assert.equal(parsed.ok,true);if(!parsed.ok)return
 const inject=new Function("normalized","resolvedTabId","threadId",`return (${declarations[0].initializer!.getText(tree)})`);assert.equal(inject(parsed.args,undefined,"OWNED_HOST").__thread_id,"OWNED_HOST")
 const dfile=path.resolve("src/tool/companion-dispatch.ts"),dtree=ts.createSourceFile(dfile,fs.readFileSync(dfile,"utf8"),ts.ScriptTarget.Latest,true);let clauses:ts.CaseClause[]=[];function find(n:ts.Node){if(ts.isCaseClause(n)&&n.expression.getText(dtree)==='"loop_declare_blocked"')clauses.push(n);ts.forEachChild(n,find)}find(dtree);assert.equal(clauses.length,1)
 const body=clauses[0].statements[0].getText(dtree);const call=new Function(ts.transpileModule(`return(async function(params)${body})`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText)();const result=await call({item_id:"owned-item"});assert.equal(result.error,"loop_declare_blocked requires __thread_id");assert.equal(result.data,undefined);assert.equal(classifyError(result.error),"non_recoverable")
})
