/** Fixed source-derived diagnostic controls only; no native/COM/PTY process. */
import test, {afterEach} from 'node:test'
import {cpuTerminalAdapter747,cleanupCpuTerminalAdapters747,observerInverseForm747} from './fixtures/desktop-476/terminal-parser-cpu'
afterEach(cleanupCpuTerminalAdapters747)
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
 const sandbox:any={source:(p:string)=>p==='tests/fixtures/desktop-476/terminal-form.js'?transform(form):source(p),Buffer,TextEncoder,TextDecoder,Uint8Array,vm,cpuTerminalAdapter747};vm.runInNewContext(ts.transpileModule(defs[0].getText(file)+';globalThis.render=renderer;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,sandbox,{timeout:1000});return sandbox.render(focus)
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
 const expose=`window.__case={key,set(v){if('phase'in v)phase=v.phase;if('typing'in v)typing=v.typing;if('pendingTarget'in v)pendingTarget=v.pendingTarget;if('selectPressed'in v)selectPressed=v.selectPressed;if('requested'in v)requested=v.requested;if('ackFrames'in v)ackFrames=v.ackFrames;if('dataFrames'in v)dataFrames=v.dataFrames;if('ownedOperation'in v)ownedOperation=v.ownedOperation}};`
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
  [11,r=>{const holder=r.document.createElement('div');holder.setAttribute('data-local-terminal','owned-fault');r.ids['local-terminals'].append(holder);const terminal=new r.window.Terminal();terminal.open(holder);const textarea=holder.querySelector('.xterm-helper-textarea');textarea.focus=()=>{};r.window.__case.set({phase:6});r.receive({type:'desktop.terminal.open.result',thread_id:'native-terminal-A',operation_id:'owned-fault',ok:true,status:'running'})}],
  // The existing inert helper decodes with Buffer.from. Wrong-type controlled
  // decoder fault reaches the real catch; this is not a browser atob claim.
  [12,r=>{r.window.__case.set({ownedOperation:'owned-fault'});r.receive({type:'desktop.terminal.data',thread_id:'native-terminal-A',operation_id:'owned-fault',b64:123})}],
  [13,r=>{r.window.__case.set({ownedOperation:'owned-fault'});r.receive({type:'desktop.terminal.data',thread_id:'native-terminal-A',operation_id:'owned-fault',b64:Buffer.alloc(256*1024+1,120).toString('base64')})}],
  [14,r=>r.receive({type:'desktop.terminal.ack.result',thread_id:'foreign',ok:true})],
  [15,r=>{r.window.__case.set({ownedOperation:'owned-fault'});r.receive({type:'desktop.terminal.ack.result',thread_id:'native-terminal-A',operation_id:'owned-fault',ok:true})}],
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
function readinessInverseForm747(raw:string){
 const begin=raw.indexOf(' // Observe only operands already reached'),end=raw.indexOf(' const outputReady=',begin);assert.ok(begin>=0&&end>begin)
 return(raw.slice(0,begin)+raw.slice(end)).replace('const outputReady=()=>{let marker=null;outputComplete=','const outputReady=()=>{outputComplete=').replace('&&(marker=parsedMarker747(ownedTerminal,"D476_TERMINAL_中"));noteReady747(typedEnter,marker,ackFrames===dataFrames);','&&parsedMarker747(ownedTerminal,"D476_TERMINAL_中");')
}
function readinessInverseCpp747(raw:string){const begin=raw.indexOf(' // Passive closed observations,'),end=raw.indexOf(' const wchar_t* receipts[]=',begin);assert.ok(begin>=0&&end>begin);return raw.slice(0,begin)+raw.slice(end)}
function readinessInverseParent747(raw:string){
 const begin=raw.indexOf('/** Passive observed-state bitset only:'),end=raw.indexOf('/** New terminal-only leaf:',begin);assert.ok(begin>=0&&end>begin)
 return(raw.slice(0,begin)+raw.slice(end)).replace('  const readiness=createTerminalReadiness747();let inputEnterObserved=false,rawOutputMarkerSeen=false\n','').replace('inputEnterObserved=inputEnterObserved||bytes.includes(13);','').replace('const rawObservation=rawMarker747(outputSuffix,outputDecoder.decode(bytes,{stream:true}));outputSuffix=rawObservation.suffix;rawOutputMarkerSeen=rawOutputMarkerSeen||rawObservation.found;','outputSuffix=rawMarker747(outputSuffix,outputDecoder.decode(bytes,{stream:true})).suffix;').replace('    readiness.observe(f)\n','').replace('readiness:readiness.snapshot(),inputEnterObserved,rawOutputMarkerSeen,','')
}
function readinessCollector747(){const f=ts.createSourceFile('native.ts',parent,ts.ScriptTarget.Latest,true),defs=f.statements.filter((n):n is ts.FunctionDeclaration=>ts.isFunctionDeclaration(n)&&n.name?.text==='createTerminalReadiness747');assert.equal(defs.length,1);const c:any={};vm.runInNewContext(ts.transpileModule(defs[0].getText(f)+';globalThis.create=createTerminalReadiness747;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,c,{timeout:1000});return c.create()}
test('747 passive readiness collector accepts exactly twelve finite own-data states and retains a seen-set',()=>{
 const c=readinessCollector747();let index=0
 for(const enter of ['0','1'])for(const marker of ['X','0','1'])for(const ack of ['0','1']){const f={type:'system.ping',id:`D476_TERMINAL_READY_${enter}_${marker}_${ack}`};c.observe(f);c.observe(f);assert.equal(c.snapshot().seenMask,(1<<++index)-1)}
 assert.equal(c.snapshot().seenMask,4095);const s=c.snapshot();s.seenMask=0;assert.equal(c.snapshot().seenMask,4095)
 let getters=0;for(const value of [null,[],{},Object.create({type:'system.ping',id:'D476_TERMINAL_READY_1_1_1'}),{type:'other',id:'D476_TERMINAL_READY_1_1_1'},{type:'system.ping',id:'D476_TERMINAL_READY_1_1_1',extra:'private'},{type:'system.ping',id:'D476_TERMINAL_READY_1_1_1\n'},{type:'system.ping',id:'D476_TERMINAL_READY_1_2_1'},Object.defineProperty({type:'system.ping'},'id',{enumerable:true,get(){getters++;return'D476_TERMINAL_READY_1_1_1'}})]){const one=readinessCollector747();assert.doesNotThrow(()=>one.observe(value));assert.equal(one.snapshot().seenMask,0)}assert.equal(getters,0)
})
function readinessControl747(text:string,sinkFails=false,reenter=false){
 const f=ts.createSourceFile('form.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let arrow='',note='',parser='';const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)){if(n.name.text==='outputReady')arrow=n.initializer!.getText(f);if(n.name.text==='noteReady747')note=n.initializer!.getText(f)}if(ts.isFunctionDeclaration(n)&&n.name?.text==='parsedMarker747')parser=n.getText(f);ts.forEachChild(n,visit)};visit(f);assert.ok(arrow&&parser)
 const posted:string[]=[],calls={encode:0,parse:0},c:any={TextEncoder:class{encode(s:string){calls.encode++;return new TextEncoder().encode(s)}},posted,calls,sinkFails,reenter};vm.createContext(c)
 vm.runInContext(`let phase=7,typedEnter=false,output='',ackFrames=0,dataFrames=0,outputComplete=false,typing=true,pendingTarget={},reentered=false;const readinessSeen747=new Set();const post=id=>{if(sinkFails&&id.startsWith('D476_TERMINAL_READY_'))throw Error('inert sink');posted.push(id);if(reenter&&!reentered&&id.startsWith('D476_TERMINAL_READY_')){reentered=true;outputReady()}};${parser};const parsedOriginal=parsedMarker747;parsedMarker747=(...args)=>{calls.parse++;return parsedOriginal(...args)};let ownedTerminal;${note?'const noteReady747='+note+';':''}const outputReady=${arrow};globalThis.control={run(v){({phase,typedEnter,output,ackFrames,dataFrames}=v);ownedTerminal=v.terminal;outputReady();return{phase,outputComplete,typing,pending:pendingTarget!==null}}}`,c,{timeout:1000})
 return{run:(v:any)=>JSON.parse(JSON.stringify(c.control.run(v))),posted,calls}
}
test('747 actual outputReady preserves every short-circuit, parser call and original action under passive sink failure',()=>{
 const original=readinessInverseForm747(form)
 for(const sinkFails of [false,true])for(const phase of [0,7])for(const typedEnter of [false,true])for(const large of [false,true])for(const found of [false,true])for(const ack of [false,true]){
  const terminal={cols:80,rows:24,buffer:{active:{length:1,getLine:()=>({isWrapped:false,translateToString:()=>found?'D476_TERMINAL_中':'absent'})}}},v={phase,typedEnter,output:large?'x'.repeat(16385):'x',dataFrames:1,ackFrames:ack?1:0,terminal}
  const old=readinessControl747(original),now=readinessControl747(form,sinkFails);assert.deepEqual(now.run(v),old.run(v));assert.deepEqual(now.calls,old.calls);assert.deepEqual(now.posted.filter(id=>!id.startsWith('D476_TERMINAL_READY_')),old.posted)
  if(phase===7&&!sinkFails){const marker=typedEnter&&large?(found?'1':'0'):'X';assert.deepEqual(now.posted.filter(id=>id.startsWith('D476_TERMINAL_READY_')),[`D476_TERMINAL_READY_${Number(typedEnter)}_${marker}_${Number(ack)}`])}
 }
 // Repeated actual invocations cannot grow the finite observation stream.
 const now=readinessControl747(form),v={phase:7,typedEnter:false,output:'x'.repeat(16385),dataFrames:1,ackFrames:0,terminal:null};for(let i=0;i<100;i++)now.run(v);assert.deepEqual(now.posted,['D476_TERMINAL_READY_0_X_0']);assert.equal(now.calls.parse,0)
 const nested=readinessControl747(form,false,true),result=nested.run({...v,typedEnter:true,ackFrames:1,terminal:{cols:80,rows:24,buffer:{active:{length:1,getLine:()=>({isWrapped:false,translateToString:()=> 'D476_TERMINAL_中'})}}}});assert.equal(result.phase,8);assert.deepEqual(nested.posted,['D476_TERMINAL_READY_1_1_1','D476_TERMINAL_OUTPUT','D476_TERMINAL_RESIZE'])
})
test('747 actual C++ readiness forwarding is closed, owner-guarded, passive and does not retry failed sinks',()=>{
 const begin=cpp.indexOf(' // Passive closed observations,'),end=cpp.indexOf(' const wchar_t* receipts[]=',begin),body=cpp.slice(begin,end),ids=[...body.matchAll(/L"(D476_TERMINAL_READY_[01]_[X01]_[01])"/g)].map(m=>m[1]);assert.equal(ids.length,12);assert.equal(new Set(ids).size,12)
 assert.ok(cpp.indexOf('if(!current(h)||text(frame,L"type")!=L"system.ping")return;')<begin);assert.ok(cpp.indexOf('text(frame,L"generation")!=document')<begin)
 const lower=body.replace(/static wchar_t const\* const ready\[\]=\{([^}]+)\};/,'const ready=[$1];').replace(/L"/g,'"').replace('for(auto observed:ready)','for(const observed of ready)').replace('catch(...)','catch(error)')
 for(const fail of [false,true])for(const id of [...ids,'D476_TERMINAL_READY_2_1_1','D476_TERMINAL_READY_1_1_1\n','unrelated']){const emitted:string[]=[],c:any={id,h:{},emit:(_h:any,v:string)=>{emitted.push(v);if(fail)throw Error('inert sink')}};vm.runInNewContext('(function(){'+lower+'})()',c,{timeout:1000});assert.deepEqual(emitted,ids.includes(id)?[id]:[])}
})
test('747 readiness projection whole-source inverse restores the exact preceding form, controller and native caller',()=>{
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex');for(const crlf of [false,true]){const lower=(s:string)=>(crlf?s.replace(/\r?\n/g,'\r\n'):s).replace(/\r\n/g,'\n');assert.equal(hash(readinessInverseForm747(lower(form))),'9182d9eb1377b862ecb73b3770e1b9f0c484708bcdb2ffb543dfdb61548015a7');assert.equal(hash(readinessInverseCpp747(lower(cpp))),'a30536fa43bfaf61688a3f6dbba2acdb941bc2be687a9fc72aec6b1f3a366eac');assert.equal(hash(readinessInverseParent747(lower(parent))),'ac59fe4e8307e8f28bf7966f222800e12c105a5b39c21479eacb8e6c6555ecfe')}
})
test('747 actual input and raw-output producers retain bytes, decoding and delegation while observing only booleans',()=>{
 const f=ts.createSourceFile('native.ts',parent,ts.ScriptTarget.Latest,true),leaves=f.statements.filter((n):n is ts.ExpressionStatement=>ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(f)==='test'&&ts.isStringLiteral(n.expression.arguments[0])&&n.expression.arguments[0].text==='#476 terminal-only native confirmation→real user PTY→selected partial excerpt→canonical reopen');assert.equal(leaves.length,1);const call=leaves[0].expression as ts.CallExpression;assert.ok(ts.isArrowFunction(call.arguments[2]));let input='';const visit=(n:ts.Node)=>{if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.EqualsToken&&n.left.getText(f)==='runtime.input'){assert.equal(input,'');input=n.right.getText(f)}ts.forEachChild(n,visit)};visit(call.arguments[2]);assert.ok(input)
 const helper=source('tests/helpers/terminal-observer-747.ts'),hf=ts.createSourceFile('observer.ts',helper,ts.ScriptTarget.Latest,true),raw=hf.statements.find((n):n is ts.FunctionDeclaration=>ts.isFunctionDeclaration(n)&&n.name?.text==='rawMarker747');assert.ok(raw)
 let marker='';for(const n of hf.statements)if(ts.isVariableStatement(n))for(const d of n.declarationList.declarations)if(d.name.getText(hf)==='terminalMarker747')marker=d.getText(hf);assert.ok(marker)
 const start=parent.indexOf("if(f.type==='desktop.terminal.data'){const bytes=Buffer.from(f.b64,'base64');assert.ok(bytes.length<=16384);assert.equal(f.seq,lastOutput+1);");assert.ok(start>=0)
 const forwarded:any[]=[],observed:Buffer[]=[],c:any={assert,Buffer,TextDecoder,forwarded,observed};const script=`const ${marker};${raw.getText(hf).replace(/^export /,'')}const outputDecoder=new TextDecoder(),inputDecoder=new TextDecoder();let outputSuffix='',inputSuffix='',inputUnicode=false,inputEnterObserved=false,rawOutputMarkerSeen=false,lastOutput=0,outputBytes=0,largestFrame=0;const outputSeq=new Set(),ws={},realInput=(id,b64)=>{forwarded.push([id,b64]);return 'delegated'},outputObserver={data(_op,_thread,_owner,bytes){observed.push(bytes)}};globalThis.input=${input};globalThis.data=f=>{${block(parent,start)}};globalThis.snapshot=()=>({inputUnicode,inputEnterObserved,rawOutputMarkerSeen,outputSuffix,lastOutput,outputBytes,largestFrame,frames:outputSeq.size});`
 vm.runInNewContext(ts.transpileModule(script,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,c,{timeout:1000})
 const command=Buffer.from('[char]0x4e2d #中\r'),chunks=[command.subarray(0,command.length-2),command.subarray(command.length-2)];for(const bytes of chunks){const b64=bytes.toString('base64');assert.equal(c.input('owned',b64),'delegated');const tuple=forwarded.at(-1);assert.equal(tuple.length,2);assert.equal(tuple[0],'owned');assert.equal(tuple[1],b64)}assert.equal(c.snapshot().inputUnicode,true);assert.equal(c.snapshot().inputEnterObserved,true)
 const payload=Buffer.from('x'.repeat(16400)+'D476_TERMINAL_中'),parts=[payload.subarray(0,16384),payload.subarray(16384,payload.length-1),payload.subarray(payload.length-1)];for(const [i,bytes]of parts.entries())c.data({type:'desktop.terminal.data',seq:i+1,b64:bytes.toString('base64'),operation_id:'owned-op',thread_id:'owned-thread'})
 assert.equal(c.snapshot().rawOutputMarkerSeen,true);assert.deepEqual(Buffer.concat(observed),payload);assert.equal(c.snapshot().outputBytes,payload.length);assert.equal(c.snapshot().frames,3);assert.equal(c.snapshot().outputSuffix,('x'.repeat(16400)+'D476_TERMINAL_中').slice(-128))
})
test('747 complete fixture business inverse retains every original predicate, action and short-circuit in LF/CRLF',()=>{
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
 for(const crlf of [false,true]){const lower=(s:string)=>crlf?s.replace(/\r?\n/g,'\r\n'):s;assert.equal(hash(businessInverseCpp(readinessInverseCpp747(lower(cpp).replace(/\r\n/g,'\n')))),'8b106974a3ab6fcf46bf1ab83b2f9fedd57c7e66e3288304a4d6d37a13200161');assert.equal(hash(businessInverseForm(observerInverseForm747(readinessInverseForm747(lower(form).replace(/\r\n/g,'\n'))))),'0cf56c94371a52a38053809c548fbf9125838cc594c37bed942e920abf605596')}
 const seen=[...cpp.matchAll(/failure\((?:h|target),([1-9][0-9]?)\)/g)].map(m=>Number(m[1]));assert.deepEqual(seen.sort((a,b)=>a-b),Array.from({length:27},(_,i)=>i+1).filter(i=>i!==4&&i!==8))
})
