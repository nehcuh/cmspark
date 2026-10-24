/** Inert CPU only: execute the native test's actual observer with the locked Windows producer. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const repo=path.resolve(__dirname,path.basename(path.dirname(__dirname))==='.test-dist'?'../../..':'../..')
const {scenario}=require(path.join(repo,'companion/tests/fixtures/node-pty-725/runtime.cjs'))
const source=fs.readFileSync(path.join(repo,'companion/tests/desktop-native-thread-metadata-476.test.ts'),'utf8')
const file=ts.createSourceFile('native.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
let observer:ts.ArrowFunction|undefined
const completion:string[]=[]
function visit(node:ts.Node){
 if(ts.isCallExpression(node)&&node.expression.getText(file)==='t.mock.method'&&node.arguments[0]?.getText(file)==='nativePty'){
  assert.equal(observer,undefined);assert.ok(ts.isArrowFunction(node.arguments[2]));observer=node.arguments[2] as ts.ArrowFunction
 }
 if(ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)){
  const call=node.expression,argument=call.arguments[0]?.getText(file)
  if(['assert.equal','assert.ok'].includes(call.expression.getText(file))&&[
   'actualSpawns','actualHandles.length','Number.isSafeInteger(ownedPid)&&ownedPid>0','actualHandles[0].pid()','actualProcessExit','failed',
  ].includes(argument)&&!(argument==='actualSpawns'&&call.arguments[1]?.getText(file)==='0'))completion.push(node.getText(file))
 }
 ts.forEachChild(node,visit)
}
const terminal=file.statements.find(node=>ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&
 ts.isStringLiteral(node.expression.arguments[0])&&node.expression.arguments[0].text.startsWith('#476 terminal-only'))
assert.ok(terminal);visit(terminal)
assert.ok(observer);assert.equal(completion.length,6,'all final PID, process-exit and failure assertions must remain')
const observerJS=ts.transpileModule(`const observe=${observer!.getText(file)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText

function harness(realSpawn:(...args:any[])=>any,fileName='C:\\owned\\node.exe',args=['C:\\owned\\child.cjs']){
 const create=new Function('bindings',`const {assert,realSpawn,fs,dir,runtime}=bindings;
 let actualSpawns=0,ownedPid=0,actualProcessExit=false,completionFailure,failed=false;
 const actualHandles=[],childExits=[];const fail=()=>{failed=true};${observerJS}
 return {observed:observe,state:()=>({actualSpawns,ownedPid,actualProcessExit,completionFailure,failed,actualHandles,childExits}),
 finish:()=>{${completion.join('\n')}}};`)
 return create({assert,realSpawn,fs:{realpathSync:(p:string)=>p},dir:'C:\\owned',runtime:{shell:()=>({file:fileName,args})}})
}

test('#747 real Windows producer publishes PID after spawn, before data, and preserves it through exit',async()=>{
 let h:any
 const facts=await scenario({wrapSpawn:(spawn:any)=>{
  h=harness(spawn)
  // The producer VM creates its own Array prototype; native observer and caller share one realm.
  return (file:string,args:string[],opts:any)=>{const handle=h.observed(file,Array.from(args),opts);assert.equal(handle.pid,0);assert.equal(h.state().ownedPid,0);return handle}
 }})
 await Promise.all(h.state().childExits)
 assert.equal(facts.closedFrames,1);assert.equal(facts.productBusy,false)
 assert.equal(h.state().ownedPid,12345);assert.equal(h.state().failed,false);assert.equal(h.state().completionFailure,undefined)
 assert.equal(h.state().actualHandles[0].exited,true);h.finish()
})

test('#747 real Windows close before ready cannot satisfy final PID/actual-exit acceptance',async()=>{
 let h:any
 const facts=await scenario({mode:'close-before-ready',wrapSpawn:(spawn:any)=>{h=harness(spawn);return (file:string,args:string[],opts:any)=>h.observed(file,Array.from(args),opts)}})
 assert.equal(facts.upstreamReady,false);assert.equal(h.state().ownedPid,0)
 assert.equal(h.state().actualProcessExit,false);assert.throws(()=>h.finish())
})

// Negative controls vary only the owned handle's observable values; no OS handles are created.
function controlled(){
 let pid=0,onData!:()=>void,onExit!:()=>void
 const handle={get pid(){return pid},kill(){},onData(fn:()=>void){onData=fn},onExit(fn:()=>void){onExit=fn}}
 const h=harness(()=>handle);assert.equal(h.observed('C:\\owned\\node.exe',['C:\\owned\\child.cjs'],{cwd:'C:\\owned'}),handle)
 return {h,setPid:(value:number)=>{pid=value},data:()=>onData(),exit:()=>onExit()}
}
test('#747 invalid first data PID records failure without throwing out of the data listener',()=>{
 for(const value of [0,-1,NaN,1.5,Number.MAX_SAFE_INTEGER+1]){
  const c=controlled();c.setPid(value);assert.doesNotThrow(()=>c.data());assert.equal(c.h.state().failed,true)
  assert.ok(c.h.state().completionFailure);c.exit();assert.throws(()=>c.h.finish())
 }
})
test('#747 a PID change in later data or only at completion cannot replace the observed identity',()=>{
 for(const laterData of [false,true]){
  const c=controlled();c.setPid(12345);c.data();c.setPid(12346)
  if(laterData){assert.doesNotThrow(()=>c.data());assert.equal(c.h.state().failed,true);assert.ok(c.h.state().completionFailure)}
  c.exit();assert.equal(c.h.state().ownedPid,12345);assert.throws(()=>c.h.finish())
 }
})
test('#747 exit without data and data without exit both fail final acceptance',()=>{
 const noData=controlled();noData.setPid(12345);noData.exit();assert.throws(()=>noData.h.finish())
 const noExit=controlled();noExit.setPid(12345);noExit.data();assert.throws(()=>noExit.h.finish())
})
test('#747 an invalid data event cannot be repaired by a later valid PID',()=>{
 const c=controlled();c.data();c.setPid(12345);c.data();c.exit()
 assert.equal(c.h.state().ownedPid,12345);assert.equal(c.h.state().failed,true);assert.throws(()=>c.h.finish())
})
