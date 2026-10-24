/** Native-only workspace actor. Selected paths never originate from a renderer. */
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import type { WebSocket } from 'ws'
import { ThreadManager } from '../threads/thread-manager'
import { redactSecrets } from '../threads/distill'
import { SecurityConfirmationManager, DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS } from '../security-confirmation'
import { acquireL2Admission, releaseL2Admission } from '../orchestrator/l2-admission'
import { snapshotRoot, assertRoot, list, read, type RootSnapshot } from './workspace-files'
import { workspaceFail, workspaceErrorCode, type WorkspaceCode } from './workspace-error'

export const DESKTOP_WORKSPACE_METHODS=['desktop.workspace.state','desktop.workspace.pick','desktop.workspace.list','desktop.workspace.read','desktop.workspace.cancel'] as const
export type WorkspaceRuntime={enabled():boolean;activity(thread:string):'idle'|'busy'|'unknown'}
type Frame=Record<string,unknown>
type Canonical=NonNullable<ReturnType<ThreadManager['desktopWorkspaceSnapshot']>>
type Snapshot={canonical:Canonical;root?:RootSnapshot;revision:string}
type Operation={id:string;thread:string;controller:AbortController;confirmation?:{id:string;digest:string;deadline:number;approved:boolean}}
const exact=(f:Frame,keys:string[])=>Object.keys(f).length===keys.length&&keys.every(k=>Object.hasOwn(f,k))
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=200
const revision=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
export function createDesktopWorkspace(opts:{threads:ThreadManager;runtime:WorkspaceRuntime;manager:SecurityConfirmationManager;ws:WebSocket;current():boolean;send(frame:Frame):boolean}){
 let snapshot:Snapshot|undefined,operation:Operation|undefined
 type Selection={op:Operation;revision:string;nonce:string;deadline:number;finish(value:{path?:string;error?:string},close:boolean):void}
 let selection:Selection|undefined
 function select(op:Operation,s:Snapshot):Promise<{path?:string;error?:string}>{
  return new Promise(resolve=>{
   const nonce=randomBytes(32).toString('hex'),deadline=Date.now()+120000
   let timer:ReturnType<typeof setTimeout>|undefined,settled=false
   const frame=(type:string)=>({type,request_id:op.id,thread_id:op.thread,revision:s.revision,pick_id:nonce})
   const abort=()=>finish({error:'cancelled'},true)
   const finish=(value:{path?:string;error?:string},close:boolean)=>{if(settled)return;settled=true;if(selection?.nonce===nonce)selection=undefined;if(timer)clearTimeout(timer);op.controller.signal.removeEventListener('abort',abort);if(close)try{opts.send(frame('desktop.workspace.picker.cancel'))}catch{/* Logical retirement is independent of transport. */}resolve(value)}
   selection={op,revision:s.revision,nonce,deadline,finish}
   op.controller.signal.addEventListener('abort',abort,{once:true})
   if(op.controller.signal.aborted){abort();return}
   timer=setTimeout(()=>finish({error:'unavailable'},true),Math.max(1,deadline-Date.now()));timer.unref?.()
   try{if(!opts.send({...frame('desktop.workspace.picker.request'),deadline_ms:deadline}))finish({error:'unavailable'},true)}catch{finish({error:'unavailable'},true)}
  })
 }
 function selected(f:Frame):boolean{
  const pending=selection;if(!pending||!active(pending.op))return false
  const fields=['type','request_id','thread_id','revision','pick_id','outcome'],outcome=f.outcome
  if(outcome==='selected')fields.push('path')
  if(!exact(f,fields)||f.type!=='desktop.workspace.picker.result'||f.request_id!==pending.op.id||f.thread_id!==pending.op.thread||f.revision!==pending.revision||f.pick_id!==pending.nonce)return false
  if(outcome==='selected'){
   if(typeof f.path!=='string'||!f.path||f.path.includes('\0')||!path.isAbsolute(f.path))return false
   if(Date.now()>=pending.deadline){pending.finish({error:'unavailable'},true);return false}
   pending.finish({path:f.path},false);return true
  }
  if(outcome!=='cancelled'&&outcome!=='unavailable')return false
  if(Date.now()>=pending.deadline){pending.finish({error:'unavailable'},true);return false}
  pending.finish({error:outcome},false);return true
 }
 function cancel(){operation?.controller.abort();operation=undefined;snapshot=undefined}
 function active(op?:Operation){return opts.current()&&(!op||operation===op&&!op.controller.signal.aborted)}
 function activity(thread:string){try{return opts.runtime.activity(thread)}catch{return 'unknown' as const}}
 function moduleState(): 'enabled'|'disabled'|'unavailable' {try{return opts.runtime.enabled()===true?'enabled':'disabled'}catch{return 'unavailable'}}
 function canonical(thread:string){if(!opts.threads.desktopMetadataSnapshot().some(t=>t.id===thread))workspaceFail('WORKSPACE_UNAVAILABLE');const value=opts.threads.desktopWorkspaceSnapshot(thread);if(!value)workspaceFail('WORKSPACE_UNAVAILABLE');return value}
 function check(s:Snapshot,op?:Operation,change=false){
  if(!active(op))workspaceFail('WORKSPACE_STALE');const module=moduleState();if(module!=='enabled')workspaceFail(module==='disabled'?'WORKSPACE_MODULE_DISABLED':'WORKSPACE_UNAVAILABLE')
  const c=canonical(s.canonical.id);if(c.updated_at!==s.canonical.updated_at||c.workspace_root!==s.canonical.workspace_root)workspaceFail('WORKSPACE_CONFLICT');if(s.root)assertRoot(s.root)
  if(change){const a=activity(c.id);if(a!=='idle')workspaceFail(a==='busy'?'WORKSPACE_BUSY':'WORKSPACE_ACTIVITY_UNKNOWN')}
 }
 function project(s:Snapshot){return{bound:!!s.root,display_name:s.root?redactSecrets(path.basename(s.root.path)).text:'',revision:s.revision,module:'enabled',activity:activity(s.canonical.id)}}
 function take(thread:string){const c=canonical(thread),root=c.workspace_root?snapshotRoot(c.workspace_root):undefined;return{canonical:c,root,revision:randomBytes(32).toString('hex')}}
 async function handle(f:Frame):Promise<Frame>{
  const type=String(f.type),thread=f.thread_id as string,common={type:type+'.result',id:f.id,thread_id:f.thread_id}
  const fail=(code:WorkspaceCode,outcome?:string):Frame=>({...common,ok:false,error_code:code,...(type==='desktop.workspace.pick'?{outcome:outcome||'unavailable'}:{})})
  const keys=type===DESKTOP_WORKSPACE_METHODS[0]?['type','id','thread_id']:type===DESKTOP_WORKSPACE_METHODS[4]?['type','id','thread_id','operation_id']:type===DESKTOP_WORKSPACE_METHODS[1]?['type','id','thread_id','revision']:type===DESKTOP_WORKSPACE_METHODS[2]&&!Object.hasOwn(f,'path')?['type','id','thread_id','revision']:['type','id','thread_id','revision','path']
  if(!(DESKTOP_WORKSPACE_METHODS as readonly string[]).includes(type)||!exact(f,keys)||!id(f.id)||typeof thread!=='string'||!ThreadManager.isSafeThreadId(thread)||(type===DESKTOP_WORKSPACE_METHODS[4]&&!id(f.operation_id))||([DESKTOP_WORKSPACE_METHODS[2],DESKTOP_WORKSPACE_METHODS[3]]as string[]).includes(type)&&f.path!==undefined&&typeof f.path!=='string')return fail('WORKSPACE_INPUT_INVALID')
  if(!opts.current())return fail('WORKSPACE_STALE')
  if(type===DESKTOP_WORKSPACE_METHODS[4]){const matched=!!operation&&operation.id===f.operation_id&&operation.thread===thread;if(matched)cancel();return{...common,ok:true,cancelled:matched,operation_id:f.operation_id}}
  try{
   if(type===DESKTOP_WORKSPACE_METHODS[0]){
    cancel();const c=canonical(thread)
    const module=moduleState();if(module!=='enabled')return{...common,ok:true,state:{bound:!!c.workspace_root,display_name:'',revision:null,module,activity:activity(thread)}}
    try { snapshot=take(thread);return{...common,ok:true,state:project(snapshot)} }
    catch { return {...common,ok:true,state:{bound:!!c.workspace_root,display_name:'',revision:null,module:'unavailable',activity:activity(thread)}} }
   }
   const module=moduleState();if(module!=='enabled')return fail(module==='disabled'?'WORKSPACE_MODULE_DISABLED':'WORKSPACE_UNAVAILABLE')
   const s=snapshot;if(!s||s.canonical.id!==thread||!revision(f.revision)||s.revision!==f.revision)return fail('WORKSPACE_STALE')
   check(s)
   if(type===DESKTOP_WORKSPACE_METHODS[2]||type===DESKTOP_WORKSPACE_METHODS[3]){
    if(!s.root)return fail('WORKSPACE_UNBOUND')
    const value=type===DESKTOP_WORKSPACE_METHODS[2]?list(s.root,f.path as string|undefined):read(s.root,f.path as string);check(s);return{...common,ok:true,revision:s.revision,...value}
   }
   if(operation)return fail('WORKSPACE_BUSY')
   check(s,undefined,true)
   const op:Operation={id:f.id,thread,controller:new AbortController()};operation=op;let admission:string|undefined,commitStarted=false
   try{
    const picked=await select(op,s);if(op.controller.signal.aborted)return fail('WORKSPACE_CANCELLED','cancelled');check(s,op,true)
    if(picked.error==='cancelled')return fail('WORKSPACE_CANCELLED','cancelled');if(typeof picked.path!=='string')return fail('WORKSPACE_UNAVAILABLE')
    const root=snapshotRoot(picked.path);check(s,op,true)
    const slot=await acquireL2Admission({threadId:thread});if(!slot.ok)return fail('WORKSPACE_BUSY');admission=slot.key;check(s,op,true);assertRoot(root)
    const action={purpose:'workspace',op:'bind',thread_id:thread,revision:s.revision,path:root.path},actionJSON=JSON.stringify(action),digest=createHash('sha256').update(actionJSON).digest('hex'),deadline=Date.now()+DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS
    let delivered=true
    const decision=await opts.manager.request(data=>{
     if(data.type==='security.confirmation.request'){
      op.confirmation={id:data.confirmation_id,digest,deadline,approved:false}
      try{delivered=opts.send({type:'desktop.confirmation.request',purpose:'workspace',request_method:type,request_id:f.id,confirmation_id:data.confirmation_id,thread_id:thread,action_digest:digest,action_json:actionJSON,deadline_ms:deadline,timeout_ms:data.timeout_ms})!==false}catch{delivered=false}
      if(!delivered)op.controller.abort()
     }else if(data.type==='security.confirmation.resolved'||data.type==='security.confirmation.expired'){
      try{opts.send({type:'desktop.confirmation.resolved',confirmation_id:op.confirmation?.id,approved:data.approved===true})}catch{/* Delivery cannot change manager settlement. */}
     }
    },{toolName:'desktop.workspace.pick',dangerousApis:['workspace.bind'],criticalApis:['workspace.bind'],code:'为指定对话绑定所选工作目录；只读文件能力不授权执行、写入或终端。',autoConfirmEligible:false,riskLevel:'high'},{originWs:opts.ws,signal:op.controller.signal})
    if(!delivered)return fail('WORKSPACE_UNAVAILABLE')
    if(!decision.approved||!op.confirmation?.approved)return fail(op.controller.signal.aborted?'WORKSPACE_CANCELLED':'WORKSPACE_DENIED',op.controller.signal.aborted?'cancelled':'denied')
    check(s,op,true);assertRoot(root);if(Date.now()>=deadline)workspaceFail('WORKSPACE_STALE')
    commitStarted=true
    const updated=opts.threads.updateDesktopWorkspace(s.canonical,root.path,()=>{check(s,op,true);assertRoot(root);return Date.now()<deadline})
    if(!updated)return fail('WORKSPACE_CONFLICT','conflict')
    snapshot={canonical:updated,root,revision:randomBytes(32).toString('hex')}
    return{...common,ok:true,outcome:'committed',state:project(snapshot)}
   }catch(error){return fail(commitStarted?'WORKSPACE_UNCONFIRMED':workspaceErrorCode(error),commitStarted?'unconfirmed':workspaceErrorCode(error)==='WORKSPACE_CONFLICT'?'conflict':'unavailable')}
   finally{if(admission)releaseL2Admission(admission);if(operation===op)operation=undefined}
  }catch(error){return fail(workspaceErrorCode(error))}
 }
 function decide(f:Frame){const op=operation,p=op?.confirmation;if(!op||!p||!exact(f,['type','purpose','confirmation_id','thread_id','action_digest','approved'])||f.purpose!=='workspace'||f.thread_id!==op.thread||f.confirmation_id!==p.id||f.action_digest!==p.digest||typeof f.approved!=='boolean'||!active(op)||Date.now()>=p.deadline)return false;p.approved=f.approved;const accepted=opts.manager.respondFrom(p.id,f.approved,opts.ws).outcome==='resolved';if(!accepted)p.approved=false;return accepted}
 return{handle,decide,cancel,selected}
}
