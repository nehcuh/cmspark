/** Actual C++ source projection; CPU only, not COM, native input or trusted DOM evidence. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import {createHash} from 'node:crypto'
const file=path.resolve(__dirname,'../..','tests/fixtures/desktop-476/terminal-acceptance.cpp')
// Remove only fixed diagnostic call arguments for the unchanged control-flow oracle.
const source=fs.readFileSync(file,'utf8').replace(/failure\((h|target),[1-9][0-9]?\)/g,'failure($1)')
function block(text:string,start:number){
 const begin=text.indexOf('{',start);assert.ok(begin>=0);let depth=0,quote='',comment=false
 for(let i=begin;i<text.length;i++){
  const c=text[i]
  if(comment){if(c==='\n')comment=false;continue}
  if(quote){if(c==='\\')i++;else if(c===quote)quote='';continue}
  if(c==='/'&&text[i+1]==='/'){comment=true;i++;continue}
  if(c==='"'||c==="'"){quote=c;continue}
  if(c==='{')depth++;if(c==='}'&&!--depth)return text.slice(begin+1,i)
 }
 throw Error('UNTERMINATED_CPP_SOURCE')
}
function member(name:string,text=source){const marker='D705TerminalAcceptance::'+name+'(';assert.equal(text.split(marker).length,2);return block(text,text.indexOf(marker)).replace(/note\((?:&h|nullptr),L'W',(?:site|4|8)\);/g,'').replace(/failure\((h|target),[1-9][0-9]?\)/g,'failure($1)')}
function lower(body:string){return body.replace(/\bL(?=")/g,'').replace(/command\(\)\.size\(\)/g,'command().length').replace(/std::wstring\(1,command\(\)\[cursor\]\)/g,'command()[cursor]').replace(/const size_t /g,'const ').replace(/\bauto action=/g,'const action=').replace(/throw std::runtime_error\(/g,'throw Error(').replace(/JsonObject payload;/g,'const payload=new JsonObject();').replace(/JsonValue::CreateNumberValue\(/g,'Number(').replace(/\(void\)/g,'').replace(/input_web\.Reset\(\)/g,'input_web=null').replace(/FAILED\((\w+)\)/g,'($1<0)')}
function command(text=source){const match=/static const std::wstring value=L("[^\n]+");return value;/.exec(member('command',text));assert.ok(match);return JSON.parse(match[1]) as string}
function context(extra:any={}){
 const h:any={web:{owned:'web'},window:'owned-window'},calls:any[]=[],realm:any={h,owner:h,failed:false,input_active:false,input_action:0,input_pending:0,input_cursor:0,input_web:null,done:false,input_done_emitted:false,
  current:(target:any)=>target===h,GetForegroundWindow:()=>h.window,emit:(...args:any[])=>calls.push(['emit',...args]),input_step:(...args:any[])=>calls.push(['step',...args]),command:()=>command(),VK_RETURN:13,Reset(){},...extra}
 realm.input_length=(action:number)=>action===1?2:action===2?command().length+2:0
 vm.createContext(realm)
 for(const [name,args]of [['failure','h'],['input_request','h,action'],['input_finished','h']] as const)vm.runInContext(name+'=function('+args+'){'+lower(member(name))+'}',realm,{timeout:1000})
 return{realm,h,calls}
}
function payloads(action:number,cursor:number,text=source){
 class JsonObject{[key:string]:any;Insert(k:string,v:any){this[k]=v}}
 const realm:any={JsonObject,put:(o:any,k:string,v:any)=>{assert.equal(typeof v,'string');o.Insert(k,v)},command:()=>command(text),VK_RETURN:13};vm.createContext(realm)
 vm.runInContext('payload=function(action,cursor){'+lower(member('input_payload',text))+'}',realm,{timeout:1000});return JSON.parse(JSON.stringify(realm.payload(action,cursor)))
}
function apiContract(text:string){
 const step=member('input_step',text),connect='web->CallDevToolsProtocolMethod(L"Input.dispatchKeyEvent",payload.c_str(),Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>'
 assert.equal(step.split(connect).length,2,'one actual owned COM dispatch site')
 for(const literal of ['auto web=input_web','input_web.Get()!=h.web.Get()','GetForegroundWindow()!=h.window','input_cursor>=input_length(input_action)','[expected,window,web,action,cursor]','!IsWindow(window)','GetWindowLongPtrW(window,GWLP_USERDATA)!=(LONG_PTR)expected','FAILED(status)','!current(target)','GetForegroundWindow()!=window','target.web.Get()!=web.Get()','input_web.Get()!=web.Get()','!input_active','input_action!=action','input_cursor!=cursor','JsonObject::Parse(result).Size()!=0','++input_cursor','input_finished(target);else input_step(target)','if(FAILED(submitted))failure(h)'])assert.ok(step.includes(literal),literal)
 assert.ok(step.indexOf('JsonObject::Parse(result)')<step.indexOf('++input_cursor'))
 for(const forbidden of ['WM_KEYDOWN','WM_KEYUP','WM_CHAR','MapVirtualKeyW','GetGUIThreadInfo','Input.insertText','SetFocus(','SetForegroundWindow(','MoveFocus(','AttachThreadInput','SendInput(','dispatchEvent(','Sleep('])assert.equal(text.includes(forbidden),false,forbidden)
 assert.ok(member('complete',text).includes('!input_done_emitted||input_active||input_pending'))
 assert.ok(member('complete',text).includes('GetForegroundWindow()!=h.window'))
}
function callback(extra:any={}){
 const f=context(extra),step=member('input_step'),marker='](HRESULT status,LPCWSTR result)->HRESULT',at=step.indexOf(marker);assert.ok(at>=0)
 const raw=block(step,at),body=lower(raw).replace(/\(LONG_PTR\)expected/g,'expected').replace(/auto& target=\*expected;/g,'const target=expected;').replace(/(target\.web|input_web|web)\.Get\(\)/g,'$1').replace(/JsonObject::Parse\(result\)\.Size\(\)/g,'parseResult(result)').replace(/catch\(\.\.\.\)/g,'catch(error)')
 Object.assign(f.realm,{expected:f.h,window:f.h.window,web:f.h.web,action:1,cursor:0,IsWindow:()=>true,GetWindowLongPtrW:()=>f.h,GWLP_USERDATA:0,S_OK:0,parseResult:(s:string)=>{const x=JSON.parse(s);if(!x||typeof x!=='object'||Array.isArray(x))throw Error('NOT_JSON_OBJECT');return Object.keys(x).length},input_active:true,input_action:1,input_web:f.h.web,...extra})
 vm.runInContext('completeCallback=function(status,result){'+body+'}',f.realm,{timeout:1000});return f
}
test('actual current C++ uses one captured owned WebView COM site, serial callback fences and no guessed keyboard queue',()=>{for(const text of [source,source.replace(/\r?\n/g,'\r\n')])apiContract(text)})
test('actual fixed command chars then Enter payloads preserve Unicode and JSON shape',()=>{
 const value=command();assert.equal(value,"[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Console]::Write(('x'*16384)+('D476_'+'TERMINAL_')+[char]0x4e2d); [Console]::ReadLine() #中");assert.equal(value.includes('D476_TERMINAL_中'),false)
 for(let cursor=0;cursor<value.length;cursor++)assert.deepEqual(payloads(2,cursor),{type:'char',text:value[cursor],unmodifiedText:value[cursor]})
 assert.deepEqual(payloads(2,value.length),payloads(1,0));assert.deepEqual(payloads(2,value.length+1),payloads(1,1))
 assert.deepEqual(payloads(1,0),{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'})
 assert.deepEqual(payloads(1,1),{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13})
 for(const [action,cursor]of [[0,0],[3,0],[1,2],[2,value.length+2]])assert.throws(()=>payloads(action,cursor))
})
test('actual finite admission permits one active and at most one pending fixed action',()=>{
 const f=context();assert.equal(f.realm.input_request(f.h,1),true);assert.equal(f.calls.length,1);assert.equal(f.realm.input_active,true)
 assert.equal(f.realm.input_request(f.h,2),true);assert.equal(f.realm.input_pending,2);assert.equal(f.calls.length,1)
 assert.equal(f.realm.input_request(f.h,1),false);assert.equal(f.realm.failed,true);assert.equal(f.realm.input_pending,0);assert.equal(f.realm.input_active,false)
})
for(const fault of ['stale','foreground','invalid'])test('actual input admission rejects '+fault+' with no submit',()=>{
 const f=context();if(fault==='stale')f.realm.current=()=>false;else if(fault==='foreground')f.realm.GetForegroundWindow=()=> 'foreign'
 assert.equal(f.realm.input_request(f.h,fault==='invalid'?3:1),false);assert.equal(f.realm.failed,true);assert.equal(f.calls.filter(x=>x[0]==='step').length,0)
})
test('actual completion advances one event only after successful protocol callback',()=>{
 const f=callback();assert.equal(f.calls.length,0);assert.equal(f.realm.completeCallback(0,'{}'),0);assert.equal(f.realm.input_cursor,1);assert.equal(f.calls.filter(x=>x[0]==='step').length,1)
 const last=callback({cursor:1,input_cursor:1,input_pending:2});last.realm.completeCallback(0,'{}');assert.equal(last.realm.input_action,2);assert.equal(last.realm.input_cursor,0);assert.equal(last.realm.input_pending,0);assert.equal(last.calls.filter(x=>x[0]==='step').length,1)
})
for(const [status,result]of [[-1,'{}'],[0,null],[0,'not-json'],[0,'null'],[0,'[]'],[0,'{"error":"fixed"}']] as const)test('actual completion refuses HRESULT/protocol result '+String(status)+':'+String(result),()=>{
 const f=callback();f.realm.completeCallback(status,result);assert.equal(f.realm.failed,true);assert.equal(f.calls.filter(x=>x[0]==='step').length,0);assert.equal(f.realm.input_active,false)
})
for(const fault of ['owner','dead-window','foreign-userdata','current','foreground','web','cursor','inactive'])test('actual async completion refuses '+fault+' without another input effect',()=>{
 const f=callback();if(fault==='owner')f.realm.owner={};if(fault==='dead-window')f.realm.IsWindow=()=>false;if(fault==='foreign-userdata')f.realm.GetWindowLongPtrW=()=>({});if(fault==='current')f.realm.current=()=>false;if(fault==='foreground')f.realm.GetForegroundWindow=()=> 'foreign';if(fault==='web')f.h.web={foreign:true};if(fault==='cursor')f.realm.input_cursor=1;if(fault==='inactive')f.realm.input_active=false
 f.realm.completeCallback(0,'{}');assert.equal(f.realm.failed,true);assert.equal(f.calls.filter(x=>x[0]==='step').length,0)
})
test('actual final input drains before the already-observed DONE receipt is emitted once',()=>{
 const f=callback({cursor:1,input_cursor:1,done:true});f.realm.completeCallback(0,'{}');assert.equal(f.realm.input_active,false);assert.equal(f.realm.input_done_emitted,true);assert.equal(f.calls.filter(x=>x[0]==='emit'&&x[2]==='D476_TERMINAL_DONE').length,1)
 f.realm.input_finished(f.h);assert.equal(f.calls.filter(x=>x[0]==='emit'&&x[2]==='D476_TERMINAL_DONE').length,1)
 assert.ok(member('renderer').includes('done=true;if(input_active||input_pending)return;input_done_emitted=true;'))
})
test('actual source contract rejects missing ownership, protocol and ordering fences',()=>{
 for(const [before,after]of [['GetForegroundWindow()!=window','false'],['target.web.Get()!=web.Get()','false'],['input_cursor!=cursor','false'],['JsonObject::Parse(result).Size()!=0','false'],['if(FAILED(submitted))failure(h)',''],['input_finished(target);else input_step(target)','input_finished(target)'],['!input_done_emitted||input_active||input_pending','false']]){
  assert.equal(source.split(before).length,2,before);assert.throws(()=>apiContract(source.replace(before,after)),{name:'AssertionError'},before)
 }
})

// Execute the complete actual confirmation/current/completion bodies together.
// Window destruction/foreground return are controlled native API boundaries;
// this is not evidence of Windows delivery order, physical input or consent.
function confirmationFixture(number:number){
 const f=callback(),r=f.realm,h=f.h,effects:any[]=[],queued:Array<()=>void>=[];let foreground='owned-panel'
 const host=fs.readFileSync(path.resolve(__dirname,'../..','src/desktop/native/DesktopHost.cpp'),'utf8')
 const close=block(host,host.indexOf('if(message==WM_CLOSE)')).replace('self->retire_confirmation(0)','self.retire_confirmation(0)')
 assert.equal(close.trim(),'self.retire_confirmation(0);return 0;')
 let body=lower(member('confirmation')).replace(/const unsigned /g,'const ').replace(/([0-9])u\b/g,'$1').replace(/\bauto (pending|panel|reveal|button)=/g,'const $1=').replace(/h\.confirmation\.get\(\)/g,'h.confirmation').replace(/->/g,'.').replace(/JsonValueType::String/g,'JsonValueType.String').replace(/std::wstring\(pending.thread.GetString\(\)\)/g,'pending.thread.GetString()')
 const buffer="int length=GetWindowTextLengthW(pending.details);std::wstring full((size_t)length+1,L'\\0');GetWindowTextW(pending.details,full.data(),length+1);full.resize((size_t)length);"
 assert.equal(body.split(buffer).length,2);body=body.replace(buffer,'const full=readDetails(pending.details);')
 Object.assign(h,{ready:true,generation:'document',epoch:7,controller:{},confirmation:{window:'owned-panel',purpose:'local-work',generation:'document',epoch:7,thread:{ValueType:()=> 'String',GetString:()=> 'native-terminal-A'},full:'{"kind":"terminal-open"}',details:'owned-details'}})
 const retire=()=>{r.self=h;h.retire_confirmation=(decision:number)=>{effects.push(['retire',decision]);h.confirmation=null;foreground=h.window};vm.runInContext('(()=>{'+close+'})()',r,{timeout:1000})}
 Object.assign(r,{document:'document',epoch:7,confirm_count:number-1,key_count:number===1?2:4,JsonValueType:{String:'String'},GW_OWNER:4,BM_CLICK:5,WM_CLOSE:16,GetForegroundWindow:()=>foreground,IsWindowVisible:()=>true,GetWindow:()=>h.window,GetDlgItem:(panel:any,id:number)=>({panel,id}),GetParent:(b:any)=>b.panel,IsWindowEnabled:()=>true,parse:JSON.parse,text:(o:any,k:string)=>o[k]||'',readDetails:()=>h.confirmation.full,
  SendMessageW:(target:any,message:number)=>{if(message===16){assert.equal(target,'owned-panel');effects.push(['close',target]);retire();return 0}effects.push(['button',target.id]);if(target.id!==3)retire();return 0},
  PostMessageW:(panel:any,message:number)=>{assert.equal(panel,'owned-panel');assert.equal(message,16);effects.push(['post-close',panel]);queued.push(retire);return true}})
 vm.runInContext('current=function(h){'+lower(member('current')).replace(/owner==&h/g,'owner==h')+'};confirmation=function(h){'+body+'}',r,{timeout:1000})
 return{...f,effects,queued,setForeground:(value:string)=>{foreground=value}}
}
test('actual second Cancel retires through native WM_CLOSE before the fixture hook returns',()=>{
 const f=confirmationFixture(2);f.realm.confirmation(f.h);assert.equal(f.realm.failed,false);assert.equal(f.h.confirmation,null);assert.equal(f.realm.confirm_count,2);assert.equal(f.queued.length,0)
 assert.deepEqual(f.effects,[['button',3],['close','owned-panel'],['retire',0]])
})
test('actual COM completion immediately after second Cancel cannot race a queued close',()=>{
 const f=confirmationFixture(2);f.realm.confirmation(f.h);f.realm.completeCallback(0,'{}');assert.equal(f.realm.failed,false);assert.equal(f.realm.input_cursor,1);assert.equal(f.calls.filter(x=>x[0]==='step').length,1)
})
test('actual close-before-completion order retains one advancing callback',()=>{
 const f=confirmationFixture(2);f.realm.confirmation(f.h);for(const close of f.queued)close();f.realm.completeCallback(0,'{}');assert.equal(f.realm.failed,false);assert.equal(f.realm.input_cursor,1);assert.equal(f.calls.filter(x=>x[0]==='step').length,1)
})
test('actual first native Cancel still completes before the callback',()=>{
 const f=confirmationFixture(1);f.realm.confirmation(f.h);f.realm.completeCallback(0,'{}');assert.equal(f.realm.failed,false);assert.equal(f.realm.input_cursor,1);assert.deepEqual(f.effects,[['button',3],['button',2],['retire',0]])
})
test('actual foreign foreground after Cancel still rejects without advancing input',()=>{
 const f=confirmationFixture(1);f.realm.confirmation(f.h);f.setForeground('foreign-window');f.realm.completeCallback(0,'{}');assert.equal(f.realm.failed,true);assert.equal(f.realm.input_cursor,0);assert.equal(f.calls.filter(x=>x[0]==='step').length,0)
})
test('actual wrong owned-panel relationship rejects before any Cancel effect',()=>{
 const f=confirmationFixture(2);f.realm.GetWindow=()=> 'foreign-owner';f.realm.confirmation(f.h);assert.equal(f.realm.failed,true);assert.equal(f.effects.length,0)
})

// Execute the actual admission bodies with inert window API returns. This
// controls schedules; it does not execute Win32, WebView or trusted DOM input.
function initialForm747(text=fs.readFileSync(file,'utf8')){
 const h:any={window:'owned-window',web:{},controller:{},ready:true,generation:'owned-document',epoch:7}
 const effects:string[]=[],r:any={h,owner:null,document:'',epoch:0,failed:false,form_requested:false,form_window:null,form_web:null,GWLP_USERDATA:0,
  IsWindow:()=>true,IsWindowVisible:()=>true,GetWindowLongPtrW:()=>h,GetForegroundWindow:()=> 'foreign-window',
  failure:()=>{r.failed=true},install:()=>{effects.push('install');r.reenter?.();r.onInstall?.()}}
 vm.createContext(r)
 const convert=(body:string)=>lower(body).replace(/\(LONG_PTR\)owner/g,'owner').replace(/&h\b/g,'h').replace(/nullptr/g,'null').replace(/h\.generation\.empty\(\)/g,'!h.generation.length').replace(/(h\.web|form_web)\.Get\(\)/g,'$1')
 const script='std::wstring code=',doc=member('document_ready',text),isJoined=text.includes('void D705TerminalAcceptance::begin_form(')
 const installPrefix=(body:string)=>{assert.equal(body.split(script).length,2);return body.slice(0,body.indexOf(script))+'install();'}
 if(isJoined)vm.runInContext('begin_form=function(h){'+convert(installPrefix(member('begin_form',text)))+'}',r,{timeout:1000})
 vm.runInContext('document_ready=function(h){'+convert(isJoined?doc:installPrefix(doc))+'}',r,{timeout:1000})
 // Keep the complete pre-existing ExecuteScript operation and callback intact.
 if(isJoined){const now=member('begin_form',text).slice(member('begin_form',text).indexOf(script));assert.ok(now.includes('ExecuteScript(code.c_str()'));assert.ok(now.includes('FAILED(status)||!current(h)||!scriptResult||std::wstring(scriptResult)!=L"true"'));assert.ok(now.includes('if(FAILED(result))failure(h)'))}
 return{h,r,effects,activate:()=>r.begin_form?.(h)}
}
function oldInitialCpp747(raw:string){
 const p=path.resolve(__dirname,'../..','tests/desktop-terminal-first-failure-747.test.ts'),text=fs.readFileSync(p,'utf8'),f=ts.createSourceFile(p,text,ts.ScriptTarget.Latest,true)
 const declarations=f.statements.filter((n):n is ts.FunctionDeclaration=>ts.isFunctionDeclaration(n)&&n.name?.text==='activationInverseCpp747');assert.equal(declarations.length,1)
 const context:any={assert};vm.runInNewContext(ts.transpileModule(declarations[0].getText(f)+'\nglobalThis.inverse=activationInverseCpp747',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context,{timeout:1000})
 const old=context.inverse(raw.replace(/\r\n/g,'\n'));assert.equal(createHash('sha256').update(old).digest('hex'),'7b04e77bf0bce117dad6bbda6f14acd255d19d6bbfcadc47c9dc471db0a0a098');return old
}
function actualInitialRow747(foreground:string,text:string){
 const native=context({GetForegroundWindow:()=>foreground}),r=native.realm
 for(const [name,args]of [['input_length','action'],['input_request','h,action'],['key','h,code']])vm.runInContext(name+'=function('+args+'){'+lower(member(name,text))+'}',r,{timeout:1000})
 const posted:any[]=[],document:any={activeElement:null,addEventListener(){}},row={disabled:false,getAttribute:()=> 'native-terminal-A',focus(){document.activeElement=row}}
 document.getElementById=(id:string)=>id==='list'?{querySelectorAll:()=>[row]}:{textContent:'waiting'}
 const window:any={Terminal:class{constructor(){throw Error('INITIAL_FORM_MUST_NOT_OPEN_TERMINAL')}},cmsparkDesktopReceive(){},chrome:{webview:{postMessage(frame:any){posted.push(JSON.parse(JSON.stringify(frame)))}}}}
 const form=fs.readFileSync(path.resolve(__dirname,'../..','tests/fixtures/desktop-476/terminal-form.js'),'utf8')
 vm.runInNewContext('const documentGeneration="owned-activation-document";'+form,{window,document,TextDecoder,TextEncoder,Uint8Array},{timeout:1000})
 window.cmsparkDesktopReceive({type:'thread.list'});assert.equal(document.activeElement,row)
 assert.deepEqual(posted,[{type:'system.ping',id:'D476_TERMINAL_ROW_KEY',generation:'owned-activation-document'}])
 return{...native,accepted:r.key(native.h,13)}
}
test('actual initial form joins document and owned activation once; old source installs before foreground',()=>{
 const raw=fs.readFileSync(file,'utf8'),oldSource=oldInitialCpp747(raw)
 for(let round=0;round<3;round++){
 const old=initialForm747(oldSource);old.r.onInstall=()=>{const input=actualInitialRow747('foreign-window',oldSource);assert.equal(input.accepted,false);assert.equal(input.realm.failed,true);assert.equal(input.calls.filter(x=>x[0]==='step').length,0)};old.r.document_ready(old.h);assert.deepEqual(old.effects,['install'],'real old document body starts form/key before foreground')
 for(const eol of [raw.replace(/\r\n/g,'\n'),raw.replace(/\r?\n/g,'\r\n')]){
  const first=initialForm747(eol);first.r.document_ready(first.h);assert.deepEqual(first.effects,[]);first.activate();assert.deepEqual(first.effects,[])
  first.r.GetForegroundWindow=()=>first.h.window;first.r.reenter=first.activate;first.r.onInstall=()=>{const input=actualInitialRow747(first.h.window,eol);assert.equal(input.accepted,true);assert.equal(input.realm.failed,false);assert.equal(input.calls.filter(x=>x[0]==='step').length,1)};first.activate();first.activate();assert.deepEqual(first.effects,['install'],'latch precedes reentrant script work')
  const already=initialForm747(eol);already.r.GetForegroundWindow=()=>already.h.window;already.activate();assert.deepEqual(already.effects,[]);already.r.document_ready(already.h);already.activate();assert.deepEqual(already.effects,['install'])
  // Initial waiting must not absorb later foreground loss: use original bodies.
  const input=context({GetForegroundWindow:()=> 'foreign-window'});assert.equal(input.realm.input_request(input.h,1),false);assert.equal(input.realm.failed,true);assert.equal(input.calls.length,1);assert.equal(input.calls.filter(x=>x[0]==='step').length,0)
  for(const fault of ['dead','userdata','window','ready','document','epoch','web','controller','hidden','foreground','foreign-owner','failed']){
   const f=initialForm747(eol);f.r.document_ready(f.h);f.r.GetForegroundWindow=()=>f.h.window
   if(fault==='dead')f.r.IsWindow=()=>false;else if(fault==='userdata')f.r.GetWindowLongPtrW=()=>({});else if(fault==='window')f.h.window='replacement';else if(fault==='ready')f.h.ready=false;else if(fault==='document')f.h.generation='replacement';else if(fault==='epoch')f.h.epoch++;else if(fault==='web')f.h.web={};else if(fault==='controller')f.h.controller=null;else if(fault==='hidden')f.r.IsWindowVisible=()=>false;else if(fault==='foreground')f.r.GetForegroundWindow=()=> 'foreign';else if(fault==='foreign-owner')f.r.owner={};else f.r.failed=true
   f.activate();assert.deepEqual(f.effects,[],fault)
  }
  const duplicate=initialForm747(eol);duplicate.r.document_ready(duplicate.h);duplicate.r.document_ready(duplicate.h);duplicate.r.GetForegroundWindow=()=>duplicate.h.window;duplicate.activate();assert.equal(duplicate.r.failed,true);assert.deepEqual(duplicate.effects,[])
 }
 }
 // The exact injected OS branch runs default processing before re-evaluation;
 // inactive/foreign messages cannot manufacture an owned activation.
 const root=path.resolve(__dirname,'../..'),builder=require(path.join(root,'scripts/desktop-terminal-fixture.mjs')),read=(p:string)=>fs.readFileSync(path.join(root,p),'utf8')
 const variant=builder.desktopTerminalFixture('cpp',read('src/desktop/native/DesktopHost.cpp'),raw,read('tests/fixtures/desktop-476/terminal-form.js'))
 const marker='if(message==WM_ACTIVATE)',at=variant.source.indexOf(marker);assert.ok(at>=0);assert.equal(variant.source.split(marker).length,2)
 const body=block(variant.source,at).replace('const auto result=','const result=').replace('D705TerminalAcceptance::begin_form(*self)','begin_form(self)')
 for(const active of [false,true]){const order:string[]=[],c:any={hwnd:'owned',message:6,w:active?1:0,l:0,self:{},LOWORD:(n:number)=>n,WA_INACTIVE:0,DefWindowProcW:()=>{order.push('default');return 19},begin_form:()=>order.push('begin')};assert.equal(vm.runInNewContext('(function(){'+body+'})()',c,{timeout:1000}),19);assert.deepEqual(order,active?['default','begin']:['default'])}
})
test('actual original terminal builder callback executes fully without loading its product imports',()=>{
 const root=path.resolve(__dirname,'../..'),p=path.join(root,'tests/desktop-terminal-native-fixture-705.test.ts'),text=fs.readFileSync(p,'utf8'),f=ts.createSourceFile(p,text,ts.ScriptTarget.Latest,true)
 const title='both terminal acceptance native variants invert every product byte, preserve guards and fail closed on anchor drift'
 const leaves=f.statements.filter((n):n is ts.ExpressionStatement=>ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(f)==='test'&&ts.isStringLiteral(n.expression.arguments[0])&&n.expression.arguments[0].text===title);assert.equal(leaves.length,1)
 const call=leaves[0].expression as ts.CallExpression,callback=call.arguments[1];assert.ok(ts.isArrowFunction(callback)&&ts.isBlock(callback.body))
 const target=path.join(root,'scripts/desktop-terminal-fixture.mjs'),builder=require(target),context:any={assert,path,root,source:(p:string)=>fs.readFileSync(path.join(root,p),'utf8'),require:(p:string)=>{assert.equal(p,target);return builder}}
 vm.runInNewContext('('+callback.getText(f)+')()',context,{timeout:1000})
})
