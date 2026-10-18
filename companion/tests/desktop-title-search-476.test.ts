/** Original #476: real metadata/HMAC and delivered renderer; no native/OS seam. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { createHmac } from 'node:crypto'
import { ThreadManager } from '../src/threads/thread-manager'
import { DesktopIdentityRegistry } from '../src/desktop/identity'
import { createDesktopChannel } from '../src/desktop/channel'
import { DESKTOP_METHOD_SET_VERSION, DESKTOP_READ_METHODS } from '../src/desktop/capabilities'
function owned(t:any){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'title-search-476-')),previous=process.env.CMSPARK_DATA_DIR;process.env.CMSPARK_DATA_DIR=dir
 const manager=new ThreadManager();manager.create('needle oldest','search-oldest');for(let i=0;i<64;i++)manager.create('ordinary '+i,'search-'+i)
 // A body/digest-only match must never enter a title-only result.
 manager.update('search-0',{digest:{tldr:'needle secret body',tags:['needle']}} as any)
 let messageReads=0,listCalls=0;t.mock.method(manager,'getMessages',()=>{messageReads++;throw Error('NO_BODY_READ')});t.mock.method(manager,'list',()=>{listCalls++;throw Error('NO_REPAIR_LIST')})
 const registry=new DesktopIdentityRegistry(),channel=createDesktopChannel({registry,services:{threads:manager,skills:{list:()=>[],listKnowledge:()=>[]},mcp:{listServers:()=>[]}},maxPayload:10*1024*1024})
 const socket:any=new EventEmitter(),sent:any[]=[];socket.readyState=1;socket.send=(b:string)=>sent.push(JSON.parse(b));socket.close=socket.terminate=()=>{if(socket.readyState!==1)return;socket.readyState=3;socket.emit('close')};channel.wss.emit('connection',socket);assert.equal(sent.shift().type,'desktop.challenge.request')
 const emit=(v:any)=>socket.emit('message',Buffer.from(typeof v==='string'?v:JSON.stringify(v))),boot=registry.issue('owned-search-host');emit({type:'desktop.hello',capability_id:boot.capabilityId,protocol_version:1});const ch=sent.shift();emit({type:'desktop.authenticate',capability_id:boot.capabilityId,protocol_version:1,proof:createHmac('sha256',Buffer.from(boot.secret,'hex')).update(JSON.stringify(['cmspark.desktop.auth.v1',boot.capabilityId,ch.connection_id,1,ch.nonce])).digest('hex')});assert.equal(sent.shift().type,'desktop.ready')
 t.after(()=>{socket.terminate();channel.wss.emit('close');if(previous===undefined)delete process.env.CMSPARK_DATA_DIR;else process.env.CMSPARK_DATA_DIR=previous;fs.rmSync(dir,{recursive:true,force:true})})
 return{manager,registry,sent,socket,emit,send:(v:any)=>{emit(v);return sent.shift()},get messageReads(){return messageReads},get listCalls(){return listCalls}}
}
function renderer(){
 const html=fs.readFileSync(path.resolve(__dirname,'../../src/desktop/assets/index.html'),'utf8'),ids:any={},posted:any[]=[]
 const element=(id=''):any=>({id,value:'',textContent:'',hidden:false,disabled:false,dataset:{},attributes:{},children:[],events:{},setAttribute(k:string,v:any){this.attributes[k]=v},getAttribute(k:string){return this.attributes[k]},addEventListener(k:string,f:any){this.events[k]=f},append(...v:any[]){this.children.push(...v)},replaceChildren(...v:any[]){this.children=v},click(){if(!this.disabled)this.events.click?.()},focus(){}})
 for(const m of html.matchAll(/id="([^"]+)"/g))ids[m[1]]=element(m[1]);const nav=['thread.list','mcp.list','skill.list','knowledge.list'].map(page=>{const e=element();e.dataset.page=page;return e}),document:any={getElementById:(id:string)=>ids[id],createElement:()=>element(),querySelectorAll:(s:string)=>s==='nav button'?nav:[],addEventListener(){}}
 const window:any={webkit:{messageHandlers:{desktop:{postMessage:(v:any)=>posted.push(JSON.parse(JSON.stringify(v)))}}}};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../src/desktop/assets/app.js'),'utf8'),{window,document},{timeout:1000});const receive=(f:any)=>window.cmsparkDesktopReceive(f);receive({type:'desktop.document',generation:'doc-1'});posted.length=0
 const search=(query:string)=>{assert.ok(ids['thread-search-query'],'actual labeled search input');ids['thread-search-query'].value=query;ids['thread-search-submit'].click();return posted.at(-1)}
 return{ids,nav,posted,receive,search}
}
const wire=(f:any)=>{const out={...f};delete out.generation;return out}
const rowIds=(ui:ReturnType<typeof renderer>)=>ui.ids.list.children.flatMap((v:any)=>v.children).filter((b:any)=>b.attributes['data-thread-dialog']).map((b:any)=>b.attributes['data-thread-dialog'])
test('actual HMAC metadata search reaches row65, projects only existing row DTO and reads no body/list repair',t=>{
 const f=owned(t),list=f.send({type:'thread.list',id:'list'});assert.equal(list.threads.length,64);assert.equal(list.truncated,true);assert.equal(list.threads.some((r:any)=>r.id==='search-oldest'),false)
 const result=f.send({type:'thread.search',id:'search',query:'needle'});assert.equal(result.type,'thread.search_result');assert.equal(result.threads.length,1);assert.equal(result.threads[0].id,'search-oldest');assert.deepEqual(Object.keys(result.threads[0]).sort(),['id','title','updated_at']);assert.equal(result.truncated,false);assert.equal(JSON.stringify(result).includes('secret body'),false);assert.equal(f.messageReads,0);assert.equal(f.listCalls,0)
})
test('strict HMAC search rejects malformed/coerced/unknown/duplicate fields and keeps existing numeric bounds',t=>{
 const f=owned(t)
 for(const limit of [1,20]){const r=f.send({type:'thread.search',id:'good',query:'ordinary',limit});assert.equal(r.threads.length,limit);assert.equal(r.truncated,true)}
 assert.equal(f.send({type:'thread.search',id:'default',query:'ordinary'}).threads.length,10);assert.equal(f.send({type:'thread.search',id:'empty',query:'   '}).threads.length,0)
})
test('search is a fresh metadata read, not persistent cache; revoked owner gets no read',t=>{
 const f=owned(t);assert.equal(f.send({type:'thread.search',id:'first',query:'needle'}).threads.length,1);f.manager.updateDesktopMetadata('search-oldest',{alias:'changed'});assert.equal(f.send({type:'thread.search',id:'next',query:'needle'}).threads.length,0);f.registry.revokeHost('owned-search-host');const r=f.send({type:'thread.search',id:'retired',query:'changed'});assert.equal(r?.type==='thread.search_result',false)
})
test('actual DOM → HMAC → metadata response opens the correct canonical row65',t=>{
 const f=owned(t),ui=renderer();ui.receive(f.send({type:'thread.list',id:'thread.list'}));assert.equal(rowIds(ui).includes('search-oldest'),false)
 const req=ui.search('needle');ui.receive(f.send(wire(req)));assert.deepEqual(rowIds(ui),['search-oldest']);const button=ui.ids.list.children[0].children.find((v:any)=>v.attributes['data-thread-dialog']);button.click();assert.equal(ui.posted.at(-1).type,'desktop.thread.open');assert.equal(ui.posted.at(-1).thread_id,'search-oldest')
})
for(const transition of ['ABA','clear','page','offline','document','edit'])test(`actual renderer discards late search/result/error after ${transition}`,t=>{
 const f=owned(t),ui=renderer(),a=ui.search('needle'),old=f.send(wire(a));
 if(transition==='ABA'){ui.search('ordinary');ui.search('needle')}
 if(transition==='clear')ui.ids['thread-search-clear'].click()
 if(transition==='page'){ui.nav[1].click();ui.nav[0].click()}
 if(transition==='offline')ui.receive({type:'desktop.offline'})
 if(transition==='document')ui.receive({type:'desktop.document',generation:'doc-2'})
 if(transition==='edit'){ui.ids['thread-search-query'].value='ordinary';ui.ids['thread-search-query'].events.input()}
 const before=JSON.stringify(rowIds(ui)),notice=ui.ids.notice.textContent;ui.receive(old);ui.receive({type:'desktop.error',id:a.id,error_code:'DESKTOP_READ_FAILED'});assert.equal(JSON.stringify(rowIds(ui)),before);assert.equal(ui.ids.notice.textContent,notice)
})
test('clear restores list and stale list cannot overwrite pending search; empty/error/truncated are finite',t=>{
 const f=owned(t),ui=renderer(),request=ui.search('ordinary');ui.receive(f.send({type:'thread.list',id:'thread.list'}));assert.deepEqual(rowIds(ui),[]);ui.receive(f.send(wire(request)));assert.equal(rowIds(ui).length,10);assert.equal(ui.ids.notice.textContent,'匹配较多，请缩小标题查询范围。');assert.equal(ui.ids.notice.textContent.includes('64'),false);ui.search('absent');ui.receive(f.send(wire(ui.posted.at(-1))));assert.equal(rowIds(ui).length,0);assert.ok(ui.ids.notice.textContent.includes('没有'));ui.ids['thread-search-clear'].click();const listRequest=ui.posted.at(-1);assert.equal(listRequest.type,'thread.list');ui.receive(f.send(wire(listRequest)));assert.equal(rowIds(ui).length,64)
})
test('sole method-set remint and all bootstrap producers/consumers share version6 and bounded search guards',()=>{
 assert.equal(DESKTOP_METHOD_SET_VERSION,6);assert.ok((DESKTOP_READ_METHODS as readonly string[]).includes('thread.search'))
 const root=path.resolve(__dirname,'../../'),read=(f:string)=>fs.readFileSync(path.join(root,f),'utf8');for(const f of ['src/desktop/native/launcher.c','tests/fixtures/desktop-480/synchronize-handle-probe.c','tests/fixtures/desktop-480/windows-inheritance.c','tests/fixtures/desktop-480/windows-malformed-bootstrap.c'])assert.match(read(f),/issued_method_set_version\\":6/)
 assert.match(read('src/desktop/native/DesktopHost.cpp'),/desktop_method_set_version!=6/);assert.match(read('src/desktop/native/DesktopHost.swift'),/DesktopCapabilities.version==6/);assert.match(read('scripts/build-desktop-native.mjs'),/DESKTOP_METHOD_SET_VERSION !== 6/)
})

for(const raw of ['{"type":"thread.search","id":"dup","query":"a","query":"b"}','{"type":"thread.search","id":"dup","query":"a","\\u0071uery":"b"}'])test('actual flat duplicate-key search frame retires the authenticated socket '+raw.length,t=>{const f=owned(t);f.send(raw);assert.equal(f.socket.readyState,3)})
test('search matches the displayed id when canonical alias is empty and discards shared snippet',t=>{const f=owned(t);f.manager.create('','empty-alias-owned');const r=f.send({type:'thread.search',id:'fallback',query:'empty-alias-owned'});assert.equal(r.threads.length,1);assert.equal(r.threads[0].id,'empty-alias-owned');assert.equal(r.threads[0].title,'empty-alias-owned');assert.equal(Object.hasOwn(r.threads[0],'snippet'),false)})

for(const [index,patch] of [{query:1},{query:null},{query:[]},{query:{}},{query:'x'.repeat(121)},{limit:'1'},{limit:true},{limit:0},{limit:21},{limit:1.5},{extra:true},{id:'x'.repeat(201)}].entries())test('strict actual HMAC malformed search refuses before read '+index,t=>{const f=owned(t),r=f.send({type:'thread.search',id:'bad',query:'ordinary',...patch});assert.ok(r?.type==='desktop.error'||f.socket.readyState===3);assert.equal(f.messageReads,0);assert.equal(f.listCalls,0)})

test('HMAC search rechecks the owner after the real snapshot and emits no retired result',t=>{
 const f=owned(t),snapshot=f.manager.desktopMetadataSnapshot.bind(f.manager);let reads=0;t.mock.method(f.manager,'desktopMetadataSnapshot',()=>{reads++;const rows=snapshot();f.registry.revokeHost('owned-search-host');return rows});assert.equal(f.send({type:'thread.search',id:'revoked-during-read',query:'needle'}),undefined);assert.equal(reads,1)
})
test('only explicit metadata fields reach shared scorer; hostile extra digest getter remains unread',t=>{
 const f=owned(t),snapshot=f.manager.desktopMetadataSnapshot.bind(f.manager);let digestReads=0;t.mock.method(f.manager,'desktopMetadataSnapshot',()=>snapshot().map(row=>Object.defineProperty(row,'digest',{get(){digestReads++;throw Error('NO_DIGEST')}})));const r=f.send({type:'thread.search',id:'no-digest',query:'  needle\n  oldest '});assert.equal(r.threads[0].id,'search-oldest');assert.equal(digestReads,0)
})
test('title search keeps displayed text inert/redacted and neither search nor clear changes current dialog draft',t=>{
 const f=owned(t);f.manager.create('<img onerror=owned> sk-1234567890123456','redact-title');const ui=renderer();ui.ids['dialog-input'].value='unsubmitted current dialog draft';ui.receive(f.send(wire(ui.search('onerror'))));assert.equal(rowIds(ui)[0],'redact-title');const label=ui.ids.list.children[0].children[0];assert.ok(label.textContent.includes('[REDACTED]'));assert.equal(label.innerHTML,undefined);assert.equal(ui.ids['dialog-input'].value,'unsubmitted current dialog draft');ui.ids['thread-search-clear'].click();assert.equal(ui.ids['dialog-input'].value,'unsubmitted current dialog draft')
})
test('current search error is finite and late predecessor error cannot overwrite a successor success',t=>{
 const f=owned(t),ui=renderer(),a=ui.search('needle');ui.receive({type:'desktop.error',id:a.id,error_code:'DESKTOP_READ_FAILED'});assert.ok(ui.ids.notice.textContent.includes('不可用'));const b=ui.search('ordinary');ui.receive(f.send(wire(b)));const notice=ui.ids.notice.textContent,ids=JSON.stringify(rowIds(ui));ui.receive({type:'desktop.error',id:a.id,error_code:'DESKTOP_READ_FAILED'});assert.equal(ui.ids.notice.textContent,notice);assert.equal(JSON.stringify(rowIds(ui)),ids)
})

test('actual HMAC scoring uses only the redacted visible title, never hidden token membership',t=>{
 const f=owned(t);f.manager.create('<img onerror=owned> sk-1234567890123456','owned-secret-title');const visible=f.send({type:'thread.list',id:'visible-title'}).threads.find((r:any)=>r.id==='owned-secret-title');assert.ok(visible.title.includes('[REDACTED]'));assert.equal(visible.title.includes('1234567890123456'),false)
 const hidden=f.send({type:'thread.search',id:'hidden-membership',query:'1234567890123456'});assert.equal(hidden.threads.length,0,'a hidden inert token fragment must not identify its canonical row')
 for(const query of ['onerror','REDACTED']){const result=f.send({type:'thread.search',id:'visible-'+query,query});assert.equal(result.threads.length,1);assert.equal(result.threads[0].id,'owned-secret-title');assert.equal(result.threads[0].title,visible.title)}
})
