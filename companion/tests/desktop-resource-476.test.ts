/** Resource #476 tests use only the real channel with inert sockets and owned files. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { DESKTOP_RENDERER_METHODS } from '../src/desktop/capabilities'
for (const verb of ['read','import','update','remove']) test(`resource ${verb} is an exact native renderer method`,()=>{
 assert.ok((DESKTOP_RENDERER_METHODS as readonly string[]).includes('desktop.resource.'+verb))
})
test('native resource pages offer an actual single-text import entry',()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../../src/desktop/assets/index.html'),'utf8')
 assert.match(html,/id="resource-import"/)
 assert.match(html,/id="resource-text"/)
})

import os from 'node:os'
import { EventEmitter } from 'node:events'
import { createHmac } from 'node:crypto'
import { SkillEngine } from '../src/skills/skill-engine'
import { createDesktopChannel } from '../src/desktop/channel'
import { DesktopIdentityRegistry } from '../src/desktop/identity'
import { SecurityConfirmationManager } from '../src/security-confirmation'
import { parseResourcePayload } from '../src/desktop/resources'
function fixture(t:any,maxPayload=10*1024*1024) {
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'resources-476-'))),old=process.env.CMSPARK_DATA_DIR
 process.env.CMSPARK_DATA_DIR=dir
 fs.mkdirSync(path.join(dir,'skills'),{recursive:true});fs.mkdirSync(path.join(dir,'knowledge/global'),{recursive:true});fs.mkdirSync(path.join(dir,'builtin-skills'),{recursive:true})
 const engine=new SkillEngine(),manager=new SecurityConfirmationManager(),registry=new DesktopIdentityRegistry()
 const channel=createDesktopChannel({registry,securityConfirmations:manager,maxPayload,services:{skills:engine,threads:{get:()=>undefined,desktopMetadataSnapshot:()=>[],getMessages:()=>[]},mcp:{listServers:()=>[]}}})
 const socket:any=new EventEmitter(),sent:any[]=[];socket.readyState=1;socket.send=(body:string)=>sent.push(JSON.parse(body));socket.close=socket.terminate=()=>{if(socket.readyState===3)return;socket.readyState=3;socket.emit('close')}
 channel.wss.emit('connection',socket);assert.equal(sent.shift().type,'desktop.challenge.request');const boot=registry.issue('owned-resource-host')
 const emit=(v:any)=>socket.emit('message',Buffer.from(typeof v==='string'?v:JSON.stringify(v)))
 emit({type:'desktop.hello',capability_id:boot.capabilityId,protocol_version:1});const ch=sent.shift()
 emit({type:'desktop.authenticate',capability_id:boot.capabilityId,protocol_version:1,proof:createHmac('sha256',Buffer.from(boot.secret,'hex')).update(JSON.stringify(['cmspark.desktop.auth.v1',boot.capabilityId,ch.connection_id,1,ch.nonce])).digest('hex')});assert.equal(sent.shift().type,'desktop.ready')
 const tick=async()=>{await new Promise<void>(r=>setImmediate(r))}
 const send=async(v:any)=>{emit(v);await tick();return sent.shift()}
 const decide=async(r:any,approved=true,patch:any={})=>{emit({type:'desktop.confirmation.decision',purpose:'resource',confirmation_id:r.confirmation_id,thread_id:null,action_digest:r.action_digest,approved,...patch});await tick();return sent.splice(0)}
 t.after(()=>{manager.rejectAll('disconnect');socket.terminate();channel.wss.emit('close');if(old===undefined)delete process.env.CMSPARK_DATA_DIR;else process.env.CMSPARK_DATA_DIR=old;fs.rmSync(dir,{recursive:true,force:true})})
 const read=(kind='knowledge',resource_id='owned-note')=>send({type:'desktop.resource.read',id:'read',kind,resource_id})
 const importText=(kind:string,text:string)=>send({type:'desktop.resource.import',id:'import',kind,payload_json:JSON.stringify({text})})
 return{dir,engine,manager,registry,emit,send,decide,read,importText,sent,tick,socket}
}
const knowledge='---\nname: owned-note\ntitle: 原知识\ndescription: 文档说明\ntype: domain_knowledge\n---\n\n  保留正文缩进\n'
const skill='---\nname: owned-skill\ndescription: 技能说明\ntype: prompt_template\n---\n\n技能正文\n'
for(const [kind,text,id] of [['knowledge',knowledge,'owned-note'],['skill',skill,'owned-skill']])test(`actual HMAC channel imports, reopens and removes only ${kind} after controller approval`,async t=>{
 const f=fixture(t),r=await f.importText(kind,text);assert.equal(r.type,'desktop.confirmation.request');assert.equal(r.purpose,'resource');assert.equal(f.manager.pendingCount(),1)
 assert.equal(JSON.parse(r.action_json).thread_id,null);assert.equal(JSON.parse(r.action_json).kind,kind)
 const out=await f.decide(r);assert.equal(out.at(-1).outcome,'committed')
 const opened=await f.read(kind,id);assert.equal(opened.ok,true);assert.equal(opened.doc.complete,true);assert.equal(opened.doc.writable,true);assert.equal(/^[a-f0-9]{64}$/.test(opened.doc.revision),true)
 assert.deepEqual(Object.keys(opened.doc).sort(),['kind','resource_id','title','description','tags','text','complete','truncated','redacted','builtin','writable','read_only_reason','revision'].sort());assert.equal(JSON.stringify(opened).includes(f.dir),false)
 const fresh=new SkillEngine();assert.ok(kind==='knowledge'?fresh.getKnowledge(id):fresh.get(id))
 const remove={type:'desktop.resource.remove',id:'remove',kind,resource_id:id,revision:opened.doc.revision}
 const deny=await f.send(remove);assert.equal((await f.decide(deny,false)).at(-1).outcome,'denied');assert.ok(f.engine.get(id))
 const reread=await f.read(kind,id),r2=await f.send({...remove,revision:reread.doc.revision});assert.equal((await f.decide(r2)).at(-1).outcome,'committed');assert.equal(f.engine.get(id),undefined)
})
test('actual resource update persists canonical metadata and observes same-content file replacement',async t=>{
 const f=fixture(t);f.engine.importKnowledge(knowledge);const opened=await f.read()
 const r=await f.send({type:'desktop.resource.update',id:'update',kind:'knowledge',resource_id:'owned-note',revision:opened.doc.revision,payload_json:JSON.stringify({title:'新名称',tags:['Review']})});assert.equal(r.type,'desktop.confirmation.request');const out=await f.decide(r);assert.equal(out.at(-1).outcome,'committed');assert.equal(new SkillEngine().getKnowledge('owned-note')!.title,'新名称')
 const second=await f.read(),record=f.engine.get('owned-note')!,raw=fs.readFileSync(record.source_file);fs.renameSync(record.source_file,record.source_file+'.old');fs.writeFileSync(record.source_file,raw)
 const stale=await f.send({type:'desktop.resource.remove',id:'remove',kind:'knowledge',resource_id:'owned-note',revision:second.doc.revision});assert.equal(stale.outcome,'conflict');assert.ok(fs.existsSync(record.source_file))
})
test('canonical A-B-A during confirmation and approved-then-revoked owner both reject effect',async t=>{
 const f=fixture(t);f.engine.importKnowledge(knowledge);let opened=await f.read(),record=f.engine.get('owned-note')!,raw=fs.readFileSync(record.source_file)
 let r=await f.send({type:'desktop.resource.remove',id:'remove',kind:'knowledge',resource_id:'owned-note',revision:opened.doc.revision})
 f.engine.updateKnowledge('owned-note',{title:'B'});fs.writeFileSync(record.source_file,raw);f.engine.refresh();assert.equal((await f.decide(r)).at(-1).outcome,'conflict');assert.ok(fs.existsSync(record.source_file))
 opened=await f.read();r=await f.send({type:'desktop.resource.remove',id:'remove',kind:'knowledge',resource_id:'owned-note',revision:opened.doc.revision})
 const respond=f.manager.respondFrom.bind(f.manager);t.mock.method(f.manager,'respondFrom',(...a:any[])=>{const result=Reflect.apply(respond,f.manager,a);f.registry.revokeHost('owned-resource-host');return result});await f.decide(r);assert.ok(fs.existsSync(record.source_file))
})
test('builtin, folder, wrong kind, duplicate and authority frontmatter cannot become writable',async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.dir,'builtin-skills','system.md'),skill.replace('owned-skill','system'));fs.mkdirSync(path.join(f.dir,'skills/package'));fs.writeFileSync(path.join(f.dir,'skills/package/SKILL.md'),skill.replace('owned-skill','package'));f.engine.refresh()
 for(const id of ['system','package']){const opened=await f.read('skill',id);assert.equal(opened.doc.writable,false);assert.equal(opened.doc.revision,null)}
 assert.equal((await f.read('knowledge','system')).ok,false)
 let r=await f.importText('knowledge',knowledge);await f.decide(r);assert.equal((await f.importText('knowledge',knowledge)).outcome,'conflict')
 for(const text of [skill.replace('name: owned-skill','name: untrusted\ntrust_level: trusted'),skill.replace('type: prompt_template','type: arbitrary'),skill.replace('name: owned-skill','name: [bad]')])assert.equal((await f.importText('skill',text)).ok,false)
 assert.equal(f.manager.pendingCount(),0)
})
test('payload parser rejects duplicates, prototype, hidden types, cap overflow and authority keys',()=>{
 for(const raw of ['{"body":"a","body":"b"}','{"body":"a","\\u0062ody":"b"}','{"__proto__":{}}','{"body":null}','{"tags":[1]}','{"force":true}','{"text":"x","path":"x"}'])assert.equal(parseResourcePayload(raw,raw.includes('text')),null)
 assert.ok(parseResourcePayload(JSON.stringify({body:'x'.repeat(524288)}),false));assert.equal(parseResourcePayload(JSON.stringify({body:'x'.repeat(524289)}),false),null)
})

import vm from 'node:vm'
function renderer() {
 const html=fs.readFileSync(path.resolve(__dirname,'../../src/desktop/assets/index.html'),'utf8'),ids:any={}
 const element=(id=''):any=>({id,value:'',textContent:'',hidden:false,disabled:false,dataset:{},attributes:{},children:[],events:{},setAttribute(k:string,v:any){this.attributes[k]=v},getAttribute(k:string){return this.attributes[k]},addEventListener(k:string,f:any){this.events[k]=f},append(...nodes:any[]){this.children.push(...nodes)},replaceChildren(...nodes:any[]){this.children=nodes},focus(){document.activeElement=this},click(){if(!this.disabled)this.events.click?.()}})
 for(const match of html.matchAll(/id="([^"]+)"/g))ids[match[1]]=element(match[1])
 const nav=['thread.list','mcp.list','skill.list','knowledge.list'].map(page=>{const e=element();e.dataset.page=page;return e}),posted:any[]=[]
 const document:any={events:{},getElementById:(id:string)=>ids[id],createElement:()=>element(),querySelectorAll:(selector:string)=>selector==='nav button'?nav:[],addEventListener(k:string,f:any){this.events[k]=f}}
 const window:any={webkit:{messageHandlers:{desktop:{postMessage:(f:any)=>posted.push(JSON.parse(JSON.stringify(f)))}}}}
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../src/desktop/assets/app.js'),'utf8'),{window,document},{timeout:1000})
 const receive=(f:any)=>window.cmsparkDesktopReceive(f);receive({type:'desktop.document',generation:'owned-doc'});nav[3].click();posted.length=0
 return{ids,posted,receive,nav,window,document}
}
const wire=(frame:any)=>{const v={...frame};delete v.generation;return v}
async function drain(f:ReturnType<typeof fixture>,ui:ReturnType<typeof renderer>) {
 let confirmation:any
 for(let i=0;i<30&&ui.posted.length;i++){const result=await f.send(wire(ui.posted.shift()));if(!result)continue;if(result.type==='desktop.confirmation.request'){confirmation=result;break}ui.receive(result)}
 return confirmation
}
test('actual native renderer imports, reads and edits through HMAC actor and canonical persisted disk',async t=>{
 const f=fixture(t),ui=renderer();ui.ids['resource-import'].click();ui.ids['resource-text'].value=knowledge;ui.ids['resource-save'].click();assert.equal(ui.ids['resource-text'].disabled,true)
 let request=await drain(f,ui);assert.equal(request.purpose,'resource');for(const reply of await f.decide(request))ui.receive(reply);await drain(f,ui)
 assert.equal(ui.ids['resource-text'].value,new SkillEngine().getKnowledge('owned-note')!.body);assert.equal(ui.ids['resource-name'].value,'原知识')
 ui.ids['resource-name'].value='UI真实保存';ui.ids['resource-save'].click();request=await drain(f,ui);assert.equal(JSON.parse(request.action_json).payload.title,'UI真实保存');for(const reply of await f.decide(request))ui.receive(reply);await drain(f,ui)
 assert.equal(new SkillEngine().getKnowledge('owned-note')!.title,'UI真实保存');assert.equal(ui.ids['resource-name'].value,'UI真实保存')
})
for(const transition of ['pageABA','cancel','document','offline'])test(`UI ${transition} cannot apply a stale import/read reply to a new draft`,async t=>{
 const f=fixture(t),ui=renderer();ui.ids['resource-import'].click();ui.ids['resource-text'].value=knowledge;ui.ids['resource-save'].click();const request=await drain(f,ui)
 if(transition==='pageABA'){ui.nav[2].click();ui.nav[3].click()}
 if(transition==='cancel')ui.ids['resource-cancel'].click()
 if(transition==='document')ui.receive({type:'desktop.document',generation:'new-doc'})
 if(transition==='offline')ui.receive({type:'desktop.offline'})
 ui.ids['resource-text'].value='new unrelated draft';for(const reply of await f.decide(request))ui.receive(reply)
 assert.equal(ui.ids['resource-text'].value,'new unrelated draft');assert.notEqual(ui.ids['resource-feedback'].textContent,'已持久化，请重新打开核对。')
})
test('wrong-purpose, old-snapshot and post-confirm-current=false cannot commit',async t=>{
 const f=fixture(t);f.engine.importKnowledge(knowledge);const opened=await f.read(),r=await f.send({type:'desktop.resource.remove',id:'remove',kind:'knowledge',resource_id:'owned-note',revision:opened.doc.revision})
 await f.decide(r,true,{purpose:'mcp'});assert.equal(f.manager.pendingCount(),1)
 await f.read('knowledge','missing');assert.equal(f.manager.pendingCount(),0);await f.decide(r);assert.ok(f.engine.get('owned-note'))
})
test('create-exclusive collision and same-kind canonical duplicate cannot overwrite a sibling',t=>{
 const f=fixture(t),store=f.engine.createDesktopResourceStore(),plan=store.prepareImport('knowledge',knowledge)
 fs.writeFileSync(plan.destination,'occupied');assert.throws(()=>store.commitImport(plan,()=>true));assert.equal(fs.readFileSync(plan.destination,'utf8'),'occupied')
})
test('mutation checks current at its last synchronous boundary after observer-triggering refresh',t=>{
 const f=fixture(t);f.engine.importKnowledge(knowledge);const store=f.engine.createDesktopResourceStore(),snapshot=store.snapshot('knowledge','owned-note');const file=f.engine.get('owned-note')!.source_file
 assert.throws(()=>store.remove(snapshot,()=>false));assert.ok(fs.existsSync(file));snapshot.release()
})
test('read previews redact contents, truncate over-cap bodies and never provide a writable revision',async t=>{
 const f=fixture(t),file=path.join(f.dir,'knowledge/global/owned-note.md')
 fs.writeFileSync(file,knowledge+'x'.repeat(524289));f.engine.refresh();let opened=await f.read();assert.equal(opened.doc.truncated,true);assert.equal(opened.doc.revision,null)
 fs.writeFileSync(file,knowledge+'sk-'+'A'.repeat(48));f.engine.refresh();opened=await f.read();assert.equal(opened.doc.redacted,true);assert.equal(opened.doc.revision,null);assert.equal(opened.doc.text.includes('sk-'+'A'.repeat(48)),false)
})
test('exclusive import partial write failure removes only its own new file and preserves the original exception',t=>{
 const f=fixture(t),store=f.engine.createDesktopResourceStore(),plan=store.prepareImport('knowledge',knowledge),original=fs.writeFileSync,primary=Error('owned write failure')
 t.mock.method(fs,'writeFileSync',(...a:any[])=>{if(typeof a[0]==='number'){fs.writeSync(a[0],Buffer.from('half'));throw primary}return Reflect.apply(original,fs,a)})
 assert.throws(()=>store.commitImport(plan,()=>true),e=>e===primary);assert.equal(fs.existsSync(plan.destination),false)
})
test('canonical-id update cannot be redirected by a legacy same-name alias',async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.dir,'knowledge/global/a.md'),knowledge.replace('name: owned-note','name: owned-note\nid: alias-other'));fs.writeFileSync(path.join(f.dir,'knowledge/global/b.md'),knowledge.replace('name: owned-note','name: distinct-name\nid: owned-note'));f.engine.refresh()
 const a=f.engine.get('alias-other')!,b=f.engine.get('distinct-name')!,beforeA=fs.readFileSync(a.source_file),beforeB=fs.readFileSync(b.source_file),opened=await f.read()
 const r=await f.send({type:'desktop.resource.update',id:'update',kind:'knowledge',resource_id:'owned-note',revision:opened.doc.revision,payload_json:JSON.stringify({title:'must not redirect'})});assert.equal((await f.decide(r)).at(-1).outcome,'conflict');assert.deepEqual(fs.readFileSync(a.source_file),beforeA);assert.deepEqual(fs.readFileSync(b.source_file),beforeB)
})
test('skill import refuses canonical knowledge types rather than ACKing an invisible skill',async t=>{
 const f=fixture(t);assert.equal((await f.importText('skill',knowledge)).ok,false);assert.equal(f.engine.listKnowledge().length,0);assert.equal(f.engine.list().length,0)
})
test('read is bound to a socket-local snapshot, not a reusable revision bearer token',async t=>{
 const f=fixture(t);f.engine.importKnowledge(knowledge);const first=await f.read(),second=await f.read();assert.notEqual(first.doc.revision,second.doc.revision)
 const denied=await f.send({type:'desktop.resource.remove',id:'remove',kind:'knowledge',resource_id:'owned-note',revision:first.doc.revision});assert.equal(denied.outcome,'conflict');assert.equal(f.manager.pendingCount(),0)
})
test('native host/controller method-set and purpose are bound at every real bootstrap producer/consumer',()=>{
 const root=path.resolve(__dirname,'../..'),read=(p:string)=>fs.readFileSync(path.join(root,p),'utf8')
 const launcher=read('src/desktop/native/launcher.c');assert.equal((launcher.match(/issued_method_set_version\\":10/g)||[]).length,2)
 for(const name of ['synchronize-handle-probe.c','windows-inheritance.c','windows-malformed-bootstrap.c'])assert.equal((read('tests/fixtures/desktop-480/'+name).match(/issued_method_set_version\\":10/g)||[]).length,1)
 const cpp=read('src/desktop/native/DesktopHost.cpp'),swift=read('src/desktop/native/DesktopHost.swift')
 assert.match(cpp,/desktop_method_set_version!=10/);assert.match(swift,/DesktopCapabilities.version==10/)
 assert.match(cpp,/value->purpose==L"resource"\|\|value->purpose==L"workspace"\|\|value->purpose==L"local-work"\)put\(result,L"purpose",value->purpose\)/);assert.match(swift,/if p.purpose=="resource" \|\| p.purpose=="workspace" \|\| p.purpose=="local-work" \{result\["purpose"\]=p.purpose\}/)
 assert.match(cpp,/binding\.target/);assert.match(cpp,/binding\.revision/);assert.match(swift,/target==request\.target/);assert.match(swift,/request\.revision/)
 const builder=read('scripts/build-desktop-native.mjs');assert.match(builder,/DESKTOP_METHOD_SET_VERSION !== 10/);for(const verb of ['read','import','update','remove'])assert.ok(builder.includes('desktop.resource.'+verb))
})
for(const docFirst of [true,false])test(`hosted resource form drives actual UI/backend through all six writes, documentFirst=${docFirst}`,async t=>{
 const f=fixture(t),ui=renderer();ui.posted.length=0
 // A fresh document order is observable; the test script wraps the actual receive function.
 if(!docFirst)ui.receive({type:'desktop.offline'})
 const select=(selector:string)=>{const page=/data-page="([^"]+)"/.exec(selector)?.[1];return page?ui.nav[['thread.list','mcp.list','skill.list','knowledge.list'].indexOf(page)]:undefined}
 ui.document.querySelector=select
 ui.document.querySelectorAll=(selector:string)=>selector==='nav button'?ui.nav:selector==='[data-resource-id]'?ui.ids.list.children.flatMap((li:any)=>li.children).filter((e:any)=>e.attributes['data-resource-id']):[]
 vm.runInNewContext("const documentGeneration='owned-doc';"+fs.readFileSync(path.resolve(__dirname,'../../tests/fixtures/desktop-476/resource-form.js'),'utf8'),{window:ui.window,document:ui.document},{timeout:1000})
 if(!docFirst)ui.receive({type:'desktop.document',generation:'owned-doc'})
 let windows=0,lost=false;const notes:string[]=[]
 for(let i=0;i<100&&ui.posted.length;i++){
   const frame=ui.posted.shift();if(frame.type==='system.ping'){if(frame.id==='D476_RES_ESCAPE_REQUEST'){/* Inert DOM dispatch only; hosted fixture owns the real OS key. */ui.ids['resource-editor'].events.keydown({key:'Escape',preventDefault(){}});ui.document.events.keyup({key:'Escape',isTrusted:true});continue}notes.push(frame.id);continue}
   assert.notEqual(frame.type,'D476.resource.offline')
   const result=await f.send(wire(frame));if(!result)continue
   if(result.type==='desktop.confirmation.request'){
     windows++;const replies=await f.decide(result,windows!==4)
     for(const reply of replies){if(windows===6&&reply.type==='desktop.resource.update.result'&&reply.outcome==='committed'){f.socket.terminate();ui.receive({type:'desktop.offline'});lost=true;break}ui.receive(reply)}
   }else ui.receive(result)
   if(lost){const receipt=ui.posted.find((v:any)=>v.type==='D476.resource.offline');assert.equal(receipt.result,'ok');break}
 }
 assert.equal(windows,6);assert.equal(lost,true);assert.equal(notes.includes('D476_RES_FAIL'),false)
 assert.deepEqual(notes,['D476_RES_SKILL_IMPORTED','D476_RES_KNOWLEDGE_IMPORTED','D476_RES_ESCAPE_OK','D476_RES_REOPENED','D476_RES_UPDATED','D476_RES_DENIED','D476_RES_REMOVED','D476_RES_BEFORE_LOST_ACK'])
 const disk=new SkillEngine();assert.equal(disk.get('native-resource-skill'),undefined);assert.equal(disk.getKnowledge('native-resource-note')!.body,'\n未确认的原生知识正文')
})
test('actual UI ignores wrong-operation and wrong-target ACKs before the matching result',async t=>{
 const f=fixture(t),ui=renderer();ui.ids['resource-import'].click();ui.ids['resource-text'].value=knowledge;ui.ids['resource-save'].click();let request=await drain(f,ui);for(const reply of await f.decide(request))ui.receive(reply);await drain(f,ui)
 ui.ids['resource-name'].value='pending';ui.ids['resource-save'].click();request=await drain(f,ui);const pending=JSON.parse(JSON.stringify(ui.posted)),replies=await f.decide(request),good=replies.find(v=>v.type==='desktop.resource.update.result')
 ui.receive({...good,type:'desktop.resource.remove.result'});assert.equal(ui.ids['resource-save'].disabled,true)
 ui.receive({...good,resource_id:'other'});assert.equal(ui.ids['resource-save'].disabled,true);assert.equal(ui.ids['resource-name'].value,'pending')
 ui.receive(good);await drain(f,ui);assert.equal(ui.ids['resource-name'].value,'pending')
})
test('a post-write refresh fault reports unknown while the committed file remains discoverable',async t=>{
 const f=fixture(t),r=await f.importText('knowledge',knowledge),refresh=f.engine.refresh.bind(f.engine)
 t.mock.method(f.engine,'refresh',()=>{throw Error('owned post-commit refresh fault')})
 const out=await f.decide(r);assert.equal(out.at(-1).outcome,'unknown');t.mock.restoreAll();refresh();assert.ok(new SkillEngine().getKnowledge('owned-note'))
})
test('import captures physical parent identity across confirmation and rejects same-name root replacement',t=>{
 const f=fixture(t),store=f.engine.createDesktopResourceStore(),plan=store.prepareImport('knowledge',knowledge),bucket=path.dirname(plan.destination)
 fs.renameSync(bucket,bucket+'-old');fs.mkdirSync(bucket)
 assert.throws(()=>store.commitImport(plan,()=>true));assert.equal(fs.existsSync(plan.destination),false)
})
test('native resource fixture transformations preserve full source for LF and CRLF and reject missing hooks',async()=>{
 const {pathToFileURL}=await import('node:url'),{desktopResourceFixture}=await(new Function('u','return import(u)'))(pathToFileURL(path.resolve(__dirname,'../../scripts/desktop-mcp-fixture.mjs')).href)
 const root=path.resolve(__dirname,'../..'),read=(rel:string)=>fs.readFileSync(path.join(root,rel),'utf8')
 for(const language of ['cpp','swift']){const original=read('src/desktop/native/DesktopHost.'+language),fixture=read('tests/fixtures/desktop-476/resource-acceptance.'+language),form=read('tests/fixtures/desktop-476/resource-form.js');for(const eol of ['\n','\r\n']){const source=original.replace(/\r\n/g,'\n').replace(/\n/g,eol),built=desktopResourceFixture(language,source,fixture,form);assert.equal(built.inverse,source);assert.equal(built.source.includes('D476_FORM_SOURCE'),false);assert.ok(built.source.includes('D476.resource.offline'));assert.ok(built.source.includes('D476_RES_ESCAPE_REQUEST'))}assert.throws(()=>desktopResourceFixture(language,original+original,fixture,form))}
})

import matter from 'gray-matter'
for(const language of ['js','javascript'])test(`native import rejects ${language} before the canonical parser can invoke a code engine`,t=>{
 const f=fixture(t),store=f.engine.createDesktopResourceStore();let calls=0
 t.mock.method((matter as any).engines.javascript,'parse',()=>{calls++;return{name:'owned-inert-language',description:'constant',type:'prompt_template'}})
 let rejected=false;try{store.prepareImport('skill','---'+language+'\n({name:"owned-inert-language"})\n---\nbody')}catch{rejected=true}
 assert.deepEqual({rejected,calls},{rejected:true,calls:0})
})
for(const eol of ['\n','\r\n'])test(`bare YAML ${JSON.stringify(eol)} and ordinary Markdown retain canonical native import support`,t=>{
 const f=fixture(t),store=f.engine.createDesktopResourceStore(),raw=skill.replace(/\n/g,eol),plan=store.prepareImport('skill',raw);store.commitImport(plan,()=>true);assert.equal(fs.readFileSync(plan.destination,'utf8'),raw)
 const text='# ordinary native note\n\nbody';const note=store.prepareImport('knowledge',text);store.commitImport(note,()=>true);assert.ok(f.engine.getKnowledge(note.id)!.body.includes('body'))
})
test('canonical entry writes without refresh invalidate active snapshots and isolate observer faults',t=>{
 const f=fixture(t);f.engine.importSkill(skill);const store=f.engine.createDesktopResourceStore(),snapshot=store.snapshot('skill','owned-skill')
 const primary=Error('owned observer fault');(f.engine as any).desktopResourceObservers.add(()=>{throw primary})
 assert.doesNotThrow(()=>f.engine.addEntry('owned-skill',{id:'owned-entry',category:'tip',content:'observed canonical entry',recorded_at:'2026-10-18T00:00:00Z',stale:false}as any))
 assert.equal(snapshot.invalidated,true);assert.throws(()=>store.validate(snapshot));snapshot.release()
})

for (const eol of ['\n', '\r\n']) test(`native knowledge import preserves parsed body bytes for ${JSON.stringify(eol)}`, async t => {
 const f = fixture(t)
 const raw = ['---', 'name: body-byte-preserved', 'description: passive', 'type: domain_knowledge', '---', '', '    indented first line', '    second line', ''].join(eol)
 const expected = matter(raw).content
 const request = await f.importText('knowledge', raw)
 assert.equal(request.type, 'desktop.confirmation.request')
 assert.equal((await f.decide(request)).at(-1).outcome, 'committed')
 assert.equal(f.engine.getKnowledge('body-byte-preserved')!.body, expected)
 assert.equal(new SkillEngine().getKnowledge('body-byte-preserved')!.body, expected)
})

test('resource metadata escaping cannot emit a frame beyond the actual channel byte budget', async t => {
 const f = fixture(t), file = path.join(f.dir, 'knowledge/global/frame-bounded.md')
 const raw = '---\nname: frame-bounded\ntype: domain_knowledge\ndescription: ' + '\\'.repeat(5400000) + '\n---\nbody\n'
 assert.ok(Buffer.byteLength(raw) < 6291456)
 fs.writeFileSync(file, raw)
 const lengths:number[] = [], send = f.socket.send
 t.mock.method(f.socket, 'send', (body:string) => { lengths.push(Buffer.byteLength(body)); send(body) })
 const result = await f.read('knowledge', 'frame-bounded')
 assert.equal(result.ok, false)
 assert.equal(result.error_code, 'DESKTOP_RESOURCE_UNAVAILABLE')
 assert.ok(lengths.length > 0 && lengths.every(n => n <= 10*1024*1024))
 assert.equal((f.engine as any).desktopResourceObservers.size, 0)
})
test('resource read applies the configured channel limit after final JSON encoding', async t => {
 const f = fixture(t,2048),file=path.join(f.dir,'knowledge/global/frame-small.md')
 fs.writeFileSync(file,'---\nname: frame-small\ntype: domain_knowledge\ndescription: passive\n---\n'+'x'.repeat(4096))
 const lengths:number[] = [], send=f.socket.send
 t.mock.method(f.socket,'send',(body:string)=>{lengths.push(Buffer.byteLength(body));send(body)})
 const result=await f.read('knowledge','frame-small')
 assert.equal(result.ok,false)
 assert.equal(result.error_code,'DESKTOP_RESOURCE_UNAVAILABLE')
 assert.ok(lengths.length>0&&lengths.every(n=>n<=2048))
 assert.equal((f.engine as any).desktopResourceObservers.size,0)
})

test('resource confirmation which cannot fit cancels only its write and rejects a late approval', async t => {
 const f=fixture(t,512),lengths:number[]=[],send=f.socket.send
 t.mock.method(f.socket,'send',(body:string)=>{lengths.push(Buffer.byteLength(body));send(body)})
 const request=f.manager.request.bind(f.manager)
 let confirmationId=''
 t.mock.method(f.manager,'request',((notify:any,...args:any[])=>Reflect.apply(request,f.manager,[(data:any)=>{if(data.type==='security.confirmation.request')confirmationId=data.confirmation_id;notify(data)},...args]))as typeof f.manager.request)
 const text='# bounded confirmation\n'+'x'.repeat(160)
 assert.ok(Buffer.byteLength(JSON.stringify({type:'desktop.resource.import',id:'import',kind:'knowledge',payload_json:JSON.stringify({text})}))<=512)
 const first=await f.importText('knowledge',text)
 const result=[first,...f.sent.splice(0)].find(v=>v.type==='desktop.resource.import.result')
 assert.ok(result);assert.equal(result.ok,false);assert.equal(result.error_code,'DESKTOP_RESOURCE_UNAVAILABLE')
 assert.ok(confirmationId);assert.equal(f.manager.pendingCount(),0)
 assert.equal(f.manager.respondFrom(confirmationId,true,f.socket).outcome,'unknown')
 await f.tick()
 assert.equal(f.engine.listKnowledge().length,0)
 assert.equal((f.engine as any).desktopResourceObservers.size,0)
 assert.ok(lengths.length>0&&lengths.every(n=>n<=512))
})

for(const field of ['title','description','tags'])test(`resource snapshot refuses oversized canonical ${field} without an editable observer`,async t=>{
 const f=fixture(t),data:any={name:'oversized-canonical',type:'domain_knowledge',description:'owned'}
 if(field==='title')data.title='t'.repeat(201)
 if(field==='description')data.description='d'.repeat(501)
 if(field==='tags')data.tags=Array.from({length:9},(_,i)=>'tag-'+i)
 const yaml=require('js-yaml')as typeof import('js-yaml')
 fs.writeFileSync(path.join(f.dir,'knowledge/global/oversized-canonical.md'),'---\n'+yaml.dump(data)+'---\nbody\n')
 const result=await f.read('knowledge','oversized-canonical')
 assert.equal(result.ok,false);assert.equal(result.error_code,'DESKTOP_RESOURCE_UNAVAILABLE')
 assert.equal(f.manager.pendingCount(),0)
 assert.equal((f.engine as any).desktopResourceObservers.size,0)
})


test('resource capacity rejection settles actual UI through only the first native terminal',async t=>{
 const f=fixture(t,512),ui=renderer();ui.ids['resource-import'].click();ui.ids['resource-text'].value='# bounded terminal\n'+'x'.repeat(160);ui.ids['resource-save'].click()
 assert.equal(ui.ids['resource-text'].disabled,true)
 const request=wire(ui.posted.shift());assert.ok(Buffer.byteLength(JSON.stringify(request))<=512)
 f.emit(request);await f.tick()
 const terminal=f.sent.filter(v=>v.type==='desktop.resource.import.result'&&v.id===request.id)
 assert.ok(terminal.length>0)
 // Both actual native receivers retire a matching request at its first result.
 ui.receive(terminal[0])
 assert.equal(terminal[0].kind,'knowledge')
 assert.equal(ui.ids['resource-text'].disabled,false)
 assert.equal(terminal.length,1)
 assert.equal(f.manager.pendingCount(),0);assert.equal(f.engine.listKnowledge().length,0)
})
test('bounded read fallback retains the closed resource kind for the native UI',async t=>{
 const f=fixture(t,512),ui=renderer();f.engine.importKnowledge(knowledge)
 const file=f.engine.get('owned-note')!.source_file;fs.appendFileSync(file,'x'.repeat(4096));f.engine.refresh()
 const result=await f.read();assert.equal(result.ok,false);assert.equal(result.kind,'knowledge')
 assert.ok(Buffer.byteLength(JSON.stringify(result))<=512);assert.equal((f.engine as any).desktopResourceObservers.size,0)
})
