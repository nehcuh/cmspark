/** Actual C++ source projection; CPU only, not COM, native input or trusted DOM evidence. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
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
 const value=command();assert.equal(value,"[Console]::Write(('x'*16384)+('D476_'+'TERMINAL_')+[char]0x4e2d); [Console]::ReadLine() #中");assert.equal(value.includes('D476_TERMINAL_中'),false)
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
