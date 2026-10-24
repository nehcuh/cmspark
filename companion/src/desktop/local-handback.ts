/** Private native commit metadata; invoked only inside the one existing lifecycle sink. */
import type {AcpSessionRecord} from '../acp/types'
import type {ThreadManager} from '../threads/thread-manager'
import {redactSecrets} from '../threads/distill'
import {commitLocalWorkMessage,type LocalFrame} from './local-work'
type Binding={threads:ThreadManager;thread:string;messageId:string;current():boolean;event(frame:LocalFrame):void;settled?:'saved'|'unknown';content?:string}
const native=new WeakMap<AcpSessionRecord,Binding>()
export function bindNativeLocalHandback(session:AcpSessionRecord,binding:Binding):void{
 if(native.has(session)||session.thread_id!==binding.thread)throw Error('LOCAL_CONFLICT')
 native.set(session,binding)
}
/** true means this native session was handled; never fall through to the legacy addMessage. */
export function commitNativeLocalHandback(session:AcpSessionRecord,content:string):boolean{
 const binding=native.get(session);if(!binding)return false
 const text=redactSecrets(content).text
 const emit=(status:'saved'|'unknown',message_id?:string)=>{try{binding.event({status,partial:session.partial===true,...(message_id?{message_id}:{})})}catch{/* A lost receipt cannot replay a commit. */}}
 if(binding.settled){if(binding.settled==='saved'&&binding.content===text)emit('saved',binding.messageId);else emit('unknown');return true}
 binding.content=text;binding.settled='unknown'
 try{const id=commitLocalWorkMessage(binding.threads,binding.thread,binding.messageId,text,binding.current);binding.settled='saved';emit('saved',id)}catch{emit('unknown')}
 return true
}
