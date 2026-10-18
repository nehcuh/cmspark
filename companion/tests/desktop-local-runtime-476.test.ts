/** Actual PTY/ACP manager outlets with inert handles; never starts an OS child. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {EventEmitter} from 'node:events'
import {ThreadManager} from '../src/threads/thread-manager'
import {initDataDir,saveConfig} from '../src/config'
import * as acp from '../src/acp/manager'
import * as discover from '../src/acp/discover'
import * as protocol from '../src/acp/protocol-session'
import * as launch from '../src/acp/win-spawn'
import * as agentEnv from '../src/acp/agent-env'
import * as pty from '../src/pty/session'
import {createNativeLocalWorkRuntime} from '../src/desktop/local-work-runtime'
import {commitNativeLocalHandback} from '../src/desktop/local-handback'
async function fixture(t:any){
 await initDataDir();const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'local-runtime-476-'))),tm=new ThreadManager();tm.create('Owned','local-runtime-A')
 saveConfig({embedded_terminal:{enabled:true},acp:{enabled:true,policy:{require_workspace:true,force_confirm_session_start:true,default_profile:'review_readonly'},servers:{owned:{enabled:true,display_name:'Owned',transport:'stdio',command:process.execPath,protocol:'acp',policy:{profile:'review_readonly'}}}},coding_handoff:{open_local_terminal:true}})
 const realEnv=agentEnv.buildAcpAgentEnv;t.mock.method(agentEnv,'buildAcpAgentEnv',(opts:any)=>realEnv({...opts,skipLoginShell:true}));
 t.mock.method(discover,'discoverCodingAgents',()=>[]);const manager=new acp.AcpManager();t.mock.method(acp,'getAcpManager',()=>manager)
 let hooks:any,finish!:()=>void,spawned=0,entered!:()=>void;const started=new Promise<void>(r=>{entered=r}),pending=new Promise<void>(r=>{finish=r}),child:any=Object.assign(new EventEmitter(),{pid:0,exitCode:null,signalCode:null})
 t.mock.method(protocol,'tryStartProtocolSession',async(i:any)=>{hooks=i.hooks;spawned++;hooks.onSpawn(child);entered();return{child,prompt:async()=>pending,kill:()=>{},cancel:()=>{}}})
 t.mock.method(launch,'closeAcpChild',async()=>{child.exitCode=0;child.emit('close',0)});t.mock.method(launch,'killAcpChild',()=>{})
 const controller=new AbortController();let current=true,permissions=0;const owner={current:()=>current,signal:controller.signal,requestPermission:async()=>{permissions++;return true}},events:any[]=[],runtime=createNativeLocalWorkRuntime({threads:tm,activity:()=> 'idle'})
 t.after(async()=>{finish();child.emit('close',0);await manager.shutdown();pty.__testResetPtySessions();pty.__testSetPtySpawn();pty.__testSetPtyPlatform();fs.rmSync(root,{recursive:true,force:true})})
 const agent=runtime.agents()[0],start=()=>runtime.startAgent!({threadId:'local-runtime-A',agentId:agent.id,identity:agent.identity,goal:'exact task',cwd:root,owner,event:v=>events.push(v),commitId:'local_runtime_commit'})
 return{runtime,manager,root,tm,owner,controller,events,started,start,finish,hooks:()=>hooks,stale:()=>{current=false},counts:()=>({spawned,permissions})}
}
test('runtime reaches existing PTY slot/owner/backpressure without accepting renderer command override',async t=>{
 const f=await fixture(t);let data!:(s:string)=>void,exit!:(s:any)=>void;const calls:any[]=[],handle={pid:0,write:(s:string)=>calls.push(['input',s]),resize:(c:number,r:number)=>calls.push(['resize',c,r]),pause:()=>calls.push(['pause']),resume:()=>calls.push(['resume']),kill:()=>exit({exitCode:0}),onData:(f:any)=>{data=f},onExit:(f:any)=>{exit=f}}
 pty.__testSetPtyPlatform('win32');pty.__testSetPtySpawn((file,args,opts)=>{calls.push(['spawn',file,args,opts.cwd]);return handle});const owner:any={readyState:1},frames:any[]=[],shell=f.runtime.shell()
 assert.equal(f.runtime.openTerminal({id:'pty-owned',threadId:'local-runtime-A',owner,cwd:f.root,cols:80,rows:24,shell:{file:'bad',args:[]},send:v=>frames.push(v)}).ok,false)
 assert.equal(calls.length,0);const opened=f.runtime.openTerminal({id:'pty-owned',threadId:'local-runtime-A',owner,cwd:f.root,cols:80,rows:24,shell,send:v=>frames.push(v)});assert.equal(opened.ok,true,JSON.stringify(opened));assert.equal(f.runtime.terminalBusy(),true);assert.equal(f.runtime.terminalContext('pty-owned',{} as any),false);assert.equal(f.runtime.terminalContext('pty-owned',owner),true)
 assert.deepEqual(calls[0],['spawn','powershell.exe',[],f.root]);assert.equal(f.runtime.input('pty-owned',Buffer.from('owned input').toString('base64')).ok,true);data('中'.repeat(24000));assert.ok(frames.every(v=>v.type!=='terminal.data'||Buffer.from(v.b64,'base64').length<=16384));assert.ok(calls.some(v=>v[0]==='pause'));assert.equal(f.runtime.ack('pty-owned',frames.at(-1).seq).ok,true);assert.ok(calls.some(v=>v[0]==='resume'));assert.equal(f.runtime.close('pty-owned').ok,true);assert.equal(f.runtime.terminalBusy(),false)
})
test('runtime private ACP events/permissions and sole sink save exactly one canonical result, no legacy event or second sink',async t=>{
 const f=await fixture(t),legacy:any[]=[];f.manager.onEvent(v=>legacy.push(v));let sinks=0;f.manager.setHandbackSink(({session,handback})=>{sinks++;assert.equal(commitNativeLocalHandback(session,handback),true)})
 const r=await f.start();assert.equal(r.ok,true);await f.started;assert.equal(f.manager.getSession(r.sessionId!),undefined);assert.equal(await f.hooks().onPermission({title:'owned permission'}),'allow');f.hooks().onAgentText('owned result');f.finish();for(let i=0;i<8;i++)await new Promise<void>(r=>setImmediate(r))
 assert.equal(sinks,1);assert.equal(f.tm.readDesktopDialog('local-runtime-A').messages.length,1);assert.equal(new ThreadManager().readDesktopDialog('local-runtime-A').messages.length,1);assert.equal(legacy.length,0);assert.equal(f.events.some(v=>v.status==='saved'),true);assert.deepEqual(f.counts(),{spawned:1,permissions:1})
})
test('runtime owner Stop still uses captured context after retirement and cannot create a legacy follow-up',async t=>{
 const f=await fixture(t),r=await f.start();await f.started;f.stale();f.controller.abort();f.runtime.cancelAgent!(r.sessionId!,f.owner);f.finish();for(let i=0;i<5;i++)await new Promise<void>(r=>setImmediate(r))
 assert.equal((await f.runtime.promptAgent!({sessionId:r.sessionId!,text:'late',owner:f.owner,event:v=>f.events.push(v),commitId:'late'})).ok,false);assert.equal(f.tm.readDesktopDialog('local-runtime-A').messages.length,0);assert.equal(f.counts().spawned,1)
})
