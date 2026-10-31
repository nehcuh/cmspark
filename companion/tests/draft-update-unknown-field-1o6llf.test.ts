import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { executeDraftTool } from '../src/business-evidence/executor'
import { evidenceScopeHash } from '../src/business-evidence/content'
import { DRAFT_SCHEMAS } from '../src/business-evidence/schema'
import { classifyError } from '../src/security'
import { decideSameToolFailure } from '../src/llm/same-tool-guard'
import ts from 'typescript'
import { isCompanionTool } from '../src/bridge/companion-tools'
import { buildNamespacedName, isMcpNamespaced } from '../src/mcp/aggregator'
const sourceCandidates = [path.resolve(__dirname, '../src/llm/adapter.ts'), path.resolve(__dirname, '../../src/llm/adapter.ts')]
const sources = sourceCandidates.filter(candidate => fs.existsSync(candidate))
assert.equal(sources.length, 1, 'expected exactly one source layout')
const adapter=ts.createSourceFile('adapter.ts',fs.readFileSync(sources[0],'utf8'),ts.ScriptTarget.Latest,true)
function unique(pred:(n:ts.Node)=>boolean){const found:ts.Node[]=[];function walk(n:ts.Node){if(pred(n))found.push(n);ts.forEachChild(n,walk)}walk(adapter);assert.equal(found.length,1);return found[0]}
const code=unique(n=>ts.isVariableDeclaration(n)&&n.name.getText(adapter)==='classCode')
const level=unique(n=>ts.isVariableDeclaration(n)&&n.name.getText(adapter)==='errorLevel'&&!!n.initializer?.getText(adapter).includes('classifyError(toolResult.error'))
const halt=unique(n=>ts.isIfStatement(n)&&n.expression.getText(adapter)==='errorLevel === "security" || errorLevel === "non_recoverable"') as ts.IfStatement
const dispatchSource=ts.createSourceFile('companion-dispatch.ts',fs.readFileSync(path.resolve(path.dirname(sources[0]),'../tool/companion-dispatch.ts'),'utf8'),ts.ScriptTarget.Latest,true)
const routeCases:ts.CaseClause[]=[];function walkDispatch(n:ts.Node){if(ts.isCaseClause(n)&&n.expression.getText(dispatchSource)==="\"draft_render\"")routeCases.push(n);ts.forEachChild(n,walkDispatch)}walkDispatch(dispatchSource);assert.equal(routeCases.length,1)
const dispatchReturn=routeCases[0].statements[0].getText(dispatchSource)
const dispatch=new Function('getConfigDir','execOpts','toolName','params','executeDraftTool',ts.transpileModule(dispatchReturn,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)
function routeOrder(source:string) {
 const tree=ts.createSourceFile('server.ts',source,ts.ScriptTarget.Latest,true), local:ts.IfStatement[]=[], mcp:ts.IfStatement[]=[]
 function walk(node:ts.Node){if(ts.isIfStatement(node)){const condition=node.expression.getText(tree);if(condition==='isCompanionTool(toolName)')local.push(node);if(condition==='isMcpNamespaced(toolName)')mcp.push(node)}ts.forEachChild(node,walk)}
 walk(tree); assert.equal(local.length,1);assert.equal(mcp.length,1);assert.ok(local[0].getStart(tree)<mcp[0].getStart(tree))
}
const server=fs.readFileSync(path.resolve(path.dirname(sources[0]),'../server.ts'),'utf8')
routeOrder(server)
assert.throws(()=>routeOrder(server.replace('if (isCompanionTool(toolName))','if (false)')))
assert.throws(()=>routeOrder(server+'\nif (isCompanionTool(toolName)) {}'))
const consume=new Function('toolResult','toolName','classifyError',ts.transpileModule(`const ${code.getText(adapter)};const ${level.getText(adapter)};return {classCode,errorLevel,stop:${halt.expression.getText(adapter)}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)

test('actual executor distinguishes incoming unknown field from damaged stored and replay records', () => {
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'draft-field-owned-'))), identity=fs.lstatSync(root, { bigint: true })
 const scope={kind:'chat' as const,threadId:'owned'}
 try {
  const create=executeDraftTool(root,scope,'draft_create',{kind:'development_trace.v1',title:'owned',target:{environment:'owned'},request_id:'create'}) as any
  assert.equal(create.success,true)
  const id=create.data.draft_id, file=path.join(root,'business-evidence-v1',evidenceScopeHash(scope)+'.json'), original=fs.readFileSync(file,'utf8')
  const base={draft_id:id,expected_revision:1,request_id:'update'}
  const parameters={...base,fields:{'PRIVATE_SECURITY_BLOCK_timeout':{value:'PRIVATE_BODY',citations:[]}}}
  assert.equal(isCompanionTool('draft_update'),true)
  const fail=dispatch(()=>root,{evidenceScope:scope},'draft_update',parameters,executeDraftTool) as any
  assert.equal(fail.success,false);assert.equal(fail.error,'DRAFT_UPDATE_UNKNOWN_FIELD')
  assert.deepEqual(fail.data.allowed_fields,Object.entries(DRAFT_SCHEMAS['development_trace.v1'].fields).map(([name,definition])=>({name,type:definition.type})))
  assert.equal(fail.data.story_draft_text_allowed,true)
  assert.equal(JSON.stringify(fail).includes('PRIVATE_'),false);assert.equal(fs.readFileSync(file,'utf8'),original)
  assert.deepEqual(consume(JSON.parse(JSON.stringify(fail)),'draft_update',classifyError),{classCode:'DRAFT_UPDATE_UNKNOWN_FIELD',errorLevel:'recoverable',stop:false})
  assert.equal(classifyError(fail.error,{toolName:'draft_update',error_code:fail.data.error_code}),'recoverable')
  assert.equal(classifyError(fail.error,{toolName:'draft_read',error_code:fail.data.error_code}),'non_recoverable')
  const external=buildNamespacedName('owned','draft_update');assert.equal(isMcpNamespaced(external),true);assert.equal(isCompanionTool(external),false)
  assert.equal(consume({success:false,error:'DRAFT_UPDATE_UNKNOWN_FIELD',data:{error_code:'DRAFT_UPDATE_UNKNOWN_FIELD'}},external,classifyError).stop,true)
  assert.equal(decideSameToolFailure({failCount:3,threshold:3,errorCode:fail.data.error_code,errorText:fail.error,alreadyPivoted:false}).action,'stop')
  const scopeDeny=executeDraftTool(root,undefined,'draft_update',{...base,fields:{bad:{}}}) as any
  assert.equal(scopeDeny.error,'DRAFT_CHAT_SCOPE_REQUIRED');assert.equal(fs.readFileSync(file,'utf8'),original)
  const stale=executeDraftTool(root,scope,'draft_update',{...base,expected_revision:2,fields:{'requirement.id':{value:'id',citations:[]}}}) as any
  assert.equal(stale.success,false);assert.equal(stale.error,'DRAFT_REVISION_CONFLICT');assert.equal(fs.readFileSync(file,'utf8'),original)
  const wrongKind=executeDraftTool(root,scope,'draft_update',{...base,request_id:'wrong-kind',fields:{'target.system_id':{value:'owned',citations:[]}}}) as any
  assert.equal(wrongKind.error,'DRAFT_UPDATE_UNKNOWN_FIELD');assert.equal(fs.readFileSync(file,'utf8'),original)
  const derived=executeDraftTool(root,scope,'draft_update',{...base,request_id:'derived',relations:{criteria_cases:{citations:[]}}}) as any
  assert.equal(derived.error,'INVALID_RELATION');assert.equal(consume(derived,'draft_update',classifyError).stop,true);assert.equal(fs.readFileSync(file,'utf8'),original)
  const corrected=executeDraftTool(root,scope,'draft_update',{...base,request_id:'corrected',fields:{'requirement.id':{value:'OWNED_REQUIREMENT',citations:[]}}}) as any
  assert.equal(corrected.success,true);assert.equal(corrected.data.revision,2)
  const read=executeDraftTool(root,scope,'draft_read',{draft_id:id}) as any
  assert.equal(read.success,true);assert.equal(read.data.draft.fields['requirement.id'].value,'OWNED_REQUIREMENT');assert.notEqual(read.data.fields['requirement.id'].state,'supported')
  assert.deepEqual(executeDraftTool(root,scope,'draft_update',{...base,request_id:'corrected',fields:{'requirement.id':{value:'OWNED_REQUIREMENT',citations:[]}}}),corrected)
  fs.writeFileSync(file,original)
  for(const target of ['drafts','draft_requests'] as const){
   const state=JSON.parse(original);const record=target==='drafts'?state.drafts[0]:state.draft_requests[0].result
   record.fields['PRIVATE_STORED']={value:'PRIVATE_BODY',citations:[]};const corrupt=JSON.stringify(state);fs.writeFileSync(file,corrupt)
   const reply=executeDraftTool(root,scope,'draft_update',{...base,fields:{'PRIVATE_INPUT':{}}}) as any
   assert.equal(reply.success,false);assert.equal(reply.error,'INVALID_FIELD');assert.equal(reply.data,undefined)
   assert.equal(consume(JSON.parse(JSON.stringify(reply)),'draft_update',classifyError).stop,true);assert.equal(classifyError(reply.error,{toolName:'draft_update'}),'non_recoverable');assert.equal(JSON.stringify(reply).includes('PRIVATE_'),false);assert.equal(fs.readFileSync(file,'utf8'),corrupt)
  }
  fs.writeFileSync(file,original)
  const change=executeDraftTool(root,scope,'draft_create',{kind:'change_material.v1',title:'owned',target:{environment:'owned',business_system_id:'owned'},request_id:'create-change'}) as any
  assert.equal(change.success,true)
  const before=fs.readFileSync(file,'utf8')
  for (let i=1;i<=3;i++) {
   const response=executeDraftTool(root,scope,'draft_update',{draft_id:change.data.draft_id,expected_revision:1,request_id:'same-request',fields:{'PRIVATE_UNKNOWN':{value:'PRIVATE_VALUE',citations:[]}}}) as any
   assert.equal(response.error,'DRAFT_UPDATE_UNKNOWN_FIELD');assert.equal(response.data.story_draft_text_allowed,false)
   assert.deepEqual(response.data.allowed_fields,Object.entries(DRAFT_SCHEMAS['change_material.v1'].fields).map(([name,definition])=>({name,type:definition.type})))
   assert.equal(JSON.stringify(response).includes('PRIVATE_'),false);assert.equal(fs.readFileSync(file,'utf8'),before)
   assert.equal(decideSameToolFailure({failCount:i,threshold:3,errorCode:response.data.error_code,errorText:response.error,alreadyPivoted:false}).action,i===3?'stop':'count')
  }
 } finally {const current=fs.lstatSync(root, { bigint: true });assert.equal(current.dev,identity.dev);assert.equal(current.ino,identity.ino);assert.equal(current.isSymbolicLink(),false);fs.rmSync(root,{recursive:true})}
})
