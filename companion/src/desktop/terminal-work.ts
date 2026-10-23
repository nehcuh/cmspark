/** Trusted native local-work actor. Runtime IDs, paths and launch data are private. */
import {createHash,randomBytes} from 'node:crypto'
import type {WebSocket} from 'ws'
import {ThreadManager} from '../threads/thread-manager'
import {redactSecrets} from '../threads/distill'
import {SecurityConfirmationManager,DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS} from '../security-confirmation'
import {acquireL2Admission,releaseL2Admission} from '../orchestrator/l2-admission'
import {snapshotRoot,assertRoot,type RootSnapshot} from './terminal-root'
export const DESKTOP_TERMINAL_METHODS=['desktop.local.state','desktop.terminal.open','desktop.terminal.input','desktop.terminal.resize','desktop.terminal.ack','desktop.terminal.ping','desktop.terminal.close','desktop.terminal.return'] as const
export type TerminalFrame=Record<string,unknown>
export type DesktopTerminalRuntime={
 modules():{terminal:boolean;agent:false};activity(thread:string):'idle'|'busy'|'unknown'
 shell():{file:string;args:readonly string[]}
 openTerminal(input:{id:string;threadId:string;owner:WebSocket;cwd:string;cols:number;rows:number;shell:{file:string;args:readonly string[]};send(frame:TerminalFrame):void}):{ok:boolean}
 terminalContext(id:string,owner:WebSocket):boolean;terminalBusy():boolean
 input(id:string,b64:string):{ok:boolean};resize(id:string,cols:number,rows:number):{ok:boolean};ack(id:string,seq:number):{ok:boolean};ping(id:string):{ok:boolean};close(id:string):{ok:boolean}
}
type Canonical=NonNullable<ReturnType<ThreadManager['desktopLocalWorkSnapshot']>>
type Snapshot={canonical:Canonical;root:RootSnapshot;revision:string;modules:{terminal:boolean;agent:boolean}}
type Operation={id:string;thread:string;kind:'terminal';snapshot:Snapshot;controller:AbortController;pending?:AbortController;confirmation?:{id:string;digest:string;deadline:number;approved:boolean};status:'pending'|'starting'|'running'|'closed';retired:boolean;lastInput:number;lastOutput:number;returnText?:string;returnResult?:TerminalFrame}
const exact=(v:TerminalFrame,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k))
const identifier=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&Buffer.byteLength(v,'utf8')<=200
const boundedText=(v:unknown,max:number):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=max&&!v.includes('\0')
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0
const safe=(v:string)=>redactSecrets(v).text
function refuse(code='LOCAL_UNAVAILABLE'):never{throw Error(code)}
const errorCodes=new Set(['LOCAL_UNAVAILABLE','LOCAL_STALE','LOCAL_INPUT_INVALID','LOCAL_BUSY','LOCAL_ACTIVITY_UNKNOWN','LOCAL_MODULE_DISABLED','LOCAL_UNBOUND','LOCAL_CONFLICT','LOCAL_DENIED','LOCAL_CANCELLED','LOCAL_NOT_OWNED','LOCAL_NO_AGENT','LOCAL_UNCONFIRMED'])
function code(error:unknown){return error instanceof Error&&errorCodes.has(error.message)?error.message:'LOCAL_UNAVAILABLE'}
/** Idempotence is bounded by current canonical history, not a cross-file transaction. */
export function commitLocalWorkMessage(threads:ThreadManager,thread:string,messageId:string,text:string,current:()=>boolean){
 if(!current())refuse('LOCAL_STALE')
 const history=threads.readDesktopDialog(thread),prior=history.messages.find(m=>m.id===messageId)
 if(prior){if(prior.role!=='assistant'||prior.content!==text)refuse('LOCAL_CONFLICT');return prior.id}
 if(!current())refuse('LOCAL_STALE')
 threads.addMessage(thread,{id:messageId,thread_id:thread,role:'assistant',content:text})
 // addMessage may have written messages then failed its separate index write. Its throw is UNKNOWN.
 const committed=threads.readDesktopDialog(thread).messages.find(m=>m.id===messageId)
 if(!committed||committed.content!==text)refuse('LOCAL_UNCONFIRMED')
 return committed.id
}
export function createDesktopTerminalWork(opts:{threads:ThreadManager;runtime:DesktopTerminalRuntime;manager:SecurityConfirmationManager;ws:WebSocket;current():boolean;send(frame:TerminalFrame):boolean;maxPayload:number}){
 let snapshot:Snapshot|undefined,viewThread:string|undefined
 const operations=new Map<string,Operation>()
 function emit(frame:TerminalFrame){try{return opts.current()&&opts.send(frame)!==false}catch{return false}}
 function canonical(thread:string){
  if(!opts.threads.desktopMetadataSnapshot().some(t=>t.id===thread))return refuse('LOCAL_UNAVAILABLE')
  const c=opts.threads.desktopLocalWorkSnapshot(thread);if(!c)return refuse('LOCAL_UNAVAILABLE')
  if(!c.allowed)return refuse('LOCAL_DENIED')
  return c
 }
 function modules(){const m=opts.runtime.modules();if(typeof m.terminal!=='boolean'||m.agent!==false)return refuse();return m}
 function active(op:Operation){return opts.current()&&!op.retired&&operations.get(op.id)===op}
 function check(s:Snapshot,op?:Operation,starting=false){
  if(!opts.current()||op&&!active(op))refuse('LOCAL_STALE')
  const c=canonical(s.canonical.id);if(c.policy!==s.canonical.policy||c.role!==s.canonical.role||c.workspace_root!==s.canonical.workspace_root||starting&&c.updated_at!==s.canonical.updated_at)refuse('LOCAL_CONFLICT');assertRoot(s.root)
  const m=modules();if(m.terminal!==s.modules.terminal||m.agent!==s.modules.agent)refuse('LOCAL_MODULE_DISABLED')
  if(starting){const a=opts.runtime.activity(c.id);if(a!=='idle')refuse(a==='busy'?'LOCAL_BUSY':'LOCAL_ACTIVITY_UNKNOWN')}
 }
 function abortPending(){for(const op of operations.values()){op.pending?.abort();if(op.status==='pending'){op.controller.abort();op.retired=true;operations.delete(op.id)}}snapshot=undefined}
 function cancel(){snapshot=undefined;viewThread=undefined;for(const op of operations.values()){op.retired=true;op.pending?.abort();op.controller.abort();try{if(op.status==='running'&&opts.runtime.terminalContext(op.id,opts.ws))opts.runtime.close(op.id);}catch{/* Continue retiring every owned operation. */}}operations.clear()}
 function lookup(f:TerminalFrame){const op=operations.get(String(f.operation_id));if(!op||op.thread!==f.thread_id||!active(op))return refuse('LOCAL_NOT_OWNED');return op}
 function event(op:Operation,f:TerminalFrame){
  if(!active(op)||op.controller.signal.aborted)return
  {
   if(f.type==='terminal.data'){
    if(op.status==='closed')return
    if(!positive(f.seq)||typeof f.b64!=='string')return;op.lastOutput=f.seq
    emit({type:'desktop.terminal.data',thread_id:op.thread,operation_id:op.id,seq:f.seq,b64:f.b64})
   }else if(f.type==='terminal.heartbeat'){if(op.status!=='closed')emit({type:'desktop.terminal.heartbeat',thread_id:op.thread,operation_id:op.id})
   }else if(f.type==='terminal.closed'){op.status='closed';emit({type:'desktop.terminal.closed',thread_id:op.thread,operation_id:op.id,status:'closed'})}
   return
  }
 }
 async function confirm(op:Operation,kind:string,payload:TerminalFrame,method:string,starting=false):Promise<boolean>{
  if(op.pending||viewThread!==op.thread)return false
  check(op.snapshot,op,starting)
  const controller=new AbortController();op.pending=controller;let admission:string|undefined
  try{
   const slot=await acquireL2Admission({threadId:op.thread});if(!slot.ok)return false;admission=slot.key;check(op.snapshot,op,starting)
   if(controller.signal.aborted)return false
   const action={purpose:'local-work',kind,thread_id:op.thread,operation_id:op.id,payload:{...payload,thread_title:safe(canonical(op.thread).title)}},actionJSON=JSON.stringify(action),digest=createHash('sha256').update(actionJSON).digest('hex'),deadline=Date.now()+DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS
   if(Buffer.byteLength(actionJSON,'utf8')>opts.maxPayload)return false
   let delivered=true
   const decision=await opts.manager.request(data=>{
    if(data.type==='security.confirmation.request'){
     op.confirmation={id:data.confirmation_id,digest,deadline,approved:false}
     delivered=emit({type:'desktop.confirmation.request',purpose:'local-work',request_method:method,request_id:op.id,confirmation_id:data.confirmation_id,thread_id:op.thread,action_digest:digest,action_json:actionJSON,deadline_ms:deadline,timeout_ms:data.timeout_ms})
     if(!delivered)controller.abort()
    }else if(data.type==='security.confirmation.resolved'||data.type==='security.confirmation.expired')emit({type:'desktop.confirmation.resolved',confirmation_id:op.confirmation?.id,approved:data.approved===true})
   },{toolName:method,dangerousApis:['local-work'],criticalApis:['local-work'],code:'原生用户终端：shell可执行命令与离开起始目录；非OS沙箱。本次同意不授予模型读取终端尾部。',riskLevel:'high',autoConfirmEligible:false},{originWs:opts.ws,signal:controller.signal})
   check(op.snapshot,op,starting)
   return delivered&&!controller.signal.aborted&&decision.approved===true&&op.confirmation?.approved===true&&Date.now()<deadline
  }finally{if(admission)releaseL2Admission(admission);if(op.pending===controller)op.pending=undefined;op.confirmation=undefined}
 }
 function decide(f:TerminalFrame){
  if(!exact(f,['type','purpose','confirmation_id','thread_id','action_digest','approved'])||f.purpose!=='local-work'||typeof f.approved!=='boolean')return false
  const op=[...operations.values()].find(o=>o.confirmation?.id===f.confirmation_id),p=op?.confirmation
  if(!op||!p||!active(op)||viewThread!==op.thread||op.thread!==f.thread_id||p.digest!==f.action_digest||Date.now()>=p.deadline||op.pending?.signal.aborted)return false
  p.approved=f.approved;const accepted=opts.manager.respondFrom(p.id,f.approved,opts.ws).outcome==='resolved';if(!accepted)p.approved=false;return accepted
 }
 const fields:Record<string,string[]>={
  'desktop.local.state':[],'desktop.terminal.open':['revision','cols','rows'],'desktop.terminal.input':['operation_id','seq','b64'],'desktop.terminal.resize':['operation_id','cols','rows'],'desktop.terminal.ack':['operation_id','seq'],'desktop.terminal.ping':['operation_id'],'desktop.terminal.close':['operation_id'],'desktop.terminal.return':['operation_id','text']}
 async function handle(f:TerminalFrame):Promise<TerminalFrame>{
  const type=String(f.type),base={type:type+'.result',id:f.id,thread_id:f.thread_id},fail=(error_code:string)=>({...base,ok:false,error_code})
  if(!Object.hasOwn(fields,type)||!exact(f,['type','id','thread_id',...fields[type]])||!identifier(f.id)||typeof f.thread_id!=='string'||!ThreadManager.isSafeThreadId(f.thread_id))return fail('LOCAL_INPUT_INVALID')
  if(!opts.current())return fail('LOCAL_STALE')
  try{
   if(type==='desktop.local.state'){
    abortPending();viewThread=f.thread_id;const c=canonical(f.thread_id),m=modules();let revision:string|null=null
    if(c.workspace_root&&(m.terminal||m.agent)){try{snapshot={canonical:c,root:snapshotRoot(c.workspace_root),modules:m,revision:randomBytes(32).toString('hex')};revision=snapshot.revision}catch{snapshot=undefined}}
    const agents:never[]=[] // This desktop Agent adapter is unshipped; never inspect configured agents.
    return{...base,ok:true,state:{platform:process.platform==='win32'?'windows':process.platform==='darwin'?'macos':'unsupported',bound:!!snapshot,revision,modules:m,agents,operations:[...operations.values()].filter(o=>active(o)&&o.thread===f.thread_id).map(o=>({operation_id:o.id,kind:o.kind,status:o.status}))}}
   }
   if(type==='desktop.terminal.open'){
    const s=snapshot;if(!s||s.canonical.id!==f.thread_id||s.revision!==f.revision||viewThread!==f.thread_id)return fail('LOCAL_STALE')
    check(s,undefined,true)
    const kind='terminal' as const
    if(!s.modules[kind])return fail('LOCAL_MODULE_DISABLED')
    if(operations.has(f.id)||[...operations.values()].some(o=>active(o)&&o.thread===f.thread_id&&o.status!=='closed'))return fail('LOCAL_BUSY')
    if(!positive(f.cols)||f.cols>500||!positive(f.rows)||f.rows>200)return fail('LOCAL_INPUT_INVALID')
    const op:Operation={id:f.id,thread:f.thread_id,kind,snapshot:s,controller:new AbortController(),status:'pending',retired:false,lastInput:0,lastOutput:0};operations.set(op.id,op);snapshot=undefined
    const shell=opts.runtime.shell()
    try{
     const approved=await confirm(op,'terminal-open',{revision:s.revision,root:s.root.path,shell:shell.file,args:[...shell.args]},type,true)
     if(!approved)return fail('LOCAL_DENIED');check(s,op,true)
     {if(opts.runtime.terminalBusy()||JSON.stringify(opts.runtime.shell())!==JSON.stringify(shell))return fail('LOCAL_CONFLICT');const r=opts.runtime.openTerminal({id:op.id,threadId:op.thread,owner:opts.ws,cwd:s.root.path,cols:f.cols as number,rows:f.rows as number,shell:shell!,send:frame=>event(op,frame)});if(!r.ok)return fail('LOCAL_UNAVAILABLE');op.status='running';for(const prior of operations.values()){if(prior!==op&&prior.status==='closed'){prior.pending?.abort();prior.controller.abort();prior.retired=true;operations.delete(prior.id)}}}
     return{...base,ok:true,operation_id:op.id,status:op.status}
    }finally{if(op.status==='pending'){op.retired=true;op.controller.abort();operations.delete(op.id)}}
   }
   if(!identifier(f.operation_id))return fail('LOCAL_INPUT_INVALID');const op=lookup(f)
   if(type==='desktop.terminal.close'){
    if(op.status==='running'&&!opts.runtime.terminalContext(op.id,opts.ws))return fail('LOCAL_NOT_OWNED')
    op.pending?.abort();op.controller.abort();if(op.status==='running')opts.runtime.close(op.id);op.status='closed'
    return{...base,ok:true,operation_id:op.id,status:'closed'}
   }
   check(op.snapshot,op)
   if(type==='desktop.terminal.return'){
    if(op.kind!=='terminal'||!boundedText(f.text,48000)||viewThread!==op.thread)return fail('LOCAL_INPUT_INVALID')
    const text='【用户选择的终端摘录 · 未验证执行结果 · partial】\n\n'+safe(f.text)
    if(op.returnResult)return op.returnText===text?{...op.returnResult,id:f.id}:fail('LOCAL_CONFLICT')
    if(!await confirm(op,'terminal-return',{text,partial:true},type))return fail('LOCAL_DENIED')
    op.returnText=text
    try{const messageId=commitLocalWorkMessage(opts.threads,op.thread,'local_'+randomBytes(16).toString('hex'),text,()=>{try{check(op.snapshot,op);return true}catch{return false}});op.returnResult={...base,ok:true,status:'saved',operation_id:op.id,message_id:messageId,partial:true}}
    catch{op.returnResult={...base,ok:false,status:'unknown',operation_id:op.id,error_code:'LOCAL_UNCONFIRMED'}}
    return op.returnResult
   }
   if(op.controller.signal.aborted)return fail('LOCAL_STALE')
   if(['desktop.terminal.input','desktop.terminal.resize'].includes(type)&&viewThread!==op.thread)return fail('LOCAL_STALE')
   if(op.status!=='running')return fail('LOCAL_STALE')
   if(op.kind!=='terminal'||!opts.runtime.terminalContext(op.id,opts.ws))return fail('LOCAL_NOT_OWNED')
   let result:{ok:boolean}
   if(type==='desktop.terminal.input'){
    if(!positive(f.seq)||f.seq<=op.lastInput||typeof f.b64!=='string'||!f.b64||f.b64.length>4*Math.ceil(16384/3)||f.b64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(f.b64))return fail('LOCAL_INPUT_INVALID')
    const bytes=Buffer.from(f.b64,'base64');if(bytes.length>16384||bytes.toString('base64')!==f.b64)return fail('LOCAL_INPUT_INVALID');op.lastInput=f.seq;result=opts.runtime.input(op.id,f.b64)
   }else if(type==='desktop.terminal.resize'){
    if(!positive(f.cols)||f.cols>500||!positive(f.rows)||f.rows>200)return fail('LOCAL_INPUT_INVALID');result=opts.runtime.resize(op.id,f.cols,f.rows)
   }else if(type==='desktop.terminal.ack'){
    if(!positive(f.seq)||f.seq>op.lastOutput)return fail('LOCAL_INPUT_INVALID');result=opts.runtime.ack(op.id,f.seq)
   }else if(type==='desktop.terminal.ping')result=opts.runtime.ping(op.id)
   else return fail('LOCAL_INPUT_INVALID')
   return{...base,ok:result.ok,operation_id:op.id,...(!result.ok?{error_code:'LOCAL_UNAVAILABLE'}:{})}
  }catch(error){return fail(code(error))}
 }
 return{handle,decide,cancel}
}
