/** Test-only fixed compiler producer. The GUI runs as a separate owned process. */
import fs from 'node:fs'
import path from 'node:path'
import { execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
const exec=promisify(execFile)
type Options={signal:AbortSignal;timeout:number;maxBuffer:number;windowsHide:boolean}
type Compiler=(file:string,args:string[],options:Options)=>Promise<unknown>
type CompilerStart=(file:string,args:string[],options:Options)=>Promise<unknown>&{child:ChildProcess}
/** execFile cancellation rejects before close. Join the actual child before cleanup. */
export async function runOwnedCompiler758(file:string,args:string[],options:Options,start:CompilerStart=exec):Promise<void>{
  const pending=start(file,args,options)
  const closed=new Promise<void>(resolve=>pending.child.once('close',()=>resolve()))
  try{await pending}finally{await closed}
}
export async function buildOwnedWpf758(root:string,signal:AbortSignal,compile:Compiler=runOwnedCompiler758,systemRoot=process.env.SystemRoot||'C:\\Windows'):Promise<string>{
  signal.throwIfAborted()
  const framework=path.join(systemRoot,'Microsoft.NET','Framework64','v4.0.30319')
  const compiler=path.join(framework,'csc.exe'),output=path.join(root,'activity-fixture.exe')
  if(fs.existsSync(output))throw Error('OWNED_ACTIVITY_BUILD_REUSE_REFUSED')
  if(!fs.statSync(compiler).isFile())throw Error('OWNED_ACTIVITY_COMPILER_UNAVAILABLE')
  const references=['System.dll','System.Core.dll','System.Web.Extensions.dll','System.Xaml.dll','PresentationFramework.dll','PresentationCore.dll','WindowsBase.dll'].map(name=>{
    const file=[path.join(framework,'WPF',name),path.join(framework,name)].find(file=>fs.existsSync(file)&&fs.statSync(file).isFile())
    if(!file)throw Error('OWNED_ACTIVITY_REFERENCE_MISSING '+name)
    return '/reference:'+file
  })
  try{
    await compile(compiler,['/noconfig','/nologo','/utf8output','/target:winexe','/platform:anycpu','/out:'+output,...references,path.resolve('tests/fixtures/activity-windows-758.cs')],{signal,timeout:10_000,maxBuffer:4096,windowsHide:true})
    signal.throwIfAborted()
    if(!fs.statSync(output).isFile()||fs.statSync(output).size===0)throw Error('OWNED_ACTIVITY_BINARY_MISSING')
    return output
  }catch(error){fs.rmSync(output,{force:true});throw error}
}
