/** Server-owned adapters reuse PTY and ACP; no WS/router forwarding. */
import {createHash} from 'node:crypto'
import {getConfig} from '../config'
import {isModuleEnabled} from '../capability/modules'
import {getAcpManager,type NativeLocalContext} from '../acp/manager'
import type {AcpSessionRecord} from '../acp/types'
import type {ThreadManager} from '../threads/thread-manager'
import {captureOwnedPtyAckTicket,type OwnedPtyAckTicket,closePty,defaultPtyCommand,getOwnedPtyContext,isPtyBusy,pingPty,resizePty,spawnPtySession,writePtyInput} from '../pty/session'
import type {LocalAgent,LocalOwner,LocalWorkRuntime} from './local-work'
import {bindNativeLocalHandback} from './local-handback'
export function createNativeLocalWorkRuntime(opts:{threads:ThreadManager;activity(thread:string):'idle'|'busy'|'unknown'}):LocalWorkRuntime{
 const manager=getAcpManager(),contexts=new WeakMap<LocalOwner,NativeLocalContext>()
 let receipt:{id:string;owner:unknown;ticket:OwnedPtyAckTicket}|undefined
 const retire=()=>{receipt?.ticket.retire();receipt=undefined}
 function native(owner:LocalOwner,agent:string,identity:string):NativeLocalContext{
  let context=contexts.get(owner)
  if(!context){context={current:()=>owner.current()&&launchIdentity(agent)===identity,signal:owner.signal,requestPermission:info=>owner.requestPermission(info)};contexts.set(owner,context)}
  return context
 }
 function launchIdentity(id:string){const server=manager.resolveServer(id);return server?createHash('sha256').update(JSON.stringify(server)).digest('hex'):''}
 const agents=():LocalAgent[]=>manager.listAgents().filter(a=>a.enabled).map(a=>({id:a.id,label:a.display_name,identity:launchIdentity(a.id)})).filter(a=>!!a.identity)
 function watch(session:AcpSessionRecord,owner:LocalOwner,context:NativeLocalContext,event:Parameters<NonNullable<LocalWorkRuntime['startAgent']>>[0]['event'],commitId:string){
  let settled=false
  bindNativeLocalHandback(session,{threads:opts.threads,thread:session.thread_id,messageId:commitId,current:()=>owner.current()&&!owner.signal.aborted,event:frame=>{if(frame.status==='saved'||frame.status==='unknown')settled=true;event(frame)}})
  const unsubscribe=manager.onNativeEvent(context,frame=>{if(frame.session_id!==session.session_id||!owner.current()||settled)return;event({status:frame.state==='running'?'running':frame.state==='offered'?'starting':'closed',partial:frame.partial===true,tail:frame.progress_tail})})
  void manager.start(session.session_id).then(result=>{if(settled)return;if(!result.ok)event({status:'failed',partial:true});else if(!session.handback_text)event({status:'not_saved',partial:true})},()=>event({status:'failed',partial:true})).finally(unsubscribe)
 }
 return{
  modules:()=>({terminal:isModuleEnabled('devsec-workspace')&&getConfig().embedded_terminal?.enabled===true,agent:isModuleEnabled('devsec-workspace')&&getConfig().acp?.enabled===true}),
  activity:opts.activity,shell:defaultPtyCommand,agents,
  openTerminal(input){
   if(JSON.stringify(defaultPtyCommand())!==JSON.stringify(input.shell))return{ok:false}
   const result=spawnPtySession({id:input.id,threadId:input.threadId,owner:input.owner,cwd:input.cwd,cols:input.cols,rows:input.rows,send:input.send})
   if(result.ok){const ticket=captureOwnedPtyAckTicket(input.id,input.owner);retire();if(ticket)receipt={id:input.id,owner:input.owner,ticket}}
   return result
  },
  terminalAckContext:(id,owner)=>receipt?.id===id&&receipt.owner===owner&&receipt.ticket.current(),
  retireTerminalAck(id,owner){if(receipt?.id===id&&receipt.owner===owner)retire()},
  terminalContext:(id,owner)=>!!getOwnedPtyContext(id,owner),terminalBusy:isPtyBusy,input:writePtyInput,resize:resizePty,ack:(id,seq)=>receipt?.id===id?receipt.ticket.ack(seq):{ok:false},ping:pingPty,close:closePty,
  async startAgent(input){
   if(!input.owner.current()||input.owner.signal.aborted||launchIdentity(input.agentId)!==input.identity)return{ok:false}
   const context=native(input.owner,input.agentId,input.identity),result=manager.proposeNative({threadId:input.threadId,agentId:input.agentId,goal:input.goal,workspaceRoot:input.cwd,mode:'review_readonly'},context)
   if(!result.ok)return{ok:false};watch(result.session,input.owner,context,input.event,input.commitId);return{ok:true,sessionId:result.session.session_id}
  },
  async promptAgent(input){
   const context=contexts.get(input.owner);if(!context||!context.current()||context.signal.aborted)return{ok:false}
   if(!manager.getNativeSession(input.sessionId,context))return{ok:false}
   const live=await manager.promptNative(input.sessionId,input.text,context)
   if(live.ok)return{ok:true,sessionId:input.sessionId}
   if(live.error!=='ACP_NATIVE_FOLLOWUP_REQUIRED'||!context.current()||context.signal.aborted)return{ok:false}
   const result=manager.followupNative({parentSessionId:input.sessionId,goal:input.text,mode:'review_readonly'},context)
   if(!result.ok)return{ok:false};watch(result.session,input.owner,context,input.event,input.commitId);return{ok:true,sessionId:result.session.session_id}
  },
  cancelAgent:(id,owner)=>{const context=contexts.get(owner);if(context)manager.cancelNative(id,context)},
 }
}
