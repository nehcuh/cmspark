/** Guarded source-derived protocol controls. Never starts a UI test or native executable. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import * as ts from 'typescript'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
const files=path.resolve('tests/fixtures/workspace-ui-705'),helper=path.resolve('tests/helpers/workspace-xctest-owned-705.ts')
function loadBoundary(mutant?:[string,string],capturedRoot?:string){
 let source=fs.readFileSync(helper,'utf8');if(mutant){assert.equal(source.split(mutant[0]).length,2);source=source.replace(...mutant)}
 const parsed=ts.createSourceFile('helper.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),selected=parsed.statements.filter(n=>(ts.isClassDeclaration(n)&&n.name?.text==='OwnedUI705Boundary')||(ts.isVariableStatement(n)&&['refused','canonical','regular','UI705_RUNNER_ID','UI705_FILES'].some(v=>n.declarationList.declarations.some(d=>d.name.getText(parsed)===v)))).map(n=>n.getText(parsed)).join('\n')
 const out=ts.transpileModule(selected,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});assert.equal(out.diagnostics!.length,0)
 const nonce='a'.repeat(64),root=capturedRoot??'/owned/cmspark-workspace-ui-705-'+nonce,store=new Map<string,any>(),fd=new Map<number,string>();let serial=3,opens=0
 const stat=(f:string)=>{if(f===root)return{isDirectory:()=>true,isSymbolicLink:()=>false,dev:1,ino:2,uid:7,mode:0o700};const v=store.get(f);if(!v)throw Object.assign(Error('ENOENT'),{code:'ENOENT'});return{isFile:()=>!v.nonfile,isSymbolicLink:()=>!!v.symlink,nlink:v.nlink??1,uid:v.uid??7,mode:v.mode??0o600,size:v.bytes.length,dev:1,ino:v.ino??8}}
 const flags={O_RDONLY:0,O_NOFOLLOW:0x20000,O_NONBLOCK:0x4}
 const mock={constants:flags,lstatSync:stat,realpathSync:(s:string)=>s,openSync:(s:string,bits:number)=>{opens++;assert.ok(bits&flags.O_NONBLOCK);assert.ok(bits&flags.O_NOFOLLOW);stat(s);fd.set(++serial,s);return serial},fstatSync:(n:number)=>stat(fd.get(n)!),readSync:(n:number,b:Buffer)=>{const v=store.get(fd.get(n)!);v.bytes.copy(b);return v.bytes.length},closeSync:(n:number)=>fd.delete(n),writeFileSync:(s:string,b:Buffer)=>{if(store.has(s))throw Error('EXISTS');store.set(s,{bytes:b})}}
 const mod:any={exports:{}};vm.runInNewContext(out.outputText,{module:mod,exports:mod.exports,fs:mock,path:path.posix,pathToFileURL:(p:string)=>pathToFileURL(p,{windows:false}),Buffer,TextDecoder,process:{getuid:()=>7,pid:123}})
 const api=new mod.exports.OwnedUI705Boundary(root,nonce),put=(name:string,value:any,extra:any={})=>store.set(root+'/'+name,{bytes:Buffer.from(JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])))),...extra})
 const base={schema:1,nonce},pid=321
 const full=()=>{put('runner-start.json',{...base,pid,bundle_id:'com.cmspark.tests.workspace-ui-705.xctrunner',bundle_url:pathToFileURL(api.runner()+'/',{windows:false}).href,executable_url:pathToFileURL(api.runnerExecutable(),{windows:false}).href});put('owner-ack.json',{...base,pid,identity_bound:true});put('runner-closed.json',{...base,pid,terminated:true});put('ui-begin.json',{...base,pid,phase:'UI_SEQUENCE_STARTED'});put('ui-quiescent.json',{...base,pid,phase:'UI_SEQUENCE_RETURNED'})}
 return{api,put,full,store,root,base,pid,opens:()=>opens}
}
test('705 actual Foundation startup receipt requires its exact directory URL representation',()=>{
 const bytes=fs.readFileSync(path.join(files,'foundation-startup.json')),provenance=JSON.parse(fs.readFileSync(path.join(files,'foundation-startup.provenance.json'),'utf8'));assert.equal(createHash('sha256').update(bytes).digest('hex'),provenance.receiptSHA256)
 const capture=JSON.parse(bytes.toString('utf8')),prefix=capture.bundle_url.slice('file://'.length),suffix='/Products/Debug/OwnedPickerUITests-Runner.app/'
 assert.ok(prefix.endsWith(suffix));const root=prefix.slice(0,-suffix.length),f=loadBoundary(undefined,root)
 f.put('runner-start.json',capture);assert.equal(f.api.startup(),capture.pid);assert.equal(f.api.receiptMask(),1);assert.equal(f.api.closure(true,true),false,'startup alone never proves closure')
 for(const url of[capture.bundle_url.slice(0,-1),capture.bundle_url+'/',capture.bundle_url+'?x=1',capture.bundle_url+'#x',capture.bundle_url.replace('file:///','file://localhost/'),capture.bundle_url.replace('/Products/','/Foreign/'),capture.bundle_url.replace('Runner.app/','Runner.app/%2e/')]){
  f.put('runner-start.json',{...capture,bundle_url:url});assert.throws(()=>f.api.startup(),/OWNED_WORKSPACE_UI_REFUSED/);assert.equal(f.api.receiptMask(),null)
 }
 for(const url of[capture.executable_url+'/',capture.executable_url+'?x=1',capture.executable_url.replace('/MacOS/','/Foreign/')]){f.put('runner-start.json',{...capture,executable_url:url});assert.throws(()=>f.api.startup(),/OWNED_WORKSPACE_UI_REFUSED/)}
 const swift=fs.readFileSync(path.join(files,'OwnedUIProtocol.swift'),'utf8');assert.match(swift,/runnerBundle:URL \{root\.appendingPathComponent\("Products\/Debug\/OwnedPickerUITests-Runner\.app",isDirectory:true\)\}/)
 const old=loadBoundary(['pathToFileURL(this.runner()+path.sep).href','pathToFileURL(this.runner()).href'],root);old.put('runner-start.json',capture);assert.throws(()=>old.api.startup(),/OWNED_WORKSPACE_UI_REFUSED/,'the actual producer receipt kills the original consumer')
})
test('705 owned XCTest closure needs actual bound observer runner and returned UI calls',()=>{const f=loadBoundary();f.full();assert.equal(f.api.closure(true,true),true);assert.equal(f.api.closure(false,true),false);assert.equal(f.api.closure(true,false),false);f.store.delete(f.root+'/ui-quiescent.json');assert.equal(f.api.closure(true,true),false);f.store.delete(f.root+'/ui-begin.json');assert.equal(f.api.closure(true,true),true);f.put('ui-quiescent.json',{...f.base,pid:f.pid,phase:'UI_SEQUENCE_RETURNED'});assert.equal(f.api.closure(true,true),false)})
test('705 runner closed words missing identity malformed metadata never settle',()=>{for(const variant of['pid','nonce','identity','terminated','phase','extra','booleanpid','selfpid','bundle','exe']){const f=loadBoundary();f.full();if(variant==='pid')f.put('runner-closed.json',{...f.base,pid:9,terminated:true});if(variant==='nonce')f.put('owner-ack.json',{...f.base,nonce:'b'.repeat(64),pid:f.pid,identity_bound:true});if(variant==='identity')f.put('owner-ack.json',{...f.base,pid:f.pid,identity_bound:false});if(variant==='terminated')f.put('runner-closed.json',{...f.base,pid:f.pid,terminated:false});if(variant==='phase')f.put('ui-quiescent.json',{...f.base,pid:f.pid,phase:'UI_SEQUENCE_STARTED'});if(variant==='extra')f.put('owner-ack.json',{...f.base,pid:f.pid,identity_bound:true,secret:'OWNED_SECRET_SENTINEL'});if(['booleanpid','selfpid','bundle','exe'].includes(variant)){const s=JSON.parse(f.store.get(f.root+'/runner-start.json').bytes);if(variant==='booleanpid')s.pid=true;if(variant==='selfpid')s.pid=123;if(variant==='bundle')s.bundle_id='foreign';if(variant==='exe')s.executable_url='file:///foreign';f.put('runner-start.json',s)}assert.equal(f.api.closure(true,true),false,variant)}})
test('705 owned protocol rejects duplicate keys nonregular links permissions and oversize without reflection',()=>{for(const variant of['duplicate','nan','nonfile','link','nlink','uid','mode','oversize']){const f=loadBoundary();f.full();const name=f.root+'/owner-ack.json',v=f.store.get(name);if(variant==='duplicate')v.bytes=Buffer.from('{"nonce":"'+f.base.nonce+'","schema":1,"schema":1}');if(variant==='nan')v.bytes=Buffer.from('{"schema":NaN}');if(variant==='nonfile')v.nonfile=true;if(variant==='link')v.symlink=true;if(variant==='nlink')v.nlink=2;if(variant==='uid')v.uid=8;if(variant==='mode')v.mode=0o644;if(variant==='oversize')v.bytes=Buffer.alloc(4097,65);assert.equal(f.api.closure(true,true),false,variant)}const f=loadBoundary();f.full();f.api.read('owner-ack.json');assert.ok(f.opens()>0)})
test('705 removing quiescent and exact observer checks enables the forbidden state',()=>{const q=loadBoundary(['(!begin||!!returned)','true']);q.full();q.store.delete(q.root+'/ui-quiescent.json');assert.equal(q.api.closure(true,true),true);const o=loadBoundary(['observerClosed&&xcodeClosed','xcodeClosed']);o.full();assert.equal(o.api.closure(false,true),true)})
test('705 actual Swift observer captures one exact identity and writes closed only from KVO',()=>{const s=fs.readFileSync(path.join(files,'OwnerObserver.swift'),'utf8');assert.equal(s.split('NSRunningApplication(processIdentifier:pid)').length,2);assert.ok(s.indexOf('OwnedUI705Scene.exactURL(app.bundleURL,scene.runnerBundle)')<s.indexOf('scene.write(.ack'));assert.ok(s.indexOf('captured=app')<s.indexOf('scene.write(.ack'));assert.match(s,/app\.observe\(\\\.isTerminated/);assert.match(s,/app === captured,app.isTerminated/);assert.equal(s.split('scene.write(.closed').length,2);assert.doesNotMatch(s,/runningApplications|OpenProcess|kill\(|processIdentifier:.*processIdentifier:/);assert.match(s,/Bool is never a closure receipt/)})
test('705 actual UI sequence is ACK gated with no app launch or foreign fallback',()=>{const s=fs.readFileSync(path.join(files,'WorkspacePickerUITests.swift'),'utf8');assert.ok(s.indexOf('let ack=try waitFile(.ack)')<s.indexOf('scene.write(.begin'));assert.ok(s.indexOf('scene.write(.begin')<s.indexOf('let app=XCUIApplication'));assert.ok(s.indexOf('defer{do{try scene.write(.returned')<s.indexOf('let app=XCUIApplication'));assert.doesNotMatch(s,/app\.(launch|activate|terminate)\(|bundleIdentifier:|System Events|Finder|OpenAndSavePanelService|coordinate\(|sleep\(/);assert.match(s,/app.windows.matching\(identifier:scene.nonce\)/);assert.match(s,/try ready\(\.second,2\)/);assert.match(s,/remaining\(\)/)})
test('705 fixed fixture UI observation no longer performs unsupported OK or synthesized result',()=>{const s=fs.readFileSync(path.resolve('tests/fixtures/desktop-476/workspace-acceptance.swift'),'utf8');const body=s.slice(s.indexOf(' static func panel('),s.indexOf(' static func renderer'));assert.doesNotMatch(body,/defaultButtonCell|directoryURL|\.cancel\(|performClick|\.urls\s*=/);assert.match(s,/setAccessibilityIdentifier\(nonce\)/);assert.match(body,/panel.sheetParent === h.window/);assert.match(body,/D476_WS_PICKER_SELECTED/)})

test('705 actual Swift cancellation guard rejects known cancel malformed cancel and late ACK before UI',()=>{
 const p=fs.readFileSync(path.join(files,'OwnedUIProtocol.swift'),'utf8'),u=fs.readFileSync(path.join(files,'WorkspacePickerUITests.swift'),'utf8'),o=fs.readFileSync(path.join(files,'OwnerObserver.swift'),'utf8')
 const marker=' func requireActive() throws {';assert.equal(p.split(marker).length,2)
 const body=p.split(marker)[1].split('\n')[0].slice(0,-1)
 const projected=body.replace('if let value=try read(.cancel)','const value=read("cancel");if(value!==undefined)').replace('try tuple(value,','tuple(value,').replace('throw OwnedUI705Error.refused','throw Error("OWNED_UI_REFUSED")')
 assert.doesNotMatch(projected,/try |OwnedUI705Error|if let/)
 const active=(value:any)=>vm.runInNewContext('(()=>{'+projected+'})()',{read:()=>value,tuple:(v:any,keys:string[])=>{assert.deepEqual(Object.keys(v).sort(),Array.from(keys).sort());assert.equal(v.schema,1);assert.equal(v.nonce,'a'.repeat(64))},Error})
 assert.doesNotThrow(()=>active(undefined));assert.throws(()=>active({schema:1,nonce:'a'.repeat(64)}),/OWNED_UI_REFUSED/);assert.throws(()=>active({schema:1,nonce:'a'.repeat(64),secret:'OWNED_SECRET_SENTINEL'}))
 const ack=o.slice(o.indexOf('   observation='),o.indexOf('  requestStop()'))
 assert.match(ack,/if let cancel=try scene.read\(\.cancel\)/);assert.match(ack,/if !cancelled \{\s*try scene.write\(\.ack/)
 assert.match(u,/func remaining\(\) throws ->TimeInterval \{try scene.requireActive\(\)/)
 assert.match(u,/try scene.requireActive\(\);if try scene.read\(name\)/)
 assert.match(u,/_ = try remaining\(\);try scene.write\(\.begin/)
 assert.match(u,/inputs.element.click\(\);_ = try remaining\(\);inputs.element.typeText\(scene.selection.path\);_ = try remaining\(\);inputs.element.typeKey/)
})
test('705 actual Swift canonical identity uses POSIX bytes without Foundation private display normalization',()=>{
 const p=fs.readFileSync(path.join(files,'OwnedUIProtocol.swift'),'utf8'),o=fs.readFileSync(path.join(files,'OwnerObserver.swift'),'utf8'),u=fs.readFileSync(path.join(files,'WorkspacePickerUITests.swift'),'utf8')
 assert.doesNotMatch(p+o+u,/resolvingSymlinksInPath/)
 assert.match(p,/let p=Darwin.realpath\(path,nil\)/);assert.match(p,/defer\{free\(p\)\}/);assert.match(p,/try Self.canonicalPath\(path\)==path/);assert.match(p,/try Self.canonicalPath\(root.path\)==root.path/)
 assert.match(p,/actual.isFileURL/);assert.match(p,/canonicalPath\(expected.path\)==expected.path && canonicalPath\(actual.path\)==expected.path/)
 assert.match(o,/app.bundleIdentifier==OwnedUI705Scene.runnerID/);assert.match(o,/exactURL\(app.bundleURL,scene.runnerBundle\)/);assert.match(u,/exactURL\(Bundle.main.bundleURL,scene.runnerBundle\)/)
 // Fixed documented Foundation behavior is an injected semantic counterexample, never a Darwin execution claim.
 const physical='/private/var/owned/scene',display=physical.slice('/private'.length),real=(p:string)=>p===display?physical:p
 assert.notEqual(display,physical);assert.equal(real(display),physical);assert.notEqual(real('/foreign/scene'),physical)
})

test('705 actual UI owner exposes only finite pre-cancel process state without reading scene or child objects',()=>{
 const source=fs.readFileSync(helper,'utf8'),ast=ts.createSourceFile(helper,source,ts.ScriptTarget.Latest,true),owner=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='OwnedWorkspaceUI705') as ts.ClassDeclaration
 assert.ok(owner);const method=owner.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(ast)==='diagnostic');assert.ok(method)
 const compiled=ts.transpileModule('class Actual {'+method.getText(ast)+'};globalThis.inspect=(value:any)=>Actual.prototype.diagnostic.call(value)',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope:any={Number};vm.runInNewContext(compiled,scope,{timeout:1000})
 let reads=0;const hidden=Object.defineProperty({},'toString',{get(){reads++;throw Error('PRIVATE_SENTINEL')}})
 for(let flags=0;flags<16;flags++)for(const code of[null,0,41,65,255,256,-1,NaN,hidden]){
  const state:any={begun:!!(flags&1),invalid:!!(flags&2),observerClosed:!!(flags&4),xcodeClosed:!!(flags&8),observerCode:code,xcodeCode:code};for(const key of['scene','observer','xcode','secret'])Object.defineProperty(state,key,{get(){reads++;throw Error('PRIVATE_SENTINEL')}})
  const out=scope.inspect(state);assert.deepEqual(Object.keys(out).sort(),['begun','invalid','observerClosed','observerCode','xcodeClosed','xcodeCode'].sort());assert.equal(out.begun,state.begun);assert.equal(out.invalid,state.invalid);assert.equal(out.observerClosed,state.observerClosed);assert.equal(out.xcodeClosed,state.xcodeClosed)
  const expected=typeof code==='number'&&Number.isInteger(code)&&code>=0&&code<=255?code:null;assert.equal(out.observerCode,expected);assert.equal(out.xcodeCode,expected);assert.equal(JSON.stringify(out).includes('SENTINEL'),false)
 }
 assert.equal(reads,0)
 const native=fs.readFileSync(path.resolve('tests/desktop-native-thread-metadata-476.test.ts'),'utf8'),observe=native.indexOf('uiLifecycle=uiOwner?.diagnostic()'),cancel=native.indexOf('uiOwner?.cancel()');assert.ok(observe>=0&&cancel>observe);assert.match(native,/nativeDiagnostic,diagnosticInvalid,selectedOutcome,selectedIdentity,uiLifecycle/)
})
test('705 actual rejected UI completion signals the existing parent failure while success cannot finish the native case',()=>{
 const file=path.resolve('tests/desktop-native-thread-metadata-476.test.ts'),source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);let callback:ts.Node|undefined,fail:ts.Expression|undefined
 function select(n:ts.Node){if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&n.expression.text==='test'&&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text.startsWith('#476 actual native workspace picker'))callback=n.arguments.at(-1);ts.forEachChild(n,select)}select(ast);assert.ok(callback)
 let then:ts.CallExpression|undefined;function walk(n:ts.Node){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='fail')fail=n.initializer;if(ts.isBinaryExpression(n)&&n.left.getText(ast)==='uiDone'&&ts.isCallExpression(n.right))then=n.right;ts.forEachChild(n,walk)}walk(callback);assert.ok(then&&fail);assert.equal(then.arguments.length,2)
 const code='let failed=false,failureSite=0,signals=0;const failResolve=()=>{signals++};const fail='+fail.getText(ast)+';globalThis.good='+then.arguments[0].getText(ast)+';globalThis.bad='+then.arguments[1].getText(ast)+';globalThis.state=()=>({failed,failureSite,signals});globalThis.preset=()=>{failureSite=5};',compiled=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope:any={};vm.runInNewContext(compiled,scope,{timeout:1000})
 assert.equal(scope.good().ok,true);assert.equal(scope.state().signals,0);assert.equal(scope.bad(Error('PRIVATE_SENTINEL')).ok,false);assert.equal(scope.state().signals,1);assert.equal(scope.state().failed,true);assert.equal(scope.state().failureSite,9);scope.preset();scope.bad();assert.equal(scope.state().failureSite,5)
 assert.match(source,/Promise\.race\(\[exit,failure\.then\(/);assert.match(source,/owned acknowledged UI runner must genuinely close quiescent/)
})

// Separate passive fixed-file snapshot; never a lifecycle/cleanup authority.
const receiptNames705=['runner-start.json','owner-ack.json','ui-begin.json','ui-quiescent.json','runner-closed.json']
test('705 receipt mask observes only valid fixed progression including early cleanup and incomplete UI',()=>{
 const valid=[0,1,3,7,15,17,19,23,31]
 for(let mask=0;mask<32;mask++){
  const f=loadBoundary();f.full();for(let bit=0;bit<5;bit++)if(!(mask&(1<<bit)))f.store.delete(f.root+'/'+receiptNames705[bit])
  assert.equal(f.api.receiptMask(),valid.includes(mask)?mask:null,String(mask))
  if(mask===23)assert.equal(f.api.closure(true,true),false,'begin+closed without return cannot settle')
  if(mask===0)assert.equal(f.api.closure(true,true),false,'not observed is not no execution or closure')
 }
})
test('705 receipt mask rejects exact schema tuple identity malformed and partial files without reflecting values',()=>{
 const variants=['nonce','pid','boolpid','selfpid','bundle','exe','extra','identity','terminated','phase','duplicate','invalidutf8','nonfile','symlink','hardlink','pending','uid','mode','oversize','empty','unreadable']
 for(const kind of variants){
  const f=loadBoundary();f.full();let file='owner-ack.json';if(['boolpid','selfpid','bundle','exe'].includes(kind))file='runner-start.json';if(kind==='terminated')file='runner-closed.json';if(kind==='phase')file='ui-begin.json'
  const name=f.root+'/'+file,v=f.store.get(name),value=JSON.parse(v.bytes.toString('utf8'))
  if(kind==='nonce')value.nonce='b'.repeat(64);if(kind==='pid')value.pid=f.pid+1;if(kind==='boolpid')value.pid=true;if(kind==='selfpid')value.pid=123;if(kind==='bundle')value.bundle_id='OWNED_PRIVATE';if(kind==='exe')value.executable_url='file:///OWNED_PRIVATE';if(kind==='extra')value.private='OWNED_PRIVATE';if(kind==='identity')value.identity_bound=false;if(kind==='terminated')value.terminated=false;if(kind==='phase')value.phase='OWNED_PRIVATE'
  f.put(file,value);const current=f.store.get(name)
  if(kind==='duplicate')current.bytes=Buffer.from('{"nonce":"'+f.base.nonce+'","pid":321,"schema":1,"schema":1}');if(kind==='invalidutf8')current.bytes=Buffer.from([255]);if(kind==='nonfile')current.nonfile=true;if(kind==='symlink')current.symlink=true;if(kind==='hardlink')current.nlink=2
  if(kind==='pending'){current.nlink=2;f.store.set(f.root+'/.owner-ack.json.pending',{...current})}
  if(kind==='uid')current.uid=8;if(kind==='mode')current.mode=0o644;if(kind==='oversize')current.bytes=Buffer.alloc(4097,65);if(kind==='empty')current.bytes=Buffer.alloc(0)
  if(kind==='unreadable'){const original=f.api.read.bind(f.api);f.api.read=(n:string)=>{if(n==='owner-ack.json')throw Error('OWNED_PRIVATE');return original(n)}}
  assert.equal(f.api.receiptMask(),null,kind)
 }
 // The existing strict reader regards a two-link publishing file as pending/undefined;
 // the passive snapshot must distinguish that present partial file from ENOENT.
 const f=loadBoundary();f.full();f.store.get(f.root+'/runner-start.json').nlink=2;f.store.set(f.root+'/.runner-start.json.pending',{...f.store.get(f.root+'/runner-start.json')});assert.equal(f.api.receiptMask(),null)
})
function realReceiptBoundary705(){
 const source=fs.readFileSync(helper,'utf8'),parsed=ts.createSourceFile(helper,source,ts.ScriptTarget.Latest,true),selected=parsed.statements.filter(n=>(ts.isClassDeclaration(n)&&n.name?.text==='OwnedUI705Boundary')||(ts.isVariableStatement(n)&&['refused','canonical','regular','UI705_RUNNER_ID','UI705_FILES'].some(v=>n.declarationList.declarations.some(d=>d.name.getText(parsed)===v)))).map(n=>n.getText(parsed)).join('\n'),out=ts.transpileModule(selected,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}),mod:any={exports:{}}
 const nonce='b'.repeat(64),parent=fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR||os.tmpdir(),'receipt-mask-705-'))),root=path.join(parent,'cmspark-workspace-ui-705-'+nonce);fs.mkdirSync(root,{mode:0o700})
 // Test-private POSIX contract projection only: retain real kind/dev/ino/nlink/uid and
 // I/O; Windows permission bits are not evidence of real POSIX permissions.
 const testUid=fs.lstatSync(root).uid,fds=new Set<number>(),owned=(name:fs.PathLike)=>{const value=String(name);assert.ok(value===root||value.startsWith(root+path.sep));return value},stat=(s:fs.Stats)=>Object.assign(Object.create(Object.getPrototypeOf(s)),s,{mode:(s.mode&~0o777)|(s.isDirectory()?0o700:s.isFile()?0o600:s.mode&0o777)})
 const ownedFS={...fs,lstatSync:(name:fs.PathLike)=>stat(fs.lstatSync(owned(name))),openSync:(name:fs.PathLike,flags:fs.OpenMode,mode?:fs.Mode)=>{const fd=fs.openSync(owned(name),flags,mode);fds.add(fd);return fd},fstatSync:(fd:number)=>{assert.ok(fds.has(fd));return stat(fs.fstatSync(fd))},closeSync:(fd:number)=>{try{return fs.closeSync(fd)}finally{fds.delete(fd)}}}
 vm.runInNewContext(out.outputText,{module:mod,exports:mod.exports,fs:ownedFS,path,pathToFileURL,Buffer,TextDecoder,process:{pid:process.pid,getuid:()=>testUid}})
 const api=new mod.exports.OwnedUI705Boundary(root,nonce),pid=process.pid===321?322:321,base={schema:1,nonce};return{api,root,parent,base,pid,put:(name:string,value:any)=>api.write(name,value),startup:()=>api.write('runner-start.json',{...base,pid,bundle_id:'com.cmspark.tests.workspace-ui-705.xctrunner',bundle_url:pathToFileURL(api.runner()+path.sep).href,executable_url:pathToFileURL(api.runnerExecutable()).href})}
}
test('705 receipt mask actual strict reader handles owned files links directory and partial publication',()=>{
 const f=realReceiptBoundary705();try{
  assert.equal(f.api.receiptMask(),0);f.startup();assert.equal(f.api.receiptMask(),1);f.put('owner-ack.json',{...f.base,pid:f.pid,identity_bound:true});assert.equal(f.api.receiptMask(),3)
  const closed=path.join(f.root,'runner-closed.json'),foreign=path.join(f.parent,'owned-inert.json');fs.writeFileSync(foreign,'{}',{mode:0o600});const foreignDirectory=path.join(f.parent,'owned-inert-directory');fs.mkdirSync(foreignDirectory,{mode:0o700});fs.symlinkSync(foreignDirectory,closed,process.platform==='win32'?'junction':'dir');assert.equal(f.api.receiptMask(),null);fs.unlinkSync(closed);fs.mkdirSync(closed,{mode:0o700});assert.equal(f.api.receiptMask(),null);fs.rmdirSync(closed)
  fs.linkSync(foreign,closed);assert.equal(f.api.receiptMask(),null);fs.unlinkSync(closed)
  f.put('runner-closed.json',{...f.base,pid:f.pid,terminated:true});assert.equal(f.api.receiptMask(),19);assert.equal(f.api.closure(false,true),false)
  fs.linkSync(closed,path.join(f.root,'.runner-closed.json.pending'));assert.equal(f.api.receiptMask(),null);fs.unlinkSync(path.join(f.root,'.runner-closed.json.pending'));assert.equal(f.api.receiptMask(),19)
 }finally{fs.rmSync(f.parent,{recursive:true,force:true})}
})
test('705 receipt mask is fixed to five strict reads and refuses FIFO-style descriptors without opening child processes',()=>{
 const f=loadBoundary();f.full();const seen:string[]=[],read=f.api.read.bind(f.api);f.api.read=(name:string)=>{seen.push(name);return read(name)};assert.equal(f.api.receiptMask(),31);assert.deepEqual([...new Set(seen)].sort(),[...receiptNames705].sort())
 // Source-derived FIFO descriptor model: isFile=false and O_NONBLOCK/O_NOFOLLOW asserted by actual reader seam.
 const g=loadBoundary();g.full();g.store.get(g.root+'/owner-ack.json').nonfile=true;assert.equal(g.api.receiptMask(),null);assert.ok(g.opens()>0)
})
test('705 passive receipt snapshot rechecks startup and leaves all original authority methods byte-exact',()=>{
 const f=loadBoundary();f.full();let calls=0;const startup=f.api.startup.bind(f.api);f.api.startup=()=>{calls++;return calls===1?startup():f.pid+1};assert.equal(f.api.receiptMask(),null)
 const g=loadBoundary();g.full();let checks=0;const check=g.api.check.bind(g.api);g.api.check=()=>{checks++;if(checks>1)throw Error('OWNED_ROOT_CHANGED');return check()};assert.equal(g.api.receiptMask(),null)
 const source=fs.readFileSync(helper,'utf8'),ast=ts.createSourceFile(helper,source,ts.ScriptTarget.Latest,true),owner=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='OwnedWorkspaceUI705') as ts.ClassDeclaration,method=owner.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(ast)==='diagnostic');assert.ok(method);assert.equal(method.getText(ast).includes('receiptMask'),false)
})
test('705 actual finally receipt mask is a separate scalar and cannot replace primary or explicit cancel',()=>{
 const file=path.resolve('tests/desktop-native-thread-metadata-476.test.ts'),source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);let body:ts.Block|undefined
 function visit(n:ts.Node){if(ts.isTryStatement(n)&&n.finallyBlock?.getText(ast).includes('D476_WORKSPACE_NATIVE_PHASE'))body=n.finallyBlock;ts.forEachChild(n,visit)}visit(ast);assert.ok(body)
 const nodes=body.statements,cut=nodes.findIndex(n=>n.getText(ast).includes('child?.terminate()'));assert.ok(cut>0);const prefix=nodes.slice(0,cut).map(n=>n.getText(ast)).join('\n'),output=(value:any,throwMask=false,loggerFault=false,sceneFault=false)=>{const rows:string[]=[],trace:string[]=[],owner={diagnostic(){trace.push('lifecycle');return{begun:true}},scene:{receiptMask(){trace.push('mask');if(throwMask)throw Error('OWNED_PRIVATE');return value}},cancel(){trace.push('cancel')}},scope:any={uiOwner:owner,surfaceLease:{retain(){trace.push('retain')}},required:[],receipts:new Set(),picks:0,pickerObserved:0,pickerReturned:0,cancelReturned:0,connections:0,authenticated:false,windowRequested:false,settled:false,failed:true,failureSite:9,pickOutcome:0,pickerLifecycle:null,nativeDiagnostic:null,diagnosticInvalid:false,selectedOutcome:null,selectedIdentity:null,cancelClose:null,cancelShow:null,cancelSettled:null,cancelCurrent:null,t:{diagnostic(s:string){if(loggerFault)throw Error('OWNED_LOGGER');rows.push(s)}}};if(sceneFault)Object.defineProperty(owner,'scene',{get(){throw Error('OWNED_SCENE')}});vm.runInNewContext(ts.transpileModule(prefix,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope);return{trace,rows:rows.map(s=>JSON.parse(s.slice('D476_WORKSPACE_NATIVE_PHASE '.length)))}}
 const good=output(23);assert.equal(good.rows[0].uiReceiptMask,23);assert.equal(good.rows[0].uiLifecycle.begun,true);assert.deepEqual(good.trace,['retain','lifecycle','mask','cancel']);const bad=output(null,true);assert.equal(bad.rows[0].uiReceiptMask,null);assert.equal(bad.rows[0].failureSite,9);assert.deepEqual(bad.trace,['retain','lifecycle','mask','cancel']);const getter=output(null,false,false,true);assert.equal(getter.rows[0].uiReceiptMask,null);assert.deepEqual(getter.trace,['retain','lifecycle','cancel']);const logger=output(31,false,true);assert.equal(logger.rows.length,0);assert.deepEqual(logger.trace,['retain','lifecycle','mask','cancel'])
})

test('705 actual physical receipt callback is portable without host getuid POSIX modes or file-symlink privilege',()=>{
 // Execute the complete current test module in a private Windows-shaped context, then
 // select its real owned-FS callback. This never changes global process/fs or production.
 const current=fs.readFileSync(path.resolve('tests/desktop-workspace-xctest-705.test.ts'),'utf8'),compiled=ts.transpileModule(current,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText
 for(const shape of['missing-getuid','windows-mode']){
  const parent=fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR||os.tmpdir(),'receipt-win-contract-705-'))),fds=new Set<number>(),links:string[]=[],cases=new Map<string,()=>void>()
  const owned=(name:fs.PathLike)=>{const value=String(name);assert.ok(value===parent||value.startsWith(parent+path.sep));return value}
  const rawStat=(s:fs.Stats)=>Object.assign(Object.create(Object.getPrototypeOf(s)),s,{uid:0,mode:shape==='windows-mode'?(s.mode&~0o777)|(s.isDirectory()?0o777:0o666):s.mode})
  const windowsFS={...fs,lstatSync:(name:fs.PathLike)=>rawStat(fs.lstatSync(owned(name))),openSync:(name:fs.PathLike,flags:fs.OpenMode,mode?:fs.Mode)=>{const fd=fs.openSync(owned(name),flags,mode);fds.add(fd);return fd},fstatSync:(fd:number)=>{assert.ok(fds.has(fd));return rawStat(fs.fstatSync(fd))},closeSync:(fd:number)=>{try{return fs.closeSync(fd)}finally{fds.delete(fd)}},symlinkSync:(target:fs.PathLike,name:fs.PathLike,type?:fs.symlink.Type)=>{owned(target);owned(name);links.push(type??'missing');assert.equal(type,'junction','Windows fixture must request only owned directory junction');return fs.symlinkSync(target,name,process.platform==='win32'?'junction':'dir')}}
  const localProcess={pid:process.pid,platform:'win32',env:{TMPDIR:parent}},mod:any={exports:{}},require=createRequireForReceipt705()
  try{vm.runInNewContext(compiled,{module:mod,exports:mod.exports,require:(name:string)=>name==='node:fs'?windowsFS:name==='node:test'?(name:string,callback:()=>void)=>cases.set(name,callback):require(name),process:localProcess,Buffer,TextDecoder,URL,console},{timeout:3000});const actual=cases.get('705 receipt mask actual strict reader handles owned files links directory and partial publication');assert.ok(actual);actual();assert.deepEqual(links,['junction']);assert.equal(fds.size,0)}finally{for(const fd of fds)fs.closeSync(fd);fs.rmSync(parent,{recursive:true,force:true})}
 }
})
function createRequireForReceipt705(){return (name:string)=>{if(name==='node:test')return test;if(name==='node:assert/strict')return assert;if(name==='node:fs')return fs;if(name==='node:path')return path;if(name==='node:vm')return vm;if(name==='node:os')return os;if(name==='typescript')return ts;if(name==='node:url')return{pathToFileURL};if(name==='node:crypto')return{createHash};throw Error('OWNED_TEST_IMPORT_REFUSED')}}


test('705 actual receipt callbacks tolerate absent or empty TMPDIR without mutating the global environment',()=>{
 const current=fs.readFileSync(path.resolve('tests/desktop-workspace-xctest-705.test.ts'),'utf8'),compiled=ts.transpileModule(current,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,parent=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'receipt-fallback-705-')))
 try{for(const empty of[false,true]){const cases=new Map<string,()=>void>(),mod:any={exports:{}},localProcess={pid:process.pid,platform:process.platform,env:empty?{TMPDIR:''}:{}},require=createRequireForReceipt705();let fallbacks=0
  vm.runInNewContext(compiled,{module:mod,exports:mod.exports,require:(name:string)=>name==='node:os'?{tmpdir(){fallbacks++;return parent}}:name==='node:test'?(name:string,callback:()=>void)=>cases.set(name,callback):require(name),process:localProcess,Buffer,TextDecoder,URL,console},{timeout:3000})
  for(const name of['705 receipt mask actual strict reader handles owned files links directory and partial publication','705 actual physical receipt callback is portable without host getuid POSIX modes or file-symlink privilege']){const callback=cases.get(name);assert.ok(callback);callback()}
  assert.equal(fallbacks,3,'real FS callback and both Windows-shaped parents use the same private fallback');assert.deepEqual(fs.readdirSync(parent),[])
 }}finally{fs.rmSync(parent,{recursive:true,force:true})}
})

// Execute the actual passive producer, not a handwritten diagnostic payload.
function loadXcode705(io:any=fs,localProcess:any=process){
 const source=fs.readFileSync(helper,'utf8'),ast=ts.createSourceFile(helper,source,ts.ScriptTarget.Latest,true),owner=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='OwnedWorkspaceUI705') as ts.ClassDeclaration,method=owner?.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(ast)==='xcodeFailureObservation')
 assert.ok(method,'the actual owner must retain a bounded Xcode failure observation')
 const selected=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&['xcode705Parse','xcode705Snapshot'].includes(n.name!.text)||ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='xcode705Unavailable')).map(n=>n.getText(ast)).join('\n'),compiled=ts.transpileModule(selected+'\nclass Actual {'+method.getText(ast)+'};globalThis.observe=(value:any)=>Actual.prototype.xcodeFailureObservation.call(value)',{compilerOptions:{target:ts.ScriptTarget.ES2022},reportDiagnostics:true}),scope:any={fs:io,path,process:localProcess,Buffer,TextDecoder,refused:()=>Error('OWNED_REFUSED')}
 assert.equal(compiled.diagnostics!.length,0);vm.runInNewContext(compiled.outputText,scope,{timeout:1000});return scope.observe as(value:any)=>any
}
function xcodeModel705(){
 const text=Buffer.from('xcodebuild: error: OWNED_PRIVATE\nError Domain=NSCocoaErrorDomain Code=4 "OWNED_PRIVATE"\n'),files=new Map<string,any>(),root='/owned',fds=new Map<number,string>();let serial=70,reads=0,closes=0,checks=0
 const stat=(name:string)=>{if(name===root)return{uid:7n,mode:0o40700n,isDirectory:()=>true,isSymbolicLink:()=>false};const item=files.get(name);if(!item)throw Object.assign(Error('OWNED_PRIVATE'),{code:'ENOENT'});return{dev:1n,ino:item.ino??9n,uid:7n,mode:0o100600n,nlink:1n,size:BigInt(item.data.length),mtimeNs:4n,ctimeNs:5n,isFile:()=>true,isSymbolicLink:()=>false,...item.stat}}
 for(const name of['xcode.stdout','xcode.stderr'])files.set(root+'/'+name,{data:text})
 const io:any={constants:{O_RDONLY:0,O_NOFOLLOW:16,O_NONBLOCK:32},lstatSync:(name:string)=>stat(name),openSync:(name:string,flags:number)=>{assert.equal(flags,48);stat(name);fds.set(++serial,name);return serial},fstatSync:(fd:number)=>{assert.ok(fds.has(fd));return stat(fds.get(fd)!)},readSync:(fd:number,b:Buffer,off:number,length:number,pos:number)=>{reads++;assert.equal(off,0);assert.equal(length,262145);assert.equal(pos,0);const data=files.get(fds.get(fd)!).data;data.copy(b);return Math.min(data.length,b.length)},closeSync:(fd:number)=>{closes++;assert.ok(fds.delete(fd))}}
 const state={xcodeClosed:true,scene:{root,check(){checks++}}},observe=()=>loadXcode705(io,{getuid:()=>7})(state)
 return{io,files,fds,root,state,observe,counts:()=>({reads,closes,checks}),stat}
}
test('705 actual Xcode failure producer gates closed state before every scene or FS read',()=>{
 let reads=0;const state:any={xcodeClosed:false};Object.defineProperty(state,'scene',{get(){reads++;throw Error('OWNED_PRIVATE')}})
 const out=loadXcode705()(state);assert.equal(reads,0);assert.equal(out.schema,1);assert.equal(out.stdout.status,'NOT_CLOSED');assert.equal(out.stderr.status,'NOT_CLOSED');assert.ok(Buffer.byteLength(JSON.stringify(out))<=1024)
 const g=xcodeModel705();assert.equal(g.observe().stdout.firstNSError.code,4);assert.deepEqual(g.counts(),{reads:2,closes:2,checks:6});assert.equal(g.fds.size,0)
})
test('705 Xcode snapshot emits only the first per-stream closed marker and allowlisted canonical int32 pair',()=>{
 for(const [domain,label]of[['NSCocoaErrorDomain','COCOA'],['NSPOSIXErrorDomain','POSIX'],['NSMachErrorDomain','MACH'],['NSOSStatusErrorDomain','OSSTATUS'],['com.OWNED_PRIVATE.domain','OTHER']])for(const code of['0','-1','2147483647','-2147483648']){
  const f=xcodeModel705();f.files.get(f.root+'/xcode.stdout').data=Buffer.from('xcode-select: error: OWNED_PRIVATE\r\nTesting failed:\r\nError Domain='+domain+' Code='+code+' "OWNED_PRIVATE"\r\nError Domain=NSPOSIXErrorDomain Code=99\n')
  const out=f.observe(),v=out.stdout;assert.equal(v.status,'OBSERVED');assert.equal(v.firstMarker,'XCODE_SELECT_ERROR');assert.equal(v.firstNSError.kind,'PAIR');assert.equal(v.firstNSError.domain,label);assert.equal(v.firstNSError.code,label==='OTHER'?null:Number(code));assert.equal(JSON.stringify(out).includes('OWNED_PRIVATE'),false);assert.ok(Buffer.byteLength(JSON.stringify(out))<=1024)
 }
 for(const bad of['+4','04','-0','2147483648','-2147483649','4suffix','4.1','true','1e2']){const f=xcodeModel705();f.files.get(f.root+'/xcode.stdout').data=Buffer.from('Error Domain=NSCocoaErrorDomain Code='+bad+'\n');assert.equal(f.observe().stdout.firstNSError.kind,'UNKNOWN',bad)}
 const f=xcodeModel705();f.files.get(f.root+'/xcode.stdout').data=Buffer.from(' Testing failed:\nword xcodebuild: error: OWNED_PRIVATE\nError Domain=NSPOSIXErrorDomain Code=4');const out=f.observe().stdout;assert.equal(out.firstMarker,'NONE');assert.equal(out.firstNSError.kind,'NONE','unterminated record is not parsed as a complete line')
})
test('705 Xcode snapshot refuses whole oversize invalid UTF8 unsafe metadata and read-count mismatches',()=>{
 for(const kind of['oversize','plusone','utf8','uid','mode','setid','nlink','directory','symlink','short','long','empty','missing']){
  const f=xcodeModel705(),item=f.files.get(f.root+'/xcode.stdout');item.stat={}
  if(kind==='oversize')item.data=Buffer.alloc(262145,65);if(kind==='plusone'){item.data=Buffer.alloc(262144,65);const read=f.io.readSync;f.io.readSync=(...args:any[])=>{read(...args);return 262145}}
  if(kind==='utf8')item.data=Buffer.from([255]);if(kind==='uid')item.stat.uid=8n;if(kind==='mode')item.stat.mode=0o100644n;if(kind==='setid')item.stat.mode=0o104600n;if(kind==='nlink')item.stat.nlink=2n;if(kind==='directory')item.stat.isFile=()=>false;if(kind==='symlink')item.stat.isSymbolicLink=()=>true
  if(kind==='short'||kind==='long'){const read=f.io.readSync;f.io.readSync=(...args:any[])=>read(...args)+(kind==='short'?-1:1)}if(kind==='empty')item.data=Buffer.alloc(0);if(kind==='missing')f.files.delete(f.root+'/xcode.stdout')
  const out=f.observe().stdout;assert.equal(out.status,kind==='empty'?'EMPTY':kind==='missing'?'MISSING':['short','long'].includes(kind)?'CHANGED':['oversize','plusone'].includes(kind)?'OVERSIZE':'INVALID',kind);assert.equal(out.firstMarker,'NONE');assert.equal(out.firstNSError.code,null);assert.equal(f.fds.size,0)
 }
 const f=xcodeModel705();f.files.get(f.root+'/xcode.stdout').data=Buffer.alloc(262144,10);assert.equal(f.observe().stdout.status,'OBSERVED')
})
test('705 Xcode snapshot checks every final named and descriptor security and mutation attribute',()=>{
 for(const phase of['after','named','lastNamed','lastFD'])for(const key of['uid','mode','nlink','size','mtimeNs','ctimeNs']){
  const f=xcodeModel705();let stats=0,named=0;const fdStat=f.io.fstatSync,pathStat=f.io.lstatSync
  const change=(s:any)=>({...s,[key]:s[key]+1n})
  f.io.fstatSync=(fd:number)=>{const s=fdStat(fd);if(f.fds.get(fd)!==f.root+'/xcode.stdout')return s;stats++;return(phase==='after'&&stats===2||phase==='lastFD'&&stats===3)?change(s):s}
  f.io.lstatSync=(p:string)=>{const s=pathStat(p);if(p!==f.root+'/xcode.stdout')return s;named++;return(phase==='named'&&named===1||phase==='lastNamed'&&named===2)?change(s):s}
  assert.equal(f.observe().stdout.status,'CHANGED',phase+':'+key);assert.equal(f.fds.size,0)
 }
})
test('705 Xcode snapshot isolates FS getters faults and one-close uncertainty without closing observed foreign descriptors',()=>{
 for(const fault of['initialStat','afterStat','lastStat','named','read','scene','sceneGetter','errorGetter','closeAfterEffect']){
  const f=xcodeModel705();let calls=0;const stat=f.io.fstatSync,close=f.io.closeSync
  if(fault.endsWith('Stat'))f.io.fstatSync=(fd:number)=>{calls++;if(calls===({initialStat:1,afterStat:2,lastStat:3}as any)[fault])throw Error('OWNED_PRIVATE');return stat(fd)}
  if(fault==='named')f.io.lstatSync=(p:string)=>{if(p.endsWith('stdout'))throw Error('OWNED_PRIVATE');return f.stat(p)}
  if(fault==='read')f.io.readSync=()=>{throw Error('OWNED_PRIVATE')};if(fault==='scene')f.state.scene.check=()=>{throw Error('OWNED_PRIVATE')};if(fault==='sceneGetter')Object.defineProperty(f.state,'scene',{get(){throw Error('OWNED_PRIVATE')}})
  if(fault==='errorGetter')f.io.openSync=()=>{throw Object.defineProperty({},'code',{get(){throw Error('OWNED_PRIVATE')}})}
  if(fault==='closeAfterEffect')f.io.closeSync=(fd:number)=>{close(fd);throw Error('OWNED_PRIVATE')}
  const out=f.observe();assert.equal(out.stdout.status,'READ_FAILED',fault);assert.equal(out.stdout.firstNSError.code,null);assert.equal(JSON.stringify(out).includes('OWNED_PRIVATE'),false);assert.equal(f.fds.size,0)
  if(fault==='closeAfterEffect')assert.equal(f.counts().closes,2,'one close per owned stream, no retry after effect then throw')
 }
 for(const phase of[2,3]){const f=xcodeModel705(),stat=f.io.fstatSync;let calls=0;f.io.fstatSync=(fd:number)=>{const s=stat(fd);calls++;return calls===phase?{...s,ino:99n}:s};if(phase===2){const named=f.io.lstatSync;f.io.lstatSync=(p:string)=>{if(p.endsWith('stdout'))throw Error('OWNED_PRIVATE');return named(p)}}assert.equal(f.observe().stdout.status,'CHANGED');assert.equal(f.counts().closes,1,'observed foreign descriptor never closed');assert.equal(f.fds.size,1)}
})
test('705 Xcode passive producer uses real owned files and rejects real links directories and malformed bytes',()=>{
 const parent=fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR||os.tmpdir(),'xcode-snapshot-705-'))),root=path.join(parent,'scene');fs.mkdirSync(root,{mode:0o700})
 // On Windows the unshipped macOS reader is tested with explicit POSIX mode/UID
 // projection; real kind/dev/ino/nlink/bytes and all I/O still come from owned files.
 const uid=fs.lstatSync(root).uid,project=(s:any)=>process.platform==='win32'?Object.assign(Object.create(Object.getPrototypeOf(s)),s,{uid:BigInt(uid),mode:(s.mode&~0o7777n)|(s.isDirectory()?0o700n:0o600n)}):s
 const io={...fs,lstatSync:(p:fs.PathLike,o?:any)=>{const s=fs.lstatSync(p,o);return o?.bigint?project(s):s},fstatSync:(fd:number,o?:any)=>{const s=fs.fstatSync(fd,o);return o?.bigint?project(s):s}},observe=loadXcode705(io,{getuid:()=>uid}),state={xcodeClosed:true,scene:{root,check(){assert.equal(fs.realpathSync(root),root)}}},name=path.join(root,'xcode.stdout')
 try{
  fs.writeFileSync(name,'Testing failed:\nError Domain=NSPOSIXErrorDomain Code=13 "OWNED_PRIVATE"\n',{mode:0o600});assert.equal(observe(state).stdout.firstNSError.code,13);assert.equal(observe(state).stderr.status,'MISSING')
  fs.linkSync(name,path.join(parent,'inert-hardlink'));assert.equal(observe(state).stdout.status,'INVALID');fs.unlinkSync(path.join(parent,'inert-hardlink'));fs.unlinkSync(name)
  fs.mkdirSync(name,{mode:0o700});assert.notEqual(observe(state).stdout.status,'OBSERVED');fs.rmdirSync(name)
  const directory=path.join(parent,'inert-directory');fs.mkdirSync(directory,{mode:0o700});fs.symlinkSync(directory,name,process.platform==='win32'?'junction':'dir');assert.notEqual(observe(state).stdout.status,'OBSERVED');fs.unlinkSync(name)
  fs.writeFileSync(name,Buffer.from([255]),{mode:0o600});assert.equal(observe(state).stdout.status,'INVALID');fs.unlinkSync(name);fs.writeFileSync(name,Buffer.alloc(262145,65),{mode:0o600});assert.equal(observe(state).stdout.status,'OVERSIZE')
 }finally{fs.rmSync(parent,{recursive:true,force:true})}
})
test('705 actual caught failure emits the producer once within 1024 bytes and preserves primary cancel and cleanup on faults',()=>{
 const file=path.resolve('tests/desktop-native-thread-metadata-476.test.ts'),source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);let body:ts.Block|undefined
 function walk(n:ts.Node){if(ts.isTryStatement(n)&&n.finallyBlock?.getText(ast).includes('D476_WORKSPACE_NATIVE_PHASE'))body=n.finallyBlock;ts.forEachChild(n,walk)}walk(ast);assert.ok(body)
 const cut=body.statements.findIndex(n=>n.getText(ast).includes('child?.terminate()')),prefix=body.statements.slice(0,cut).map(n=>n.getText(ast)).join('\n'),base=()=>({surfaceLease:{retain(){}},required:[],receipts:new Set(),picks:0,pickerObserved:0,pickerReturned:0,cancelReturned:0,connections:0,authenticated:false,windowRequested:false,settled:false,failed:true,failureSite:9,pickOutcome:0,pickerLifecycle:null,nativeDiagnostic:null,diagnosticInvalid:false,selectedOutcome:null,selectedIdentity:null,cancelClose:null,cancelShow:null,cancelSettled:null,cancelCurrent:null,Buffer})
 for(const variant of['good','success','readerFault','sinkFault','oversize']){
  const f=xcodeModel705(),rows:string[]=[],trace:string[]=[],owner={diagnostic:()=>({begun:true}),scene:{receiptMask:()=>0},xcodeFailureObservation(){trace.push('observe');if(variant==='readerFault')throw Error('OWNED_PRIVATE');return variant==='oversize'?'a'.repeat(1025):f.observe()},cancel(){trace.push('cancel')}},scope={...base(),primaryFailed:variant!=='success',uiOwner:owner,t:{diagnostic(s:string){if(s.startsWith('D705_XCODE_FAILURE ')&&variant==='sinkFault')throw Error('OWNED_PRIVATE');rows.push(s)}}}
  vm.runInNewContext(ts.transpileModule(prefix,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope)
  assert.deepEqual(trace,variant==='success'?['cancel']:['observe','cancel']);const record=rows.filter(s=>s.startsWith('D705_XCODE_FAILURE '));assert.equal(record.length,variant==='good'?1:0);assert.equal(rows.filter(s=>s.startsWith('D476_WORKSPACE_NATIVE_PHASE ')).length,1)
  if(record.length){const text=record[0].slice('D705_XCODE_FAILURE '.length);assert.ok(Buffer.byteLength(text)<=1024);const out=JSON.parse(text);assert.deepEqual(Object.keys(out).sort(),['schema','stderr','stdout']);assert.equal(out.stdout.firstNSError.code,4);assert.equal(text.includes('OWNED_PRIVATE'),false)}
 }
})
test('705 Xcode real descriptor reuse survives close-after-effect and observed foreign identity without a second close',()=>{
 const parent=fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR||os.tmpdir(),'xcode-fd-705-'))),root=path.join(parent,'scene');fs.mkdirSync(root,{mode:0o700});const name=path.join(root,'xcode.stdout'),other=path.join(parent,'inert-other'),text='Testing failed:\n'
 fs.writeFileSync(name,text,{mode:0o600});fs.writeFileSync(other,text,{mode:0o600});const uid=fs.lstatSync(root).uid,project=(s:any)=>process.platform==='win32'?Object.assign(Object.create(Object.getPrototypeOf(s)),s,{uid:BigInt(uid),mode:(s.mode&~0o7777n)|(s.isDirectory()?0o700n:0o600n)}):s
 try{for(const kind of['closeAfterEffect','readReusesFD']){let foreign:number|undefined,closes=0
  const io={...fs,lstatSync:(p:fs.PathLike,o?:any)=>{const s=fs.lstatSync(p,o);return o?.bigint?project(s):s},fstatSync:(fd:number,o?:any)=>{const s=fs.fstatSync(fd,o);return o?.bigint?project(s):s},closeSync:(fd:number)=>{closes++;fs.closeSync(fd);if(kind==='closeAfterEffect'){foreign=fs.openSync(other,'r');assert.equal(foreign,fd);throw Error('OWNED_AFTER_CLOSE')}},readSync:(fd:number,b:Buffer,offset:number,length:number,position:number)=>{if(kind==='readReusesFD'){fs.closeSync(fd);foreign=fs.openSync(other,'r');assert.equal(foreign,fd)}return fs.readSync(fd,b,offset,length,position)}}
  try{const out=loadXcode705(io,{getuid:()=>uid})({xcodeClosed:true,scene:{root,check(){assert.equal(fs.realpathSync(root),root)}}});assert.equal(out.stdout.status,kind==='closeAfterEffect'?'READ_FAILED':'CHANGED');assert.equal(closes,kind==='closeAfterEffect'?1:0);assert.notEqual(foreign,undefined);assert.equal(fs.readFileSync(foreign!,'utf8'),text,'foreign replacement descriptor remains usable')}finally{if(foreign!==undefined)fs.closeSync(foreign)}
 }}finally{fs.rmSync(parent,{recursive:true,force:true})}
})
test('705 Xcode real same-sized named replacement and final directory permission change refuse observation',()=>{
 const parent=fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR||os.tmpdir(),'xcode-replace-705-'))),root=path.join(parent,'scene');fs.mkdirSync(root,{mode:0o700});const name=path.join(root,'xcode.stdout'),other=path.join(root,'replacement'),text='Testing failed:\n'
 const uid=fs.lstatSync(root).uid,project=(s:any)=>process.platform==='win32'?Object.assign(Object.create(Object.getPrototypeOf(s)),s,{uid:BigInt(uid),mode:(s.mode&~0o7777n)|(s.isDirectory()?0o700n:0o600n)}):s
 try{for(const variant of['replace','directory']){
  if(process.platform!=='win32')fs.chmodSync(root,0o700)
  fs.writeFileSync(name,text,{mode:0o600});fs.writeFileSync(other,text,{mode:0o600});let finalRoot=false,closes=0
  const io={...fs,lstatSync:(p:fs.PathLike,o?:any)=>{const s=fs.lstatSync(p,o);const out=o?.bigint?project(s):s;return finalRoot&&String(p)===root&&o?.bigint?Object.assign(Object.create(Object.getPrototypeOf(out)),out,{mode:0o40755n}):out},fstatSync:(fd:number,o?:any)=>{const s=fs.fstatSync(fd,o);return o?.bigint?project(s):s},readSync:(fd:number,b:Buffer,off:number,length:number,pos:number)=>{const n=fs.readSync(fd,b,off,length,pos);if(variant==='replace'){fs.unlinkSync(name);fs.renameSync(other,name)}else if(process.platform==='win32')finalRoot=true;else fs.chmodSync(root,0o755);return n},closeSync:(fd:number)=>{closes++;fs.closeSync(fd)}}
  const out=loadXcode705(io,{getuid:()=>uid})({xcodeClosed:true,scene:{root,check(){assert.equal(fs.realpathSync(root),root)}}});assert.equal(out.stdout.status,variant==='replace'?'CHANGED':'READ_FAILED');assert.equal(out.stdout.firstMarker,'NONE');assert.equal(closes,1);assert.equal(fs.readFileSync(name,'utf8'),text)
 }}finally{fs.rmSync(parent,{recursive:true,force:true})}
})
