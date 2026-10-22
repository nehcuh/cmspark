/** Actual controller function, inert owned files/child; no native desktop. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import ts from 'typescript'

const file=path.resolve('tests/activity-platform-native-758.test.ts')
const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true)
const functions=source.statements.filter((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text==='receipt')
assert.equal(functions.length,1)
const code=ts.transpileModule(functions[0].getText(source)+'\nexports.receipt = receipt',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
const context={exports:{} as any,fs,path,setTimeout,clearTimeout}
new vm.Script(code,{filename:file}).runInNewContext(context)
const receipt=context.exports.receipt as (file:string,child:EventEmitter,signal:AbortSignal,diagnostic:()=>string)=>Promise<unknown>

test('#758 actual fixture controller preserves the finite first rejection when child closes',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'activity758-observer-'))
  const child=new EventEmitter()
  try{
    const pending=receipt(path.join(root,'ready.json'),child,new AbortController().signal,()=> 'OWNED_STDERR')
    fs.writeFileSync(path.join(root,'failure.json'),JSON.stringify({phase:'CONTENT_RENDERED',type:'OWNED_FAILURE',message:'OWNED_MESSAGE'}))
    child.emit('close')
    await assert.rejects(pending,(error:any)=>/OWNED_ACTIVITY_FIXTURE_FAILED/.test(error.message)&&/CONTENT_RENDERED/.test(error.message)&&!/FIXTURE_CLOSED/.test(error.message))
    assert.equal(child.listenerCount('close'),0)
  }finally{fs.rmSync(root,{recursive:true,force:true})}
})
test('#758 actual fixture controller keeps early process-close stderr and releases observers',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'activity758-observer-'))
  const child=new EventEmitter()
  try{
    const pending=receipt(path.join(root,'ready.json'),child,new AbortController().signal,()=> 'OWNED_STDERR')
    child.emit('close')
    await assert.rejects(pending,/OWNED_ACTIVITY_FIXTURE_CLOSED OWNED_STDERR/)
    assert.equal(child.listenerCount('close'),0)
  }finally{fs.rmSync(root,{recursive:true,force:true})}
})
test('#758 a ready file cannot turn an already observed child close into readiness',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'activity758-observer-'))
  const child=new EventEmitter()
  try{
    const pending=receipt(path.join(root,'ready.json'),child,new AbortController().signal,()=> 'OWNED_STDERR')
    fs.writeFileSync(path.join(root,'ready.json'),JSON.stringify({pid:123,hwnd:456}))
    child.emit('close')
    await assert.rejects(pending,/OWNED_ACTIVITY_FIXTURE_CLOSED/)
    assert.equal(child.listenerCount('close'),0)
  }finally{fs.rmSync(root,{recursive:true,force:true})}
})
