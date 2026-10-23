/** CPU source-derived acceptance controls; never actual OS/native/PTY evidence. */
import test, {afterEach} from 'node:test'
import {cpuTerminalAdapter747,cleanupCpuTerminalAdapters747} from './fixtures/desktop-476/terminal-parser-cpu'
afterEach(cleanupCpuTerminalAdapters747)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import {EventEmitter} from 'node:events'
import {createHmac} from 'node:crypto'
import ts from 'typescript'
import {ThreadManager} from '../src/threads/thread-manager'
import {DesktopIdentityRegistry} from '../src/desktop/identity'
import {createDesktopChannel} from '../src/desktop/channel'
import {SecurityConfirmationManager} from '../src/security-confirmation'
const root=path.resolve(__dirname,'../..'),source=(p:string)=>fs.readFileSync(path.join(root,p),'utf8')
// This CPU form control has an inert backend runtime. Project only its display
// platform on Linux; the actual backend must still report unsupported there.
function nativeCpuDisplay(frame:any,host=process.platform){
 if(frame.type!=='desktop.local.state.result'||frame.ok!==true)return frame
 assert.equal(frame.state.platform,host==='win32'?'windows':host==='darwin'?'macos':'unsupported')
 return host==='linux'?{...frame,state:{...frame.state,platform:'macos'}}:frame
}
test('CPU native display projection preserves every authority field and supported-host frame',()=>{
 const frame={type:'desktop.local.state.result',ok:true,id:'owned',thread_id:'A',state:{platform:'unsupported',bound:true,revision:'r',modules:{terminal:true,agent:false}}}
 const projected=nativeCpuDisplay(frame,'linux')
 assert.deepEqual(projected,{...frame,state:{...frame.state,platform:'macos'}})
 assert.equal(projected.state.modules,frame.state.modules)
 assert.equal(frame.state.platform,'unsupported')
 const supported={...frame,state:{...frame.state,platform:'windows'}}
 assert.equal(nativeCpuDisplay(supported,'win32'),supported)
 const other={type:'desktop.terminal.open.result',ok:true};assert.equal(nativeCpuDisplay(other,'linux'),other)
 assert.throws(()=>nativeCpuDisplay(supported,'linux'))
})
function backend(t:any):any {
 const file=source('tests/desktop-terminal-work-705.test.ts'),begin=file.indexOf('function fixture(t:any){'),end=file.indexOf('\ntest(',begin);assert.ok(begin>=0&&end>begin)
 const code=ts.transpileModule(file.slice(begin,end)+'\nglobalThis.producer=fixture;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context:any={fs,os,path,ThreadManager,DesktopIdentityRegistry,createDesktopChannel,SecurityConfirmationManager,EventEmitter,createHmac,assert,process,Buffer,setImmediate}
 vm.runInNewContext(code,context,{timeout:1000});const f=context.producer(t);f.tm.create('Native terminal','native-terminal-A');f.tm.create('Sibling','native-terminal-B');f.tm.update('native-terminal-A',{workspace_root:f.selected});return f
}
function renderer(focus:'normal'|'noop'|'wrong'='normal') {
 const posted:any[]=[],terminals:any[]=[],timers=new Map(),html=source('src/desktop/assets/index.html');let timer=0
 const document:any={activeElement:{id:'owned-body'},events:{},addEventListener(k:string,fn:any){(this.events[k]??=[]).push(fn)}}
 // Identity/DOM are the original inert CPU seam, never actual WebView evidence.
 const element=(id:string,rootConnected=false):any=>({id,textContent:'',hidden:false,disabled:false,value:'',children:[],attributes:{},events:{},ownerDocument:document,parentElement:null,get isConnected(){return rootConnected||this.parentElement?.isConnected===true},contains(target:any):boolean{return this===target||this.children.some((child:any)=>child.contains(target))},setAttribute(k:string,v:string){this.attributes[k]=v},getAttribute(k:string){return this.attributes[k]},append(v:any){v.parentElement=this;this.children.push(v)},replaceChildren(...v:any[]){for(const child of this.children)child.parentElement=null;this.children=[];for(const child of v)this.append(child)},remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter((child:any)=>child!==this);this.parentElement=null},addEventListener(k:string,fn:any){(this.events[k]??=[]).push(fn)},focus(){if(focus==='normal')document.activeElement=this;else if(focus==='wrong')document.activeElement={id:'owned-wrong'}},click(){if(!this.disabled)for(const fn of this.events.click??[])fn()},querySelector(selector:string){const visit=(node:any):any=>{if(selector==='.xterm-helper-textarea'&&node.className==='xterm-helper-textarea')return node;for(const child of node.children){const found=visit(child);if(found)return found}};return visit(this)}})
 const ids:any=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],element(m[1],true)])),nav=['thread.list','mcp.list','skill.list','knowledge.list'].map(page=>Object.assign(element(page),{dataset:{page}})),window:any={events:{},addEventListener(k:string,fn:any){(this.events[k]??=[]).push(fn)},webkit:{messageHandlers:{desktop:{postMessage:(v:any)=>posted.push(JSON.parse(JSON.stringify(v)))}}}}
 document.getElementById=(id:string)=>ids[id];document.createElement=element;document.querySelectorAll=(s:string)=>s==='nav button'?nav:[];document.querySelector=(s:string)=>s.startsWith('nav button')?nav.find(n=>s.includes(n.dataset.page)):null
 ids.list.querySelectorAll=(selector:string)=>ids.list.children.flatMap((row:any)=>row.children).filter((n:any)=>n.attributes[selector.slice(1,-1)])
 Object.defineProperty(ids['dialog-history'],'textContent',{get(){return this.children.map((n:any)=>n.textContent).join('\n')},set(_v){}})
 class Fit {term:any;fit(){if(this.term)this.term.resizeTo(this.term.cols+12,this.term.rows)}}
 const Terminal=cpuTerminalAdapter747(element,terminals)
 window.Terminal=Terminal;window.FitAddon={FitAddon:Fit};const globals={window,document,TextEncoder,TextDecoder,Uint8Array,atob:(v:string)=>Buffer.from(v,'base64').toString('binary'),btoa:(v:string)=>Buffer.from(v,'binary').toString('base64'),setInterval:(fn:any)=>{timers.set(++timer,fn);return timer},clearInterval:(id:number)=>timers.delete(id)}
 vm.runInNewContext(source('src/desktop/assets/local-work.js'),globals,{timeout:1000});vm.runInNewContext(source('src/desktop/assets/app.js'),globals,{timeout:1000})
 const receive=(frame:any)=>window.cmsparkDesktopReceive(frame);receive({type:'desktop.document',generation:'owned-terminal-document'})
 vm.runInNewContext("const documentGeneration='owned-terminal-document';"+source('tests/fixtures/desktop-476/terminal-form.js'),globals,{timeout:1000})
 const event=(kind:string,target:any,trust=true)=>{for(const fn of document.events[kind]??[])fn({key:'Enter',target,isTrusted:trust})}
 return{window,document,ids,posted,terminals,receive,event,drain:async()=>{for(const terminal of terminals)await terminal.drain()}}
}
for(const focus of ['noop','wrong'] as const)test('terminal native fixture rejects actual stock row focus '+focus,()=>{
 const r=renderer(focus),request=r.posted.find(v=>v.type==='thread.list');assert.ok(request);r.receive({type:'thread.list',threads:[{id:'native-terminal-A',title:'owned'}]})
 assert.equal(r.posted.filter(v=>v.id==='D476_TERMINAL_ROW_KEY').length,0);assert.equal(r.posted.filter(v=>v.id==='D476_TERMINAL_FAIL').length,1)
})
for(const variant of ['untrusted','late','body','duplicate'] as const)test('terminal native fixture rejects actual requested-key '+variant,()=>{
 const r=renderer();r.receive({type:'thread.list',threads:[{id:'native-terminal-A',title:'owned'}]});const row=r.document.activeElement
 assert.equal(r.posted.filter(v=>v.id==='D476_TERMINAL_ROW_KEY').length,1)
 if(variant==='late')r.document.activeElement={id:'late-body'}
 r.event('keydown',variant==='body'?{id:'other-body'}:row,variant!=='untrusted');if(variant==='duplicate')r.event('keydown',row)
 assert.equal(r.posted.filter(v=>v.id==='D476_TERMINAL_FAIL').length,1)
})
test('whole real app/form→actual HMAC actor→owned store drives ten keys and four decisions; CPU PTY is inert',async t=>{
 const b=backend(t),r=renderer(),receipts:string[]=[],keys:string[]=[];let posted=0,decisions=0,typed=false,resized=false,steps=0,holdAck=true;const heldAck:any[]=[]
 const priorInput=b.runtime.input;b.runtime.input=(id:string,b64:string)=>{const value=priorInput(id,b64);if(!typed){typed=true;assert.ok(Buffer.from(b64,'base64').toString('utf8').includes('中'));const bytes=Buffer.from('x'.repeat(16384)+'D476_TERMINAL_中');b.output({type:'terminal.data',seq:1,b64:bytes.subarray(0,16384).toString('base64')});b.output({type:'terminal.data',seq:2,b64:bytes.subarray(16384).toString('base64')})}return value}
 while(steps++<200){
  while(posted<r.posted.length){const f=r.posted[posted++];if(f.type==='system.ping'){
    assert.notStrictEqual(f.id,'D476_TERMINAL_FAIL')
    if(f.id.endsWith('_KEY')){keys.push(f.id);const target=r.document.activeElement;r.event('keydown',target);target.click();r.event('keyup',target)}
    else if(f.id==='D476_TERMINAL_TYPE'){assert.equal(r.document.activeElement.className,'xterm-helper-textarea');r.event('keydown',r.document.activeElement);r.terminals[0].data('owned synthetic command #中\r');r.event('keyup',r.document.activeElement)}
    else if(f.id==='D476_TERMINAL_RESIZE'){resized=true;for(const fn of r.window.events.resize??[])fn()}
    else receipts.push(f.id)
   }else {const {generation,...wire}=f;b.emit(wire)}}
  await b.tick();await r.drain()
  while(b.sent.length){const f=b.sent.shift();if(f.type==='desktop.confirmation.request'){decisions++;b.emit({type:'desktop.confirmation.decision',purpose:'local-work',confirmation_id:f.confirmation_id,thread_id:f.thread_id,action_digest:f.action_digest,approved:decisions>2})}else if(f.type==='desktop.terminal.ack.result'&&holdAck)heldAck.push(f);else r.receive(nativeCpuDisplay(f))}
  if(holdAck&&heldAck.length===2){assert.equal(receipts.includes('D476_TERMINAL_OUTPUT'),false);assert.equal(resized,false);assert.equal(keys.length,6);holdAck=false;for(const f of heldAck)r.receive(f)}
  if(receipts.includes('D476_TERMINAL_DONE'))break
 }
 assert.ok(steps<200);assert.equal(heldAck.length,2);assert.equal(holdAck,false);assert.equal(decisions,4);assert.equal(keys.length,10);assert.equal(new Set(keys).size,10);assert.equal(typed,true);assert.equal(resized,true)
 assert.deepEqual(receipts,['D476_TERMINAL_DENIED','D476_TERMINAL_CANCELLED','D476_TERMINAL_OUTPUT','D476_TERMINAL_RESIZED','D476_TERMINAL_STOPPED','D476_TERMINAL_SAVED','D476_TERMINAL_REOPENED','D476_TERMINAL_DONE'])
 assert.equal(b.calls.filter((v:string)=>v==='open').length,1);assert.equal(b.calls.filter((v:string)=>v==='close').length,1);assert.equal(b.tm.readDesktopDialog('native-terminal-A').messages.length,1);assert.equal(b.tm.readDesktopDialog('native-terminal-B').messages.length,0);assert.equal(b.manager.pendingCount(),0)
})
test('native admission refuses manual supported hosts before native imports or environment value reads',()=>{
 const file=source('tests/desktop-native-thread-metadata-476.test.ts'),begin=file.indexOf('function hostedTerminalAdmission705()'),end=file.indexOf("\ntest('#476 terminal-only",begin);assert.ok(begin>=0&&end>begin)
 const code=ts.transpileModule(file.slice(begin,end)+'\nglobalThis.admit=hostedTerminalAdmission705;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 for(const platform of ['win32','darwin']){let reads=0;const env=new Proxy({} as any,{get(){reads++;return undefined},ownKeys(){throw Error('MUST_NOT_SANITIZE_BEFORE_ADMISSION')}}),context:any={assert,fs:{},path:{},process:{platform,env}};vm.runInNewContext(code,context,{timeout:1000});assert.throws(()=>context.admit(),/TERMINAL705_REMOTE_GHA_REQUIRED/);assert.equal(reads,1)}
})

test('both terminal acceptance native variants invert every product byte, preserve guards and fail closed on anchor drift',()=>{
 const {desktopTerminalFixture}=require(path.join(root,'scripts/desktop-terminal-fixture.mjs'))
 const form=source('tests/fixtures/desktop-476/terminal-form.js')
 for(const [language,extension]of [['cpp','cpp'],['swift','swift']]){
  const original=source('src/desktop/native/DesktopHost.'+extension),controller=source('tests/fixtures/desktop-476/terminal-acceptance.'+extension)
  for(const windowsNewlines of [false,true]){
   const input=windowsNewlines?original.replace(/\r?\n/g,'\r\n'):original,variant=desktopTerminalFixture(language,input,controller,form)
   assert.equal(variant.inverse,input);assert.notStrictEqual(variant.source,input);assert.ok(variant.source.includes('D705TerminalAcceptance'));assert.ok(variant.source.includes('D476_TERMINAL_DONE'))
   assert.throws(()=>desktopTerminalFixture(language,input+input,controller,form),/FIXTURE_ANCHOR/)
   assert.throws(()=>desktopTerminalFixture(language,input,controller.replace('D705_TERMINAL_FORM_SOURCE','missing'),form),/FORM_SOURCE/)
  }
  for(const forbidden of ['SetForegroundWindow(', 'SetFocus(', 'makeKeyAndOrderFront(', '.activate('])assert.equal(controller.includes(forbidden),false,'test fixture cannot rescue native foreground/focus')
 }
 const mac=source('scripts/build-desktop-native.mjs'),windows=source('scripts/build-desktop-windows.mjs')
 assert.ok(mac.includes('desktopTerminalFixture("swift",terminalOriginal,terminalController,terminalForm)'));assert.ok(windows.includes('desktopTerminalFixture("cpp",terminalOriginal,terminalController,terminalForm)'))
 assert.ok(mac.includes('if(terminalVariant.inverse!==terminalOriginal)'));assert.ok(windows.includes('if(terminalVariant.inverse!==terminalOriginal)'))
 assert.ok(mac.includes('acceptance","terminal"'));assert.ok(windows.includes('acceptanceRoot,"terminal"'))
})

// Use the actual native foreign-client constructor and actual production upgrade
// callback. The inert server has no socket listener, process or native effects.
test('native terminal foreign-owner probe reaches authentication only through exact native Origin',()=>{
 const file=ts.createSourceFile('native.ts',source('tests/desktop-native-thread-metadata-476.test.ts'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
 const candidates:ts.NewExpression[]=[]
 function visit(n:ts.Node){if(ts.isVariableDeclaration(n)&&n.name.getText(file)==='foreignOwner'){const scan=(x:ts.Node)=>{if(ts.isNewExpression(x)&&x.expression.getText(file)==='WebSocket')candidates.push(x);ts.forEachChild(x,scan)};scan(n)}ts.forEachChild(n,visit)}visit(file)
 assert.equal(candidates.length,1,'one actual native foreign-owner client')
 const caps=ts.createSourceFile('caps.ts',source('src/desktop/capabilities.ts'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let origin:string|undefined
 function cap(n:ts.Node){if(ts.isVariableDeclaration(n)&&n.name.getText(caps)==='DESKTOP_NATIVE_ORIGIN'&&n.initializer&&ts.isStringLiteral(n.initializer))origin=n.initializer.text;ts.forEachChild(n,cap)}cap(caps);assert.ok(origin)
 let captured:any[]=[]
 vm.runInNewContext('new '+candidates[0].getText(file).slice(4),{WebSocket:class{constructor(...args:any[]){captured=args}},port:12345,DESKTOP_NATIVE_ORIGIN:origin},{timeout:1000})
 assert.equal(captured[0],'ws://127.0.0.1:12345/desktop')
 const channel=ts.createSourceFile('channel.ts',source('src/desktop/channel.ts'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),definitions=channel.statements.filter((n):n is ts.FunctionDeclaration=>ts.isFunctionDeclaration(n)&&n.name?.text==='attachDesktopUpgrade');assert.equal(definitions.length,1)
 const js=ts.transpileModule(definitions[0].getText(channel).replace(/^export /,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
 const context:any={DESKTOP_NATIVE_ORIGIN:origin};vm.runInNewContext(js+';globalThis.upgrade=attachDesktopUpgrade;',context,{timeout:1000})
 function attempt(value:unknown){let accepted=0,rejected='';const server=new EventEmitter(),legacy={handleUpgrade(){throw Error('foreign native client cannot enter legacy route')}},desktop={handleUpgrade(req:any,socket:any,head:any,done:any){accepted++;done({})},emit(){}};context.upgrade(server,legacy,desktop,()=>false);server.emit('upgrade',{url:'/desktop',headers:{origin:value}},{end(value:string){rejected=value}},Buffer.alloc(0));return{accepted,rejected}}
 for(const invalid of [undefined,'null','https://foreign.invalid'])assert.deepEqual(attempt(invalid),{accepted:0,rejected:'HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'})
 assert.deepEqual(attempt(captured[1]?.origin),{accepted:1,rejected:''},'real negative owner fixture must reach the unchanged authentication gate; no Origin bypass')
 assert.equal(captured[1].origin,origin)
})
