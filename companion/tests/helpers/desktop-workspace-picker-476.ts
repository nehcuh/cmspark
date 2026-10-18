/** Hosted test-only observer. The production picker's cached promisify closure stays intact. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ChildProcess } from 'node:child_process'
import { pickFolderNative, buildWindowsFolderPickScript, resolveWindowsPowerShell, WORKSPACE_FOLDER_PROMPT } from '../../src/obsidian/folder-picker'
import { OSASCRIPT_BIN } from '../../src/process-path'

const prompt=WORKSPACE_FOLDER_PROMPT.replace(/\\/g,'\\\\').replace(/"/g,'\\"')
const macScripts=[`tell application (path to frontmost application as text) to POSIX path of (choose folder with prompt "${prompt}")`,`POSIX path of (choose folder with prompt "${prompt}")`]
export async function observeWorkspacePicker476(onChild:(pid:number)=>void,onInvalid:()=>void,signal?:AbortSignal) {
 const prototype=ChildProcess.prototype as any,original=prototype.spawn
 let observed=0
 const owned=new Set<ChildProcess>();const stop=()=>{for(const child of owned){try{child.kill()}catch{/* Exact observed handle cleanup only. */}}}
 signal?.throwIfAborted();signal?.addEventListener('abort',stop,{once:true})
 const invalid=()=>{try{onInvalid()}catch{/* Passive observation cannot replace the picker result. */}}
 function observer(this:ChildProcess,options:any){
  // Do not inspect, clone, print or change envPairs or any process options.
  const result=Reflect.apply(original,this,[options])
  try{
   const args=options.args
   if(!Array.isArray(args)||typeof options.file!=='string')return result
   let matched=false
   if(process.platform==='win32'){
    if(options.file!==resolveWindowsPowerShell()||args[0]!==options.file)return result
    // Node's normalized argv is file + the six unchanged picker arguments.
   }else if(process.platform==='darwin'){
    matched=options.file===OSASCRIPT_BIN&&args.length===3&&args[0]===options.file&&args[1]==='-e'&&macScripts.includes(args[2])
   }
   if(process.platform==='win32'){
    const script=args.at(-1)
    if(args.length!==7||args[1]!=='-NoProfile'||args[2]!=='-STA'||args[3]!=='-WindowStyle'||args[4]!=='Hidden'||args[5]!=='-File'||typeof script!=='string'||options.windowsHide!==false||path.dirname(script)!==os.tmpdir()||!new RegExp('^cmspark-pick-'+process.pid+'-[0-9]+\\.ps1$').test(path.basename(script)))return result
    const st=fs.lstatSync(script);matched=st.isFile()&&!st.isSymbolicLink()&&fs.readFileSync(script,'utf8')==='\uFEFF'+buildWindowsFolderPickScript(WORKSPACE_FOLDER_PROMPT)
   }
   if(!matched)return result
   if(!Number.isInteger(this.pid)||this.pid!<1){invalid();return result}
   owned.add(this);this.once('close',()=>owned.delete(this));if(signal?.aborted){try{this.kill()}catch{invalid()}}
   observed++;try{onChild(this.pid!)}catch{invalid()}
  }catch{invalid()}
  return result
 }
 prototype.spawn=observer
 try{const result=await pickFolderNative(WORKSPACE_FOLDER_PROMPT);return{result,observed}}
 finally{prototype.spawn=original;signal?.removeEventListener('abort',stop)}
}
