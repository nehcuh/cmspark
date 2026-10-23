/** Execute the actual local renderer without a browser; xterm IO is an explicit inert seam. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import os from 'node:os'
import {EventEmitter} from 'node:events'
import {createHmac} from 'node:crypto'
import {ThreadManager} from '../src/threads/thread-manager'
import {DesktopIdentityRegistry} from '../src/desktop/identity'
import {createDesktopChannel} from '../src/desktop/channel'
import {SecurityConfirmationManager} from '../src/security-confirmation'
import {createNativeLocalWorkRuntime} from '../src/desktop/local-work-runtime'
import {initDataDir} from '../src/config'
import * as pty from '../src/pty/session'
import * as discovery from '../src/acp/discover'
function fixture(){
 const nodes=new Map<string,any>(),posted:any[]=[],terminals:any[]=[],intervals=new Map<number,()=>void>();let generation:string|null='owned-document',timer=0
 const element=(id='')=>({id,textContent:'',value:'',hidden:false,disabled:false,children:[] as any[],events:{} as Record<string,()=>void>,setAttribute(){},remove(){},append(v:any){this.children.push(v)},replaceChildren(...v:any[]){this.children=v},addEventListener(k:string,f:()=>void){this.events[k]=f},click(){this.events.click?.()}})
 const get=(id:string)=>{if(!nodes.has(id))nodes.set(id,element(id));return nodes.get(id)}
 class Terminal {cols=80;rows=24;selection='';writes:Uint8Array[]=[];data?:(s:string)=>void;resize?:(s:any)=>void;disposed=false;constructor(){terminals.push(this)}loadAddon(){}open(){}onData(f:any){this.data=f}onResize(f:any){this.resize=f}getSelection(){return this.selection}write(v:Uint8Array,done:()=>void){this.writes.push(v);done()}dispose(){this.disposed=true}}
 const window:any={Terminal,FitAddon:{FitAddon:class {fit(){}}}},document={getElementById:get,createElement:element,querySelector:()=>({content:'a'.repeat(64)})}
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../src/desktop/assets/local-work.js'),'utf8'),{window,document,TextEncoder,Uint8Array,btoa:(v:string)=>Buffer.from(v,'binary').toString('base64'),atob:(v:string)=>Buffer.from(v,'base64').toString('binary'),setInterval:(f:()=>void)=>{intervals.set(++timer,f);return timer},clearInterval:(id:number)=>intervals.delete(id)},{timeout:1000})
 const view=window.cmsparkLocalWork({post:(v:any)=>posted.push(JSON.parse(JSON.stringify(v))),currentDocument:()=>generation})
 const open=(thread='A')=>{view.open(thread);const p=posted.at(-1);view.receive({type:p.type+'.result',id:p.id,thread_id:thread,ok:true,state:{platform:process.platform==='win32'?'windows':process.platform==='darwin'?'macos':'unsupported',bound:true,revision:'a'.repeat(64),modules:{terminal:true,agent:true},agents:[{id:'owned',label:'Owned'}],operations:[]}})}
 const start=()=>{get('local-terminal-open').click();const p=posted.at(-1);view.receive({type:p.type+'.result',id:p.id,thread_id:p.thread_id,ok:true,operation_id:p.id,status:'running'});return p}
 return{get,posted,view,terminals,intervals,open,start,window,offline:()=>{generation=null;view.receive({type:'desktop.offline'})},document:()=>{view.receive({type:'desktop.document'});generation='next-document'}}
}
test('actual renderer sends one open, real xterm UTF8 input chunks and ACK only owned output',()=>{
 const f=fixture();f.open();f.get('local-terminal-open').click();const p=f.posted.at(-1);f.get('local-terminal-open').click();assert.equal(f.posted.filter(v=>v.type==='desktop.terminal.open').length,1)
 f.view.receive({type:p.type+'.result',id:p.id,thread_id:'A',operation_id:p.id,ok:true,status:'running'});const term=f.terminals[0];term.data('中'.repeat(6000));const inputs=f.posted.filter(v=>v.type==='desktop.terminal.input');assert.equal(inputs.length,2);assert.equal(inputs.map(v=>Buffer.from(v.b64,'base64').toString('utf8')).join(''),'中'.repeat(6000));assert.ok(inputs.every(v=>Buffer.from(v.b64,'base64').length<=16384))
 f.view.receive({type:'desktop.terminal.data',thread_id:'B',operation_id:p.id,seq:1,b64:'YQ=='});assert.equal(term.writes.length,0)
 f.view.receive({type:'desktop.terminal.data',thread_id:'A',operation_id:p.id,seq:1,b64:'YQ=='});assert.equal(term.writes.length,1);assert.equal(f.posted.at(-1).type,'desktop.terminal.ack');assert.equal(f.posted.at(-1).thread_id,'A')
})
test('A→B keeps A ACK/heartbeat but cannot inject or display A as B; Stop latches per original operation',()=>{
 const f=fixture();f.open();const a=f.start(),term=f.terminals[0];f.open('B');const before=f.posted.length;term.data('DO_NOT_SEND');assert.equal(f.posted.length,before);f.view.receive({type:'desktop.terminal.data',thread_id:'A',operation_id:a.id,seq:2,b64:'YQ=='});assert.equal(f.posted.at(-1).thread_id,'A');assert.equal(f.get('local-terminals').children[0].hidden,true)
 for(const ping of f.intervals.values())ping();assert.equal(f.posted.at(-1).thread_id,'A');assert.equal(f.posted.at(-1).type,'desktop.terminal.ping')
 f.view.open('A');const state=f.posted.at(-1);f.view.receive({type:state.type+'.result',id:state.id,thread_id:'A',ok:true,state:{platform:process.platform==='win32'?'windows':process.platform==='darwin'?'macos':'unsupported',bound:true,revision:'b'.repeat(64),modules:{terminal:true,agent:true},agents:[],operations:[{operation_id:a.id,kind:'terminal',status:'running'}]}})
 f.get('local-stop').click();f.get('local-stop').click();const stops=f.posted.filter(v=>v.type==='desktop.terminal.close');assert.equal(stops.length,1);assert.equal(stops[0].operation_id,a.id)
})
test('selected excerpt is explicit and never auto-saved; disconnect/new document cannot replay or accept old output',()=>{
 const f=fixture();f.open();const p=f.start(),term=f.terminals[0];assert.equal(f.posted.some(v=>v.type==='desktop.terminal.return'),false);term.selection='unverified <script> text';f.get('local-return').click();assert.equal(f.posted.at(-1).text,term.selection);const before=f.posted.length;f.offline();assert.equal(f.intervals.size,0);assert.equal(term.disposed,true);f.view.receive({type:'desktop.terminal.data',thread_id:'A',operation_id:p.id,seq:1,b64:'YQ=='});assert.equal(f.posted.length,before);assert.equal(term.writes.length,0);f.document();assert.equal(f.posted.length,before)
})
test('Agent action is explicit; unknown or other-thread events cannot paint current output',()=>{
 const f=fixture();f.open();f.get('local-goal').value='exact owned goal';f.get('local-agent-start').click();const p=f.posted.at(-1);assert.equal(p.goal,'exact owned goal');f.view.receive({type:p.type+'.result',id:p.id,thread_id:'A',operation_id:p.id,status:'starting',ok:true});f.view.receive({type:'desktop.agent.event',thread_id:'B',operation_id:p.id,status:'running',tail:'foreign'});assert.equal(f.get('local-agent-output').textContent,'');f.view.receive({type:'desktop.agent.event',thread_id:'A',operation_id:p.id,status:'running',tail:'<img onerror=owned>'});assert.equal(f.get('local-agent-output').textContent,'<img onerror=owned>');assert.equal(f.get('local-agent-output').innerHTML,undefined)
})
test('actual renderer→HMAC channel→native actor→existing PTY seam→DOM→one strict owned disk message',async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'local-dom-hmac-'))),prior=process.env.CMSPARK_DATA_DIR;process.env.CMSPARK_DATA_DIR=root;await initDataDir();const threads=new ThreadManager();threads.create('Owned','A');threads.create('Sibling','B');threads.update('A',{workspace_root:root});t.mock.method(discovery,'discoverCodingAgents',()=>[])
 let output!:(s:string)=>void,closed!:(v:any)=>void;const input:string[]=[],resizes:any[]=[],handle={pid:0,write:(s:string)=>input.push(s),resize:(c:number,r:number)=>resizes.push([c,r]),pause(){},resume(){},kill:()=>closed({exitCode:0}),onData:(f:any)=>{output=f},onExit:(f:any)=>{closed=f}}
 pty.__testSetPtyPlatform('win32');pty.__testSetPtySpawn(()=>handle);const runtime=createNativeLocalWorkRuntime({threads,activity:()=> 'idle'});runtime.modules=()=>({terminal:true,agent:false});const registry=new DesktopIdentityRegistry(),confirmations=new SecurityConfirmationManager(),channel=createDesktopChannel({registry,services:{threads,skills:{list:()=>[],listKnowledge:()=>[]},mcp:{listServers:()=>[]}},securityConfirmations:confirmations,localRuntime:runtime,maxPayload:10485760}),ws:any=new EventEmitter(),frames:any[]=[],f=fixture();ws.readyState=1;ws.send=(raw:string)=>frames.push(JSON.parse(raw));ws.terminate=ws.close=()=>{if(ws.readyState===3)return;ws.readyState=3;ws.emit('close')};channel.wss.emit('connection',ws);frames.shift();const boot=registry.issue('owned-dom-local'),emit=(v:any)=>ws.emit('message',Buffer.from(JSON.stringify(v)));emit({type:'desktop.hello',capability_id:boot.capabilityId,protocol_version:1});const challenge=frames.shift();emit({type:'desktop.authenticate',capability_id:boot.capabilityId,protocol_version:1,proof:createHmac('sha256',Buffer.from(boot.secret,'hex')).update(JSON.stringify(['cmspark.desktop.auth.v1',boot.capabilityId,challenge.connection_id,1,challenge.nonce])).digest('hex')});assert.equal(frames.shift().type,'desktop.ready');let cursor=0,confirmed=0
 const pump=async()=>{for(let round=0;round<8;round++){while(cursor<f.posted.length)emit(f.posted[cursor++]);await new Promise<void>(r=>setImmediate(r));while(frames.length){const frame=frames.shift();if(frame.type==='desktop.confirmation.request'){confirmed++;assert.equal(frame.purpose,'local-work');emit({type:'desktop.confirmation.decision',purpose:frame.purpose,confirmation_id:frame.confirmation_id,thread_id:frame.thread_id,action_digest:frame.action_digest,approved:true})}else f.view.receive(frame)}}}
 t.after(()=>{f.offline();ws.terminate();channel.wss.emit('close');confirmations.rejectAll('disconnect');pty.__testResetPtySessions();if(prior===undefined)delete process.env.CMSPARK_DATA_DIR;else process.env.CMSPARK_DATA_DIR=prior;fs.rmSync(root,{recursive:true,force:true})})
 f.view.open('A');await pump();f.get('local-terminal-open').click();await pump();assert.equal(confirmed,1);assert.equal(f.terminals.length,1);f.terminals[0].data('owned Unicode 中');await pump();assert.deepEqual(input,['owned Unicode 中']);output('actual controlled PTY 中');await pump();assert.equal(Buffer.concat(f.terminals[0].writes.map((b:Uint8Array)=>Buffer.from(b))).toString('utf8'),'actual controlled PTY 中');assert.ok(resizes.length>0)
 f.get('local-stop').click();await pump();assert.equal(pty.isPtyBusy(),false);f.terminals[0].selection='actual controlled PTY 中';f.get('local-return').click();await pump();assert.equal(confirmed,2);const disk=new ThreadManager();assert.equal(disk.readDesktopDialog('A').messages.length,1);assert.match(disk.readDesktopDialog('A').messages[0].content,/actual controlled PTY 中/);assert.equal(disk.readDesktopDialog('B').messages.length,0);assert.equal(f.get('local-feedback').textContent,'已确认保存到原对话，请重开历史核对。')
})

test('fixed terminal constructor failure requests close of the captured operation without fake input or UI success',()=>{
 const f=fixture();f.open();f.window.Terminal=class {constructor(){throw Error('OWNED_STYLE_FACTORY_REFUSAL')}};f.get('local-terminal-open').click();const p=f.posted.at(-1);assert.doesNotThrow(()=>f.view.receive({type:p.type+'.result',id:p.id,thread_id:'A',operation_id:p.id,ok:true,status:'running'}));assert.equal(f.posted.at(-1).type,'desktop.terminal.close');assert.equal(f.posted.at(-1).operation_id,p.id);assert.equal(f.posted.some(v=>v.type==='desktop.terminal.input'),false)
})

test('lost Stop ACK remains latched until explicit fresh owner state proves closed, without replay',()=>{
 const f=fixture();f.open();const op=f.start();f.get('local-stop').click();assert.equal(f.get('local-stop').disabled,true);assert.ok(f.get('local-feedback').textContent.includes('未确认'));f.get('local-stop').click();assert.equal(f.posted.filter(v=>v.type==='desktop.terminal.close').length,1);f.get('local-refresh').click();const p=f.posted.at(-1);f.view.receive({type:p.type+'.result',id:p.id,thread_id:'A',ok:true,state:{platform:process.platform==='win32'?'windows':process.platform==='darwin'?'macos':'unsupported',bound:true,revision:'c'.repeat(64),modules:{terminal:true,agent:true},agents:[],operations:[{operation_id:op.id,kind:'terminal',status:'closed'}]}});assert.equal(f.intervals.size,0);assert.equal(f.get('local-stop').disabled,true);assert.equal(f.posted.filter(v=>v.type==='desktop.terminal.close').length,1)
})
test('after two sequential terminals, explicit return selects the current terminal rather than a closed predecessor',()=>{
 const f=fixture();f.open();const first=f.start();f.terminals[0].selection='old selected excerpt';f.view.receive({type:'desktop.terminal.closed',thread_id:'A',operation_id:first.id,status:'closed'});f.open();const next=f.start();f.terminals[1].selection='new selected excerpt';f.get('local-return').click();assert.equal(f.posted.at(-1).operation_id,next.id);assert.equal(f.posted.at(-1).text,'new selected excerpt')
})
