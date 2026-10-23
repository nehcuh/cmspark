/** Source/formatter/inverse contracts only. No Swift/C/C++ compiler or native execution. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {desktopLocalFixture} from '../desktop-mcp-fixture.mjs'
const root=new URL('../../',import.meta.url),read=rel=>fs.readFileSync(new URL(rel,root),'utf8')
const methods=['desktop.local.state','desktop.terminal.open','desktop.terminal.input','desktop.terminal.resize','desktop.terminal.ack','desktop.terminal.ping','desktop.terminal.close','desktop.terminal.return','desktop.agent.start','desktop.agent.prompt','desktop.agent.cancel']
test('both native finite method grammars agree with exactly eleven approved local methods',()=>{
 const cpp=read('src/desktop/native/DesktopHost.cpp'),swift=read('src/desktop/native/DesktopHost.swift'),c=cpp.match(/static bool local_method[^\n]+/)[0],s=swift.match(/static let localMethods[^\n]+/)[0]
 for(const body of [c,s])assert.deepEqual([...body.matchAll(/"(desktop\.[a-z.]+)"/g)].map(v=>v[1]),methods)
 assert.match(cpp,/local_requests\[native\]=\{pending,type,operation\}/);assert.match(swift,/localRequests\[native\]=\(pending,type,operation\)/)
 assert.match(cpp,/kind!=L"agent-permission"&&!std::any_of\(local_requests/);assert.match(swift,/kind != "agent-permission" \{guard localRequests.values.contains/)
})
test('actual launcher snprintf formats emit version10 while malformed controls retain their intentional protocol faults',()=>{
 for(const file of ['src/desktop/native/launcher.c','tests/fixtures/desktop-480/synchronize-handle-probe.c','tests/fixtures/desktop-480/windows-inheritance.c','tests/fixtures/desktop-480/windows-malformed-bootstrap.c']){
  const formats=[...read(file).matchAll(/"((?:\\.|[^"\\])*)"/g)].map(m=>JSON.parse('"'+m[1]+'"')).filter(s=>s.includes('"issued_method_set_version"'))
  assert.ok(formats.length>=1);for(const format of formats){assert.equal(/"issued_method_set_version":10/.test(format),true);for(const old of [7,8,9])assert.equal(new RegExp('"issued_method_set_version":'+old+'(?=[,}])').test(format),false);assert.ok(format.includes('"protocol_version"'))}
 }
})
test('native local acceptance generation is reversible over both source and controller newline conventions',()=>{
 for(const language of ['cpp','swift'])for(const sourceEol of ['\n','\r\n'])for(const fixtureEol of ['\n','\r\n']){
  const source=read('src/desktop/native/DesktopHost.'+language).replace(/\r\n/g,'\n').replace(/\n/g,sourceEol),fixture=read('tests/fixtures/desktop-476/local-acceptance.'+language).replace(/\r\n/g,'\n').replace(/\n/g,fixtureEol),form=read('tests/fixtures/desktop-476/local-form.js'),actual=desktopLocalFixture(language,source,fixture,form)
  assert.equal(actual.inverse,source);assert.ok(actual.source.includes('D476_LOCAL_DONE'));assert.ok(actual.source.includes('D476.local.complete'));assert.ok(actual.source.includes('77'));assert.ok(actual.source.includes(language==='cpp'?'D476LocalAcceptance::confirmation(*this)':'D476LocalAcceptance.confirmation(self)'))
  assert.throws(()=>desktopLocalFixture(language,source+source,fixture,form),/ANCHOR/)
 }
})
test('style-only HTML placeholders are unique and all other original CSP directives are unchanged',()=>{
 const html=read('src/desktop/assets/index.html'),csp=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1]
 for(const token of ['__CMSPARK_STYLE_NONCE_CSP__','__CMSPARK_STYLE_NONCE_META__'])assert.equal(html.split(token).length,2)
 for(const part of ["default-src 'none'","script-src 'self'","connect-src 'none'","frame-src 'none'","object-src 'none'","base-uri 'none'","form-action 'none'"])assert.ok(csp.split(';').map(s=>s.trim()).includes(part))
 assert.ok(csp.includes("style-src-elem 'self' 'nonce-__CMSPARK_STYLE_NONCE_CSP__'"));assert.equal(csp.includes('unsafe-inline'),false);assert.equal(csp.includes('unsafe-eval'),false)
 const cpp=read('src/desktop/native/DesktopHost.cpp'),swift=read('src/desktop/native/DesktopHost.swift');assert.match(cpp,/style_nonce=random_id\(\)\+random_id\(\)/);assert.match(cpp,/data.find\(marker,at\+1\)!=std::string::npos/);assert.match(swift,/bundledScheme\?\.newDocument\(\)/);assert.match(swift,/UUID\(\).uuidString\+UUID\(\).uuidString/);assert.match(swift,/components\(separatedBy:\$0\).count==2/)
})

test('composed picker and local-work families preserve every normal host byte in both EOL conventions',async()=>{
 const hooks=await import('../desktop-mcp-fixture.mjs'),{desktopAcceptanceVariant}=await import('../build-desktop-windows.mjs')
 for(const language of ['cpp','swift'])for(const eol of ['\n','\r\n']){
  const source=read('src/desktop/native/DesktopHost.'+language).replace(/\r?\n/g,eol),fixture=n=>read('tests/fixtures/desktop-476/'+n+'.'+language),form=n=>read('tests/fixtures/desktop-476/'+n+'-form.js')
  const base=fixture('native-acceptance')
  const variants=[
   hooks.desktopMcpFixture(language,source,base,form('native')),
   hooks.desktopMetadataFixture(language,source,base,form('metadata'),fixture('metadata-acceptance')),
   hooks.desktopDialogFixture(language,source,base,form('dialog'),fixture('dialog-acceptance')),
   hooks.desktopResourceFixture(language,source,fixture('resource-acceptance'),form('resource')),
   hooks.desktopWorkspaceFixture(language,source,fixture('workspace-acceptance'),form('workspace')),
   hooks.desktopLocalFixture(language,source,fixture('local-acceptance'),form('local')),
   desktopAcceptanceVariant(language,source,read('tests/fixtures/desktop-480/native-acceptance.'+language))
  ]
  for(const actual of variants){assert.equal(actual.inverse,source);assert.ok(actual.source.length>source.length)}
  const picker=language==='cpp'?'picker_current(workspace_selection)':'pickerCurrent(selection)',local=language==='cpp'?'void retire_local()':'func retireLocal()',deadline=language==='cpp'?'WM_TIMER&&w==workspace_picker_timer':'p.timer=Timer.scheduledTimer'
  for(const token of [picker,local,deadline])assert.ok(source.includes(token))
  assert.equal(source.includes('pickFolderNative('),false)
 }
})


// Fixed first-failure observations only. No native module/GUI or parent callback imports.
import vm from 'node:vm'
import {createRequire} from 'node:module'
const ts705=createRequire(import.meta.url)('typescript')
const localForm705=()=>read('tests/fixtures/desktop-476/local-form.js')
const localMeta705=()=>read('tests/desktop-native-thread-metadata-476.test.ts')
function firstParser705(){const text=localMeta705(),ast=ts705.createSourceFile('metadata.ts',text,ts705.ScriptTarget.Latest,true),fn=ast.statements.find(n=>ts705.isFunctionDeclaration(n)&&n.name?.text==='parseLocalFirstSite705');assert.ok(fn,'actual closed parser');const js=ts705.transpileModule(fn.getText(ast).replace('export ',''),{compilerOptions:{target:ts705.ScriptTarget.ES2022}}).outputText,scope={};vm.runInNewContext(js+';globalThis.actual=parseLocalFirstSite705',scope);return scope.actual}
function renderer705(source,kind,loggerFault=false){const out=[],events={},button={disabled:kind==='disabled',focus(){},getAttribute(){return 'native-local-A'}},nodes={status:{textContent:''},list:{querySelectorAll(){return kind==='row'?[]:[button]}},'local-terminal-open':button,'local-terminals':{querySelector(){return kind==='textarea'?null:button}}};const scope={documentGeneration:'owned',Uint8Array,TextDecoder,atob,document:{getElementById:id=>nodes[id],addEventListener:(n,f)=>events[n]=f},window:{cmsparkDesktopReceive(){},chrome:{webview:{postMessage:f=>{if(loggerFault&&f.id.startsWith('D476_LOCAL_FIRST_'))throw Error('OWNED_LOGGER');out.push(f.id)}}}}};vm.runInNewContext(source,scope);const receive=scope.window.cmsparkDesktopReceive;receive({type:'thread.list'});if(kind==='key')events.keydown({key:'Enter',isTrusted:false});if(!['row','key'].includes(kind)){receive({type:'desktop.local.state.result',ok:kind!=='state',state:{bound:kind!=='unbound'}});if(!['state','unbound','disabled'].includes(kind)){receive({type:'desktop.terminal.open.result',ok:kind!=='open'});if(kind==='data')receive({type:'desktop.terminal.data',b64:'!invalid!'})}}return{out,receive,events}}
test('705 actual renderer first sites distinguish early failures and never suppress the original FAIL',()=>{
 const expected={row:2,key:3,state:5,unbound:5,disabled:1,open:7,textarea:8,data:9}
 for(const source of [localForm705(),localForm705().replace(/\r?\n/g,'\r\n')])for(const [kind,site]of Object.entries(expected)){
  const f=renderer705(source,kind);assert.deepEqual(f.out.filter(x=>x.startsWith('D476_LOCAL_FIRST_')),[`D476_LOCAL_FIRST_R_${site}`]);assert.equal(f.out.filter(x=>x==='D476_LOCAL_FAIL').length,1,kind)
  f.events.keydown({key:'Enter',isTrusted:false});assert.equal(f.out.filter(x=>x.startsWith('D476_LOCAL_FIRST_')).length,1);assert.equal(f.out.filter(x=>x==='D476_LOCAL_FAIL').length,2)
  const bad=renderer705(source,kind,true);assert.equal(bad.out.filter(x=>x==='D476_LOCAL_FAIL').length,1,'logger fault must retain original FAIL')
 }
})
test('705 actual Node first-site parser is closed for all origins and never coerces inputs',()=>{
 const parse=firstParser705();for(const [origin,max]of [['R',17],['W',13],['M',8]])for(let site=1;site<=max;site++){const out=parse(`D476_LOCAL_FIRST_${origin}_${site}`);assert.equal(out.origin,origin);assert.equal(out.site,site)}
 let traps=0;const proxy=new Proxy({},{get(){traps++;throw 1},getPrototypeOf(){traps++;throw 1}}),revoked=Proxy.revocable({},{});revoked.revoke();const getter=Object.defineProperty({},'toString',{get(){traps++;throw 1}})
 for(const v of [undefined,null,proxy,revoked.proxy,getter,{},[],1,'','D476_LOCAL_FIRST_R_0','D476_LOCAL_FIRST_R_18','D476_LOCAL_FIRST_W_14','D476_LOCAL_FIRST_M_9','D476_LOCAL_FIRST_X_1','D476_LOCAL_FIRST_R_01','D476_LOCAL_FIRST_R_1\n','D476_LOCAL_FIRST_R_1\r','D476_LOCAL_FIRST_R_1\u2028','D476_LOCAL_FIRST_R_1_PRIVATE','D476_LOCAL_FIRST_R_1'.repeat(10)])assert.equal(parse(v),null);assert.equal(traps,0)
})
function cppFirst705(){const source=read('tests/fixtures/desktop-476/local-acceptance.cpp'),pick=name=>{const start=source.indexOf(`${name}(Desktop& h,wchar_t const* id) noexcept {`);assert.ok(start>=0,'actual native fixed helper '+name);return source.slice(start+source.slice(start).indexOf('{')+1,source.indexOf('\n}',start))};const lower=s=>s.replace(/static wchar_t const\* known\[\]=\{/g,'const known=[').replace(/\};/g,'];').replace(/\bL"/g,'"').replace(/std::wstring\(id\)/g,'allocate705(id)').replace(/std::wcscmp\(id,name\)==0/g,'compare705(id,name)===0').replace(/for\(auto name:known\)/g,'for(const name of known)').replace(/bool accepted=/g,'let accepted=').replace(/catch\(\.\.\.\)/g,'catch');return{source,observe:lower(pick('D476LocalAcceptance::observe')),forward:lower(pick('D476LocalAcceptance::rendererSite'))}}
test('705 actual native first-site helpers are single-shot closed and preserve literal FAIL emissions',()=>{
 const c=cppFirst705();for(const fault of [false,true]){const calls=[],s={firstNative:false,firstRenderer:false,allocate705:id=>String(id),compare705:(id,name)=>id===name?0:1,emit(_,id){if(fault&&id!=='D476_LOCAL_FAIL')throw Error('OWNED_SINK');calls.push(id)}};vm.runInNewContext('globalThis.observe=(h,id)=>{'+c.observe+'};globalThis.forward=(h,id)=>{'+c.forward+'}',s);s.observe({},'D476_LOCAL_FIRST_W_1');s.observe({},'D476_LOCAL_FIRST_W_2');s.emit({},'D476_LOCAL_FAIL');assert.equal(calls.filter(x=>x==='D476_LOCAL_FAIL').length,1);assert.equal(calls.filter(x=>x.startsWith('D476_LOCAL_FIRST_W_')).length,fault?0:1);assert.equal(s.forward({},'D476_LOCAL_FIRST_R_1_PRIVATE'),false);assert.equal(s.forward({},'D476_LOCAL_FIRST_W_1'),false);assert.equal(s.forward({},'D476_LOCAL_FIRST_R_2'),true);assert.equal(s.forward({},'D476_LOCAL_FIRST_R_3'),true);assert.equal(calls.filter(x=>x.startsWith('D476_LOCAL_FIRST_R_')).length,fault?0:1)}
 assert.equal([...c.source.matchAll(/emit\(h,L"D476_LOCAL_FAIL"\)/g)].length,13);for(let n=1;n<=13;n++)assert.ok(c.source.includes(`observe(h,L"D476_LOCAL_FIRST_W_${n}"),emit(h,L"D476_LOCAL_FAIL")`));assert.match(c.source,/if\(rendererSite\(h,id\.c_str\(\)\)\)return;/)
 const swift=read('tests/fixtures/desktop-476/local-acceptance.swift');assert.equal([...swift.matchAll(/emit\(h,"D476_LOCAL_FAIL"\)/g)].length,8);for(let n=1;n<=8;n++)assert.ok(swift.includes(`observe(h,"D476_LOCAL_FIRST_M_${n}");emit(h,"D476_LOCAL_FAIL")`));assert.match(swift,/if rendererSite\(h,id\)\{return\}/);assert.match(swift,/try\? JSONSerialization.data/);assert.match(swift,/task.send\(\.string\(text\)\)\{_ in\}/);assert.doesNotMatch(swift,/D476_LOCAL_FIRST_.*\\\(/)
})
test('705 actual authenticated receiver keeps the first closed site and does not manufacture FAIL or receipts',()=>{
 const source=localMeta705(),ast=ts705.createSourceFile('metadata.ts',source,ts705.ScriptTarget.Latest,true),nodes=[];function visit(n){if(ts705.isCallExpression(n)&&ts705.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='on'&&n.arguments[0]?.text==='message'&&n.arguments[1]?.getText(ast).includes('parseLocalFirstSite705(frame.id)'))nodes.push(n.arguments[1]);ts705.forEachChild(n,visit)}visit(ast);assert.equal(nodes.length,1);const code=ts705.transpileModule('globalThis.receive='+nodes[0].getText(ast),{compilerOptions:{target:ts705.ScriptTarget.ES2022}}).outputText;const parse=firstParser705();for(const platform of ['win32','darwin']){let fails=0;const s={process:{platform},authenticated:true,parseLocalFocus705:focusParser705(false),localFocusResult:null,parseLocalFirstSite705:parse,localFirstSite:{R:null,W:null,M:null},required:[],receipts:new Set(),fail(){fails++}};vm.runInNewContext(code,s);const send=f=>s.receive(JSON.stringify(f));send({type:'system.ping',id:'D476_LOCAL_FIRST_R_1',extra:'OWNED_PRIVATE'});assert.equal(s.localFirstSite.R,null);s.authenticated=false;send({type:'system.ping',id:'D476_LOCAL_FIRST_R_1'});assert.equal(s.localFirstSite.R,null);s.authenticated=true;send({type:'wrong',id:'D476_LOCAL_FIRST_R_1'});assert.equal(s.localFirstSite.R,null);send({type:'system.ping',id:'D476_LOCAL_FIRST_R_2'});send({type:'system.ping',id:'D476_LOCAL_FIRST_R_3'});assert.equal(s.localFirstSite.R,2);send({type:'system.ping',id:'D476_LOCAL_FIRST_R_1',extra:'OWNED_PRIVATE'});assert.equal(s.localFirstSite.R,2);send({type:'system.ping',id:'D476_LOCAL_FIRST_'+(platform==='win32'?'M':'W')+'_1'});assert.equal(s.localFirstSite[platform==='win32'?'M':'W'],null);assert.equal(fails,0);assert.equal(s.receipts.size,0);send({type:'system.ping',id:'D476_LOCAL_FAIL'});assert.equal(fails,1);assert.deepEqual(Object.keys(s.localFirstSite).sort(),['M','R','W'])}
})

test('705 actual Swift first-site guards independently latch native and exact renderer origins',()=>{
 const source=read('tests/fixtures/desktop-476/local-acceptance.swift'),a=/static func observe\(_ h:NativeDesktop,_ id:String\)\{([^\n]+)\}/.exec(source),b=/static func rendererSite\(_ h:NativeDesktop,_ id:String\)->Bool\{([^\n]+)\}/.exec(source);assert.ok(a&&b)
 const native=a[1].replace(/guard !firstNative,(\[.*?\])\.contains\(id\) else\{return\}/,'if(firstNative||!$1.includes(id)){return}'),renderer=b[1].replace(/guard (\[.*?\])\.contains\(id\) else\{return false\}/,'if(!$1.includes(id)){return false}').replace('if !firstRenderer{','if(!firstRenderer){')
 assert.doesNotMatch(native+renderer,/guard |\.contains\(|if !/);const rows=[],scope={firstNative:false,firstRenderer:false,observation(_,id){rows.push(id)}};vm.runInNewContext('globalThis.native=(h,id)=>{'+native+'};globalThis.renderer=(h,id)=>{'+renderer+'}',scope)
 scope.native({},'D476_LOCAL_FIRST_M_9');assert.equal(scope.firstNative,false);scope.native({},'D476_LOCAL_FIRST_M_4');scope.native({},'D476_LOCAL_FIRST_M_1');assert.equal(scope.renderer({},'D476_LOCAL_FIRST_R_1_PRIVATE'),false);assert.equal(scope.renderer({},'D476_LOCAL_FIRST_W_1'),false);assert.equal(scope.renderer({},'D476_LOCAL_FIRST_R_2'),true);assert.equal(scope.renderer({},'D476_LOCAL_FIRST_R_3'),true);assert.deepEqual(rows,['D476_LOCAL_FIRST_M_4','D476_LOCAL_FIRST_R_2'])
})

// Source-derived allocation boundary model; never a C++ compiler/native exception run.
function noAllocHelpers705(){const c=cppFirst705(),calls=[],s={firstNative:false,firstRenderer:false,allocate705(){throw Error('OWNED_BAD_ALLOC')},compare705:(id,name)=>id===name?0:1,emit(_,id){calls.push(id)}};vm.runInNewContext('globalThis.observe=(h,id)=>{'+c.observe+'};globalThis.forward=(h,id)=>{'+c.forward+'}',s);return{c,calls,s}}
test('705 actual diagnostic observe comparison cannot allocate before noexcept sink or suppress original FAIL',()=>{
 const {c,calls,s}=noAllocHelpers705();assert.match(c.source,/observe\(Desktop& h,wchar_t const\* id\) noexcept/);try{s.observe({},'D476_LOCAL_FIRST_W_1');s.emit({},'D476_LOCAL_FAIL')}catch{}
 assert.equal(calls.filter(id=>id==='D476_LOCAL_FAIL').length,1,'comparison allocation must not suppress original FAIL');assert.deepEqual(calls,['D476_LOCAL_FIRST_W_1','D476_LOCAL_FAIL']);
});
test('705 actual rendererSite comparison cannot allocate for ordinary or closed diagnostic ping',()=>{
 const {c,calls,s}=noAllocHelpers705();assert.match(c.source,/rendererSite\(Desktop& h,wchar_t const\* id\) noexcept/);assert.equal(s.forward({},'D476_LOCAL_KEY'),false);assert.equal(s.forward({},'D476_LOCAL_FIRST_R_1_PRIVATE'),false);assert.equal(s.forward({},'D476_LOCAL_FIRST_R_2'),true);assert.equal(s.forward({},'D476_LOCAL_FIRST_R_3'),true);assert.deepEqual(calls,['D476_LOCAL_FIRST_R_2']);
});

function focusParser705(required=true){const source=localMeta705(),ast=ts705.createSourceFile('metadata.ts',source,ts705.ScriptTarget.Latest,true),fn=ast.statements.find(n=>ts705.isFunctionDeclaration(n)&&n.name?.text==='parseLocalFocus705');if(!fn&&!required)return()=>null;assert.ok(fn,'actual closed focus parser');const code=ts705.transpileModule(fn.getText(ast),{compilerOptions:{target:ts705.ScriptTarget.ES2022}}).outputText,scope={};vm.runInNewContext(code+';globalThis.parse=parseLocalFocus705',scope);return scope.parse}
function focusBranch705(source){const begin=source.indexOf(' SetForegroundWindow(h.window);'),end=source.indexOf('GUITHREADINFO info{};',begin);assert.ok(begin>=0&&end>begin);const body=source.slice(begin,end).replace(/h\.controller->/g,'h.controller.').replace(/COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC/g,'0').replace(/const auto /g,'const ').replace(/const bool /g,'const ').replace(/\bL"/g,'"').replace(/catch\(\.\.\.\)/g,'catch');return vm.compileFunction(body+';return true',['h','SetForegroundWindow','FAILED','GetForegroundWindow','observe','emit'])}
function runFocus705(source,{status=0,foreground=1,fault=false}={}){const events=[],sent=[],sites=[];let foregroundReads=0,moveCalls=0,inputEffects=0;const fn=focusBranch705(source),accepted=fn({window:1,controller:{MoveFocus(){events.push('MoveFocus');moveCalls++;return status}}},()=>events.push('SetForegroundWindow'),v=>v<0,()=>{events.push('GetForegroundWindow');foregroundReads++;return foreground},(_,id)=>{events.push('observe');sites.push(id)},(_,id)=>{events.push(id);if(id.startsWith('D476_LOCAL_FOCUS_')&&fault==='throw')throw Error('OWNED_PRIVATE');sent.push(id);return fault!=='false'});if(accepted)inputEffects++;return{accepted:!!accepted,events,sent,sites,foregroundReads,moveCalls,inputEffects}}
test('705 actual W8 focus split preserves short circuit and unchanged rejection while recording finite cause',()=>{
 const source=read('tests/fixtures/desktop-476/local-acceptance.cpp')
 for(const actual of[source,source.replace(/\r?\n/g,'\r\n')])for(const status of[-1,-2147467259,0,1])for(const foreground of[0,1,99]){
  const result=runFocus705(actual,{status,foreground}),failed=status<0||foreground!==1;assert.equal(result.accepted,!failed);assert.equal(result.moveCalls,1);assert.equal(result.foregroundReads,status<0?0:1);assert.equal(result.events[0],'SetForegroundWindow');assert.equal(result.events[1],'MoveFocus');assert.equal(result.inputEffects,failed?0:1);assert.deepEqual(result.sites,failed?['D476_LOCAL_FIRST_W_8']:[]);assert.equal(result.sent.filter(x=>x==='D476_LOCAL_FAIL').length,failed?1:0)
  assert.deepEqual(result.sent.filter(x=>x.startsWith('D476_LOCAL_FOCUS_')),failed?[status<0?'D476_LOCAL_FOCUS_MOVE_FOCUS_FAILED':'D476_LOCAL_FOCUS_FOREGROUND_MISMATCH']:[])
 }
})
test('705 actual W8 diagnostic false or throw cannot change primary failure or create input',()=>{
 const source=read('tests/fixtures/desktop-476/local-acceptance.cpp');for(const fault of['false','throw'])for(const status of[-1,0]){const actual=runFocus705(source,{status,foreground:99,fault});assert.equal(actual.accepted,false);assert.deepEqual(actual.sites,['D476_LOCAL_FIRST_W_8']);assert.equal(actual.sent.filter(x=>x==='D476_LOCAL_FAIL').length,1);assert.equal(actual.inputEffects,0);assert.equal(actual.moveCalls,1);assert.equal(actual.foregroundReads,status<0?0:1)}
 const a=source.indexOf(' SetForegroundWindow(h.window);'),b=source.indexOf('GUITHREADINFO info{};',a),branch=source.slice(a,b);assert.doesNotMatch(branch,/std::wstring|new |to_wstring|sleep|SetFocus|SetActiveWindow|\.activate/)
})
test('705 actual focus parser admits two exact enums only without coercion or reflection',()=>{
 const parse=focusParser705();assert.equal(parse('D476_LOCAL_FOCUS_MOVE_FOCUS_FAILED'),'MOVE_FOCUS_FAILED');assert.equal(parse('D476_LOCAL_FOCUS_FOREGROUND_MISMATCH'),'FOREGROUND_MISMATCH');let reads=0;const trap=Object.defineProperty({},'toString',{get(){reads++;throw Error('OWNED_PRIVATE')}}),proxy=new Proxy({},{get(){reads++;throw 1}}),revoked=Proxy.revocable({},{});revoked.revoke()
 for(const value of[undefined,null,1,[],trap,proxy,revoked.proxy,'','D476_LOCAL_FIRST_W_8','D476_LOCAL_FOCUS_UNKNOWN','D476_LOCAL_FOCUS_MOVE_FOCUS_FAILED\n','D476_LOCAL_FOCUS_MOVE_FOCUS_FAILED\r','D476_LOCAL_FOCUS_MOVE_FOCUS_FAILED_PRIVATE','D476_LOCAL_FOCUS_FOREGROUND_MISMATCH\u2028','D476_LOCAL_FOCUS_FOREGROUND_MISMATCH'.repeat(10)])assert.equal(parse(value),null);assert.equal(reads,0)
})
test('705 actual authenticated receiver keeps first Windows focus enum separate from W8 failure and receipts',()=>{
 const source=localMeta705(),ast=ts705.createSourceFile('metadata.ts',source,ts705.ScriptTarget.Latest,true),nodes=[];function visit(n){if(ts705.isCallExpression(n)&&ts705.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='on'&&n.arguments[0]?.text==='message'&&n.arguments[1]?.getText(ast).includes('parseLocalFirstSite705(frame.id)'))nodes.push(n.arguments[1]);ts705.forEachChild(n,visit)}visit(ast);assert.equal(nodes.length,1);const code=ts705.transpileModule('globalThis.receive='+nodes[0].getText(ast),{compilerOptions:{target:ts705.ScriptTarget.ES2022}}).outputText
 for(const platform of['win32','darwin','linux']){let failCount=0;const s={process:{platform},authenticated:true,parseLocalFocus705:focusParser705(),parseLocalFirstSite705:firstParser705(),localFocusResult:null,localFirstSite:{R:null,W:null,M:null},required:[],receipts:new Set(),fail(){failCount++}};vm.runInNewContext(code,s);const send=f=>s.receive(JSON.stringify(f));for(const frame of[{type:'wrong',id:'D476_LOCAL_FOCUS_MOVE_FOCUS_FAILED'},{type:'system.ping',id:'D476_LOCAL_FOCUS_UNKNOWN'},{type:'system.ping',id:'D476_LOCAL_FOCUS_MOVE_FOCUS_FAILED',extra:'OWNED_PRIVATE'}])send(frame);assert.equal(s.localFocusResult,null);s.authenticated=false;send({type:'system.ping',id:'D476_LOCAL_FOCUS_MOVE_FOCUS_FAILED'});assert.equal(s.localFocusResult,null);s.authenticated=true;send({type:'system.ping',id:'D476_LOCAL_FOCUS_MOVE_FOCUS_FAILED'});send({type:'system.ping',id:'D476_LOCAL_FOCUS_FOREGROUND_MISMATCH'});assert.equal(s.localFocusResult,platform==='win32'?'MOVE_FOCUS_FAILED':null);assert.equal(failCount,0);assert.equal(s.receipts.size,0);send({type:'system.ping',id:'D476_LOCAL_FIRST_W_8'});assert.equal(s.localFirstSite.W,platform==='win32'?8:null);send({type:'system.ping',id:'D476_LOCAL_FAIL'});assert.equal(failCount,1);assert.equal(s.localFocusResult,platform==='win32'?'MOVE_FOCUS_FAILED':null)}
 const text=localMeta705();assert.match(text,/childExited:settled,localFirstSite,localFocusResult/)
})
