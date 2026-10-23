/** Source-derived native controller controls only. No compiler, PTY or OS UI runs. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
const dir=process.env.CMSPARK_NATIVE705_SOURCE_DIR??path.resolve(__dirname,"../../src/desktop/native")
const read=(language:string)=>fs.readFileSync(path.join(dir,"DesktopHost."+language),"utf8")
const terminalMethods=["desktop.local.state","desktop.terminal.open","desktop.terminal.input","desktop.terminal.resize","desktop.terminal.ack","desktop.terminal.ping","desktop.terminal.close","desktop.terminal.return"]
function block(source:string,signature:string){const start=source.indexOf(signature);assert.ok(start>=0,signature);let n=0,quote="",escaped=false;const begin=source.indexOf("{",start);for(let i=begin;i<source.length;i++){const c=source[i];if(quote){if(escaped)escaped=false;else if(c==="\\")escaped=true;else if(c===quote)quote="";continue}if(c==='"'||c==="'"){quote=c;continue}if(c==="{")n++;if(c==="}"&&!--n)return source.slice(begin+1,i)}throw Error("UNTERMINATED_NATIVE_BODY")}
const methods=[...terminalMethods,"desktop.agent.start","desktop.agent.prompt","desktop.agent.cancel"]
test("705 native controllers expose the exact terminal plus Agent method union and retain original entry ownership",()=>{
 const cpp=read("cpp"),swift=read("swift"),c=block(cpp,"static bool local_method("),s=swift.match(/static let localMethods:Set<String>=\[([^\n]+)\]/)?.[1];assert.ok(s)
 assert.deepEqual([...c.matchAll(/L"([^"]+)"/g)].map(m=>m[1]),methods);assert.deepEqual([...s.matchAll(/"([^"]+)"/g)].map(m=>m[1]),methods)
 assert.equal(terminalMethods.length,8);assert.deepEqual(methods.filter(name=>!name.startsWith("desktop.agent.")),terminalMethods)
 assert.ok(cpp.includes('if(!ready||source!=document_url||generation.empty())return;'));assert.ok(cpp.includes('text(frame,L"generation")!=generation'))
 for(const literal of ['message.webView === web','message.frameInfo.isMainFrame','message.frameInfo.securityOrigin.protocol=="cmspark-desktop"','message.frameInfo.securityOrigin.host=="app"','g==generation'])assert.ok(swift.includes(literal),literal)
 assert.ok(cpp.includes('if(local_method(type)){render_local(frame);return;}'));assert.ok(swift.includes('if Self.localMethods.contains(type){renderLocal(f);return}'))
})
test("705 actual C++ base64 predicate accepts canonical <=16KiB and rejects malformed/pad-bit/oversize input",()=>{
 let body=block(read("cpp"),'static bool local_base64('),digit=body.match(/auto digit=\[\]\(wchar_t c\)\{([\s\S]+?)\};/);assert.ok(digit)
 const db=digit[1].replace(/L'(.)'/g,(_m,c)=>String(c.charCodeAt(0))).replace(/int\(([^)]+)\)/g,'($1)')
 body=body.replace(digit[0],'const digit=(c)=>{c=c.charCodeAt(0);'+db+'};').replace('auto count=value.size();','const count=value.length;').replace('size_t padding=','let padding=').replace('for(size_t i=','for(let i=').replace(/L'(.)'/g,"'$1'")
 const actual=new Function('value',body),valid=[Buffer.from('中文\n').toString('base64'),'Zg==','Zm8=','Zm9v',Buffer.alloc(16384,7).toString('base64')]
 for(const value of valid)assert.equal(actual(value),true)
 for(const value of ['', 'Zg','Zg===','Zh==','Zm9=','Z===','====','Zm 9v','中文','Zg==\n',Buffer.alloc(16385,7).toString('base64')])assert.equal(actual(value),false,value.slice(0,12))
 const swift=block(read('swift'),'static func localBase64(');for(const clause of ['value.utf8.count<=21848','Data(base64Encoded:value)','data.count<=16384','data.base64EncodedString()==value'])assert.ok(swift.includes(clause),clause)
})
test("705 actual C++ integer guard refuses booleans/NaN/fractions and preserves original bounds",()=>{
 let body=block(read('cpp'),'static bool local_integer(').replace('auto value=','const value=').replace('auto n=','const n=').replace(/JsonValueType::Number/g,'"Number"').replace(/std::isfinite/g,'Number.isFinite').replace(/std::floor/g,'Math.floor')
 const actual=new Function('frame','key','maximum',body),frame=(v:unknown)=>({TryLookup:()=>({ValueType:()=>typeof v==='number'?'Number':'Other',GetNumber:()=>v})})
 for(const max of [200,500,9007199254740991]){for(const v of [1,max])assert.equal(actual(frame(v),'value',max),true);for(const v of [true,false,null,'1',0,-1,1.5,max+1,NaN,Infinity])assert.equal(actual(frame(v),'value',max),false)}
})
test("705 native local confirmation binds each terminal/Agent kind to its actual operation and original deadline/digest",()=>{
 const cpp=read('cpp'),swift=read('swift'),body=block(cpp,'void begin_confirmation(')
 const condition=/auto kind=text\(action,L"kind"\);bool terminal=binding.kind==L"terminal";\s*if\(([^\n]+)\)return;/.exec(body);assert.ok(condition)
 const expression=condition[1].replace(/L"/g,'"').replace(/std::set<std::wstring>\{([^}]+)\}\.count\(kind\)/g,'new Set([$1]).has(kind)')
 assert.doesNotMatch(expression,/std::|\bbinding\b/)
 const refuse=new Function('kind','method','terminal','return '+expression)
 const pairs=[['terminal-open','desktop.terminal.open',true],['terminal-return','desktop.terminal.return',true],['agent-start','desktop.agent.start',false],['agent-prompt','desktop.agent.prompt',false],['agent-permission','desktop.agent.start',false]] as const
 for(const [kind,method,terminal]of pairs){
  assert.equal(refuse(kind,method,terminal),false)
  assert.equal(refuse(kind,method,!terminal),true)
  for(const other of new Set(pairs.map(pair=>pair[1])))if(other!==method)assert.equal(refuse(kind,other,terminal),true)
 }
 for(const terminal of [false,true])assert.equal(refuse('unknown','desktop.terminal.open',terminal),true)
 for(const text of ['local_operations.find(text(frame,L"request_id"))','owned->second.generation!=generation','owned->second.thread!=local_thread','text(action,L"operation_id")!=binding.native_id','item.method==method&&item.pending.generation==generation&&item.pending.thread==binding.thread','text(payload,L"revision")!=binding.revision','if(actual!=digest)return','budget>45000','value->epoch==epoch&&value->generation==generation&&wall_ms()<value->deadline'])assert.ok(cpp.includes(text),text)
 for(const text of ['localOperations[f["request_id"] as? String ?? ""]','request.thread==localThread','action["operation_id"] as? String==request.nativeId','localRequests.values.contains','timeout.doubleValue<=45000','socket === p.task,p.generation==generation','p.purpose=="local-work"'])assert.ok(swift.includes(text),text)
 for(const source of [cpp,swift]){assert.ok(source.includes('用户终端可执行命令并离开起始目录'));assert.ok(source.includes('不是 OS 沙箱'));assert.ok(source.includes('不授权模型读取终端屏显'))}
 // The composed native host must retain Agent confirmation rather than silently
 // shrinking the method set to satisfy the older terminal-only source oracle.
 for(const kind of ['agent-start','agent-prompt','agent-permission']){assert.ok(body.includes('L"'+kind+'"'));assert.ok(block(swift,'func beginConfirmation(').includes('"'+kind+'"'))}
})
test("705 source-derived native open gate retains old closed excerpts until replacement succeeds",()=>{
 const cpp=read('cpp'),s=cpp.match(/return row.second.generation==generation&&\(row.second.ui_id==ui\|\|\(type==L"desktop.terminal.open"&&row.second.kind==L"terminal"&&!local_closed.count\(row.first\)\)\);/);assert.ok(s)
 const body=s[0].replace(/row\.second/g,'row.value').replace('local_closed.count(row.first)','closed.has(row.id)').replace(/L"/g,'"'),blocks=new Function('row','generation','closed','ui','type',body)
 const row={id:'old',value:{generation:'current',ui_id:'old-ui',kind:'terminal'}}
 assert.equal(blocks(row,'current',new Set(),'new-ui','desktop.terminal.open'),true);assert.equal(blocks(row,'current',new Set(['old']),'new-ui','desktop.terminal.open'),false);assert.equal(blocks(row,'current',new Set(['old']),'old-ui','desktop.terminal.open'),true);assert.equal(blocks(row,'new',new Set(),'new-ui','desktop.terminal.open'),false)
 assert.equal(blocks({...row,value:{...row.value,kind:'agent'}},'current',new Set(),'new-ui','desktop.terminal.open'),false)
 assert.equal(blocks(row,'current',new Set(),'new-ui','desktop.agent.start'),false)
 for(const [lang,close,onlyAfter,cleanup]of [
  ['cpp','local_closed.insert(found->first)','if(!ok.GetBoolean())local_operations.erase(value.pending.native_id);','old->first!=value.pending.native_id&&old->second.kind==L"terminal"&&local_closed.count(old->first)'],
  ['swift','localClosed.insert(operation)','if !ok{localOperations.removeValue(forKey:request.pending.nativeId)}','old != request.pending.nativeId && localOperations[old]?.kind=="terminal" && localClosed.contains(old)'],
 ]){const source=read(lang);assert.ok(source.includes(close));assert.ok(source.includes(onlyAfter));assert.ok(source.includes(cleanup))}
})
test("705 new terminal retire paths preserve current archive/browser and native confirmation isolation",()=>{
 const cpp=read('cpp'),swift=read('swift')
 for(const name of ['desktop.archive.list','desktop.archive.state','desktop.archive.set','desktop.browser.status','desktop.browser.tasks','desktop.browser.visibility','desktop.browser.retire']){assert.ok(cpp.includes('L"'+name+'"'),name);assert.ok(swift.includes('"'+name+'"'),name)}
 assert.ok(cpp.includes('if(message==native_connect){self->retire_local();self->retire_picker();self->retire_confirmation();self->phase=L"initial";self->generation.clear();self->requests.clear();}else if(message==native_offline){self->retire_local();'));assert.ok(cpp.includes('void document(){retire_local();retire_workspace();if(!retire_browser(true))ExitProcess(46);retire_archive();retire_dialog();'));assert.ok(block(cpp,'void retire_dialog()').trimStart().startsWith('retire_local();'));assert.ok(cpp.includes('if(message==WM_CLOSE){self->retire_local();'))
 assert.ok(swift.includes('guard socket === task else { return };let wasAuthenticated=authenticated;retireLocal();'));assert.ok(swift.includes('guard socket === task else { return };let wasAuthenticated='));assert.ok(swift.includes('func applicationWillTerminate(_ notification:Notification) { retireLocal();retireWorkspace();retireBrowser(true);'));assert.ok(block(swift,'func retireDialog()').trimStart().startsWith('retireLocal()'))
 assert.ok(cpp.includes('local_operations.clear();local_requests.clear();local_closed.clear();local_thread.clear();'));assert.ok(swift.includes('localOperations.removeAll();localRequests.removeAll();localClosed.removeAll();localThread=nil'))
 const nativeOnly=cpp.indexOf('if(type==L"desktop.confirmation.request")'),reply=cpp.indexOf('if(accept_local(frame))return;');assert.ok(nativeOnly>0&&reply>nativeOnly)
 for(const name of ['local-work.js','terminal-core.js','terminal-fit.js','terminal.css']){assert.ok(cpp.includes('L"'+name+'"'));assert.ok(swift.includes('"'+name+'"'))}
})
test("705 fixed two-marker nonce lowering rejects missing/duplicate reserved markers and keeps actual CSP/meta contexts",()=>{
 const original=block(read('cpp'),'static bool desktop_style_html('),loop='for(auto marker:{"__CMSPARK_STYLE_NONCE_CSP__","__CMSPARK_STYLE_NONCE_META__"})'
 assert.equal(original.split(loop).length,3)
 let body=original.split(loop).join('for(const marker of ["__CMSPARK_STYLE_NONCE_CSP__","__CMSPARK_STYLE_NONCE_META__"])').replace(/auto /g,'const ').replace(/data.find\(/g,'data.indexOf(').replace(/std::string::npos/g,'-1').replace(/std::strlen\(marker\)/g,'marker.length')
 body=body.replace('data.replace(data.indexOf(marker),marker.length,value);','data=data.slice(0,data.indexOf(marker))+value+data.slice(data.indexOf(marker)+marker.length);').replace('return data.indexOf("__CMSPARK_STYLE_NONCE_")==-1;','return data.indexOf("__CMSPARK_STYLE_NONCE_")==-1?{ok:true,html:data}:false;')
 assert.doesNotMatch(body,/std::|\bauto\b|data\.replace\(/)
 const actual=new Function('input','nonce','hex','utf8','let data=input;'+body),html=fs.readFileSync(path.resolve(__dirname,'../../src/desktop/assets/index.html'),'utf8'),nonce='a'.repeat(64),run=(h:string,n=nonce)=>actual(h,n,(s:string,k:number)=>s.length===k&&/^[0-9a-f]+$/.test(s),(s:string)=>s)
 assert.ok(html.includes("'nonce-__CMSPARK_STYLE_NONCE_CSP__'"));assert.ok(html.includes('name="cmspark-style-nonce" content="__CMSPARK_STYLE_NONCE_META__"'))
 assert.equal(run(html).ok,true);assert.ok(!run(html).html.includes('__CMSPARK_STYLE_NONCE_'))
 for(const marker of ['__CMSPARK_STYLE_NONCE_CSP__','__CMSPARK_STYLE_NONCE_META__'])for(const h of [html.replace(marker,''),html+marker])assert.equal(run(h),false)
 for(const h of [html+html,html+'__CMSPARK_STYLE_NONCE_UNKNOWN__'])assert.equal(run(h),false)
 for(const n of ['', 'A'.repeat(64),'a'.repeat(63)])assert.equal(run(html,n),false)
 // Tag identity is enforced by the pinned xterm style factory in the document
 // entry controls. The native helper's actual contract is reserved-marker
 // uniqueness; it must not be credited with an invented HTML parser predicate.
 const swift=block(read('swift'),'static func styledHTML(');for(const clause of ['let markers=["__CMSPARK_STYLE_NONCE_CSP__","__CMSPARK_STYLE_NONCE_META__"]','markers.allSatisfy','text.components(separatedBy:$0).count==2','nonce.count==64','!text.contains("__CMSPARK_STYLE_NONCE_")'])assert.ok(swift.includes(clause),clause)
})


// CPU controls below delegate every VT write/resize to the admitted actual
// xterm package. Callback delivery is held explicitly; no PTY/DOM is opened.
import { createTerminalObserver747, rawMarker747, terminalMarker747, parsedMarker747 } from './helpers/terminal-observer-747'
import { createNoOpenTerminal747 } from './fixtures/desktop-476/terminal-parser-cpu'
const rawVectors747=[
 {id:'RAW01',text:terminalMarker747+'x'.repeat(128),old:false,expected:true},
 {id:'RAW02',text:'a'.repeat(8000)+terminalMarker747+'b'.repeat(8000),old:false,expected:true},
 {id:'RAW03',text:'prefix'+terminalMarker747,old:true,expected:true},
 {id:'RAW04',text:'D476_TERMINAL_x'+ 'x'.repeat(128),old:false,expected:false},
]
for(const vector of rawVectors747)test('747 original raw-window counterexample '+vector.id,()=>{
 const bytes=Buffer.from(vector.text);assert.ok(bytes.length<=16384)
 const decoded=new TextDecoder().decode(bytes),old=decoded.slice(-128).includes(terminalMarker747),now=rawMarker747('',decoded)
 assert.equal(old,vector.old);assert.equal(now.found,vector.expected);assert.ok(now.suffix.length<=128)
})
function observerHarness747(held=false){
 const controller=new AbortController(),owner={},faults:Error[]=[],trace:string[]=[],ready:Array<()=>void>=[],waiting:Array<()=>void>=[]
 let actual:ReturnType<typeof createNoOpenTerminal747>|undefined,creates=0,disposals=0
 const observer=createTerminalObserver747((cols,rows)=>{
  creates++;actual=createNoOpenTerminal747({cols,rows})
  const parser=actual
  return {get cols(){return parser.cols},get rows(){return parser.rows},get buffer(){return parser.buffer},
   write(bytes,done){assert.ok(bytes instanceof Uint8Array);trace.push('write:'+Buffer.from(bytes).toString('hex'));parser.write(bytes,()=>{trace.push('ready');if(held){ready.push(()=>{trace.push('done');done?.()});for(const notify of waiting.splice(0))notify()}else{trace.push('done');done?.()}})},
   resize(cols,rows){trace.push('resize:'+cols+'x'+rows);parser.resize(cols,rows)},
   dispose(){disposals++;parser.dispose()},
  }
 },controller.signal,error=>faults.push(error))
 const open=(cols=80,rows=24)=>{const token=observer.reserveOpen({id:'owned',threadId:'thread',owner,cols,rows});observer.commitOpen(token,true)}
 return {observer,owner,controller,faults,trace,open,data:(bytes:Uint8Array)=>observer.data('owned','thread',owner,bytes),
  get parser(){assert.ok(actual);return actual},get creates(){return creates},get disposals(){return disposals},
  async callbackReady(){if(!ready.length)await new Promise<void>(resolve=>waiting.push(resolve));assert.ok(ready.length)},
  release(){const next=ready.shift();assert.ok(next);next()},
 }
}
function publicBuffer747(parser:ReturnType<typeof createNoOpenTerminal747>){return{cols:parser.cols,rows:parser.rows,lines:Array.from({length:parser.buffer.active.length},(_,i)=>{const line=parser.buffer.active.getLine(i);assert.ok(line);return{wrapped:line.isWrapped,text:line.translateToString(true)}})}}
async function reference747(h:ReturnType<typeof observerHarness747>,events:Array<Uint8Array|{cols:number;rows:number}>,cols=80,rows=24){
 const reference=createNoOpenTerminal747({cols,rows})
 try{for(const event of events){if(event instanceof Uint8Array)await new Promise<void>(resolve=>reference.write(event,resolve));else reference.resize(event.cols,event.rows)}assert.deepEqual(publicBuffer747(h.parser),publicBuffer747(reference));assert.equal(parsedMarker747(h.parser),parsedMarker747(reference))}finally{reference.dispose()}
}
test('747 actual parser queue QUEUE01 derives initial dimensions and identity from successful open',async()=>{
 const h=observerHarness747();try{h.open(15,4);assert.equal(h.creates,1);assert.equal(h.parser.cols,15);assert.equal(h.parser.rows,4);h.data(Buffer.from(terminalMarker747));assert.equal(await h.observer.finish(),true);assert.deepEqual(h.faults,[])}finally{h.observer.dispose();assert.equal(h.disposals,1)}
})
test('747 actual parser queue QUEUE02 never admits early bytes from a refused open',()=>{
 const h=observerHarness747(),token=h.observer.reserveOpen({id:'owned',threadId:'thread',owner:h.owner,cols:80,rows:24})
 h.data(Buffer.from(terminalMarker747));assert.equal(h.creates,0)
 assert.throws(()=>h.observer.commitOpen(token,false),/OPEN_REFUSED/);assert.equal(h.creates,0);assert.deepEqual(h.trace,[]);assert.throws(()=>h.observer.dispose(),/OPEN_REFUSED/)
})
test('747 actual parser queue QUEUE03 serializes two original byte writes by real callbacks',async()=>{
 const h=observerHarness747(true),a=Buffer.from('D476_TERMINAL_'),b=Buffer.from('中')
 try{h.open();h.data(a);h.data(b);await h.callbackReady();assert.deepEqual(h.trace,['write:'+a.toString('hex'),'ready']);h.release();await h.callbackReady();const done=h.observer.finish();h.release();assert.equal(await done,true);await reference747(h,[a,b])}finally{h.observer.dispose()}
})
test('747 actual parser queue QUEUE04 orders data then committed resize then reentrant data',async()=>{
 const h=observerHarness747(true),a=Buffer.from('D476_TERMINAL_'),b=Buffer.from('中')
 try{h.open();h.data(a);const token=h.observer.reserveResize('owned',15,4);h.data(b);h.observer.commitResize(token,true);await h.callbackReady();assert.equal(h.trace.some(x=>x.startsWith('resize:')),false);h.release();await h.callbackReady();assert.deepEqual(h.trace.slice(2,5),['done','resize:15x4','write:'+b.toString('hex')]);const done=h.observer.finish();h.release();assert.equal(await done,true);await reference747(h,[a,{cols:15,rows:4},b])}finally{h.observer.dispose()}
})
test('747 actual parser queue QUEUE05 reserves successful resize before same-call data',async()=>{
 const h=observerHarness747(),bytes=Buffer.from(terminalMarker747)
 try{h.open();const token=h.observer.reserveResize('owned',15,4);h.data(bytes);assert.deepEqual(h.trace,[]);h.observer.commitResize(token,true);assert.equal(await h.observer.finish(),true);assert.equal(h.trace[0],'resize:15x4');await reference747(h,[{cols:15,rows:4},bytes])}finally{h.observer.dispose()}
})
test('747 actual parser queue QUEUE06 refuses to apply unsuccessful resize between writes',async()=>{
 const h=observerHarness747(true),a=Buffer.from('D476_TERMINAL_'),b=Buffer.from('中')
 try{h.open();h.data(a);const token=h.observer.reserveResize('owned',15,4);h.data(b);h.observer.commitResize(token,false);await h.callbackReady();h.release();await h.callbackReady();const done=h.observer.finish();h.release();assert.equal(await done,true);assert.equal(h.trace.some(x=>x.startsWith('resize:')),false);await reference747(h,[a,b])}finally{h.observer.dispose()}
})
test('747 actual parser queue QUEUE07 refuses foreign operation owner and thread without feeding bytes',()=>{
 for(const [id,thread,owner]of [['foreign','thread',null],['owned','foreign',null],['owned','thread',{}]] as const){const h=observerHarness747();h.open();assert.throws(()=>h.observer.data(id,thread,owner??h.owner,Buffer.from(terminalMarker747)),/FOREIGN_OPERATION/);assert.deepEqual(h.trace,[]);assert.throws(()=>h.observer.dispose(),/FOREIGN_OPERATION/);assert.equal(h.disposals,1)}
 const h=observerHarness747();h.open();assert.throws(()=>h.observer.reserveResize('foreign',15,4),/FOREIGN_OPERATION/);assert.throws(()=>h.observer.dispose(),/FOREIGN_OPERATION/)
})
test('747 actual parser queue QUEUE08 waits final write callback at DONE and checks final active buffer',async()=>{
 const h=observerHarness747(true),bytes=Buffer.from(terminalMarker747+'\r\x1b[2K')
 try{h.open();h.data(bytes);await h.callbackReady();let settled=false;const done=h.observer.finish().then(value=>{settled=true;return value});await Promise.resolve();assert.equal(settled,false);h.release();assert.equal(await done,false);await reference747(h,[bytes])}finally{h.observer.dispose()}
})
test('747 actual parser queue QUEUE09 abort refuses pending completion and disposes only its owned parser once',async()=>{
 const h=observerHarness747(true),foreign=createNoOpenTerminal747()
 try{h.open();h.data(Buffer.from(terminalMarker747));await h.callbackReady();const result=assert.rejects(h.observer.finish(),/ABORTED/);h.controller.abort();await result;h.release();assert.throws(()=>h.observer.dispose(),/ABORTED/);h.observer.dispose();assert.equal(h.disposals,1);await new Promise<void>(resolve=>foreign.write(Buffer.from(terminalMarker747),resolve));assert.equal(parsedMarker747(foreign),true);assert.equal(h.faults.length,1)}finally{foreign.dispose();try{h.observer.dispose()}catch{}}
})
