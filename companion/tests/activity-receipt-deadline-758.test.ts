import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import ts from 'typescript'

// Execute the complete real controller. Only file observation and the original
// deadline delivery are inert; this is not a WPF/native readiness simulation.
const file=path.resolve('tests/activity-platform-native-758.test.ts')
const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true)
const functions=source.statements.filter((n):n is ts.FunctionDeclaration=>ts.isFunctionDeclaration(n)&&n.name?.text==='receipt')
assert.equal(functions.length,1)
const code=ts.transpileModule(functions[0].getText(source)+'\nexports.receipt=receipt',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText

function controller(){
  const files=new Map<string,string>(),child=new EventEmitter(),abort=new AbortController()
  let deadline:()=>void=()=>{throw Error('NO_DEADLINE')},notify:()=>void=()=>{throw Error('NO_WATCHER')},closed=0,cleared=0,readyReads=0
  const exports:any={}
  vm.runInNewContext(code,{exports,path:path.posix,fs:{
    existsSync:(name:string)=>files.has(name),
    readFileSync:(name:string)=>{if(name==='/owned/ready.json')readyReads++;return files.get(name)},
    watch:(directory:string,callback:()=>void)=>{assert.equal(directory,'/owned');notify=callback;return{close(){closed++}}},
  },setTimeout:(callback:()=>void,ms:number)=>{assert.equal(ms,10_000);deadline=callback;return 1},clearTimeout:(id:number)=>{assert.equal(id,1);cleared++}},{timeout:1000})
  const pending:Promise<unknown>=exports.receipt('/owned/ready.json',child,abort.signal,()=> 'OWNED_DIAGNOSTIC')
  return{files,child,abort,pending,expire:()=>deadline(),notify:()=>notify(),snapshot:()=>({closed,cleared,readyReads,closeListeners:child.listenerCount('close')})}
}

test('758 original deadline reconciles an opaque completed receipt when the watch event is lost',async()=>{
  const c=controller(),opaque={owned:'opaque receipt, not a fabricated native identity'}
  c.files.set('/owned/ready.json',JSON.stringify(opaque));c.expire()
  assert.deepEqual(JSON.parse(JSON.stringify(await c.pending)),opaque)
  assert.deepEqual(c.snapshot(),{closed:1,cleared:1,readyReads:1,closeListeners:0})
})

test('758 original deadline preserves a recorded failure before ready including both files',async()=>{
  for(const ready of [false,true]){
    const c=controller(),rejected=assert.rejects(c.pending,(error:any)=>/OWNED_ACTIVITY_FIXTURE_FAILED/.test(error.message)&&/OWNED_FAILURE/.test(error.message)&&!/NOT_READY/.test(error.message))
    c.files.set('/owned/failure.json',JSON.stringify({phase:'CONTENT_RENDERED',type:'OWNED_FAILURE'}))
    if(ready)c.files.set('/owned/ready.json','{}')
    c.expire();await rejected
    assert.deepEqual(c.snapshot(),{closed:1,cleared:1,readyReads:0,closeListeners:0})
  }
})

test('758 absent receipt still fails at the original deadline and later output cannot rescue it',async()=>{
  const c=controller(),rejected=assert.rejects(c.pending,/OWNED_ACTIVITY_FIXTURE_NOT_READY OWNED_DIAGNOSTIC/)
  c.expire();await rejected
  c.files.set('/owned/ready.json','{}');c.notify()
  await assert.rejects(c.pending,/OWNED_ACTIVITY_FIXTURE_NOT_READY OWNED_DIAGNOSTIC/)
  assert.equal(c.snapshot().closed,1);assert.equal(c.snapshot().closeListeners,0)
})

test('758 a closed or aborted child cannot be rescued by deadline reconciliation',async()=>{
  for(const reason of ['close','abort']){
    const c=controller(),expected=reason==='close'?/OWNED_ACTIVITY_FIXTURE_CLOSED/:/OWNED_ABORT/
    const rejected=assert.rejects(c.pending,expected)
    c.files.set('/owned/ready.json','{}')
    if(reason==='close')c.child.emit('close');else c.abort.abort(Error('OWNED_ABORT'))
    await rejected;c.expire();await assert.rejects(c.pending,expected)
    assert.equal(c.snapshot().closed,1);assert.equal(c.snapshot().closeListeners,0)
  }
})

test('758 malformed receipt at the deadline remains a failure rather than readiness',async()=>{
  for(const name of ['ready.json','failure.json']){
    const c=controller(),rejected=assert.rejects(c.pending,(error:any)=>error.name==='SyntaxError')
    c.files.set('/owned/'+name,'{');c.expire();await rejected
    assert.equal(c.snapshot().closed,1);assert.equal(c.snapshot().closeListeners,0)
  }
})

test('758 a watch-delivered failure remains authoritative after a stale deadline callback',async()=>{
  const c=controller(),rejected=assert.rejects(c.pending,/OWNED_ACTIVITY_FIXTURE_FAILED/)
  c.files.set('/owned/failure.json','{}');c.notify();await rejected
  c.files.delete('/owned/failure.json');c.files.set('/owned/ready.json','{}');c.expire()
  await assert.rejects(c.pending,/OWNED_ACTIVITY_FIXTURE_FAILED/)
  assert.equal(c.snapshot().closed,1);assert.equal(c.snapshot().closeListeners,0)
})
