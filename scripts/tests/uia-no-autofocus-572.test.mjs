// CPU/source-executed contracts only. Hosted SDK compilation/provider oracles are mandatory.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const ps=readFileSync(path.join(root,'companion/src/host-use/win/scripts/computer-uia-act.ps1'),'utf8');
const selection=readFileSync(path.join(root,'companion/src/host-use/win/scripts/computer-uia-select.ps1'),'utf8');
const cpp=readFileSync(path.join(root,'companion/src/host-use/win/native/computer-uia-no-focus.cpp'),'utf8');
function body(source,anchor){const start=source.indexOf(anchor);assert.ok(start>=0,anchor);const brace=source.indexOf('{',start);let depth=1,i=brace+1;for(;depth&&i<source.length;i++){if(source[i]==='{')depth++;if(source[i]==='}')depth--;}assert.equal(depth,0);return source.slice(brace+1,i-1);}
function completion(){
  // Execute every actual PS switch body after only finite syntax translation.
  const source=body(ps,'function Complete-NoFocusAction');
  const cases=[...source.matchAll(/^\s*(\d+|default)\s*\{([^{}]*(?:\$\{pname\}[^{}]*)?[^{}]*)\}/gm)];
  assert.equal(cases.length,9);
  let js='switch(status){';
  for(const [,key,action] of cases){
    let a=action.replaceAll('[void]$tried.Add(', 'tried.push(').replaceAll('"${pname}:ok"','`${pname}:ok`').replaceAll('"${pname}:unsupported"','`${pname}:unsupported`');
    a=a.replace(/Fail "([A-Z_]+)" "([^"\r\n]*)" (\d+)/g,(_,prefix,detail,exit)=>`fail(${JSON.stringify(prefix)},${exit})`)
      .replaceAll('$true','true').replaceAll('$false','false');
    assert.ok(!a.replaceAll('${pname}','pname').includes('$'),a);js+=(key==='default'?'default:':`case ${key}:`)+a+';break;';
  }
  js+='}';
  return new vm.Script(`(function(status,pname,tried,fail){${js}})`).runInNewContext();
}
const complete=completion();
for(const status of [2,3,4,5,6,7,8,-1])test(`actual terminal PS status${status} cannot advance auto`,()=>{
  const calls=[],tried=[];
  const fail=(prefix,exit)=>{calls.push({prefix,exit});throw new Error('terminal');};
  assert.throws(()=>{if(!complete(status,'invoke',tried,fail))calls.push('next-action');},/terminal/);
  assert.equal(calls.length,1);assert.equal(tried.length,0);
  assert.equal(calls[0].exit,({2:11,3:3,4:4,5:5,7:6})[status]??7);
});
test('actual unsupported alone returns false; success records same selected action',()=>{
  const fail=()=>assert.fail('unexpected failure'),a=[],b=[];
  assert.equal(complete(1,'invoke',a,fail),false);assert.deepEqual(a,['invoke:unsupported']);
  assert.equal(complete(0,'setvalue',b,fail),true);assert.deepEqual(b,['setvalue:ok']);
});
test('actual Try-Pattern catch cannot turn a native terminal exception into next pattern',()=>{
  const b=body(ps,'function Try-Pattern');
  assert.match(b,/try \{ \$status = & \$act \$null \}\s*catch \{ Fail "UIA_TERMINAL" "UIA_METHOD_FAILED" 7 \}\s*return Complete-NoFocusAction \$status \$pname/);
  assert.doesNotMatch(ps,/\(\[System\.Windows\.Automation\.(?:Invoke|Value|SelectionItem|Toggle|Scroll)Pattern\]\$o\)\.(?:Invoke|SetValue|Select|Toggle|Scroll)\(/);
  for(const name of ['invoke','setvalue','select','toggle','scroll'])assert.ok(ps.includes(`Invoke-NoFocusAction '${name}'`));
});
function boundary(){
  let b=body(cpp,'int32_t boundary(');
  b=b.replaceAll('!r.stop.empty()','r.stop.length !== 0').replaceAll('r.stop.c_str()','r.stop')
   .replaceAll('DWORD attributes=','let attributes=').replaceAll('DWORD error=','let error=')
   .replaceAll('DWORD pid=0;','let pid=0;').replace('GetWindowThreadProcessId(r.root,&pid)','getPid(r.root, p=>{pid=p})');
  return new vm.Script(`(function(r){${b}})`);
}
for(const [name,options,want] of [
 ['stop exists',{stop:'stop',attributes:0},2],['stop access denied',{stop:'stop',error:5},2],
 ['stop missing file',{stop:'stop',error:2},0],['stop missing parent',{stop:'stop',error:3},0],
 ['root gone',{window:false},3],['root pid query failed',{pidQuery:0},3],['root pid replaced',{pid:22},5],['distinct selected pid allowed',{selectedPid:99},0],
])test(`actual native boundary: ${name}`,()=>{
  const o={stop:'',attributes:-1,error:2,window:true,pidQuery:1,pid:11,...options};
  const context={OK:0,STOPPED:2,WINDOW_GONE:3,MISMATCH:5,INVALID_FILE_ATTRIBUTES:-1,ERROR_FILE_NOT_FOUND:2,ERROR_PATH_NOT_FOUND:3,
    GetFileAttributesW:()=>o.attributes,GetLastError:()=>o.error,IsWindow:()=>o.window,getPid:(_,set)=>{set(o.pid);return o.pidQuery;}};
  const f=boundary().runInNewContext(context);assert.equal(f({root:1,rootPid:11,selectedPid:o.selectedPid??11,stop:o.stop}),want);
});
test('SDK same scoped client must configure false and read back before resolving action elements',()=>{
 const b=body(cpp,'int32_t execute(');
 const property=b.indexOf('client->put_AutoSetFocus(FALSE)'),read=b.indexOf('client->get_AutoSetFocus(&autoFocus)'),resolve=b.indexOf('client->ElementFromHandle');
 assert.ok(property>0&&read>property&&resolve>read);
 assert.ok(b.includes('if(FAILED(client->put_AutoSetFocus(FALSE))||FAILED(client->get_AutoSetFocus(&autoFocus))||autoFocus)return CLIENT_UNAVAILABLE;'));
 assert.match(b,/client->get_ControlViewCondition/);assert.match(b,/client->CreateTreeWalker\(condition.Get\(\),&walker\)/);assert.doesNotMatch(b,/get_ControlViewWalker/);assert.match(b,/runtimeEquals\(current.el.Get\(\),r.runtime\)\)return perform\(r,root.Get\(\),current.el.Get\(\)\)/);
 assert.doesNotMatch(cpp,/\b(?:SetFocus|SetForegroundWindow|SwitchToThisWindow|AttachThreadInput|SendInput)\s*\(/);
});
test('SDK typed patterns recheck identity immediately before each action including each scroll',()=>{
 const b=body(cpp,'int32_t perform(');assert.equal((b.match(/status=ready\(\)/g)||[]).length,5);
 for(const type of ['Invoke','Value','SelectionItem','Toggle','Scroll'])assert.ok(b.includes(`IUIAutomation${type}Pattern`));
 assert.match(cpp,/pid\)!=r.selectedPid/);assert.match(cpp,/type!=r.controlType/);assert.match(cpp,/area>150000\.0/);assert.match(cpp,/area\/windowArea>0\.3/);
 assert.match(cpp,/runtimeCount<1\|\|runtimeCount>64/);assert.match(cpp,/SafeArrayGetDim\(id.p\)!=1/);assert.match(cpp,/type!=VT_I4/);
});
test('actual loader is absolute scoped import with restricted dependency search and fixed errors',()=>{
 assert.match(ps,/IsPathRooted\(\$NoFocusLibrary\)/);assert.match(ps,/FileAttributes\]::ReparsePoint/);
 assert.match(ps,/DefaultDllImportSearchPaths\(DllImportSearchPath.System32\)/);
 assert.match(ps,/DllImport\(@"\$literal", EntryPoint="CUiAction", ExactSpelling=true/);
 assert.match(ps,/SizeParamIndex=5/);assert.match(ps,/catch \{ Fail "UIA_TERMINAL" "UIA_PATTERN_UNAVAILABLE" 6 \}/);
 assert.ok(Buffer.from(ps).subarray(0,3).equals(Buffer.from([239,187,191])));
});
test('MTA thread/COM scope has no DllMain work and worker joins within original process',()=>{
 assert.match(cpp,/CoInitializeEx\(nullptr,COINIT_MULTITHREADED\)/);assert.match(cpp,/if\(SUCCEEDED\(hr\)\)CoUninitialize/);
 assert.match(cpp,/std::thread worker/);assert.match(cpp,/worker.join\(\);return result/);
 assert.doesNotMatch(cpp,/\b(?:CreateProcess|DllMain|TerminateThread)\s*\(/);
});

for(const [name,put,get,value,want] of [['put fails',-1,0,false,7],['get fails',0,-1,false,7],['readback true',0,0,true,7],['false verified',0,0,false,0]])test(`actual native client property guard: ${name}`,()=>{
 const b=body(cpp,'int32_t execute(');const start=b.indexOf('BOOL autoFocus=TRUE;'),end=b.indexOf('  int32_t status=boundary(r);');assert.ok(start>=0&&end>start);
 const snippet=b.slice(start,end).replace('BOOL autoFocus=TRUE;','let autoFocus=true;').replaceAll('client->','client.').replaceAll('FALSE','false').replace('client.get_AutoSetFocus(&autoFocus)','client.get_AutoSetFocus(v=>{autoFocus=v})');
 const calls=[];const f=new vm.Script(`(function(){${snippet}calls.push('resolve');return 0;})`).runInNewContext({CLIENT_UNAVAILABLE:7,FAILED:x=>x<0,calls,client:{put_AutoSetFocus:v=>{calls.push(['put',v]);return put;},get_AutoSetFocus:set=>{calls.push('get');set(value);return get;}}});
 assert.equal(f(),want);assert.equal(calls.includes('resolve'),want===0);assert.deepEqual(calls[0],['put',false]);
});

function freshIdentityGuard572() {
 const line=selection.split(/\r?\n/).find(l=>l.startsWith('if (')&&l.includes('$selectedAutomationId')&&l.includes('$selectedTypeName'));assert.ok(line);
 let expression=line.slice(4,-3);
 if(expression.includes(' -ne ')) {
  // WMF5.1 -ne is invariant-culture case-insensitive; ASCII controls below
  // exercise that documented rule, rather than translating it to JS !==.
  assert.equal(expression,'$selectedAutomationId -ne $hit.automationId -or $selectedTypeName -ne $hit.controlType');
  return (aid,type,hit)=>aid.toLowerCase()!==String(hit.automationId??'').toLowerCase()||type.toLowerCase()!==String(hit.controlType??'').toLowerCase();
 }
 const ordinal=/\[string\]::Equals\(\$(selectedAutomationId|selectedTypeName), \[string\]\$hit\.(automationId|controlType), \[StringComparison\]::Ordinal\)/g;
 assert.equal([...expression.matchAll(ordinal)].length,2);
 expression=expression.replace(ordinal,(_,left,right)=>`${left} === String(hit.${right}??'')`)
  .replaceAll('-not ','!').replaceAll(' -or ',' || ');
 // Parentheses preserve each .NET boolean call under -not.
 expression=expression.replace(/!((?:selectedAutomationId|selectedTypeName) === String\(hit\.(?:automationId|controlType)\?\?''\))/g,'!($1)');
 assert.doesNotMatch(expression,/\$|\[string\]|-or|-not/);
 return new vm.Script(`(function(selectedAutomationId,selectedTypeName,hit){return ${expression};})`).runInNewContext();
}
test('fresh identity cannot rebind an already verified hit to a renamed/retyped element',()=>{
 const f=freshIdentityGuard572();
 for(const [aid,type,want] of [['A','Button',false],['B','Button',true],['A','Edit',true]])assert.equal(f(aid,type,{automationId:'A',controlType:'Button'}),want);
});
test('fresh identity comparison is ordinal even for case-only AutomationId and type changes',()=>{
 const f=freshIdentityGuard572();
 assert.equal(f('a','Button',{automationId:'A',controlType:'Button'}),true);
 assert.equal(f('A','button',{automationId:'A',controlType:'Button'}),true);
 assert.equal(f('提交','Button',{automationId:'提交',controlType:'Button'}),false);
 assert.equal(f('','Button',{automationId:'',controlType:'Button'}),false);
});
test('native count bound applies only to existing scroll mode',()=>{assert.ok(cpp.includes('(mode==5&&(count<1||count>50))'));});

test('control type id and name use one immutable selected ControlType value',()=>{assert.match(selection,/\$selectedControlType = \$el.Current.ControlType\r?\n\s*\[int\]\$selectedType = \$selectedControlType.Id/);assert.ok(selection.includes('$selectedTypeName = $selectedControlType.ProgrammaticName'));assert.doesNotMatch(selection,/\$selectedTypeName = \$el.Current.ControlType/);});

test('actual adapter argv binds the fixed DLL and preserves Unicode, values and final StopFile',async()=>{
 const {createRequire}=await import('node:module');
 const require=createRequire(path.join(root,'companion/package.json'));
 const ts=require('typescript');
 const file=path.join(root,'companion/src/computer/win-adapters.ts'),text=readFileSync(file,'utf8');
 const tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
 const declaration=tree.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='PsInputInjector');assert.ok(declaration);
 const parser=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='parseUiaSelection572');assert.ok(parser);
 const whole=parser.getText(tree)+'\n'+declaration.getText(tree).replace('export class','class')+';PsInputInjector;';
 const fixed='C:\\first-party space\\computer-uia-no-focus.dll';
 const scope={Buffer,performance:{now:()=>0},runPs:()=>assert.fail('must not execute runPs'),resolveWinScript:n=>'C:\\scripts\\'+n,resolveComputerUiaNoFocusDll:()=>fixed};
 const Class=new vm.Script(ts.transpileModule(whole,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext(scope);
 let called=0;
 const injector=new Class(async(script,args)=>{called++;const a=Array.from(args);
  if(script.endsWith('computer-uia-select.ps1')) return JSON.stringify({schema:1,hwnd:40,rootPid:1,selectedPid:1,runtime:[42],controlTypeId:50000,controlType:'Edit',automationId:'owned',name:'提交',x:1,y:1,bbox:{x:0,y:0,w:2,h:2},patterns:[{mode:'setvalue',state:'ready'}]});
  assert.ok(script.endsWith('computer-uia-act.ps1'));
  assert.equal(a.filter(v=>v==='-NoFocusLibrary').length,1);assert.equal(a[a.indexOf('-NoFocusLibrary')+1],fixed);
  assert.equal(a[a.indexOf('-Name')+1],'提交 "\n$()');assert.equal(a[a.indexOf('-Value')+1],'原始值\n/secret-not-a-command');
  assert.deepEqual(a.slice(-2),['-StopFile','C:\\owned\\stop.flag']);return JSON.stringify({ok:true,mode:'setvalue'});
 },'C:\\owned\\stop.flag');
 const result=await injector.invokeUia(40,'提交 "\n$()','setvalue',{value:'原始值\n/secret-not-a-command',NoFocusLibrary:'C:\\untrusted\\other.dll'});
 assert.equal(result.ok,true);assert.equal(called,2);
});

// Execute the actual native DFS control flow over inert tree-walker objects.
// This is a finite C++-syntax projection, not a compiled SDK/provider claim.
function nativeWalkProjection(source, tree, target, nodes, depth) {
 let b=body(body(source,'int32_t execute('),'while(!stack.empty())');
 b=b.replace('Frame current=std::move(stack.back());stack.pop_back();','const current=stack.pop();')
  .replaceAll('current.el.Get()','current.el').replaceAll('root.Get()','root')
  .replace('ComPtr<IUIAutomationElement> child;','let child;')
  .replace('HRESULT hr=walker->GetFirstChildElement(current.el,&child);','let hr=walker.GetFirstChildElement(current.el,v=>{child=v});')
  .replace('ComPtr<IUIAutomationElement> next;','let next;')
  .replace('walker->GetNextSiblingElement(child.Get(),&next)','walker.GetNextSiblingElement(child,v=>{next=v})')
  .replaceAll('stack.size()','stack.length').replaceAll('static_cast<size_t>(r.nodes)','r.nodes')
  .replace('stack.push_back({child,current.depth+1});','stack.push({el:child,depth:current.depth+1});')
  .replaceAll('std::move(next)','next').replaceAll('stack.pop_front();','stack.shift();');
 assert.doesNotMatch(b,/\b(?:ComPtr|HRESULT|Frame|std|static_cast)\b|->|\.Get\(/);
 const seen=[], sibling=new Map();
 function index(node){node.children.forEach((child,i)=>{sibling.set(child,node.children[i+1]??null);index(child)})}index(tree);
 const context={r:{runtime:target,nodes,depth},root:tree,stack:[{el:tree,depth:0}],visited:0,status:0,OK:0,ELEMENT_GONE:4,
  FAILED:n=>n<0,boundary:()=>0,runtimeEquals:(el,id)=>{seen.push(el.id);return el.id===id},perform:(_r,_root,el)=>el.id,
  walker:{GetFirstChildElement:(el,set)=>{set(el.children[0]??null);return 0},GetNextSiblingElement:(el,set)=>{set(sibling.get(el)??null);return 0}}};
 const result=new vm.Script(`(function(){while(stack.length){${b}}return ELEMENT_GONE;})()`).runInNewContext(context,{timeout:3000});
 return {result,seen};
}
const leaf572=id=>({id,children:[]});
function managedVisitPrefix572(tree,nodes,depth){const stack=[{el:tree,depth:0}],seen=[];while(stack.length){const cur=stack.pop();if(cur.depth>=depth)continue;if(seen.length===nodes)break;seen.push(cur.el.id);for(const child of cur.el.children)stack.push({el:child,depth:cur.depth+1})}return seen;}
for(const [width,budget] of [[5,4],[4001,4000]])test(`actual native walk retains the last eligible sibling on width ${width}`,()=>{
 const tree={id:100000,children:Array.from({length:width},(_,i)=>leaf572(i+1))};
 const result=nativeWalkProjection(cpp,tree,width,budget,4);
 assert.equal(result.result,width);assert.deepEqual(result.seen,[100000,width]);
});
test('actual native walk preserves the original eligible visit prefix across wide deep and mixed trees',()=>{
 const trees=[{id:100000,children:Array.from({length:17},(_,i)=>({id:i+1,children:Array.from({length:i%4+1},(_,j)=>leaf572(1000+i*10+j))}))},
  {id:200000,children:[{id:200001,children:[{id:200002,children:Array.from({length:20},(_,i)=>leaf572(200010+i))}]},...Array.from({length:12},(_,i)=>leaf572(300000+i))]}];
 for(const tree of trees)for(const nodes of [1,2,3,5,9,20,64])for(const depth of [1,2,3,4]){
  const expected=managedVisitPrefix572(tree,nodes,depth),actual=nativeWalkProjection(cpp,tree,-1,nodes,depth);
  assert.deepEqual(actual.seen,expected,`nodes=${nodes} depth=${depth}`);assert.equal(actual.result,4);
  for(const target of expected){assert.equal(nativeWalkProjection(cpp,tree,target,nodes,depth).result,target)}
 }
});


test('all nine native modes register after original cases in one canonical file worker',async()=>{
 const {createRequire}=await import('node:module'),require=createRequire(path.join(root,'companion/package.json')),ts=require('typescript');
 const file=path.join(root,'companion/tests/helpers/uia-no-focus-native-572.ts'),text=readFileSync(file,'utf8'),tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
 const modes=tree.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(tree)==='modes572'));
 const fn=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='registerNoFocusNativeTests572');assert.ok(modes&&fn);
 const js=ts.transpileModule(modes.getText(tree)+'\n'+fn.getText(tree).replace('export function','function')+'\nregisterNoFocusNativeTests572();',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const registrations=[];new vm.Script(js).runInNewContext({process:{platform:'win32'},test:(name,options,callback)=>registrations.push({name,options,callback}),runMode572:()=>assert.fail('registration must not run native')});
 assert.equal(registrations.length,9);assert.equal(new Set(registrations.map(x=>x.name)).size,9);
 for(const row of registrations){assert.equal(row.options.skip,false);assert.equal(row.options.timeout,45000);assert.equal(typeof row.callback,'function')}
 const parent=readFileSync(path.join(root,'companion/tests/computer-uia-invoke-integration.test.ts'),'utf8');
 assert.equal((parent.match(/^registerNoFocusNativeTests572\(\)$/gm)||[]).length,1);
 assert.ok(parent.lastIndexOf('registerNoFocusNativeTests572()')>parent.lastIndexOf('test('));
 assert.ok(parent.includes('from "./helpers/uia-no-focus-native-572"'));
 assert.ok(!readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8').includes('.test-dist/tests/computer-uia-no-focus-native-572.test.js'));
 assert.ok(!file.endsWith('.test.ts'));
});

// This finite source projection checks the SDK BSTR ownership boundary, not a
// compiled COM call. The hosted SDK build and native value-mode test remain required.
function nativeValueBstr572(source, options={}) {
 const branch=body(body(source,'int32_t perform('),'else if(r.mode==2)');
 assert.match(source,/struct Text \{ BSTR p=nullptr; ~Text\(\)\{if\(p\)SysFreeString\(p\);\} \};/);
 let js=branch.replace('ComPtr<IUIAutomationValuePattern> p;','')
  .replace('pattern(el,UIA_ValuePatternId,p)','pattern()')
  .replace('Text value;','const value={p:null};owned=value;')
  .replace('SysAllocStringLen(r.value.data(),static_cast<UINT>(r.value.size()))','allocate(r.value)')
  .replaceAll('p->','p.').replace('r.value.c_str()','r.value');
 assert.doesNotMatch(js,/\b(?:ComPtr|Text|static_cast|UIA_ValuePatternId|SysAllocStringLen)\b|->/);
 const calls=[],opts={pattern:0,allocation:true,ready:0,hr:0,text:'提交😀',...options},allocated=new Set();
 const context={r:{value:opts.text},status:0,hr:-1,OK:0,METHOD_FAILED:6,owned:null,
  pattern:()=>{calls.push('pattern');return opts.pattern;},
  allocate:text=>{calls.push('allocate');if(!opts.allocation)return null;const token={text};allocated.add(token);return token;},
  ready:()=>{calls.push('ready');return opts.ready;},
  p:{SetValue:token=>{assert.ok(allocated.has(token),'SDK SetValue needs an allocated BSTR, never a const wchar_t pointer');calls.push('set');assert.equal(token.text,opts.text);return opts.hr;}},
  free:token=>{assert.ok(allocated.delete(token));calls.push('free');}};
 const run=new vm.Script(`(function(){try{${js}return hr<0?METHOD_FAILED:OK;}finally{if(owned&&owned.p)free(owned.p);}})`).runInNewContext(context);
 const result=run();assert.equal(allocated.size,0);return {result,calls};
}
test('SDK value mode uses length-bound BSTR and a final identity check without a pointer cast',()=>{
 const b=body(body(cpp,'int32_t perform('),'else if(r.mode==2)');
 assert.match(b,/Text value;value\.p=SysAllocStringLen\(r\.value\.data\(\),static_cast<UINT>\(r\.value\.size\(\)\)\);/);
 assert.match(b,/if\(!value\.p\)return METHOD_FAILED;\s*if\(\(status=ready\(\)\)!=OK\)return status;hr=p->SetValue\(value\.p\);/);
 assert.doesNotMatch(b,/const_cast|reinterpret_cast|SetValue\(r\.value/);
});
for(const text of ['', '提交😀', 'quote " line\n$()'])test(`actual BSTR branch retains UTF16 value ${JSON.stringify(text)}`,()=>{
 assert.deepEqual(nativeValueBstr572(cpp,{text}),{result:0,calls:['pattern','allocate','ready','set','free']});
});
for(const [name,options,result,calls] of [
 ['unsupported',{pattern:1},1,['pattern']],
 ['allocation failure',{allocation:false},6,['pattern','allocate']],
 ['late identity refusal',{ready:5},5,['pattern','allocate','ready','free']],
 ['method failure',{hr:-1},6,['pattern','allocate','ready','set','free']],
])test(`actual BSTR branch ${name} keeps refusal and scope cleanup`,()=>assert.deepEqual(nativeValueBstr572(cpp,options),{result,calls}));

// Execute only the actual SDK walker-construction boundary after finite syntax
// projection. This does not emulate COM internals or prove AutoSetFocus propagation.
function nativeWalkerFactory572(source, options={}) {
 const execute=body(source,'int32_t execute(');
 const start=execute.indexOf('  ComPtr<IUIAutomationCondition> condition;');
 const end=execute.indexOf('  struct Frame ');
 assert.ok(start>=0&&end>start,'same-client ControlView condition/factory boundary');
 let snippet=execute.slice(start,end)
  .replace('ComPtr<IUIAutomationCondition> condition;','let condition=null;')
  .replace('ComPtr<IUIAutomationTreeWalker> walker;','let walker=null;')
  .replaceAll('client->','client.')
  .replace('client.get_ControlViewCondition(&condition)','client.get_ControlViewCondition(v=>{condition=v})')
  .replace('client.CreateTreeWalker(condition.Get(),&walker)','client.CreateTreeWalker(condition,v=>{walker=v})');
 assert.doesNotMatch(snippet,/\bComPtr\b|->|\.Get\(|&(?:condition|walker)/);
 const calls=[],conditionToken={},walkerToken={};
 const o={conditionHr:0,condition:true,walkerHr:0,walker:true,...options};
 const run=new vm.Script(`(function(){${snippet}calls.push('walk');return 0;})`).runInNewContext({
  CLIENT_UNAVAILABLE:7,FAILED:hr=>hr<0,calls,
  client:{
   get_ControlViewCondition:set=>{calls.push('condition');set(o.condition?conditionToken:null);return o.conditionHr;},
   CreateTreeWalker:(condition,set)=>{assert.equal(condition,conditionToken,'factory must consume this same client condition');calls.push('factory');set(o.walker?walkerToken:null);return o.walkerHr;},
  },
 });
 return {result:run(),calls};
}
test('actual SDK walker constructor uses the same client ControlView condition once before DFS',()=>{
 assert.deepEqual(nativeWalkerFactory572(cpp),{result:0,calls:['condition','factory','walk']});
});
for(const [name,options,calls] of [
 ['condition HRESULT failure',{conditionHr:-1},['condition']],
 ['condition null',{condition:false},['condition']],
 ['factory HRESULT failure',{walkerHr:-1},['condition','factory']],
 ['factory null',{walker:false},['condition','factory']],
])test(`actual SDK walker constructor refuses ${name} before traversal`,()=>{
 assert.deepEqual(nativeWalkerFactory572(cpp,options),{result:7,calls});
});
test('walker constructor controls reject dropped refusal guards and a different condition',()=>{
 const conditionGuard='FAILED(client->get_ControlViewCondition(&condition))||!condition';
 const walkerGuard='FAILED(client->CreateTreeWalker(condition.Get(),&walker))||!walker';
 assert.ok(cpp.includes(conditionGuard)&&cpp.includes(walkerGuard));
 const noConditionNull=cpp.replace(conditionGuard,'FAILED(client->get_ControlViewCondition(&condition))');
 assert.throws(()=>nativeWalkerFactory572(noConditionNull,{condition:false}));
 const noWalkerNull=cpp.replace(walkerGuard,'FAILED(client->CreateTreeWalker(condition.Get(),&walker))');
 assert.notEqual(nativeWalkerFactory572(noWalkerNull,{walker:false}).result,7);
 const noConditionFailure=cpp.replace(conditionGuard,'(client->get_ControlViewCondition(&condition),!condition)');
 assert.notEqual(nativeWalkerFactory572(noConditionFailure,{conditionHr:-1}).result,7);
 const noWalkerFailure=cpp.replace(walkerGuard,'(client->CreateTreeWalker(condition.Get(),&walker),!walker)');
 assert.notEqual(nativeWalkerFactory572(noWalkerFailure,{walkerHr:-1}).result,7);
 const different=cpp.replace('condition.Get(),&walker','nullptr,&walker');
 assert.throws(()=>nativeWalkerFactory572(different));
});

test('clean pipeline selection preserves old whole discovery while standalone entry cannot act',()=>{
 const legacy=readFileSync(path.join(root,'companion/tests/fixtures/win/computer-uia-invoke-mixed-before572.ps1'),'utf8');
 const prefix=legacy.slice(legacy.indexOf('param('),legacy.indexOf('$script:noFocusReady = $false'));
 assert.equal(selection.slice(selection.indexOf('param('),selection.indexOf('param(')+prefix.length),prefix);
 assert.equal(selection.includes('[CU.NoFocus]::Act'),false);
 assert.equal(selection.includes('Try-Pattern'),false);
 assert.ok(selection.includes('runtime = @($selectedRuntime)'));
 assert.ok(selection.includes('patterns = @($patterns.ToArray())'));
 const entry=readFileSync(path.join(root,'companion/src/host-use/win/scripts/computer-uia-invoke.ps1'),'utf8');
 assert.match(entry,/UIA_TERMINAL:UIA_PATTERN_UNAVAILABLE/);
 assert.match(entry,/host_pipeline_required/);assert.match(entry,/exit 6\s*$/);
 assert.doesNotMatch(entry,/\b(?:Add-Type|Start-Process|Invoke-NoFocusAction|FromHandle)\b/);
 assert.doesNotMatch(ps,/\[System\.Windows\.Automation\.|Add-Type -AssemblyName UIAutomation/);
 assert.ok(Buffer.from(selection).subarray(0,3).equals(Buffer.from([239,187,191])));
});
function cleanTry572(state,status,throws=false){
 let b=body(ps,'function Try-Pattern');
 b=b.replace('[void]$tried.Add("$($pname):$state")',"tried.push(pname+':'+state)")
  .replace('return Complete-NoFocusAction $status $pname','return complete(status,pname,tried,fail)')
  .replace('try { $status = & $act $null }','let status; try { status = act(null) }')
  .replace('catch { Fail "UIA_TERMINAL" "UIA_METHOD_FAILED" 7 }',"catch { fail('UIA_TERMINAL','UIA_METHOD_FAILED',7) }")
  .replace('$state = $null','let state = null').replace('foreach ($entry in $selected.patterns)','for (const entry of selected.patterns)')
  .replaceAll('$entry','entry').replaceAll('$pname','pname').replaceAll('$state','state').replaceAll(' -ceq ',' === ').replaceAll(' -cne ',' !== ').replaceAll('$false','false');
 assert.doesNotMatch(b,/\$(?!\()|\[void\]| -c(?:eq|ne) /);
 const tried=[],calls=[];
 const fn=new vm.Script('(function(){'+b+'})').runInNewContext({selected:{patterns:[{mode:'invoke',state}]},pname:'invoke',tried,complete,
  act:()=>{calls.push('native');if(throws)throw Error('controlled');return status},
  fail:(prefix,detail,code)=>{calls.push({prefix,code:code??detail});throw Error('FIXED_TERMINAL')}});
 let result;try{result=fn()}catch(error){result=error.message}
 return {result,tried,calls};
}
test('actual clean Try-Pattern never acts on unready selection or retries uncertain method',()=>{
 for(const state of ['unsupported','null','threw'])assert.deepEqual(cleanTry572(state,0),{result:false,tried:['invoke:'+state],calls:[]});
 assert.deepEqual(cleanTry572('ready',0),{result:true,tried:['invoke:ok'],calls:['native']});
 assert.deepEqual(cleanTry572('ready',1),{result:false,tried:['invoke:unsupported'],calls:['native']});
 assert.deepEqual(cleanTry572('ready',6),{result:'FIXED_TERMINAL',tried:[],calls:['native',{prefix:'UIA_TERMINAL',code:7}]});
 assert.deepEqual(cleanTry572('ready',0,true),{result:'FIXED_TERMINAL',tried:[],calls:['native',{prefix:'UIA_TERMINAL',code:7}]});
});

test('clean action preserves exact original native ABI and all dispatch semantics',()=>{
 const legacy=readFileSync(path.join(root,'companion/tests/fixtures/win/computer-uia-invoke-mixed-before572.ps1'),'utf8');
 const native=s=>s.slice(s.indexOf('$script:noFocusReady = $false'),s.indexOf('# Terminal dispatch is outside the generic action catch.'));
 assert.equal(native(ps),native(legacy));
 const dispatch=s=>s.slice(s.indexOf('$used = $null'),s.indexOf("if ($null -eq $used) {\n  Fail"));
 let original=dispatch(legacy).replace(/\(\[System\.Windows\.Automation\.(?:InvokePattern|ValuePattern|SelectionItemPattern|TogglePattern|ScrollPattern)\]::Pattern\)/g,'$null');
 const begin=original.indexOf('  $hAmt = [System.Windows.Automation.ScrollAmount]::NoAmount'),end=original.indexOf("  if (Try-Pattern 'scroll'",begin);
 assert.ok(begin>=0&&end>begin);original=original.slice(0,begin)+original.slice(end);
 assert.equal(dispatch(ps),original);
});
