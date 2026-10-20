/** Source-derived native controller controls only. No compiler, PTY or OS UI runs. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
const dir=process.env.CMSPARK_NATIVE705_SOURCE_DIR??path.resolve(__dirname,"../../src/desktop/native")
const read=(language:string)=>fs.readFileSync(path.join(dir,"DesktopHost."+language),"utf8")
const methods=["desktop.local.state","desktop.terminal.open","desktop.terminal.input","desktop.terminal.resize","desktop.terminal.ack","desktop.terminal.ping","desktop.terminal.close","desktop.terminal.return"]
function block(source:string,signature:string){const start=source.indexOf(signature);assert.ok(start>=0,signature);let n=0,quote="",escaped=false;const begin=source.indexOf("{",start);for(let i=begin;i<source.length;i++){const c=source[i];if(quote){if(escaped)escaped=false;else if(c==="\\")escaped=true;else if(c===quote)quote="";continue}if(c==='"'||c==="'"){quote=c;continue}if(c==="{")n++;if(c==="}"&&!--n)return source.slice(begin+1,i)}throw Error("UNTERMINATED_NATIVE_BODY")}
test("705 native controllers expose exactly eight terminal methods and retain original entry ownership",()=>{
 const cpp=read("cpp"),swift=read("swift"),c=block(cpp,"static bool local_method("),s=swift.match(/static let localMethods:Set<String>=\[([^\n]+)\]/)?.[1];assert.ok(s)
 assert.deepEqual([...c.matchAll(/L"([^"]+)"/g)].map(m=>m[1]),methods);assert.deepEqual([...s.matchAll(/"([^"]+)"/g)].map(m=>m[1]),methods)
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
test("705 native local confirmation has real operation/request binding, exact terminal kinds and original deadline/digest",()=>{
 const cpp=read('cpp'),swift=read('swift');const condition=cpp.match(/auto kind=text\(action,L"kind"\);if\(([^\n]+)\)return;/);assert.ok(condition)
 const refuse=new Function('kind','method','return '+condition[1].replace(/L"/g,'"'))
 assert.equal(refuse('terminal-open','desktop.terminal.open'),false);assert.equal(refuse('terminal-return','desktop.terminal.return'),false)
 for(const [kind,method]of [['agent-start','desktop.agent.start'],['terminal-open','desktop.terminal.return'],['terminal-return','desktop.terminal.open'],['unknown','desktop.terminal.open']])assert.equal(refuse(kind,method),true)
 for(const text of ['local_operations.find(text(frame,L"request_id"))','owned->second.generation!=generation','owned->second.thread!=local_thread','text(action,L"operation_id")!=binding.native_id','item.method==method&&item.pending.generation==generation&&item.pending.thread==binding.thread','text(payload,L"revision")!=binding.revision','if(actual!=digest)return','budget>45000','value->epoch==epoch&&value->generation==generation&&wall_ms()<value->deadline'])assert.ok(cpp.includes(text),text)
 for(const text of ['localOperations[f["request_id"] as? String ?? ""]','request.thread==localThread','action["operation_id"] as? String==request.nativeId','localRequests.values.contains','timeout.doubleValue<=45000','socket === p.task,p.generation==generation','p.purpose=="local-work"'])assert.ok(swift.includes(text),text)
 for(const source of [cpp,swift]){assert.ok(source.includes('用户终端可执行命令并离开起始目录'));assert.ok(source.includes('不是 OS 沙箱'));assert.ok(source.includes('不授权模型读取终端屏显'))}
 assert.ok(!block(cpp,'void begin_confirmation(').includes('L"agent-start"'));assert.ok(!block(swift,'func beginConfirmation(').includes('"agent-start"'))
})
test("705 source-derived native open gate retains old closed excerpts until replacement succeeds",()=>{
 const cpp=read('cpp'),s=cpp.match(/return row.second.generation==generation&&\(!local_closed.count\(row.first\)\|\|row.second.ui_id==ui\);/);assert.ok(s)
 const body=s[0].replace(/row\.second/g,'row.value').replace('local_closed.count(row.first)','closed.has(row.id)'),blocks=new Function('row','generation','closed','ui',body)
 const row={id:'old',value:{generation:'current',ui_id:'old-ui'}}
 assert.equal(blocks(row,'current',new Set(),'new-ui'),true);assert.equal(blocks(row,'current',new Set(['old']),'new-ui'),false);assert.equal(blocks(row,'current',new Set(['old']),'old-ui'),true);assert.equal(blocks(row,'new',new Set(),'new-ui'),false)
 for(const [lang,close,onlyAfter]of [['cpp','local_closed.insert(found->first)','if(!ok.GetBoolean())local_operations.erase(value.pending.native_id);'],['swift','localClosed.insert(operation)','if !ok{localOperations.removeValue(forKey:request.pending.nativeId)}']]){const source=read(lang);assert.ok(source.includes(close));assert.ok(source.includes(onlyAfter));assert.ok(source.includes(lang==='cpp'?'old->first!=value.pending.native_id&&local_closed.count(old->first)':'old != request.pending.nativeId && localClosed.contains(old)'))}
})
test("705 new terminal retire paths preserve current archive/browser and native confirmation isolation",()=>{
 const cpp=read('cpp'),swift=read('swift')
 for(const name of ['desktop.archive.list','desktop.archive.state','desktop.archive.set','desktop.browser.status','desktop.browser.tasks','desktop.browser.visibility','desktop.browser.retire']){assert.ok(cpp.includes('L"'+name+'"'),name);assert.ok(swift.includes('"'+name+'"'),name)}
 assert.ok(cpp.includes('if(message==native_connect||message==native_offline)self->retire_local();'));assert.ok(cpp.includes('void document(){if(!retire_browser(true))ExitProcess(46);retire_archive();retire_dialog();'));assert.ok(block(cpp,'void retire_dialog()').trimStart().startsWith('retire_local();'));assert.ok(cpp.includes('if(message==WM_CLOSE){self->retire_local();'))
 assert.ok(swift.includes('if socket === task {retireLocal()}'));assert.ok(swift.includes('guard socket === task else { return };let wasAuthenticated='));assert.ok(swift.includes('func applicationWillTerminate(_ notification:Notification) { retireBrowser(true);'));assert.ok(block(swift,'func retireDialog()').trimStart().startsWith('retireLocal()'))
 assert.ok(cpp.includes('local_operations.clear();local_requests.clear();local_closed.clear();local_thread.clear();'));assert.ok(swift.includes('localOperations.removeAll();localRequests.removeAll();localClosed.removeAll();localThread=nil'))
 const nativeOnly=cpp.indexOf('if(type==L"desktop.confirmation.request")'),reply=cpp.indexOf('if(accept_local(frame))return;');assert.ok(nativeOnly>0&&reply>nativeOnly)
 for(const name of ['local-work.js','terminal-core.js','terminal-fit.js','terminal.css']){assert.ok(cpp.includes('L"'+name+'"'));assert.ok(swift.includes('"'+name+'"'))}
})
test("705 fixed nonce template lowering refuses missing/duplicate/context mismatch without weakening CSP",()=>{
 let body=block(read('cpp'),'static bool desktop_style_html(').replace('std::string marker=','const marker=').replace('for(auto const& context:{csp,meta})','for(const context of [csp,meta])').replace(/auto /g,'const ').replace(/data.find\(/g,'data.indexOf(').replace(/std::string::npos/g,'-1').replace(/marker.size\(\)/g,'marker.length')
 body=body.replace('data.replace(second,marker.length,value);','data=data.slice(0,second)+value+data.slice(second+marker.length);').replace('data.replace(first,marker.length,value);','data=data.slice(0,first)+value+data.slice(first+marker.length);').replace('return data.indexOf(marker)==-1;','return {ok:data.indexOf(marker)==-1,html:data};')
 const actual=new Function('input','nonce','hex','utf8','let data=input;'+body),html=`<meta content="style-src-elem 'self' 'nonce-__CM_STYLE_NONCE__'"><meta name="cmspark-style-nonce" content="__CM_STYLE_NONCE__">`,nonce='a'.repeat(64),run=(h:string,n=nonce)=>actual(h,n,(s:string,k:number)=>s.length===k&&/^[0-9a-f]+$/.test(s),(s:string)=>s)
 assert.equal(run(html).ok,true);assert.ok(!run(html).html.includes('__CM_STYLE_NONCE__'))
 for(const h of [html.replace('__CM_STYLE_NONCE__','missing'),html+'__CM_STYLE_NONCE__',html.replace('cmspark-style-nonce','other'),html+html])assert.equal(run(h),false)
 for(const n of ['', 'A'.repeat(64),'a'.repeat(63)])assert.equal(run(html,n),false)
 const swift=block(read('swift'),'static func styledHTML(');assert.ok(swift.includes('text.components(separatedBy:marker).count==3'));assert.ok(swift.includes('contexts.allSatisfy'));assert.ok(swift.includes('nonce.utf8.count==64'))
})
