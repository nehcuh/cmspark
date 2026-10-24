/** CPU-only controls for the actual passive native-test observers. No GUI/PTY child. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import {createHash,createHmac} from 'node:crypto'
import {EventEmitter} from 'node:events'
import {DesktopIdentityRegistry} from '../src/desktop/identity'
import {createDesktopChannel} from '../src/desktop/channel'
import {SecurityConfirmationManager} from '../src/security-confirmation'
import {ThreadManager} from '../src/threads/thread-manager'
const root=path.resolve(__dirname,'../..'),read=(p:string)=>fs.readFileSync(path.join(root,p),'utf8')
const native=read('tests/desktop-native-thread-metadata-476.test.ts')
function declaration(text:string,name:string){const file=ts.createSourceFile('actual.ts',text,ts.ScriptTarget.Latest,true),found=file.statements.filter((n):n is ts.FunctionDeclaration=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.equal(found.length,1);return found[0].getText(file).replace(/^export /,'')}
function observers(){const scope:any={};vm.runInNewContext(ts.transpileModule(declaration(native,'createLocalProgress705')+'\n'+declaration(native,'parseLocalActivation705')+';globalThis.create=createLocalProgress705;globalThis.parse=parseLocalActivation705;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope,{timeout:1000});return{progress:scope.create(),parse:scope.parse}}
const plain=(v:any)=>JSON.parse(JSON.stringify(v))
test('705 activation decoder is a closed relation, never a window identity or success authority',()=>{
 const {parse}=observers();for(const requested of [0,1])for(const [token,foreground]of [['X','NOT_READ'],['0','NULL'],['1','OWNED'],['2','OTHER']])assert.deepEqual(plain(parse(`D476_LOCAL_ACTIVATE_${requested}_${token}`)),{requested:!!requested,foreground})
 let getters=0;for(const input of [null,{},Object.defineProperty({},'toString',{get(){getters++;throw Error('PRIVATE')}}),'D476_LOCAL_ACTIVATE_2_0','D476_LOCAL_ACTIVATE_1_3','D476_LOCAL_ACTIVATE_0_X\n','D476_LOCAL_ACTIVATE_0_X_PRIVATE'])assert.equal(parse(input),null);assert.equal(getters,0)
})
test('705 passive counters distinguish a protocol attempt from a returned handle',()=>{
 const {progress:p}=observers();p.attempt();assert.equal(p.snapshot().protocolAttempts,1);assert.equal(p.snapshot().protocolHandles,0);p.handle();assert.equal(p.snapshot().protocolHandles,1)
 const attempt='localProgress.attempt();const handle=await realStart(opts);if(handle){localProgress.handle();protocolStarts++;';assert.equal(native.split(attempt).length,2)
 assert.ok(native.includes('return Reflect.apply(realAgentStart!,runtime,[input])'));assert.ok(native.includes('return Reflect.apply(originalSend,this,[data,...args])'))
 assert.ok(Buffer.byteLength(JSON.stringify(p.snapshot()))<512)
})
test('705 actual HMAC producer frames identify request, bound confirmation and result without native effects',async t=>{
 // Reuse the actual fixture body with one explicit inert adapter selection: full localRuntime, not terminal-only.
 // All HMAC/real channel handlers remain; no hand-written success response.
 const terminalFixture=declaration(read('tests/desktop-terminal-work-705.test.ts'),'fixture');assert.equal(terminalFixture.split('terminalRuntime:runtime').length,2);const actualFixture=terminalFixture.replace('terminalRuntime:runtime','localRuntime:runtime'),scope:any={fs,os,path,EventEmitter,DesktopIdentityRegistry,createDesktopChannel,SecurityConfirmationManager,ThreadManager,createHmac,assert,process,Buffer,setImmediate}
 vm.runInNewContext(ts.transpileModule(actualFixture+';globalThis.make=fixture;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope,{timeout:1000})
 const f=scope.make(t),{progress:p}=observers();f.runtime.modules=()=>({terminal:true,agent:true});f.runtime.agents=()=>[{id:'owned',label:'Owned inert agent',identity:'a'.repeat(64)}]
 f.runtime.startAgent=()=>{p.runtime();return{ok:true,sessionId:'owned-inert-session'}}
 const originalSend=f.ws.send;f.ws.send=(data:string)=>{p.outgoing(data);return originalSend(data)}
 const send=async(frame:any)=>{p.incoming(frame);return f.send(frame)}
 const state=await send({type:'desktop.local.state',id:'state',thread_id:'local-work-A'});assert.equal(state.ok,true)
 const confirmation=await send({type:'desktop.agent.start',id:'owned-start',thread_id:'local-work-A',revision:state.state.revision,agent_id:'owned',goal:'inert source control'})
 assert.equal(confirmation.type,'desktop.confirmation.request');assert.equal(p.snapshot().agentRequests,1);assert.equal(p.snapshot().agentConfirmations,1);assert.equal(p.snapshot().runtimeStarts,0)
 // The decision is derived from this actual producer, not an assumed private ID or digest.
 const decision={type:'desktop.confirmation.decision',purpose:confirmation.purpose,confirmation_id:confirmation.confirmation_id,thread_id:confirmation.thread_id,action_digest:confirmation.action_digest,approved:true}
 await send(decision);const value=plain(p.snapshot());assert.equal(value.agentDecisions,1);assert.equal(value.agentApprovals,1);assert.equal(value.runtimeStarts,1);assert.equal(value.agentResults,1);assert.equal(value.agentAccepted,1);assert.equal(value.protocolAttempts,0);assert.equal(value.protocolHandles,0)
 const snapshot=JSON.stringify(value);for(const privateValue of [f.selected,confirmation.confirmation_id,confirmation.action_digest,'inert source control','owned-inert-session'])assert.equal(snapshot.includes(privateValue),false)
 p.incoming(decision);assert.equal(p.snapshot().agentDecisions,1,'duplicate decision is not another bound confirmation')
 assert.deepEqual(plain(f.calls),[],'inert fixture never opens a terminal')
})
test('705 local activation observation inverse restores the complete preceding controller',()=>{
 let cpp=read('tests/fixtures/desktop-476/local-acceptance.cpp').replace(/\r\n/g,'\n')
 const capture='const BOOL activation=SetForegroundWindow(h.window);const auto focusStatus=h.controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);const bool focusFailed=FAILED(focusStatus);const HWND observedForeground=focusFailed?nullptr:GetForegroundWindow();const bool foregroundMismatch=!focusFailed&&observedForeground!=h.window;'
 const original='SetForegroundWindow(h.window);const auto focusStatus=h.controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);const bool focusFailed=FAILED(focusStatus);const bool foregroundMismatch=!focusFailed&&GetForegroundWindow()!=h.window;'
 const observation='try{const wchar_t* id=activation?(focusFailed?L"D476_LOCAL_ACTIVATE_1_X":observedForeground==nullptr?L"D476_LOCAL_ACTIVATE_1_0":observedForeground==h.window?L"D476_LOCAL_ACTIVATE_1_1":L"D476_LOCAL_ACTIVATE_1_2"):(focusFailed?L"D476_LOCAL_ACTIVATE_0_X":observedForeground==nullptr?L"D476_LOCAL_ACTIVATE_0_0":observedForeground==h.window?L"D476_LOCAL_ACTIVATE_0_1":L"D476_LOCAL_ACTIVATE_0_2");emit(h,id);}catch(...){}'
 assert.equal(cpp.split(capture).length,2);assert.equal(cpp.split(observation).length,2);cpp=cpp.replace(capture,original).replace(observation,'')
 assert.equal(createHash('sha256').update(cpp).digest('hex'),'19b2cf211c1c50ec893a3f57c2d20c07ec0abf12e3827955f461f5c4bbda5b08')
})

function actualResultParser705(){
 const helper=read('tests/helpers/workspace-xctest-owned-705.ts'),file=ts.createSourceFile('actual-helper.ts',helper,ts.ScriptTarget.Latest,true)
 const names=['refused','result705Unknown','RESULT705_IDS','RESULT705_TYPES','RESULT705_SOURCES'],definitions:string[]=[]
 for(const name of names){const found=file.statements.filter(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(file)===name));assert.equal(found.length,1,name);definitions.push(found[0].getText(file))}
 for(const name of ['result705Select','result705Project'])definitions.push(declaration(helper,name))
 const scope:any={Buffer,TextDecoder,URL,URLSearchParams,fs,path,createHash};vm.runInNewContext(ts.transpileModule(definitions.join('\n')+';globalThis.select=result705Select;globalThis.project=result705Project;globalThis.types=[...RESULT705_TYPES];globalThis.unknown=result705Unknown;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope,{timeout:1000});return scope
}
test('705 actual xcresult consumers reject authentic schema documents as the wrong producer',()=>{
 const parser=actualResultParser705()
 for(const [name,digest]of [['tests.json','18adcaa0c1bb43c466c0e0587816dbbe127c86e69e0f07fcde601ab7398d47da'],['test-details.json','fd41cd2862c44e50e3c70127e5bb3830ec0773d89263d767fa648c1d549db5da']]){
  // Complete public schema capture: official run40040434849/artifact12539400475.
  // This is deliberately NOT a runtime-positive TestDetails fixture.
  const bytes=Buffer.from(read('tests/fixtures/workspace-ui-705/xcresult-schema-0.1.0/'+name));assert.equal(createHash('sha256').update(bytes).digest('hex'),digest)
  assert.throws(()=>parser.select(bytes));assert.throws(()=>parser.project(bytes,'/unread-source','WorkspacePicker705/testOwnedPanel()'))
  const schema=JSON.parse(bytes.toString('utf8'));assert.deepEqual(plain(parser.types),schema.schemas.TestNodeType.enum)
 }
})
test('705 actual xcresult parser refuses absent, oversized, malformed and invalid UTF8 results',()=>{
 const parser=actualResultParser705();for(const bytes of [Buffer.alloc(0),Buffer.from('{}'),Buffer.from([0xff]),Buffer.alloc(1048577)]){assert.throws(()=>parser.select(bytes));assert.throws(()=>parser.project(bytes,'/unread-source','WorkspacePicker705/testOwnedPanel()'))}
 const value=plain(parser.unknown('INVALID_RESULT'));assert.equal(value.status,'UNKNOWN');assert.equal(value.nativePassClaim,false);assert.equal(value.testPresent,null);assert.deepEqual(value.sourceCoordinates,[])
})
