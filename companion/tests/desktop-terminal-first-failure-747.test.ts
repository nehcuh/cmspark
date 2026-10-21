/** Fixed source-derived diagnostic controls only; no native/COM/PTY process. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import {createHash} from 'node:crypto'
const root=process.env.CMSPARK_TERMINAL747_SOURCE_ROOT??path.resolve(__dirname,'../..')
const source=(p:string)=>fs.readFileSync(path.join(root,p),'utf8')
const cpp=source('tests/fixtures/desktop-476/terminal-acceptance.cpp'),form=source('tests/fixtures/desktop-476/terminal-form.js'),parent=source('tests/desktop-native-thread-metadata-476.test.ts')
function block(text:string,start:number){const begin=text.indexOf('{',start);assert.ok(begin>=0);let depth=0,quote='',comment=false;for(let i=begin;i<text.length;i++){const c=text[i];if(comment){if(c==='\n')comment=false;continue}if(quote){if(c==='\\')i++;else if(c===quote)quote='';continue}if(c==='/'&&text[i+1]==='/'){comment=true;i++;continue}if(c==='"'||c==="'"){quote=c;continue}if(c==='{')depth++;if(c==='}'&&!--depth)return text.slice(begin+1,i)}throw Error('UNCLOSED')}
function collector(){const file=ts.createSourceFile('native.ts',parent,ts.ScriptTarget.Latest,true),defs=file.statements.filter((n):n is ts.FunctionDeclaration=>ts.isFunctionDeclaration(n)&&n.name?.text==='createTerminalFirstFailure747');assert.equal(defs.length,1,'actual native caller must define one finite collector');const c:any={};vm.runInNewContext(ts.transpileModule(defs[0].getText(file)+';globalThis.create=createTerminalFirstFailure747;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,c,{timeout:1000});return c.create()}
function note(){const signature='void D705TerminalAcceptance::note(';assert.equal(cpp.split(signature).length,2,'actual controller must have one finite latch');let body=block(cpp,cpp.indexOf(signature)).replace(/L(?=["'])/g,'').replace(/(28|19)u\b/g,'$1').replace(/static wchar_t const\* const (native|renderer)\[\]=\{([^}]+)\};/g,'const $1=[$2];').replace('emit(*host,','emit(host,').replace('catch(...)','catch(error)');const emitted:string[]=[],realm:any={first_origin:0,first_site:0,emit:(_h:any,id:string)=>emitted.push(id)};vm.createContext(realm);vm.runInContext('note=function(host,origin,site){'+body+'}',realm,{timeout:1000});return{realm,emitted}}
const ping=(origin:string,site:number)=>({type:'system.ping',id:'D476_TERMINAL_FIRST_'+origin+'_'+site})
test('747 actual collector and actual C++ latch cover every fixed code with a bounded own-data projection',()=>{
 for(const [origin,max]of [['W',28],['R',19]] as const)for(let site=1;site<=max;site++){const c=collector(),n=note();n.realm.note({},origin,site);assert.equal(n.emitted.length,1);c.observe({type:'system.ping',id:n.emitted[0]});const value=JSON.parse(JSON.stringify(c.snapshot()));assert.deepEqual(value.first,{origin,site});assert.ok(Buffer.byteLength(JSON.stringify(value))<=256)}
})
test('747 actual first latch is immutable across origins, duplicate/late arrivals and failed sinks',()=>{
 for(const [first,late]of [['W','R'],['R','W']]){const n=note();n.realm.note({},first,1);n.realm.note({},late,2);assert.equal(n.emitted.length,1);assert.equal(n.realm.first_origin,first);assert.equal(n.realm.first_site,1)}
 const n=note();n.realm.emit=()=>{throw Error('PRIVATE_SINK')};assert.doesNotThrow(()=>n.realm.note({},'W',7));n.realm.emit=()=>assert.fail('no retry');assert.doesNotThrow(()=>n.realm.note({},'R',3));assert.equal(n.realm.first_site,7)
 const c=collector();c.observe(ping('R',10));c.observe(ping('W',7));c.seal();c.observe(ping('R',1));assert.equal(c.snapshot().first.site,10);const x=c.snapshot();x.first.site=1;assert.equal(c.snapshot().first.site,10)
 const closed=collector();closed.seal();closed.observe(ping('W',1));assert.equal(closed.snapshot().first,null)
})
test('747 collector rejects malformed/foreign/overlimit/getter input without invoking accessors or changing primary',()=>{
 let getters=0;const bad=[null,undefined,{},[],{type:'other',id:'D476_TERMINAL_FIRST_W_1'},{...ping('W',1),path:'PRIVATE'},ping('W',0),ping('W',29),ping('R',20),ping('M',1),{type:'system.ping',id:'D476_TERMINAL_FIRST_W_01'},{type:'system.ping',id:'D476_TERMINAL_FIRST_W_1\n'},{type:'system.ping',id:'x'.repeat(4096)},Object.defineProperty({type:'system.ping'},'id',{get(){getters++;return 'D476_TERMINAL_FIRST_W_1'},enumerable:true})];for(const value of bad){const c=collector();assert.doesNotThrow(()=>c.observe(value));assert.equal(c.snapshot().first,null)}assert.equal(getters,0)
 const n=note();for(const [origin,site]of [['W',0],['W',29],['R',20],['M',1]] as const)n.realm.note({},origin,site);assert.equal(n.emitted.length,0)
})
test('747 unsafe dead-owner/payload exits never dereference a host and original exit64 remains a refusal',()=>{
 for(const site of [4,8]){const n=note();n.realm.emit=()=>assert.fail('no safe host');n.realm.note(null,'W',site);assert.equal(n.realm.first_site,site);assert.equal(n.emitted.length,0)}
 assert.ok(cpp.includes("note(nullptr,L'W',8);failed=true;input_active=false;input_pending=0;input_web.Reset();return S_OK;"))
 assert.ok(cpp.includes("{note(nullptr,L'W',4);throw std::runtime_error(\"TERMINAL_INPUT_STATE\");}"))
 assert.ok(cpp.includes("{note(&h,L'W',28);ExitProcess(64);}"));assert.ok(cpp.includes('done=false;ExitProcess(77)'))
})
function render(transform:(s:string)=>string=(s=>s),focus='normal'){
 const text=source('tests/desktop-terminal-native-fixture-705.test.ts'),file=ts.createSourceFile('fixture.ts',text,ts.ScriptTarget.Latest,true),defs=file.statements.filter((n):n is ts.FunctionDeclaration=>ts.isFunctionDeclaration(n)&&n.name?.text==='renderer');assert.equal(defs.length,1)
 const sandbox:any={source:(p:string)=>p==='tests/fixtures/desktop-476/terminal-form.js'?transform(form):source(p),Buffer,TextEncoder,TextDecoder,Uint8Array,vm};vm.runInNewContext(ts.transpileModule(defs[0].getText(file)+';globalThis.render=renderer;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,sandbox,{timeout:1000});return sandbox.render(focus)
}
test('747 actual stock form preserves focus/trust refusals and reports exactly one first reason before legacy FAIL',()=>{
 for(const focus of ['noop','wrong']){const r=render(s=>s,focus);r.receive({type:'thread.list',threads:[{id:'native-terminal-A',title:'owned'}]});assert.equal(JSON.stringify(r.posted.filter((f:any)=>f.id?.includes('FIRST_')).map((f:any)=>f.id)),JSON.stringify(['D476_TERMINAL_FIRST_R_2']));assert.equal(r.posted.filter((f:any)=>f.id==='D476_TERMINAL_FAIL').length,1)}
 const r=render();r.receive({type:'thread.list',threads:[{id:'native-terminal-A',title:'owned'}]});r.event('keydown',r.document.activeElement,false);r.event('keydown',r.document.activeElement,false);assert.equal(JSON.stringify(r.posted.filter((f:any)=>f.id?.includes('FIRST_')).map((f:any)=>f.id)),JSON.stringify(['D476_TERMINAL_FIRST_R_4']));assert.equal(r.posted.filter((f:any)=>f.id==='D476_TERMINAL_FAIL').length,2)
})
test('747 every actual form refusal body carries a unique finite reason; sink failure preserves original generic failure',()=>{
 const ids=[...form.matchAll(/fail\(([1-9][0-9]?)\)/g)].map(m=>Number(m[1]));assert.deepEqual(ids,Array.from({length:19},(_,i)=>i+1))
 const expose='window.__firstControl={fail};';assert.equal(form.split('\n})();').length,2)
 const r=render(s=>s.replace('\n})();','\n'+expose+'\n})();'));const original=r.window.webkit.messageHandlers.desktop.postMessage;let legacy=0;r.window.webkit.messageHandlers.desktop.postMessage=(f:any)=>{if(f.id?.includes('FIRST_'))throw Error('PRIVATE');legacy++;original(f)}
 r.window.__firstControl.fail(3);r.window.__firstControl.fail(6);assert.equal(legacy,2);assert.equal(r.posted.filter((f:any)=>f.id?.includes('FIRST_')).length,0)
})
test('747 actual native caller freezes on original failure, abort, child-close and finally without changing authority',()=>{
 assert.ok(parent.includes('firstFailure.observe(f)\n    if(f.id===\'D476_TERMINAL_FAIL\'){fail();return}'))
 assert.ok(parent.includes("fail=()=>{firstFailure.seal();failed=true;failResolve()}"));assert.ok(parent.includes("abort',()=>{firstFailure.seal();reject(Error('OWNED_TERMINAL705_NATIVE_DEADLINE'))"));assert.ok(parent.includes('code=>{firstFailure.seal();childExited=true;exitResolve(code)}'))
 assert.ok(parent.includes("firstFailure.seal();surfaceLease.retain();try{t.diagnostic('D476_TERMINAL_NATIVE_PHASE '"));assert.ok(parent.includes('timeout:45000,concurrency:false'))
 assert.ok(parent.includes('assert.equal(await Promise.race([exited,failure.then('));assert.ok(parent.includes('assert.equal(actualSpawns,1)'));assert.ok(parent.includes('assert.equal(receipts.size,required.length)'))
})
test('747 whole actual form one-fault schedules classify each reachable refusal without a new success action',()=>{
 const expose=`window.__case={key,set(v){if('phase'in v)phase=v.phase;if('typing'in v)typing=v.typing;if('pendingTarget'in v)pendingTarget=v.pendingTarget;if('selectPressed'in v)selectPressed=v.selectPressed;if('requested'in v)requested=v.requested;if('ackFrames'in v)ackFrames=v.ackFrames;if('dataFrames'in v)dataFrames=v.dataFrames}};`
 const cases:Array<[number,(r:any)=>void]>=[
  [1,r=>r.window.__case.key(1,{disabled:true})],
  [2,r=>{const button=r.document.createElement('inert');button.focus=()=>{};r.window.__case.key(1,button)}],
  [3,r=>{r.window.__case.set({typing:true});r.event('keydown',r.document.activeElement,false)}],
  [4,r=>r.event('keydown',r.document.activeElement,false)],
  [5,r=>{r.window.__case.set({selectPressed:true,phase:0});r.event('keyup',r.ids['local-select'])}],
  [6,r=>{r.window.__case.set({phase:1});r.receive({type:'desktop.local.state.result',ok:false})}],
  [8,r=>r.receive({type:'desktop.terminal.open.result',thread_id:'foreign',ok:false})],
  [9,r=>r.receive({type:'desktop.terminal.open.result',thread_id:'native-terminal-A',ok:false})],
  [10,r=>{r.window.__case.set({phase:6});r.receive({type:'desktop.terminal.open.result',thread_id:'native-terminal-A',ok:true,status:'running'})}],
  [11,r=>{const textarea=r.document.createElement('owned');textarea.className='xterm-helper-textarea';textarea.focus=()=>{};r.ids['local-terminals'].append(textarea);r.window.__case.set({phase:6});r.receive({type:'desktop.terminal.open.result',thread_id:'native-terminal-A',ok:true,status:'running'})}],
  // The existing inert helper decodes with Buffer.from. Wrong-type controlled
  // decoder fault reaches the real catch; this is not a browser atob claim.
  [12,r=>r.receive({type:'desktop.terminal.data',thread_id:'native-terminal-A',b64:123})],
  [13,r=>r.receive({type:'desktop.terminal.data',thread_id:'native-terminal-A',b64:Buffer.alloc(256*1024+1,120).toString('base64')})],
  [14,r=>r.receive({type:'desktop.terminal.ack.result',thread_id:'foreign',ok:true})],
  [15,r=>r.receive({type:'desktop.terminal.ack.result',thread_id:'native-terminal-A',ok:true})],
  [16,r=>{r.window.__case.set({phase:8});r.receive({type:'desktop.terminal.resize.result',ok:false})}],
  [17,r=>{r.window.__case.set({phase:9});r.receive({type:'desktop.terminal.close.result',ok:false})}],
  [18,r=>{r.window.__case.set({phase:11});r.receive({type:'desktop.terminal.return.result',ok:false})}],
  [19,r=>{r.window.__case.set({phase:12});r.receive({type:'desktop.thread.open.result',ok:false})}],
 ]
 for(const [site,act]of cases){const r=render(s=>s.replace('\n})();','\n'+expose+'\n})();'));act(r);assert.equal(JSON.stringify(r.posted.filter((f:any)=>f.id?.includes('FIRST_')).map((f:any)=>f.id)),JSON.stringify(['D476_TERMINAL_FIRST_R_'+site]),'actual form site '+site);assert.equal(r.posted.filter((f:any)=>f.id==='D476_TERMINAL_FAIL').length,1);assert.equal(r.posted.some((f:any)=>f.id==='D476_TERMINAL_DONE'),false)}
 // R7 is the preserved fallthrough after an exhaustive 1/3/5 phase split.
 // It is catalogued rather than pretending it has a reachable JSON schedule.
 assert.ok(form.includes("if(![1,3,5].includes(phase))return;"));for(const phase of [1,3,5])assert.ok(form.includes('if(phase==='+phase+')'));assert.ok(form.includes('   fail(7);return;'))
})

function businessInverseCpp(raw:string){
 let value=raw.replace("static void failure(Desktop&,unsigned=0);\n static wchar_t first_origin;static unsigned first_site;static void note(Desktop*,wchar_t,unsigned) noexcept;","static void failure(Desktop&);")
 const begin=value.indexOf('// Test-only first observed refusal.'),end=value.indexOf('bool D705TerminalAcceptance::current(',begin);assert.ok(begin>=0&&end>begin);value=value.slice(0,begin)+value.slice(end)
 value=value.replace('failure(Desktop& h,unsigned site)','failure(Desktop& h)').replace("note(&h,L'W',site);",'').replace(/failure\((h|target),[1-9][0-9]?\)/g,'failure($1)')
 value=value.replace("{note(nullptr,L'W',4);throw std::runtime_error(\"TERMINAL_INPUT_STATE\");}",'throw std::runtime_error("TERMINAL_INPUT_STATE");').replace("note(nullptr,L'W',8);",'')
 const start=value.indexOf(' static wchar_t const* const first[]={'),finish=value.indexOf(' if(id==L"D476_TERMINAL_FAIL")',start);assert.ok(start>=0&&finish>start);value=value.slice(0,start)+value.slice(finish)
 return value.replace("{note(&h,L'W',28);ExitProcess(64);}",'ExitProcess(64);')
}
function businessInverseForm(raw:string){return raw.replace('outputComplete=false,firstFailure=false;','outputComplete=false;').replace('fail=site=>{if(!firstFailure){firstFailure=true;try{post("D476_TERMINAL_FIRST_R_"+site)}catch{}}post("D476_TERMINAL_FAIL")}','fail=()=>post("D476_TERMINAL_FAIL")').replace(/fail\([1-9][0-9]?\)/g,'fail()')}
test('747 complete fixture business inverse retains every original predicate, action and short-circuit in LF/CRLF',()=>{
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
 for(const crlf of [false,true]){const lower=(s:string)=>crlf?s.replace(/\r?\n/g,'\r\n'):s;assert.equal(hash(businessInverseCpp(lower(cpp).replace(/\r\n/g,'\n'))),'8b106974a3ab6fcf46bf1ab83b2f9fedd57c7e66e3288304a4d6d37a13200161');assert.equal(hash(businessInverseForm(lower(form).replace(/\r\n/g,'\n'))),'0cf56c94371a52a38053809c548fbf9125838cc594c37bed942e920abf605596')}
 const seen=[...cpp.matchAll(/failure\((?:h|target),([1-9][0-9]?)\)/g)].map(m=>Number(m[1]));assert.deepEqual(seen.sort((a,b)=>a-b),Array.from({length:27},(_,i)=>i+1).filter(i=>i!==4&&i!==8))
})
