/** Hosted test-only observer. The production picker's cached promisify closure stays intact. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ChildProcess } from 'node:child_process'
import { pickFolderNative, buildWindowsFolderPickScript, resolveWindowsPowerShell, WORKSPACE_FOLDER_PROMPT } from '../../src/obsidian/folder-picker'
import { OSASCRIPT_BIN } from '../../src/process-path'
import { types } from 'node:util'

/** Closed test-only observations; never include picker paths, argv, errors or PIDs. */
export type WorkspacePickerLifecycle705={mode:0|1|2|3;childClosed:boolean;childExit:number|null;childSignal:0|1|2|3|4;childError:boolean}
export function pickerOutcome705(value:unknown,expected:string):number {
 try {
  if(!value||typeof value!=='object'||types.isProxy(value))return 6
  const proto=Object.getPrototypeOf(value);if(proto!==Object.prototype&&proto!==null)return 6
  const d=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(d)
  if(keys.length!==1)return 6
  if(keys[0]==='path'&&d.path&&'value'in d.path&&typeof d.path.value==='string')return d.path.value===expected?2:3
  if(keys[0]==='error'&&d.error&&'value'in d.error&&typeof d.error.value==='string')return d.error.value==='cancelled'?4:5
 }catch{/* Unknown is never an inferred cause. */}
 return 6
}
export function parseNativeWorkspaceDiagnostic705(value:unknown):{platform:1|2;phaseMask:number;failureSite:number;localPanels:number|null;ownedPanels:number|null;flags:number;flagsKnown:number}|null {
 if(typeof value!=='string'||value.length>100)return null
 const m=/^D476_WS_DIAG_([WM])_(0|[1-9][0-9]{0,3})_(0|[1-9][0-9]?)_([0-2X])_([0-2X])_(0|[1-9][0-9]{0,2})_(0|[1-9][0-9]?)$/.exec(value)
 if(!m)return null
 const phaseMask=Number(m[2]),failureSite=Number(m[3]),flags=Number(m[6]),flagsKnown=Number(m[7])
 if(phaseMask>(m[1]==='W'?127:1023)||failureSite>(m[1]==='W'?16:10)||flags>(m[1]==='W'?7:15)||flagsKnown>(m[1]==='W'?7:15)||(flags&~flagsKnown)!==0)return null
 return {platform:m[1]==='W'?1:2,phaseMask,failureSite,localPanels:m[4]==='X'?null:Number(m[4]),ownedPanels:m[5]==='X'?null:Number(m[5]),flags,flagsKnown}
}

const prompt=WORKSPACE_FOLDER_PROMPT.replace(/\\/g,'\\\\').replace(/"/g,'\\"')
const macScripts=[`tell application (path to frontmost application as text) to POSIX path of (choose folder with prompt "${prompt}")`,`POSIX path of (choose folder with prompt "${prompt}")`]
export async function observeWorkspacePicker476(onChild:(pid:number)=>void,onInvalid:()=>void,signal?:AbortSignal,onLifecycle?:(value:WorkspacePickerLifecycle705)=>void) {
 const prototype=ChildProcess.prototype as any,original=prototype.spawn
 let observed=0,diagnosticChild:ChildProcess|undefined
 const lifecycle:WorkspacePickerLifecycle705={mode:0,childClosed:false,childExit:null,childSignal:0,childError:false}
 const report=()=>{try{onLifecycle?.({...lifecycle})}catch{/* Diagnostic logger faults cannot change the picker. */}}
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
   try{diagnosticChild=this;lifecycle.mode=process.platform==='win32'?1:args[2]===macScripts[0]?2:3;lifecycle.childClosed=false;lifecycle.childExit=null;lifecycle.childSignal=0;lifecycle.childError=false;report()}catch{/* Passive only. */}
   if(!Number.isInteger(this.pid)||this.pid!<1){invalid();return result}
   owned.add(this);this.once('close',()=>owned.delete(this));if(signal?.aborted){try{this.kill()}catch{invalid()}}
   try{
    this.once('close',(code:number|null,signal:NodeJS.Signals|null)=>{try{if(diagnosticChild!==this)return;lifecycle.childClosed=true;lifecycle.childExit=Number.isInteger(code)&&code!>=0&&code!<=255?code:null;lifecycle.childSignal=signal==null?0:signal==='SIGTERM'?1:signal==='SIGKILL'?2:signal==='SIGABRT'?3:4;report()}catch{/* Passive only. */}})
    this.once('error',()=>{try{if(diagnosticChild!==this)return;lifecycle.childError=true;report()}catch{/* Never suppress the production error listener. */}})
   }catch{/* Observation cannot replace the original child result. */}
   observed++;try{onChild(this.pid!)}catch{invalid()}
  }catch{invalid()}
  return result
 }
 prototype.spawn=observer
 try{const result=await pickFolderNative(WORKSPACE_FOLDER_PROMPT);return{result,observed}}
 finally{prototype.spawn=original;signal?.removeEventListener('abort',stop)}
}
