/** Actual controller function, inert owned files/child; no native desktop. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import ts from 'typescript'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { buildOwnedWpf758, runOwnedCompiler758 } from './helpers/activity-native-fixture-758'

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

function ownedCompiler(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'activity758-compiler-'))
  const framework=path.join(root,'system','Microsoft.NET','Framework64','v4.0.30319')
  fs.mkdirSync(path.join(framework,'WPF'),{recursive:true});fs.mkdirSync(path.join(root,'output'))
  for(const name of ['csc.exe','System.dll','System.Core.dll','System.Web.Extensions.dll','System.Xaml.dll'])fs.writeFileSync(path.join(framework,name),'INERT_OWNED_NOT_EXECUTED')
  for(const name of ['PresentationFramework.dll','PresentationCore.dll','WindowsBase.dll'])fs.writeFileSync(path.join(framework,'WPF',name),'INERT_OWNED_NOT_EXECUTED')
  return {root,framework,output:path.join(root,'output'),system:path.join(root,'system')}
}
test('#758 actual fixed compiler producer binds WPF references, argv and fresh output before a GUI can start',async()=>{
  const owned=ownedCompiler(),signal=new AbortController().signal
  try{
    let calls=0
    const binary=await buildOwnedWpf758(owned.output,signal,async(file,args,options)=>{
      calls++;assert.equal(file,path.join(owned.framework,'csc.exe'));assert.equal(options.signal,signal)
      assert.equal(options.timeout,10000);assert.equal(options.windowsHide,true);assert.equal(options.maxBuffer,4096)
      assert.ok(args.includes('/target:winexe'));assert.ok(args.includes('/noconfig'));assert.equal(args.filter(v=>v.startsWith('/reference:')).length,7)
      assert.equal(args.at(-1),path.resolve('tests/fixtures/activity-windows-758.cs'))
      assert.ok(args.includes('/out:'+path.join(owned.output,'activity-fixture.exe')))
      // Inert compiler boundary only. This file is never executed or called a real PE.
      fs.writeFileSync(path.join(owned.output,'activity-fixture.exe'),'INERT_OWNED_NOT_EXECUTED',{flag:'wx'})
    },owned.system)
    assert.equal(calls,1);assert.equal(binary,path.join(owned.output,'activity-fixture.exe'))
    await assert.rejects(buildOwnedWpf758(owned.output,signal,async()=>{throw Error('MUST_NOT_REUSE')},owned.system),/REUSE_REFUSED/)
  }finally{fs.rmSync(owned.root,{recursive:true,force:true})}
})
test('#758 actual compiler producer refuses missing references, failed compile and cancellation without admitting a binary',async()=>{
  const owned=ownedCompiler()
  try{
    const reference=path.join(owned.framework,'WPF','WindowsBase.dll'),bytes=fs.readFileSync(reference);fs.unlinkSync(reference)
    let calls=0
    const compile=async()=>{calls++;fs.writeFileSync(path.join(owned.output,'activity-fixture.exe'),'INERT_PARTIAL');throw Error('OWNED_COMPILER_FAILED')}
    await assert.rejects(buildOwnedWpf758(owned.output,new AbortController().signal,compile,owned.system),/REFERENCE_MISSING/);assert.equal(calls,0)
    fs.writeFileSync(reference,bytes)
    await assert.rejects(buildOwnedWpf758(owned.output,new AbortController().signal,compile,owned.system),/OWNED_COMPILER_FAILED/);assert.equal(calls,1);assert.equal(fs.existsSync(path.join(owned.output,'activity-fixture.exe')),false)
    const abort=new AbortController();abort.abort(Error('OWNED_CANCELLED'))
    await assert.rejects(buildOwnedWpf758(owned.output,abort.signal,compile,owned.system),/OWNED_CANCELLED/);assert.equal(calls,1)
    assert.equal(fs.existsSync(path.join(owned.output,'activity-fixture.exe')),false)
  }finally{fs.rmSync(owned.root,{recursive:true,force:true})}
})

// Real child/execFile producer, no compiler or desktop claim. Three minimal controls.
test('#758 compiler abort joins actual child close before rejecting to directory cleanup',async()=>{
  const exec=promisify(execFile)
  for(let attempt=0;attempt<3;attempt++){
    const oldAbort=new AbortController()
    const oldPending=exec(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:oldAbort.signal})
    let oldClosed=false
    const oldClose=new Promise<void>(resolve=>oldPending.child.once('close',()=>{oldClosed=true;resolve()}))
    oldAbort.abort()
    await assert.rejects(oldPending,(error:any)=>error.name==='AbortError')
    assert.equal(oldClosed,false,'original promise is not an actual close receipt')
    await oldClose
    const abort=new AbortController();let closed=false,calls=0
    const pending=runOwnedCompiler758(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:abort.signal,timeout:10000,maxBuffer:4096,windowsHide:true},(file,args,options)=>{
      calls++
      const actual=exec(file,args,options)
      actual.child.once('close',()=>{closed=true})
      abort.abort() // Actual AbortSignal/execFile producer; observe its actual child.
      return actual
    })
    await assert.rejects(pending,(error:any)=>error.name==='AbortError')
    assert.equal(calls,1);assert.equal(closed,true,'caller may only clean up after actual close')
  }
})
