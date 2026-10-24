/** CPU only: actual PTY bookkeeping/adapters/HMAC actors; every native handle is inert pid0. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import {EventEmitter} from 'node:events'
import {createHmac} from 'node:crypto'
import ts from 'typescript'
import * as pty from '../src/pty/session'
import {ThreadManager} from '../src/threads/thread-manager'
import {DesktopIdentityRegistry} from '../src/desktop/identity'
import {createDesktopChannel} from '../src/desktop/channel'
import {SecurityConfirmationManager} from '../src/security-confirmation'
import {createNativeTerminalRuntime} from '../src/desktop/terminal-runtime'
import {createNativeLocalWorkRuntime} from '../src/desktop/local-work-runtime'
import {cpuTerminalAdapter747,cleanupCpuTerminalAdapters747} from './fixtures/desktop-476/terminal-parser-cpu'

const root=path.resolve(__dirname,'../..'),source=(name:string)=>fs.readFileSync(path.join(root,name),'utf8')
class InertPty {
 pid=0;writes:string[]=[];resizes=0;resumes=0;pauses=0;kills=0
 data?: (text:string)=>void;exit?: (value:{exitCode:number;signal:number})=>void
 onData(fn:(text:string)=>void){this.data=fn}onExit(fn:(value:{exitCode:number;signal:number})=>void){this.exit=fn}
 write(value:string){this.writes.push(value)}resize(){this.resizes++}resume(){this.resumes++}pause(){this.pauses++}
 kill(){this.kills++;this.exit?.({exitCode:0,signal:0})}emit(text:string){assert.ok(this.data);this.data(text)}
}
function arm(t:any){
 pty.__testResetPtySessions();pty.__testSetPtyPlatform('darwin')
 const handles:InertPty[]=[]
 pty.__testSetPtySpawn(()=>{const handle=new InertPty();handles.push(handle);return handle as any})
 t.after(()=>pty.__testResetPtySessions());return handles
}
async function owned(t:any){
 const before=process.env.CMSPARK_DATA_DIR,dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'closed-ack-705-')))
 process.env.CMSPARK_DATA_DIR=dir
 t.after(()=>{pty.__testResetPtySessions();if(before===undefined)delete process.env.CMSPARK_DATA_DIR;else process.env.CMSPARK_DATA_DIR=before;fs.rmSync(dir,{recursive:true,force:true})})
 return dir
}
function open(dir:string,id='owned',owner:any={readyState:1}){
 const frames:any[]=[];assert.equal(pty.spawnPtySession({id,owner,cwd:dir,cols:80,rows:24,send:frame=>frames.push(frame)}).ok,true)
 return {owner,frames,state:pty.getOwnedPtyContext(id,owner) as any,ticket:pty.captureOwnedPtyAckTicket(id,owner)!}
}
function effects(h:InertPty){return {writes:[...h.writes],resizes:h.resizes,resumes:h.resumes,pauses:h.pauses,kills:h.kills}}

test('closed ACK ticket consumes actual emitted bytes without resume/input/resize/activity or generic ACK authority',async t=>{
 const dir=await owned(t),handles=arm(t),f=open(dir);assert.ok(f.ticket)
 handles[0].emit('x'.repeat(70000));assert.ok(f.state.paused);assert.ok(f.frames.length>1)
 const sent=f.frames.filter(v=>v.type==='terminal.data'),beforeBytes=f.state.unackedBytes
 assert.equal(sent.reduce((n,v)=>n+Buffer.from(v.b64,'base64').length,0),beforeBytes)
 assert.equal(pty.closePty('owned').ok,true);assert.equal(pty.getLivePtyId(),null)
 const stopped=effects(handles[0]),lastActivity=f.state.lastClientAt
 assert.equal(pty.ackPty('owned',sent[0].seq).ok,false,'generic legacy caller gains no closed authority')
 for(const frame of [...sent].reverse()){
  const bytes=f.state.unacked.get(frame.seq);assert.ok(bytes>0)
  const prior=f.state.unackedBytes;assert.equal(f.ticket.ack(frame.seq).ok,true)
  assert.equal(f.state.unacked.has(frame.seq),false);assert.equal(f.state.unackedBytes,prior-bytes)
  assert.equal(f.ticket.ack(frame.seq).ok,false,'no duplicate empty success')
 }
 assert.equal(f.state.unackedBytes,0);assert.equal(f.state.unacked.size,0);assert.equal(f.state.ackFrames,sent.length)
 assert.equal(f.state.lastClientAt,lastActivity);assert.deepEqual(effects(handles[0]),stopped)
 assert.equal(pty.writePtyInput('owned','YQ==').ok,false);assert.equal(pty.resizePty('owned',90,30).ok,false)
 assert.deepEqual(effects(handles[0]),stopped)
})

test('ticket capture and lifecycle refuse wrong identity/seq/duplicate/reset/owner-close/retire and id-reuse ABA',async t=>{
 const dir=await owned(t),handles=arm(t),f=open(dir)
 assert.equal(pty.captureOwnedPtyAckTicket('wrong',f.owner),null)
 assert.equal(pty.captureOwnedPtyAckTicket('owned',{readyState:1}),null)
 handles[0].emit('actual data');pty.closePty('owned')
 for(const seq of [0,-1,0.5,2,Number.MAX_SAFE_INTEGER+1,NaN])assert.equal(f.ticket.ack(seq).ok,false)
 assert.equal(f.state.unacked.size,1);assert.equal(f.ticket.ack(1).ok,true);assert.equal(f.ticket.ack(1).ok,false)
 for(const mode of ['retire','owner-close','reset','same-id-next-session-closed'] as const){
  pty.__testResetPtySessions();pty.__testSetPtyPlatform('darwin');pty.__testSetPtySpawn(()=>{const h=new InertPty();handles.push(h);return h as any})
  const current=open(dir,'reused');handles.at(-1)!.emit('outstanding');pty.closePty('reused')
  if(mode==='retire')current.ticket.retire()
  if(mode==='owner-close'){current.owner.readyState=3;assert.equal(current.ticket.current(),false);current.owner.readyState=1}
  if(mode==='reset')pty.__testResetPtySessions()
  if(mode==='same-id-next-session-closed'){const next=open(dir,'reused',current.owner);assert.notStrictEqual(next.state,current.state);pty.closePty('reused')}
  assert.equal(current.ticket.current(),false,mode);assert.equal(current.ticket.ack(1).ok,false,mode)
  assert.equal(current.state.unacked.has(1),true,mode+' cannot erase original bytes after invalidation')
 }
})

test('both actual native adapters preserve live ACK on failed open and bind one closed ticket to its actual owner',async t=>{
 const dir=await owned(t),handles=arm(t)
 const factories=[()=>createNativeTerminalRuntime(()=> 'idle'),()=>createNativeLocalWorkRuntime({threads:new ThreadManager(),activity:()=> 'idle'})]
 for(const factory of factories){
  const runtime=factory(),owner:any={readyState:1},foreignOwner:any={readyState:1},id='adapter-owned';const frames:any[]=[]
  const args={id,threadId:'adapter-thread',owner,cwd:dir,cols:80,rows:24,shell:runtime.shell(),send:(v:any)=>frames.push(v)}
  assert.equal(runtime.openTerminal(args).ok,true);const h=handles.at(-1)!,state=pty.getOwnedPtyContext(id,owner) as any
  h.emit('first');assert.equal(runtime.openTerminal({...args,id:'busy-attempt'}).ok,false)
  assert.equal(runtime.openTerminal({...args,id:'wrong-shell',shell:{file:'/unapproved',args:[]}}).ok,false)
  assert.equal(runtime.ack(id,1).ok,true,'failed open cannot retire existing live receipt')
  h.emit('second');runtime.close(id);const stopped=effects(h),activity=state.lastClientAt
  assert.equal(runtime.terminalAckContext?.(id,owner),true)
  assert.equal(runtime.terminalAckContext?.(id,foreignOwner),false)
  runtime.retireTerminalAck?.(id,foreignOwner);assert.equal(runtime.terminalAckContext?.(id,owner),true)
  assert.equal(runtime.ack(id,2).ok,true);assert.equal(state.unackedBytes,0)
  assert.equal(runtime.ack(id,2).ok,false);assert.deepEqual(effects(h),stopped);assert.equal(state.lastClientAt,activity)
  runtime.retireTerminalAck?.(id,owner);assert.equal(runtime.terminalAckContext?.(id,owner),false)
  assert.equal(runtime.ack(id,2).ok,false)
 }
})

// Extract complete original helpers, never register an old test suite or rewrite its callbacks.
function helpers(file:string,names:string[],bindings:Record<string,unknown>){
 const text=source(file),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true)
 const definitions=names.map(name=>{const matches=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.equal(matches.length,1,name);return matches[0].getText(ast)})
 const js=ts.transpileModule(definitions.join('\n')+'\nglobalThis.result={'+names.join(',')+'};',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const context:any={...bindings};vm.runInNewContext(js,context,{timeout:1000});return context.result
}
const basic=()=>({fs,os,path,ThreadManager,DesktopIdentityRegistry,createDesktopChannel,SecurityConfirmationManager,EventEmitter,createHmac,assert,process,Buffer,setImmediate})
function backend(t:any,kind:'terminal'|'local'){
 const file=kind==='terminal'?'tests/desktop-terminal-work-705.test.ts':'tests/desktop-local-work-476.test.ts'
 let channel:ReturnType<typeof createDesktopChannel>|undefined
 const f=helpers(file,['fixture'],{...basic(),createDesktopChannel:(...args:any[])=>{channel=Reflect.apply(createDesktopChannel,undefined,args);return channel}}).fixture(t)
 f.channel=channel
 const native=kind==='terminal'?createNativeTerminalRuntime(()=> 'idle'):createNativeLocalWorkRuntime({threads:f.tm,activity:()=> 'idle'})
 Object.assign(f.runtime,native)
 // Only module admission is the established inert fixture seam. All PTY receipt methods are actual adapter methods.
 f.runtime.modules=()=>({terminal:true,agent:false});return f
}
async function foreignAck(f:any,operation:string){
 const ws:any=new EventEmitter(),sent:any[]=[];ws.readyState=1;ws.send=(raw:string)=>sent.push(JSON.parse(raw))
 ws.close=ws.terminate=()=>{if(ws.readyState===3)return;ws.readyState=3;ws.emit('close')}
 try{
  f.channel.wss.emit('connection',ws);assert.equal(sent.shift().type,'desktop.challenge.request')
  const cap=f.registry.issue('closed-ack-foreign'),emit=(v:any)=>ws.emit('message',Buffer.from(JSON.stringify(v)))
  emit({type:'desktop.hello',capability_id:cap.capabilityId,protocol_version:1});const c=sent.shift()
  emit({type:'desktop.authenticate',capability_id:cap.capabilityId,protocol_version:1,proof:createHmac('sha256',Buffer.from(cap.secret,'hex')).update(JSON.stringify(['cmspark.desktop.auth.v1',cap.capabilityId,c.connection_id,1,c.nonce])).digest('hex')})
  assert.equal(sent.shift().type,'desktop.ready')
  emit({type:'desktop.terminal.ack',id:'foreign-ack',thread_id:'local-work-A',operation_id:operation,seq:1});await f.tick()
  assert.equal(sent[0]?.ok,false);assert.equal(sent[0]?.error_code,'LOCAL_NOT_OWNED')
 }finally{ws.terminate()}
}
async function approveOpen(f:any){
 const state=await f.send({type:'desktop.local.state',id:'state',thread_id:'local-work-A'})
 const c=await f.send({type:'desktop.terminal.open',id:'opened',thread_id:'local-work-A',revision:state.state.revision,cols:80,rows:24})
 assert.equal(c.type,'desktop.confirmation.request')
 await f.send({type:'desktop.confirmation.decision',purpose:'local-work',confirmation_id:c.confirmation_id,thread_id:c.thread_id,action_digest:c.action_digest,approved:true})
 assert.equal(f.sent.find((x:any)=>x.type==='desktop.terminal.open.result')?.ok,true);f.sent.length=0
}
test('both actual HMAC actors settle only owned closed emitted ACK and preserve stale/control/root/module refusals',async t=>{
 const handles=arm(t)
 for(const kind of ['terminal','local'] as const){
  const cleanups:Array<()=>unknown>=[],f=backend({after:(fn:()=>unknown)=>cleanups.push(fn)},kind)
  try{await approveOpen(f);const h=handles.at(-1)!
  h.emit('first');h.emit('second');const data=f.sent.splice(0);assert.equal(data.filter((x:any)=>x.type==='desktop.terminal.data').length,2)
  const stop=await f.send({type:'desktop.terminal.close',id:'stop',thread_id:'local-work-A',operation_id:'opened'});assert.equal(stop.ok,true)
  const ack={type:'desktop.terminal.ack',id:'late-ack',thread_id:'local-work-A',operation_id:'opened',seq:1}
  for(const extra of [{thread_id:'local-work-B'},{operation_id:'foreign'}])assert.equal((await f.send({...ack,...extra})).error_code,'LOCAL_NOT_OWNED')
  for(const seq of [0,3])assert.equal((await f.send({...ack,seq})).error_code,'LOCAL_INPUT_INVALID')
  await foreignAck(f,'opened');assert.equal(f.runtime.terminalAckContext?.('opened',f.ws),true)
  assert.equal((await f.send(ack)).ok,true)
  for(const request of [
   {type:'desktop.terminal.input',seq:1,b64:'YQ=='},
   {type:'desktop.terminal.resize',cols:90,rows:30},
   {type:'desktop.terminal.ping'},
  ])assert.equal((await f.send({id:'closed-control',thread_id:'local-work-A',operation_id:'opened',...request})).error_code,'LOCAL_STALE')
  f.runtime.modules=()=>({terminal:false,agent:false});assert.equal((await f.send({...ack,seq:2})).error_code,'LOCAL_MODULE_DISABLED')
  f.runtime.modules=()=>({terminal:true,agent:false});fs.renameSync(f.selected,f.selected+'.old');fs.mkdirSync(f.selected)
  assert.equal((await f.send({...ack,seq:2})).ok,false,'actual root identity still checked')
  f.registry.revokeHost('owned-local-host');await f.tick();assert.equal(f.ws.readyState,3)
  assert.equal(f.runtime.terminalAckContext?.('opened',f.ws),false)
  }finally{for(const cleanup of cleanups.reverse())await cleanup()}
 }
})

test('whole shared renderer permits only exact closed-operation parse ACK and suppresses new document/replaced operation',async t=>{
 const handles=arm(t)
 for(const mode of ['closed','new-document','replacement-operation'] as const){
  const cleanups:Array<()=>unknown>=[],f=backend({after:(fn:()=>unknown)=>cleanups.push(fn)},'terminal')
  const r=helpers('tests/desktop-local-work-renderer-476.test.ts',['fixture'],{fs,path,vm,TextEncoder,Uint8Array,Buffer,process,__dirname}).fixture()
  let cursor=0,parse:(()=>void)|undefined
  async function pump(){for(let step=0;step<12;step++){
   const hadPosts=cursor<r.posted.length
   while(cursor<r.posted.length)f.emit(r.posted[cursor++])
   await f.tick();const frames=f.sent.splice(0)
   for(const frame of frames)if(frame.type==='desktop.confirmation.request')f.emit({type:'desktop.confirmation.decision',purpose:'local-work',confirmation_id:frame.confirmation_id,thread_id:frame.thread_id,action_digest:frame.action_digest,approved:true});else r.view.receive(frame)
   if(!hadPosts&&!frames.length&&cursor===r.posted.length)return
  }assert.fail('OWNED_RENDERER_PUMP_BOUND')}
  try{
   r.view.open('local-work-A');await pump();r.get('local-terminal-open').click();await pump()
   const id=r.posted.find((v:any)=>v.type==='desktop.terminal.open').id,oldState=pty.getOwnedPtyContext(id,f.ws) as any
   r.terminals[0].write=(_bytes:Uint8Array,done:()=>void)=>{parse=done}
   handles.at(-1)!.emit('actual owned queued bytes');await pump();assert.ok(parse);assert.equal(oldState.unacked.size,1)
   r.get('local-stop').click();await pump()
   if(mode==='new-document')r.document()
   if(mode==='replacement-operation'){r.view.open('local-work-A');await pump();r.get('local-terminal-open').click();await pump();assert.equal(r.terminals.length,2)}
   const posts=r.posted.length;parse!()
   if(mode==='closed'){
    assert.equal(r.posted.length,posts+1);assert.equal(r.posted.at(-1).type,'desktop.terminal.ack');assert.equal(r.posted.at(-1).operation_id,id)
    await pump();assert.equal(oldState.unacked.size,0);assert.equal(oldState.unackedBytes,0)
   }else{assert.equal(r.posted.length,posts);assert.equal(oldState.unacked.size,1)}
  }finally{r.offline();for(const cleanup of cleanups.reverse())await cleanup()}
 }
})

test('whole real app/form waits after saved history for its final actual ACK before DONE; CPU PTY pid0 only',async t=>{
 const handles=arm(t),f=backend(t,'terminal');f.tm.create('Native terminal','native-terminal-A');f.tm.create('Sibling','native-terminal-B');f.tm.update('native-terminal-A',{workspace_root:f.selected})
 const foreignBindings={...basic(),source,TextEncoder,TextDecoder,Uint8Array,vm,cpuTerminalAdapter747}
 const {renderer,nativeCpuDisplay}=helpers('tests/desktop-terminal-native-fixture-705.test.ts',['renderer','nativeCpuDisplay'],foreignBindings)
 const r=renderer();t.after(cleanupCpuTerminalAdapters747)
 let actualState:any;const actualOpen=f.runtime.openTerminal.bind(f.runtime)
 f.runtime.openTerminal=(input:any)=>{const result=actualOpen(input);if(result.ok)actualState=pty.getOwnedPtyContext(input.id,input.owner);return result}
 let posted=0,decisions=0,typed=false,resized=false,late=false,lateAckId:string|undefined,held:any,steps=0
 const receipts:string[]=[],successAckSeq:number[]=[];const actualAck=f.runtime.ack.bind(f.runtime)
 f.runtime.ack=(id:string,seq:number)=>{const value=actualAck(id,seq);if(value.ok)successAckSeq.push(seq);return value}
 const actualInput=f.runtime.input.bind(f.runtime)
 f.runtime.input=(id:string,b64:string)=>{const result=actualInput(id,b64);if(!typed){typed=true;const text=Buffer.from('x'.repeat(16384)+'D476_TERMINAL_中');handles.at(-1)!.emit(text.toString('utf8'))}return result}
 while(steps++<240){
  while(posted<r.posted.length){const frame=r.posted[posted++]
   if(frame.type==='system.ping'){
    assert.notStrictEqual(frame.id,'D476_TERMINAL_FAIL')
    if(frame.id.endsWith('_KEY')){const target=r.document.activeElement;r.event('keydown',target);target.click();r.event('keyup',target)}
    else if(frame.id==='D476_TERMINAL_TYPE'){r.event('keydown',r.document.activeElement);r.terminals[0].data('owned synthetic command #中\r');r.event('keyup',r.document.activeElement)}
    else if(frame.id==='D476_TERMINAL_RESIZE'){resized=true;for(const fn of r.window.events.resize??[])fn()}
    else if(!frame.id.startsWith('D476_TERMINAL_READY_'))receipts.push(frame.id)
   }else{
    if(frame.type==='desktop.terminal.ack'&&frame.seq===3)lateAckId=frame.id
    const {generation,...wire}=frame;f.emit(wire)
    if(resized&&!late&&frame.type==='desktop.terminal.resize'){late=true;handles.at(-1)!.emit('actual-inert-resize-tail')}
   }
  }
  await f.tick();await r.drain()
  while(f.sent.length){const frame=f.sent.shift()
   if(frame.type==='desktop.confirmation.request'){decisions++;f.emit({type:'desktop.confirmation.decision',purpose:'local-work',confirmation_id:frame.confirmation_id,thread_id:frame.thread_id,action_digest:frame.action_digest,approved:decisions>2})}
   else if(frame.type==='desktop.terminal.ack.result'&&frame.id===lateAckId){assert.equal(frame.ok,true);held=frame}
   else r.receive(nativeCpuDisplay(frame))
  }
  if(receipts.includes('D476_TERMINAL_REOPENED')&&held){
   assert.equal(receipts.includes('D476_TERMINAL_DONE'),false,'history return is not an ACK barrier')
   r.receive(held);held=undefined
  }
  if(receipts.includes('D476_TERMINAL_DONE'))break
 }
 assert.ok(steps<240);assert.equal(late,true);assert.equal(typed,true);assert.equal(decisions,4)
 assert.deepEqual(receipts,['D476_TERMINAL_DENIED','D476_TERMINAL_CANCELLED','D476_TERMINAL_OUTPUT','D476_TERMINAL_RESIZED','D476_TERMINAL_STOPPED','D476_TERMINAL_SAVED','D476_TERMINAL_REOPENED','D476_TERMINAL_DONE'])
 assert.deepEqual([...successAckSeq].sort((a,b)=>a-b),[1,2,3]);assert.ok(actualState);assert.equal(actualState.unackedBytes,0);assert.equal(actualState.unacked.size,0)
 assert.equal(f.tm.readDesktopDialog('native-terminal-A').messages.length,1);assert.equal(f.tm.readDesktopDialog('native-terminal-B').messages.length,0)
 assert.equal(handles.length,1);assert.equal(handles[0].pid,0);assert.equal(handles[0].kills,1)
})
