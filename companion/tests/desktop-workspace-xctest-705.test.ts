import { archiveObservationInverse782 } from "./fixtures/archive-first-failure-782"
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
 const mock={constants:flags,lstatSync:stat,realpathSync:(s:string)=>s,openSync:(s:string,bits:number|string)=>{opens++;if(bits==='wx'){assert.equal(store.has(s),false);store.set(s,{bytes:Buffer.alloc(0),ino:serial+10});fd.set(++serial,s);return serial}assert.equal(typeof bits,'number');assert.ok(Number(bits)&flags.O_NONBLOCK);assert.ok(Number(bits)&flags.O_NOFOLLOW);stat(s);fd.set(++serial,s);return serial},fstatSync:(n:number)=>stat(fd.get(n)!),readSync:(n:number,b:Buffer)=>{const v=store.get(fd.get(n)!);v.bytes.copy(b);return v.bytes.length},closeSync:(n:number)=>fd.delete(n),writeFileSync:(s:string|number,b:Buffer)=>{if(typeof s==='number'){assert.ok(fd.has(s));store.get(fd.get(s)!).bytes=Buffer.from(b);return}if(store.has(s))throw Error('EXISTS');store.set(s,{bytes:Buffer.from(b)})},fsyncSync:(n:number)=>{assert.ok(fd.has(n))},linkSync:(from:string,to:string)=>{assert.equal(store.has(to),false);const item=store.get(from);assert.ok(item);item.nlink=2;store.set(to,item)},unlinkSync:(name:string)=>{const item=store.get(name);assert.ok(item);item.nlink--;assert.ok(store.delete(name))}}
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
 const nodes=body.statements,cut=nodes.findIndex(n=>n.getText(ast).includes('child?.terminate()'));assert.ok(cut>0);const prefix=nodes.slice(0,cut).map(n=>n.getText(ast)).join('\n'),output=(value:any,throwMask=false,loggerFault=false,sceneFault=false)=>{const rows:string[]=[],trace:string[]=[],owner={diagnostic(){trace.push('lifecycle');return{begun:true}},scene:{receiptMask(){trace.push('mask');if(throwMask)throw Error('OWNED_PRIVATE');return value}},cancel(){trace.push('cancel')}},scope:any={uiOwner:owner,surfaceLease:{retain(){trace.push('retain')}},required:[],receipts:new Set(),picks:0,pickerObserved:0,pickerReturned:0,cancelReturned:0,connections:0,authenticated:false,windowRequested:false,settled:false,childExitCode:null,firstFailedAssertion:0,failed:true,failureSite:9,pickOutcome:0,pickerLifecycle:null,nativeDiagnostic:null,diagnosticInvalid:false,selectedOutcome:null,selectedIdentity:null,cancelClose:null,cancelShow:null,cancelSettled:null,cancelCurrent:null,t:{diagnostic(s:string){if(loggerFault)throw Error('OWNED_LOGGER');rows.push(s)}}};if(sceneFault)Object.defineProperty(owner,'scene',{get(){throw Error('OWNED_SCENE')}});vm.runInNewContext(ts.transpileModule(prefix,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope);return{trace,rows:rows.map(s=>JSON.parse(s.slice('D476_WORKSPACE_NATIVE_PHASE '.length)))}}
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
function createRequireForReceipt705(){return (name:string)=>{if(name==='./fixtures/archive-first-failure-782')return{archiveObservationInverse782};if(name==='node:test')return test;if(name==='node:assert/strict')return assert;if(name==='node:fs')return fs;if(name==='node:path')return path;if(name==='node:vm')return vm;if(name==='node:os')return os;if(name==='typescript')return ts;if(name==='node:url')return{pathToFileURL};if(name==='node:crypto')return{createHash};throw Error('OWNED_TEST_IMPORT_REFUSED')}}


test('705 receipt importer admits only the exact actual Archive inverse and preserves refusal',()=>{
 const source=fs.readFileSync(path.resolve('tests/desktop-workspace-xctest-705.test.ts'),'utf8'),ast=ts.createSourceFile('actual.ts',source,ts.ScriptTarget.Latest,true),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='createRequireForReceipt705');assert.ok(fn)
 const current=fn.getText(ast),added="if(name==='./fixtures/archive-first-failure-782')return{archiveObservationInverse782};";assert.equal(current.split(added).length,2)
 const load=(text:string)=>{const scope:any={test,assert,fs,path,vm,os,ts,pathToFileURL,createHash,archiveObservationInverse782};vm.runInNewContext(ts.transpileModule(text+';globalThis.factory=createRequireForReceipt705',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope,{timeout:1000});return scope.factory()}
 const actual=load(current),name='./fixtures/archive-first-failure-782';assert.equal(actual(name).archiveObservationInverse782,archiveObservationInverse782)
 for(const unknown of[name+'.ts',name+'/foreign','node:child_process','./fixtures/foreign'])assert.throws(()=>actual(unknown),/OWNED_TEST_IMPORT_REFUSED/)
 assert.throws(()=>load(current.replace(added,''))(name),/OWNED_TEST_IMPORT_REFUSED/,'the actual prior resolver rejects the newly imported exact module')
})


test('705 actual receipt callbacks tolerate absent or empty TMPDIR without mutating the global environment',()=>{
 const current=fs.readFileSync(path.resolve('tests/desktop-workspace-xctest-705.test.ts'),'utf8'),compiled=ts.transpileModule(current,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,parent=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'receipt-fallback-705-')))
 try{for(const empty of[false,true]){const cases=new Map<string,()=>void>(),mod:any={exports:{}},localProcess={pid:process.pid,platform:process.platform,env:empty?{TMPDIR:''}:{}},require=createRequireForReceipt705();let fallbacks=0
  vm.runInNewContext(compiled,{module:mod,exports:mod.exports,require:(name:string)=>name==='node:os'?{tmpdir(){fallbacks++;return parent}}:name==='node:test'?(name:string,callback:()=>void)=>cases.set(name,callback):require(name),process:localProcess,Buffer,TextDecoder,URL,console},{timeout:3000})
  for(const name of['705 receipt mask actual strict reader handles owned files links directory and partial publication','705 actual physical receipt callback is portable without host getuid POSIX modes or file-symlink privilege']){const callback=cases.get(name);assert.ok(callback);callback()}
  assert.equal(fallbacks,3,'real FS callback and both Windows-shaped parents use the same private fallback');assert.deepEqual(fs.readdirSync(parent),[])
 }}finally{fs.rmSync(parent,{recursive:true,force:true})}
})

// Execute the actual passive producer, not a handwritten diagnostic payload.
function loadXcode705(io:any=fs,localProcess:any=process,localPath:typeof path=path){
 const source=fs.readFileSync(helper,'utf8'),ast=ts.createSourceFile(helper,source,ts.ScriptTarget.Latest,true),owner=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='OwnedWorkspaceUI705') as ts.ClassDeclaration,method=owner?.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(ast)==='xcodeFailureObservation')
 assert.ok(method,'the actual owner must retain a bounded Xcode failure observation')
 const selected=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&['xcode705Parse','xcode705Snapshot'].includes(n.name!.text)||ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='xcode705Unavailable')).map(n=>n.getText(ast)).join('\n'),compiled=ts.transpileModule(selected+'\nclass Actual {'+method.getText(ast)+'};globalThis.observe=(value:any)=>Actual.prototype.xcodeFailureObservation.call(value)',{compilerOptions:{target:ts.ScriptTarget.ES2022},reportDiagnostics:true}),scope:any={fs:io,path:localPath,process:localProcess,Buffer,TextDecoder,refused:()=>Error('OWNED_REFUSED')}
 assert.equal(compiled.diagnostics!.length,0);vm.runInNewContext(compiled.outputText,scope,{timeout:1000});return scope.observe as(value:any)=>any
}
function xcodeModel705(){
 const text=Buffer.from('xcodebuild: error: OWNED_PRIVATE\nError Domain=NSCocoaErrorDomain Code=4 "OWNED_PRIVATE"\n'),files=new Map<string,any>(),root='/owned',fds=new Map<number,string>();let serial=70,reads=0,closes=0,checks=0
 const stat=(name:string)=>{if(name===root)return{uid:7n,mode:0o40700n,isDirectory:()=>true,isSymbolicLink:()=>false};const item=files.get(name);if(!item)throw Object.assign(Error('OWNED_PRIVATE'),{code:'ENOENT'});return{dev:1n,ino:item.ino??9n,uid:7n,mode:0o100600n,nlink:1n,size:BigInt(item.data.length),mtimeNs:4n,ctimeNs:5n,isFile:()=>true,isSymbolicLink:()=>false,...item.stat}}
 for(const name of['xcode.stdout','xcode.stderr'])files.set(root+'/'+name,{data:text})
 const io:any={constants:{O_RDONLY:0,O_NOFOLLOW:16,O_NONBLOCK:32},lstatSync:(name:string)=>stat(name),openSync:(name:string,flags:number)=>{assert.equal(flags,48);stat(name);fds.set(++serial,name);return serial},fstatSync:(fd:number)=>{assert.ok(fds.has(fd));return stat(fds.get(fd)!)},readSync:(fd:number,b:Buffer,off:number,length:number,pos:number)=>{reads++;assert.equal(off,0);assert.equal(length,262145);assert.equal(pos,0);const data=files.get(fds.get(fd)!).data;data.copy(b);return Math.min(data.length,b.length)},closeSync:(fd:number)=>{closes++;assert.ok(fds.delete(fd))}}
 const state={xcodeClosed:true,scene:{root,check(){checks++}}},observe=()=>loadXcode705(io,{getuid:()=>7},path.posix)(state)
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
 const cut=body.statements.findIndex(n=>n.getText(ast).includes('child?.terminate()')),prefix=body.statements.slice(0,cut).map(n=>n.getText(ast)).join('\n'),base=()=>({surfaceLease:{retain(){}},required:[],receipts:new Set(),picks:0,pickerObserved:0,pickerReturned:0,cancelReturned:0,connections:0,authenticated:false,windowRequested:false,settled:false,childExitCode:null,firstFailedAssertion:0,failed:true,failureSite:9,pickOutcome:0,pickerLifecycle:null,nativeDiagnostic:null,diagnosticInvalid:false,selectedOutcome:null,selectedIdentity:null,cancelClose:null,cancelShow:null,cancelSettled:null,cancelCurrent:null,Buffer})
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

// The actual native catch observes assertion identity without changing the caught value.
test('705 actual native failure observer preserves primary errors and hostile code properties',()=>{
 const file=path.resolve('tests/desktop-native-thread-metadata-476.test.ts'),source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);let body:ts.Block|undefined
 function visit(n:ts.Node){if(ts.isTryStatement(n)&&n.finallyBlock?.getText(ast).includes('D476_WORKSPACE_NATIVE_PHASE'))body=n.catchClause?.block;ts.forEachChild(n,visit)}visit(ast);assert.ok(body)
 const plain=Object.assign(Error('OWNED_ASSERTION'),{code:'ERR_ASSERTION'}),accessor=Object.defineProperty({},'code',{get(){throw Error('OWNED_GETTER')}}),hasTrap=new Proxy({}, {has(){throw Error('OWNED_HAS')}}),revoked=Proxy.revocable({},{});revoked.revoke()
 for(const error of[plain,accessor,hasTrap,revoked.proxy,null,17]){const scope:any={error,primaryFailed:false,firstFailedAssertion:0,assertionSite:7};let escaped:unknown,thrown=false;try{vm.runInNewContext(ts.transpileModule(body.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope)}catch(value){escaped=value;thrown=true}
  assert.equal(thrown,true);assert.equal(escaped,error);assert.equal(scope.primaryFailed,true);assert.equal(scope.firstFailedAssertion,error===plain?7:0)
 }
})


test('705 failure-only UI stage is closed bounded and never a lifecycle authority',()=>{
 const f=loadBoundary();assert.equal(f.api.uiRefusal(),null);const value={...f.base,stage:9,detail:1};f.put('ui-refusal.json',value);assert.deepEqual(JSON.parse(JSON.stringify(f.api.uiRefusal())),{stage:9,detail:1});assert.equal(f.api.receiptMask(),0);assert.equal(f.api.closure(true,true),false)
 for(const bad of[{...value,stage:0},{...value,stage:21},{...value,stage:true},{...value,stage:1.5},{...value,detail:-1},{...value,detail:6},{...value,detail:true},{...value,nonce:'b'.repeat(64)},{...value,extra:'PRIVATE_UI_SENTINEL'}]){f.put('ui-refusal.json',bad);assert.equal(f.api.uiRefusal(),null)}
 for(let stage=1;stage<=20;stage++)for(let detail=0;detail<=5;detail++){f.put('ui-refusal.json',{...f.base,stage,detail});assert.deepEqual(JSON.parse(JSON.stringify(f.api.uiRefusal())),{stage,detail})}
 const p=fs.readFileSync(path.join(files,'OwnedUIProtocol.swift'),'utf8'),u=fs.readFileSync(path.join(files,'WorkspacePickerUITests.swift'),'utf8');assert.match(p,/uiRefusal="ui-refusal.json"/);assert.match(u,/if preflightStage==0 && \(1\.\.\.20\).contains\(uiStage\),let scene=uiScene \{try\? scene.write\(\.uiRefusal/);assert.ok(u.indexOf('scene.write(.uiRefusal')<u.lastIndexOf('throw error'));assert.equal(u.split('scene.write(.uiRefusal').length,2)
})


// Exact source-only inverse of the macOS title compatibility change. Never applies to receipts or compiled evidence.
// Undo only the separately reviewed census observation extraction before the
// existing whole-parent authorities. Every old digest remains unchanged.
function censusTerminalInverseParent747(raw:string){
 raw=confirmationObservationInverse772(raw)
 const pairs:[string,string][]=[["  let terminalPhaseEmitted=false,terminalPhaseEmitting=false\n  const emitTerminalPhase=(moment='FINALLY')=>{\n   if(terminalPhaseEmitted||terminalPhaseEmitting)return\n   terminalPhaseEmitting=true\n   try{t.diagnostic('D476_TERMINAL_NATIVE_PHASE '+JSON.stringify({schema:1,moment,firstFailure:firstFailure.snapshot(),readiness:readiness.snapshot(),inputEnterObserved,rawOutputMarkerSeen,failed,receiptMask:required.reduce((m,id,i)=>m|(receipts.has(id)?1<<i:0),0),actualSpawns,openAttempts,confirmationRequests,decisions,deniedResults,outputBytes,largestFrame,outputFrames:outputSeq.size,acks:ackSeq.size,dimensions:dimensions.size,inputUnicode,outputUnicode,stops,actualProcessExit,authenticated,windowRequested,connections,childExited}));terminalPhaseEmitted=true}catch{}finally{terminalPhaseEmitting=false}\n  }\n",""],["t.signal.addEventListener('abort',()=>{firstFailure.seal();emitTerminalPhase('ABORT');reject(Error('OWNED_TERMINAL705_NATIVE_DEADLINE'))},{once:true})","t.signal.addEventListener('abort',()=>{firstFailure.seal();reject(Error('OWNED_TERMINAL705_NATIVE_DEADLINE'))},{once:true})"],["firstFailure.seal();surfaceLease.retain();emitTerminalPhase('FINALLY')","firstFailure.seal();surfaceLease.retain();try{t.diagnostic('D476_TERMINAL_NATIVE_PHASE '+JSON.stringify({schema:1,firstFailure:firstFailure.snapshot(),readiness:readiness.snapshot(),inputEnterObserved,rawOutputMarkerSeen,failed,receiptMask:required.reduce((m,id,i)=>m|(receipts.has(id)?1<<i:0),0),actualSpawns,openAttempts,confirmationRequests,decisions,deniedResults,outputBytes,largestFrame,outputFrames:outputSeq.size,acks:ackSeq.size,dimensions:dimensions.size,inputUnicode,outputUnicode,stops,actualProcessExit,authenticated,windowRequested,connections,childExited}))}catch{}"]]
 let value=raw
 for(const [current,prior]of pairs){assert.equal(value.split(current).length,2,'one exact census terminal observation hunk');value=value.replace(current,prior)}
 assert.equal(createHash('sha256').update(value).digest('hex'),'bdba454b129cdc8364cb937a1445f57661a374b54ef1ff6904398d08cbde61e3','entire f522 native parent conserved');return value
}

// Exact inverse for removing only the optional synchronous census call from
// the live UI sequence. Older authority digests below are not refreshed.
// Source-only inverse of the owned input readiness barrier; never runtime evidence.
function previousInputReady705(kind:'ui'|'protocol'|'helper'|'native',raw:string){
 raw=require(path.resolve('scripts/tests/observation-788-inverse.mjs')).restoreObservation788(raw)
 let source=raw.replace(/\r\n/g,'\n')
 if(kind==='ui'||kind==='helper'){
  const current=kind==='ui'?"  uiStage=7;uiDetail=0;observeUIStage()\n  let inputCandidates=first.descendants(matching:.any).matching(NSPredicate(format:\"elementType IN %@\",[XCUIElement.ElementType.comboBox.rawValue,XCUIElement.ElementType.textField.rawValue]))\n  guard inputCandidates.firstMatch.waitForExistence(timeout:try remaining()) else{throw OwnedUI705Error.refused}\n  let comboCount=first.comboBoxes.count;uiDetail=min(comboCount,2)+1;observeUIStage();let inputs=comboCount==1 ? first.comboBoxes:first.textFields\n":"fb446e0d2b32e5a55e05a03e369fa5635b98448513a59fe9ea91bd098590b076",prior=kind==='ui'?"  uiStage=7;uiDetail=0;observeUIStage();let comboCount=first.comboBoxes.count;uiDetail=min(comboCount,2)+1;observeUIStage();let inputs=comboCount==1 ? first.comboBoxes:first.textFields\n":"0b193e101ccee97e618500e56208e6e1740bad28558a8c2439252efca7b9b572"
  assert.equal(source.split(current).length,2,'one exact owned input readiness hunk');source=source.replace(current,prior)
  assert.equal(createHash('sha256').update(source).digest('hex'),kind==='ui'?"0b193e101ccee97e618500e56208e6e1740bad28558a8c2439252efca7b9b572":"1f8e2f2129378ec2ccc4510e6a4ab29a4445fa71208223ef04c4114b2bf0885d",'entire e9cc source restored before previous authorities')
 }
 return source
}

function previousCriticalCensus705(kind:'ui'|'protocol'|'helper'|'native',raw:string){
 let source=previousInputReady705(kind,raw)
 if(kind==='ui'||kind==='helper'){
  const current=kind==='ui'?"uiDetail=3;observeUIStage();let chooseTimeout=try remaining()":"0b193e101ccee97e618500e56208e6e1740bad28558a8c2439252efca7b9b572",prior=kind==='ui'?"uiDetail=3;observeUIStage();observeChooseCensus();let chooseTimeout=try remaining()":"1c9da3dd55238e24652db387a3dd351ae49f40bc4c566c5db8621a9fdf453b68"
  assert.equal(source.split(current).length,2,'one exact critical-path census removal hunk');source=source.replace(current,prior)
  assert.equal(createHash('sha256').update(source).digest('hex'),kind==='ui'?"1c9da3dd55238e24652db387a3dd351ae49f40bc4c566c5db8621a9fdf453b68":"8f3a773a53ec672565fe56148e0238f5a233c3e32f6a6e3c68d3a43d97f0cc81",'entire dc9 source restored before older authority')
 }
 return source
}

function previousTitle705(kind:'ui'|'protocol'|'helper'|'native',raw:string){
 const pairs={"ui":[["    let title=OwnedUI705ButtonIdentity(button.title).rawValue\n    buttonIdentityRows.append([label,title])","    let identifier=OwnedUI705ButtonIdentity(button.identifier).rawValue\n    buttonIdentityRows.append([label,identifier])"],["   let sheetLabelCount=labelChoose.count","   let sheetLabelCount=choose.count"],["  let choose=first.buttons.matching(NSPredicate(format:\"label IN %@ OR title IN %@\",[\"Choose\",\"Open\"],[\"Choose\",\"Open\"]))\n  let labelChoose=first.buttons.matching(NSPredicate(format:\"label IN %@\",[\"Choose\",\"Open\"]))","  let choose=first.buttons.matching(NSPredicate(format:\"label IN %@\",[\"Choose\",\"Open\"]))"]],"helper":[["1c9da3dd55238e24652db387a3dd351ae49f40bc4c566c5db8621a9fdf453b68","182d2773a37134d289fec9c80a27107b5359c51d2cab1545bdfd62c3f6a2cee4"]]} as const
 let source=previousCriticalCensus705(kind,raw)
 if(kind==='native')source=censusTerminalInverseParent747(source)
 if(kind==='ui'||kind==='helper')for(const [current,prior]of pairs[kind]){assert.equal(source.split(current).length,2,'one exact title compatibility hunk');source=source.replace(current,prior)}
 return source
}

// Exact source-only inverse for the enum census addition. Older canonical pins stay unchanged.
function previousCensusIdentity705(kind:'ui'|'protocol'|'helper'|'native',raw:string){
 const pairs={"ui":[["   // Reuse that same count; this is non-atomic evidence, never button authority.\n   var buttonIdentityRows=[[Int]]()\n   for index in 0..<min(sheetButtonCount,8) {\n    let button=first.buttons.element(boundBy:index)\n    let label=OwnedUI705ButtonIdentity(button.label).rawValue\n    let identifier=OwnedUI705ButtonIdentity(button.identifier).rawValue\n    buttonIdentityRows.append([label,identifier])\n   }\n   // No receipt if any synchronous framework call does not return; missing is UNKNOWN.\n   try? scene.write(.uiChooseCensus,[\"schema\":1,\"nonce\":scene.nonce,\"status\":\"OBSERVED\",\"sheetLabelCount\":min(sheetLabelCount,2),\"sheetButtonCount\":min(sheetButtonCount,2),\"ownerLabelCount\":min(ownerLabelCount,2),\"buttonCount\":min(sheetButtonCount,8),\"buttonsMore\":sheetButtonCount>8,\"buttonIdentityRows\":buttonIdentityRows])","   // No receipt if a synchronous framework call does not return; missing is UNKNOWN.\n   try? scene.write(.uiChooseCensus,[\"schema\":1,\"nonce\":scene.nonce,\"status\":\"OBSERVED\",\"sheetLabelCount\":min(sheetLabelCount,2),\"sheetButtonCount\":min(sheetButtonCount,2),\"ownerLabelCount\":min(ownerLabelCount,2)])"]],"protocol":[["// Fixed local mapping only. Raw AX strings never enter a receipt or log.\nenum OwnedUI705ButtonIdentity: Int {\n case empty=0, choose=1, open=2, go=3, cancel=4, other=5\n init(_ value:String) {\n  switch value {\n  case \"\":self = .empty\n  case \"Choose\":self = .choose\n  case \"Open\":self = .open\n  case \"Go\":self = .go\n  case \"Cancel\":self = .cancel\n  default:self = .other\n  }\n }\n}\nenum OwnedUI705File: String {","enum OwnedUI705File: String {"]],"helper":[["182d2773a37134d289fec9c80a27107b5359c51d2cab1545bdfd62c3f6a2cee4","d9e11574d3a835f3ce1bf85c3e40975d4eb5adb413c20dad6dc43d3c6ab4a463"],["fbad4db2905d6bb58a40062ec844716554fb4bb8f52ae73f3f5b094ec27c979c","5d42b55aa35a1559b026a1aa2475bf9393bc93ed524b4ec0fedee908883b54b1"],[" // Fixed saturated counts and local identity enums only; never UI/closure authority.\n uiChooseCensus():{schema:1;status:'OBSERVED'|'UNKNOWN';sheetLabelCount:number|null;sheetButtonCount:number|null;ownerLabelCount:number|null;buttonCount:number|null;buttonsMore:boolean|null;buttonIdentityRows:Array<[number,number]>|null} {\n  const unknown=()=>({schema:1 as const,status:'UNKNOWN' as const,sheetLabelCount:null,sheetButtonCount:null,ownerLabelCount:null,buttonCount:null,buttonsMore:null,buttonIdentityRows:null})\n  try{\n   const v=this.read('ui-choose-census.json');if(v===undefined)return unknown()\n   this.fields(v,['schema','nonce','status','sheetLabelCount','sheetButtonCount','ownerLabelCount','buttonCount','buttonsMore','buttonIdentityRows'])\n   if(v.status!=='OBSERVED'||![v.sheetLabelCount,v.sheetButtonCount,v.ownerLabelCount].every(n=>Number.isInteger(n)&&n>=0&&n<=2)||!Number.isInteger(v.buttonCount)||v.buttonCount<0||v.buttonCount>8||typeof v.buttonsMore!=='boolean'||v.buttonsMore&&v.buttonCount!==8||v.sheetButtonCount!==Math.min(v.buttonCount,2))return unknown()\n   if(!Array.isArray(v.buttonIdentityRows)||v.buttonIdentityRows.length!==v.buttonCount||!v.buttonIdentityRows.every((row:unknown)=>Array.isArray(row)&&row.length===2&&row.every(n=>Number.isInteger(n)&&n>=0&&n<=5)))return unknown()\n   return{schema:1,status:'OBSERVED',sheetLabelCount:v.sheetLabelCount,sheetButtonCount:v.sheetButtonCount,ownerLabelCount:v.ownerLabelCount,buttonCount:v.buttonCount,buttonsMore:v.buttonsMore,buttonIdentityRows:v.buttonIdentityRows.map((row:number[])=>[row[0],row[1]] as [number,number])}\n  }catch{return unknown()}\n }\n"," // One fixed, saturated AX census. Never a UI outcome or lifecycle/cleanup receipt.\n uiChooseCensus():{schema:1;status:'OBSERVED'|'UNKNOWN';sheetLabelCount:number|null;sheetButtonCount:number|null;ownerLabelCount:number|null} {\n  const unknown=()=>({schema:1 as const,status:'UNKNOWN' as const,sheetLabelCount:null,sheetButtonCount:null,ownerLabelCount:null})\n  try{const v=this.read('ui-choose-census.json');if(v===undefined)return unknown();this.fields(v,['schema','nonce','status','sheetLabelCount','sheetButtonCount','ownerLabelCount']);if(v.status!=='OBSERVED'||![v.sheetLabelCount,v.sheetButtonCount,v.ownerLabelCount].every(n=>Number.isInteger(n)&&n>=0&&n<=2))return unknown();return{schema:1,status:'OBSERVED',sheetLabelCount:v.sheetLabelCount,sheetButtonCount:v.sheetButtonCount,ownerLabelCount:v.ownerLabelCount}}catch{return unknown()}\n }\n"]],"native":[["let uiChooseCensus:{schema:1;status:'OBSERVED'|'UNKNOWN';sheetLabelCount:number|null;sheetButtonCount:number|null;ownerLabelCount:number|null;buttonCount:number|null;buttonsMore:boolean|null;buttonIdentityRows:Array<[number,number]>|null}|null=null;","let uiChooseCensus:{schema:1;status:'OBSERVED'|'UNKNOWN';sheetLabelCount:number|null;sheetButtonCount:number|null;ownerLabelCount:number|null}|null=null;"]]} as const
 const authority={"ui":"d9e11574d3a835f3ce1bf85c3e40975d4eb5adb413c20dad6dc43d3c6ab4a463","protocol":"5d42b55aa35a1559b026a1aa2475bf9393bc93ed524b4ec0fedee908883b54b1","helper":"67c5bc474de8b5fe5e7868f7a6040968477624223d2ecd7aac086af4f46bb32b","native":"2f2a3d08eafb54b2eef26450e30b12000844479e759316eff3773ebad8364f2e"} as const
 let source=previousTitle705(kind,raw)
 for(const [current,prior]of pairs[kind]){assert.equal(source.split(current).length,2,'one exact identity census hunk');source=source.replace(current,prior)}
 assert.equal(createHash('sha256').update(source).digest('hex'),authority[kind]);return source
}

// Source-only exact census inverse. Never normalize runtime JSON, TAP or emitted evidence.
function previousCensus705(kind:'ui'|'protocol'|'helper'|'native',raw:string){
 const pairs={"ui":[["uiDetail=3;observeUIStage();observeChooseCensus();let chooseTimeout=try remaining()","uiDetail=3;observeUIStage();let chooseTimeout=try remaining()"],["  let choose=first.buttons.matching(NSPredicate(format:\"label IN %@\",[\"Choose\",\"Open\"]))\n  // One diagnostic census only. Separate non-atomic AX queries; no labels leave this process.\n  var chooseCensusAttempted=false\n  func observeChooseCensus(){\n   if chooseCensusAttempted{return};chooseCensusAttempted=true\n   let sheetLabelCount=choose.count\n   let sheetButtonCount=first.buttons.count\n   let ownerLabelCount=app.windows.matching(identifier:scene.nonce).buttons.matching(NSPredicate(format:\"label IN %@\",[\"Choose\",\"Open\"])).count\n   guard sheetLabelCount>=0,sheetButtonCount>=0,ownerLabelCount>=0 else{return}\n   // No receipt if a synchronous framework call does not return; missing is UNKNOWN.\n   try? scene.write(.uiChooseCensus,[\"schema\":1,\"nonce\":scene.nonce,\"status\":\"OBSERVED\",\"sheetLabelCount\":min(sheetLabelCount,2),\"sheetButtonCount\":min(sheetButtonCount,2),\"ownerLabelCount\":min(ownerLabelCount,2)])\n  }\n","  let choose=first.buttons.matching(NSPredicate(format:\"label IN %@\",[\"Choose\",\"Open\"]))\n"]],"protocol":[["uiProgress=\"ui-progress.json\", uiChooseCensus=\"ui-choose-census.json\"","uiProgress=\"ui-progress.json\""]],"helper":[["5d42b55aa35a1559b026a1aa2475bf9393bc93ed524b4ec0fedee908883b54b1","01ca276b55894f4897901403291a891d9e4993c743de3d2c1f0f2dd6deb07310"],["d9e11574d3a835f3ce1bf85c3e40975d4eb5adb413c20dad6dc43d3c6ab4a463","79439b217dffda4fd07095be6fc8a250aaf27bff0e34198c0d0cdc44bdae8b09"],[" // One fixed, saturated AX census. Never a UI outcome or lifecycle/cleanup receipt.\n uiChooseCensus():{schema:1;status:'OBSERVED'|'UNKNOWN';sheetLabelCount:number|null;sheetButtonCount:number|null;ownerLabelCount:number|null} {\n  const unknown=()=>({schema:1 as const,status:'UNKNOWN' as const,sheetLabelCount:null,sheetButtonCount:null,ownerLabelCount:null})\n  try{const v=this.read('ui-choose-census.json');if(v===undefined)return unknown();this.fields(v,['schema','nonce','status','sheetLabelCount','sheetButtonCount','ownerLabelCount']);if(v.status!=='OBSERVED'||![v.sheetLabelCount,v.sheetButtonCount,v.ownerLabelCount].every(n=>Number.isInteger(n)&&n>=0&&n<=2))return unknown();return{schema:1,status:'OBSERVED',sheetLabelCount:v.sheetLabelCount,sheetButtonCount:v.sheetButtonCount,ownerLabelCount:v.ownerLabelCount}}catch{return unknown()}\n }\n // Passive, non-atomic observation only. Neither a success nor a cleanup receipt.\n"," // Passive, non-atomic observation only. Neither a success nor a cleanup receipt.\n"],["'ui-refusal.json','ui-progress.json','ui-choose-census.json'] as const","'ui-refusal.json','ui-progress.json'] as const"]],"native":[["...(uiOwner?{uiRefusal,uiProgress,uiChooseCensus}:{})","...(uiOwner?{uiRefusal,uiProgress}:{})"],["let uiProgress:{stage:number;detail:number}|null=null;try{if(primaryFailed)uiProgress=uiOwner?.scene.uiProgress()??null}catch{};let uiChooseCensus:{schema:1;status:'OBSERVED'|'UNKNOWN';sheetLabelCount:number|null;sheetButtonCount:number|null;ownerLabelCount:number|null}|null=null;try{if(primaryFailed)uiChooseCensus=uiOwner?.scene.uiChooseCensus()??null}catch{};","let uiProgress:{stage:number;detail:number}|null=null;try{if(primaryFailed)uiProgress=uiOwner?.scene.uiProgress()??null}catch{};"]]} as const
 const authority={"ui":"79439b217dffda4fd07095be6fc8a250aaf27bff0e34198c0d0cdc44bdae8b09","protocol":"01ca276b55894f4897901403291a891d9e4993c743de3d2c1f0f2dd6deb07310","helper":"d69c5c5f74fdba1788c32db463e576feb4a6a5d2925c6425079dbcfa549c2752","native":"ba6a17d9ba68cefa2ea0a4feae84a2ef41ada61c83073a5d7b47e7755b4f9b5e"} as const
 let source=previousCensusIdentity705(kind,raw)
 for(const [current,prior]of pairs[kind]){assert.equal(source.split(current).length,2,'one exact census source hunk');source=source.replace(current,prior)}
 assert.equal(createHash('sha256').update(source).digest('hex'),authority[kind]);return source
}

// This inverse is static source text only; no compiled/TAP/JSON/evidence normalization.
function previousChoose705(source:string){
 source=previousCensus705('ui',source)
 const current='let chooseElement=choose.firstMatch;uiDetail=3;observeUIStage();let chooseTimeout=try remaining();uiDetail=4;observeUIStage();let chooseSeen=chooseElement.waitForExistence(timeout:chooseTimeout)',previous='let chooseSeen=choose.firstMatch.waitForExistence(timeout:try remaining())'
 assert.equal(source.split(current).length,2);return source.replace(current,previous)
}

test('705 owned Choose query waits within the original deadline before preserving uniqueness and hittability',()=>{
 const swift=previousChoose705(fs.readFileSync(path.resolve('tests/fixtures/workspace-ui-705/WorkspacePickerUITests.swift'),'utf8'))
 const start=swift.indexOf('let choose=first.buttons.matching('),end=swift.indexOf('uiStage=14;',start),fragment=swift.slice(start,end)
 assert.ok(start>=0&&end>start)
 assert.match(fragment,/choose\.firstMatch\.waitForExistence\(timeout:try remaining\(\)\)/)
 const wait=fragment.indexOf('waitForExistence('),present=fragment.indexOf('guard chooseSeen else'),count=fragment.indexOf('let chooseCount=choose.count'),unique=fragment.indexOf('guard chooseCount==1 else'),hit=fragment.indexOf('let chooseHittable=choose.element.isHittable'),click=fragment.indexOf('choose.element.click()')
 assert.ok(wait<present&&present<count&&count<unique&&unique<hit&&hit<click)
 assert.match(fragment,/guard chooseHittable else\{throw OwnedUI705Error\.refused\}/)
 assert.equal(fragment.match(/waitForExistence\(/g)?.length,1)
 assert.doesNotMatch(fragment,/sleep|activate\(|launch\(|terminate\(|setPrompt|\.prompt=/)
 assert.match(swift,/guard r>0,r<=45 else/)
})


// Diagnostic payloads come from the exact current Swift writer dictionary, not
// hand-invented field names. This is a CPU source projection, not a Swift run.
function swiftProgress705(stage:number,detail:number,nonce:string){
 const source=fs.readFileSync(path.join(files,'OwnedUIProtocol.swift'),'utf8'),match=/let value:\[String:Any\]=(\["schema":1,"nonce":nonce,"stage":stage,"detail":detail\])/.exec(source);assert.ok(match)
 const body=match[1].slice(1,-1).replace(/:nonce(?=,|$)/g,':'+JSON.stringify(nonce)).replace(/:stage(?=,|$)/g,':'+JSON.stringify(stage)).replace(/:detail(?=,|$)/g,':'+JSON.stringify(detail))
 return JSON.parse('{'+body+'}')
}
test('705 published UI progress is producer-derived closed and independent of refusal and lifecycle authority',()=>{
 const f=loadBoundary();assert.equal(f.api.uiProgress(),null)
 for(let stage=1;stage<=20;stage++)for(let detail=0;detail<=5;detail++){
  const value=swiftProgress705(stage,detail,f.base.nonce);f.put('ui-progress.json',value);assert.deepEqual(JSON.parse(JSON.stringify(f.api.uiProgress())),{stage,detail});assert.equal(f.api.uiRefusal(),null);assert.equal(f.api.receiptMask(),0);assert.equal(f.api.closure(true,true),false)
 }
 const value=swiftProgress705(10,0,f.base.nonce)
 for(const change of[{stage:0},{stage:21},{stage:true},{stage:1.5},{stage:Number.MAX_VALUE},{detail:-1},{detail:6},{detail:true},{nonce:'b'.repeat(64)},{extra:'OWNED_PRIVATE_PROGRESS'}]){f.put('ui-progress.json',{...value,...change});assert.equal(f.api.uiProgress(),null)}
 for(const fault of['nonfile','symlink','nlink','uid','mode','oversize','empty']){
  const g=loadBoundary();g.put('ui-progress.json',swiftProgress705(3,0,g.base.nonce));const row=g.store.get(g.root+'/ui-progress.json');if(fault==='nonfile')row.nonfile=true;if(fault==='symlink')row.symlink=true;if(fault==='nlink')row.nlink=2;if(fault==='uid')row.uid=8;if(fault==='mode')row.mode=0o644;if(fault==='oversize')row.bytes=Buffer.alloc(4097,65);if(fault==='empty')row.bytes=Buffer.alloc(0);assert.equal(g.api.uiProgress(),null,fault)
 }
 f.full();f.put('ui-progress.json',value);assert.equal(f.api.receiptMask(),31);assert.equal(f.api.closure(true,true),true);f.put('ui-progress.json',{...value,stage:0});assert.equal(f.api.uiProgress(),null);assert.equal(f.api.receiptMask(),31);assert.equal(f.api.closure(true,true),true)
})
test('705 main-thread progress publisher preserves every original UI action authority and atomic fixed-file boundary',()=>{
 const actualProtocol=fs.readFileSync(path.join(files,'OwnedUIProtocol.swift'),'utf8'),actualUI=fs.readFileSync(path.join(files,'WorkspacePickerUITests.swift'),'utf8'),actualSource=fs.readFileSync(helper,'utf8'),actualNative=fs.readFileSync(path.resolve('tests/desktop-native-thread-metadata-476.test.ts'),'utf8')
 function verifyConservation(protocol:string,ui:string,source:string,native:string){
  // Static source text only: never normalize runtime JSON, compiled bytes, TAP or evidence.
  const restore788=require(path.resolve('scripts/tests/observation-788-inverse.mjs')).restoreObservation788
  const canonical=(value:string)=>restore788(value.replace(/\r\n/g,'\n'))
  protocol=previousCensus705('protocol',canonical(protocol));ui=previousChoose705(canonical(ui));source=previousCensus705('helper',canonical(source));native=previousCensus705('native',canonical(native))
  // Remove only the new result observation before applying the unchanged preceding conservation oracle.
  const resultStart=source.indexOf('// Two post-close, read-only test-result queries share 5s/1MiB per stream each.'),resultEnd=source.indexOf('type File705=',resultStart);assert.ok(resultStart>=0&&resultEnd>resultStart);source=source.slice(0,resultStart)+source.slice(resultEnd)
  for(const extra of [' private xcodeResultObservationStarted=false\n',' private readonly resultSourceRoot:string\n',"  this.resultSourceRoot=path.resolve(native,'../../tests/fixtures/workspace-ui-705')\n"]){assert.equal(source.split(extra).length,2);source=source.replace(extra,'')}
  const resultCall=";owner.observeClosedXcodeResultOnce(value=>{try{const finite=JSON.stringify(value);if(Buffer.byteLength(finite,'utf8')<=1024)process.stdout.write('D705_XCRESULT_DETAILS_CLOSED '+finite+'\\n')}catch{}})";assert.equal(native.split(resultCall).length,2);native=native.replace(resultCall,'')
  const passiveStart=source.indexOf(' // One passive close listener only.'),passiveEnd=source.indexOf(' canSettle(){',passiveStart);assert.ok(passiveStart>=0&&passiveEnd>passiveStart);source=(source.slice(0,passiveStart)+source.slice(passiveEnd)).replace(" private xcodeCloseObservationRegistered=false\n",'');native=native.replace("try{if(primaryFailed&&uiOwner){const owner=uiOwner;owner.observeXcodeCloseOnce(()=>{try{const observation=JSON.stringify(owner.xcodeFailureObservation());if(Buffer.byteLength(observation,'utf8')<=1024)process.stdout.write('D705_XCODE_FAILURE_AFTER_CANCEL '+observation+'\\n')}catch{}})}}catch{};",'')
  const a=protocol.indexOf(' // Best-effort main-thread stage snapshot only;'),b=protocol.indexOf(' func tuple(',a);assert.ok(a>=0&&b>a);const writer=protocol.slice(a,b)
  assert.match(writer,/guard Thread\.isMainThread,\(1\.\.\.20\).contains\(stage\),\(0\.\.\.5\).contains\(detail\)/);assert.match(writer,/OwnedUI705File\.uiProgress/);assert.match(writer,/O_WRONLY\|O_CREAT\|O_EXCL\|O_NOFOLLOW,0o600/);assert.match(writer,/pending\.st_dev==owned\.st_dev,pending\.st_ino==owned\.st_ino/);assert.match(writer,/current\.st_dev==previous\.st_dev,current\.st_ino==previous\.st_ino/);assert.match(writer,/published\.st_dev==owned\.st_dev,published\.st_ino==owned\.st_ino/);assert.ok(writer.indexOf('fsync(fd)')<writer.indexOf('rename(temp,file)'));assert.doesNotMatch(writer,/Dispatch|Timer|Task\.|async|sleep|XCTest|XCUIApplication|Int\(oldStage\)|Int\(oldDetail\)/)
  const originalProtocol=protocol.slice(0,a)+protocol.slice(b);assert.equal(createHash('sha256').update(originalProtocol.replace(', uiProgress="ui-progress.json"','')).digest('hex'),'757299efa1cc922ac5551e16e763755b790fc0ccd49d969df24aadb2b1fb94d4')
  assert.equal(ui.match(/uiStage=(?:stage(?:\+[12])?|\d+);uiDetail=0;observeUIStage\(\)/g)?.length,17);assert.match(ui,/@MainActor func testOwnedPanel/);assert.match(ui,/func observeUIStage\(\)\{try\? scene.writeUIProgress\(uiStage,uiDetail\)\}/)
  const originalUI=ui.replace('  func observeUIStage(){try? scene.writeUIProgress(uiStage,uiDetail)}\n','').replaceAll(';observeUIStage()','').replace('  observeUIStage()\n','');assert.equal(createHash('sha256').update(originalUI).digest('hex'),'ab75e477a7f678cbc86191ca3997ea9d55fa8e6ba9cca6a408536af82afa7a79')
  const c=source.indexOf(' // Last published main-thread stage only;'),d=source.indexOf(' // Passive, non-atomic observation only.',c);assert.ok(c>=0&&d>c);assert.equal(createHash('sha256').update((source.slice(0,c)+source.slice(d)).replace(",'ui-progress.json'] as const","] as const")).digest('hex'),'bc35145a80691993219c237dce088534604a99a001cf5a7414229562963438cb')
  const nativeStart=native.indexOf('   surfaceLease.retain();let uiLifecycle:'),nativeEnd=native.indexOf('\n  }\n })\n})',nativeStart);assert.ok(nativeStart>=0&&nativeEnd>nativeStart);const originalNative=native.slice(nativeStart,nativeEnd).replace("let uiProgress:{stage:number;detail:number}|null=null;try{if(primaryFailed)uiProgress=uiOwner?.scene.uiProgress()??null}catch{};",'').replace('...(uiOwner?{uiRefusal,uiProgress}:{})','...(uiOwner?{uiRefusal}:{})');assert.equal(createHash('sha256').update(originalNative).digest('hex'),'aa950d5bf4a8cbb67fce423534261f026acb99c7e7057b2f8988c69009e2c52e')
 }
 for(const eol of ['\n','\r\n']){
  const profile=(value:string)=>value.replace(/\r\n/g,'\n').replace(/\n/g,eol)
  verifyConservation(profile(actualProtocol),profile(actualUI),profile(actualSource),profile(actualNative))
 }
})
test('705 actual failure progress projection precedes cancel and isolates reader scene logger and cancellation faults',()=>{
 const file=path.resolve('tests/desktop-native-thread-metadata-476.test.ts'),source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);let block:ts.Block|undefined
 function visit(n:ts.Node){if(ts.isTryStatement(n)&&n.finallyBlock?.getText(ast).includes('D476_WORKSPACE_NATIVE_PHASE'))block=n.finallyBlock;ts.forEachChild(n,visit)}visit(ast);assert.ok(block)
 const cut=block.statements.findIndex(n=>n.getText(ast).includes('child?.terminate()'));assert.ok(cut>0);const prefix=block.statements.slice(0,cut).map(n=>n.getText(ast)).join('\n'),compiled=ts.transpileModule(prefix,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const census=loadBoundary();actualChooseCensus705((name,value)=>census.api.write(name,value),[0,1,2]).observe()
 for(const variant of['good','success','readerFault','sceneGetter','loggerFault','cancelFault','censusFault']){
  const trace:string[]=[],rows:string[]=[],cancelError=Error('OWNED_CANCEL'),value=swiftProgress705(9,0,'a'.repeat(64)),owner:any={diagnostic:()=>({begun:true}),scene:{receiptMask:()=>7,uiRefusal:()=>null,uiProgress(){trace.push('progress');if(variant==='readerFault')throw Error('OWNED_PRIVATE_PROGRESS');return{stage:value.stage,detail:value.detail}},uiChooseCensus(){trace.push('census');if(variant==='censusFault')throw Error('OWNED_PRIVATE_CENSUS');return census.api.uiChooseCensus()}},xcodeFailureObservation(){throw Error('OWNED_PRIVATE_XCODE')},cancel(){trace.push('cancel');if(variant==='cancelFault')throw cancelError}}
  if(variant==='sceneGetter')Object.defineProperty(owner,'scene',{get(){throw Error('OWNED_PRIVATE_SCENE')}})
  const scope:any={uiOwner:owner,primaryFailed:variant!=='success',surfaceLease:{retain(){}},required:[],receipts:new Set(),picks:1,pickerObserved:1,pickerReturned:0,cancelReturned:0,connections:1,authenticated:true,windowRequested:true,settled:false,childExitCode:null,firstFailedAssertion:0,failed:true,failureSite:9,pickOutcome:1,pickerLifecycle:null,nativeDiagnostic:null,diagnosticInvalid:false,selectedOutcome:null,selectedIdentity:null,cancelClose:null,cancelShow:null,cancelSettled:null,cancelCurrent:null,Buffer,t:{diagnostic(s:string){if(variant==='loggerFault')throw Error('OWNED_PRIVATE_LOGGER');rows.push(s)}}}
  if(variant==='cancelFault')assert.throws(()=>vm.runInNewContext(compiled,scope),error=>error===cancelError);else assert.doesNotThrow(()=>vm.runInNewContext(compiled,scope))
  assert.equal(trace.filter(x=>x==='cancel').length,1);assert.equal(trace.filter(x=>x==='progress').length,['success','sceneGetter'].includes(variant)?0:1);if(trace.includes('progress'))assert.ok(trace.indexOf('progress')<trace.indexOf('cancel'));assert.equal(trace.filter(x=>x==='census').length,['success','sceneGetter'].includes(variant)?0:1);if(trace.includes('census'))assert.ok(trace.indexOf('census')<trace.indexOf('cancel'));assert.equal(scope.primaryFailed,variant!=='success');assert.equal(scope.failureSite,9);assert.equal(scope.failed,true)
  const records=rows.filter(s=>s.startsWith('D476_WORKSPACE_NATIVE_PHASE '));assert.equal(records.length,['loggerFault','cancelFault'].includes(variant)?0:1);for(const record of records){const actual=JSON.parse(record.slice('D476_WORKSPACE_NATIVE_PHASE '.length));assert.deepEqual(actual.uiProgress,['good','censusFault'].includes(variant)?{stage:9,detail:0}:null);assert.deepEqual(actual.uiChooseCensus,['success','sceneGetter','censusFault'].includes(variant)?null:JSON.parse(JSON.stringify(census.api.uiChooseCensus())));assert.equal(actual.failureSite,9);assert.equal(record.includes('OWNED_PRIVATE'),false)}
 }
})


test('705 Choose stage11 splits only original firstMatch remaining and wait boundaries with whole-source conservation',()=>{
 const actual=fs.readFileSync(path.join(files,'WorkspacePickerUITests.swift'),'utf8')
 for(const eol of['\n','\r\n']){
  const source=actual.replace(/\r\n/g,'\n').replace(/\n/g,eol),prior=previousChoose705(source)
  // Git source-only LF digest binds all other actions, deadlines and assertions.
  assert.equal(createHash('sha256').update(prior.replace(/\r\n/g,'\n')).digest('hex'),'6efad44df4a39d7b4aa33a2509dd01b17e97f8ed333252169c058aa5815f064e')
  const fragment=source.slice(source.indexOf('uiStage=11;'),source.indexOf('uiStage=12;'))
  const ordered=['uiDetail=0;observeUIStage()','let chooseElement=choose.firstMatch','uiDetail=3;observeUIStage()','let chooseTimeout=try remaining()','uiDetail=4;observeUIStage()','let chooseSeen=chooseElement.waitForExistence(timeout:chooseTimeout)','uiDetail=chooseSeen ? 2:1;observeUIStage()','guard chooseSeen else','let chooseCount=choose.count','guard chooseCount==1 else']
  let position=-1;for(const item of ordered){const at=fragment.indexOf(item);assert.ok(at>position,item);position=at}
  assert.equal(fragment.match(/choose\.firstMatch/g)?.length,1);assert.equal(fragment.match(/try remaining\(\)/g)?.length,1);assert.equal(fragment.match(/waitForExistence\(/g)?.length,1)
  assert.doesNotMatch(fragment,/Timer|Task\.|Dispatch|sleep|setPrompt|\.prompt\s*=|debugDescription|snapshot/)
 }
})
function loadXcodeClose705(){
 const source=fs.readFileSync(helper,'utf8'),ast=ts.createSourceFile(helper,source,ts.ScriptTarget.Latest,true),owner=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='OwnedWorkspaceUI705') as ts.ClassDeclaration
 const method=owner?.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(ast)==='observeXcodeCloseOnce'),start=owner?.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(ast)==='start');assert.ok(method&&start)
 let close:ts.ArrowFunction|undefined;function walk(n:ts.Node){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='on'&&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text==='close')close=n.arguments[1] as ts.ArrowFunction;ts.forEachChild(n,walk)}walk(start);assert.ok(close)
 const compiled=ts.transpileModule('class Actual{'+method.getText(ast)+'};globalThis.register=(owner:any,observe:()=>void)=>Actual.prototype.observeXcodeCloseOnce.call(owner,observe);globalThis.primary=(owner:any)=>function(){const kind="xcode";return ('+close.getText(ast)+')}.call(owner)',{compilerOptions:{target:ts.ScriptTarget.ES2022},reportDiagnostics:true});assert.equal(compiled.diagnostics!.length,0)
 const scope:any={};vm.runInNewContext(compiled.outputText,scope,{timeout:1000});return scope as{register:(owner:any,observe:()=>void)=>void;primary:(owner:any)=>(code:number)=>void}
}
test('705 actual passive xcode close registration is once for already closed late close duplicates and observer faults',()=>{
 const actual=loadXcodeClose705()
 for(const variant of['alreadyClosed','lateClose','observerThrow','registrationThrow','missingChild']){
  const trace:string[]=[],callbacks:Array<()=>void>=[],state:any={xcodeClosed:variant==='alreadyClosed',xcodeCode:null,notify(){trace.push('notify')}}
  state.xcode=variant==='missingChild'?undefined:{once(event:string,callback:()=>void){assert.equal(event,'close');trace.push('register');if(variant==='registrationThrow')throw Error('OWNED_PRIVATE');callbacks.push(callback)}}
  let observations=0;const observe=()=>{trace.push('observe');observations++;if(variant==='observerThrow')throw Error('OWNED_PRIVATE')}
  assert.doesNotThrow(()=>actual.register(state,observe));assert.doesNotThrow(()=>actual.register(state,()=>{throw Error('DUPLICATE_CALLBACK')}))
  if(variant==='alreadyClosed'){assert.equal(observations,1);assert.deepEqual(trace,['observe'])}
  else if(variant==='registrationThrow'||variant==='missingChild'){assert.equal(observations,0);assert.equal(callbacks.length,0)}
  else{assert.deepEqual(trace,['register']);assert.equal(observations,0);actual.primary(state)(65);assert.equal(state.xcodeClosed,true);assert.equal(state.xcodeCode,65);for(let repeat=0;repeat<2;repeat++)assert.doesNotThrow(()=>callbacks[0]());assert.equal(observations,1);assert.deepEqual(trace,['register','notify','observe'])}
  assert.equal(trace.filter(v=>v==='notify').length,['lateClose','observerThrow'].includes(variant)?1:0)
 }
 const source=fs.readFileSync(helper,'utf8'),a=source.indexOf(' // One passive close listener only.'),b=source.indexOf(' canSettle(){',a),method=source.slice(a,b)
 assert.doesNotMatch(method,/await|Promise|Timer|setTimeout|setInterval|notify\(|canSettle\(|cancel\(|cleanup\(|\.kill\(|fs\.|scene\.|observeXcodeCloseOnce\(observeXcodeCloseOnce/)
})
test('705 actual post-cancel projection uses strict closed snapshots once and isolates registration snapshot and logger failures',()=>{
 const source=fs.readFileSync(path.resolve('tests/desktop-native-thread-metadata-476.test.ts'),'utf8'),ast=ts.createSourceFile('native.ts',source,ts.ScriptTarget.Latest,true);let block:ts.Block|undefined
 function visit(n:ts.Node){if(ts.isTryStatement(n)&&n.finallyBlock?.getText(ast).includes('D476_WORKSPACE_NATIVE_PHASE'))block=n.finallyBlock;ts.forEachChild(n,visit)}visit(ast);assert.ok(block)
 const cut=block.statements.findIndex(n=>n.getText(ast).includes('child?.terminate()'));assert.ok(cut>0);const prefix=block.statements.slice(0,cut).map(n=>n.getText(ast)).join('\n'),compiled=ts.transpileModule(prefix,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const actual=loadXcodeClose705()
 for(const variant of['lateClose','alreadyClosed','success','registrationThrow','snapshotThrow','snapshotReadFailed','loggerThrow','endedContext','stdoutThrow','oversize','oversizeUTF8']){
  const f=xcodeModel705(),owner:any=f.state,trace:string[]=[],rows:string[]=[],stdoutRows:string[]=[],callbacks:Array<()=>void>=[];let postRegistered=false,notifications=0
  owner.xcodeClosed=variant==='alreadyClosed';owner.xcode={once(event:string,callback:()=>void){assert.equal(event,'close');callbacks.push(callback)}};owner.notify=()=>{notifications++}
  owner.diagnostic=()=>({begun:true});owner.scene.receiptMask=()=>7;owner.scene.uiRefusal=()=>null;owner.scene.uiProgress=()=>({stage:11,detail:0});owner.cancel=()=>{trace.push('cancel')}
  owner.xcodeFailureObservation=()=>{if(postRegistered&&variant==='snapshotThrow')throw Error('OWNED_PRIVATE');if(postRegistered&&variant==='oversize')return{secret:'x'.repeat(1025)};if(postRegistered&&variant==='oversizeUTF8')return{secret:'é'.repeat(513)};return loadXcode705(f.io,{getuid:()=>7},path.posix)(owner)}
  owner.observeXcodeCloseOnce=(observe:()=>void)=>{trace.push('register');postRegistered=true;if(variant==='registrationThrow')throw Error('OWNED_PRIVATE');actual.register(owner,observe)}
  const scope:any={uiOwner:owner,primaryFailed:variant!=='success',surfaceLease:{retain(){}},required:[],receipts:new Set(),picks:1,pickerObserved:1,pickerReturned:0,cancelReturned:0,connections:1,authenticated:true,windowRequested:true,settled:false,childExitCode:null,firstFailedAssertion:0,failed:true,failureSite:9,pickOutcome:1,pickerLifecycle:null,nativeDiagnostic:null,diagnosticInvalid:false,selectedOutcome:null,selectedIdentity:null,cancelClose:null,cancelShow:null,cancelSettled:null,cancelCurrent:null,Buffer,process:{stdout:{write(row:string){assert.equal(typeof row,'string');if(variant==='stdoutThrow')throw Error('OWNED_PRIVATE');stdoutRows.push(row);return true}}},t:{diagnostic(row:string){if(variant==='endedContext'||postRegistered&&variant==='loggerThrow')throw Error('OWNED_PRIVATE');rows.push(row)}}}
  assert.doesNotThrow(()=>vm.runInNewContext(compiled,scope,{timeout:1000}));assert.equal(trace[0],'cancel');assert.equal(trace.filter(v=>v==='cancel').length,1)
  if(variant!=='success')assert.equal(trace[1],'register');else assert.deepEqual(trace,['cancel'])
  if(callbacks.length){if(variant==='snapshotReadFailed')f.io.readSync=()=>{throw Error('OWNED_PRIVATE')};actual.primary(owner)(65);assert.doesNotThrow(()=>callbacks[0]());assert.doesNotThrow(()=>callbacks[0]())}
  const before=rows.filter(row=>row.startsWith('D705_XCODE_FAILURE ')),after=stdoutRows.filter(row=>row.startsWith('D705_XCODE_FAILURE_AFTER_CANCEL '));assert.equal(before.length,['success','endedContext'].includes(variant)?0:1)
  const expected=['lateClose','alreadyClosed','snapshotReadFailed','loggerThrow','endedContext'].includes(variant);assert.equal(after.length,expected?1:0,variant)
  assert.equal(stdoutRows.length,expected?1:0);if(expected){assert.ok(after[0].endsWith('\n'));assert.equal(after[0].split('\n').length,2);const observation=JSON.parse(after[0].slice('D705_XCODE_FAILURE_AFTER_CANCEL '.length));assert.equal(observation.schema,1);assert.equal(observation.stdout.status,variant==='snapshotReadFailed'?'READ_FAILED':'OBSERVED');assert.equal(after[0].includes('OWNED_PRIVATE'),false)}
  assert.equal(scope.primaryFailed,variant!=='success');assert.equal(scope.failed,true);assert.equal(scope.failureSite,9);assert.equal(notifications,callbacks.length?1:0);assert.equal(f.fds.size,0)
 }
 assert.equal(prefix.split('uiOwner?.cancel()').length,2);assert.equal(prefix.split('owner.observeXcodeCloseOnce(').length,2)
 assert.ok(prefix.indexOf("'D705_XCODE_FAILURE '")<prefix.indexOf('uiOwner?.cancel()'));assert.ok(prefix.indexOf('uiOwner?.cancel()')<prefix.indexOf('owner.observeXcodeCloseOnce('))
})


// Extract actual normal Swift enum and census body. AX is an inert input, not a native claim.
function actualChooseCensus705(publish:(name:string,value:any)=>void,counts:number[],buttons:Array<[string,string]>=[],fault?:'label'|'title'){
 const source=fs.readFileSync(path.join(files,'WorkspacePickerUITests.swift'),'utf8').replace(/\r\n/g,'\n'),match=/  func observeChooseCensus\(\)\{([\s\S]*?)\n  \}/.exec(source);assert.ok(match)
 const protocol=fs.readFileSync(path.join(files,'OwnedUIProtocol.swift'),'utf8').replace(/\r\n/g,'\n'),enumeration=/enum OwnedUI705ButtonIdentity: Int \{\n case ([^\n]+)\n init\(_ value:String\) \{\n  switch value \{([\s\S]*?)\n  \}\n \}\n\}/.exec(protocol);assert.ok(enumeration)
 const values:any={};for(const field of enumeration[1].split(',')){const pair=/^\s*([a-z]+)=([0-5])\s*$/.exec(field);assert.ok(pair);values[pair[1]]=Number(pair[2])}assert.deepEqual(values,{empty:0,choose:1,open:2,go:3,cancel:4,other:5})
 const branches=enumeration[2].replace(/self = \.([a-z]+)/g,'return values.$1');assert.doesNotMatch(branches,/self|OwnedUI|rawValue/)
 const project=vm.compileFunction('switch(value){'+branches+'}',['value','values'])
 const identity=(value:string)=>project(value,values)
 for(const [text,expected]of[['',0],['Choose',1],['Open',2],['Go',3],['Cancel',4],['OTHER',5],['choose',5],['PRIVATE_CENSUS/中',5]]as const)assert.equal(identity(text),expected)
 let body=match[1],payload=/try\? scene\.write\(\.uiChooseCensus,(\["schema":1,[^\n]+\])\)/.exec(body);assert.ok(payload)
 const object='{'+payload[1].slice(1,-1).replace(/\bmin\(/g,'Math.min(')+'}'
 body=body.replace(payload[0],'try{scene.write("ui-choose-census.json",'+object+')}catch{}').replace('if chooseCensusAttempted{return};chooseCensusAttempted=true','if(chooseCensusAttempted){return};chooseCensusAttempted=true').replace('var buttonIdentityRows=[[Int]]()','const buttonIdentityRows=[]').replace('for index in 0..<min(sheetButtonCount,8) {','for(var index=0;index<Math.min(sheetButtonCount,8);index++){').replace('element(boundBy:index)','element({boundBy:index})').replace('buttonIdentityRows.append','buttonIdentityRows.push').replace(/OwnedUI705ButtonIdentity\(button\.(label|title)\)\.rawValue/g,'identity(button.$1)').replace(/\blet /g,'const ').replace('guard sheetLabelCount>=0,sheetButtonCount>=0,ownerLabelCount>=0 else{return}','if(!(sheetLabelCount>=0&&sheetButtonCount>=0&&ownerLabelCount>=0)){return}').replace('matching(identifier:scene.nonce)','matching({identifier:scene.nonce})').replace('NSPredicate(format:"label IN %@",["Choose","Open"])','({format:"label IN %@",values:["Choose","Open"]})')
 assert.doesNotMatch(body,/try\?|\bguard\b|OwnedUI|\blet\b|NSPredicate|matching\(identifier:|\[\[Int\]\]|\.append\(/)
 const calls:string[]=[],count=(index:number)=>{calls.push(['sheetLabel','sheetButtons','ownerLabel'][index]);return counts[index]}
 const scene={nonce:'a'.repeat(64),write(name:string,value:any){calls.push('write');publish(name,value)}}
 const scope:any={
  scene,identity,
  labelChoose:{get count(){return count(0)}},
  first:{buttons:{
   get count(){return count(1)},
   element(query:any){
    assert.ok(Number.isInteger(query.boundBy)&&query.boundBy>=0&&query.boundBy<8);const index=query.boundBy;calls.push('element:'+index);
    return{
     get label(){calls.push('label:'+index);if(fault==='label')throw Error('PRIVATE_CENSUS');return buttons[index]?.[0]??'PRIVATE_CENSUS'},
     get title(){calls.push('title:'+index);if(fault==='title')throw Error('PRIVATE_CENSUS');return buttons[index]?.[1]??'PRIVATE_CENSUS'}
    }
   }
  }},
  app:{windows:{
   matching(query:any){
    assert.equal(query.identifier,scene.nonce);
    return{buttons:{
     matching(predicate:any){
      assert.equal(predicate.format,'label IN %@');assert.equal(JSON.stringify(predicate.values),'["Choose","Open"]');
      return{get count(){return count(2)}}
     }
    }}
   }
  }}
 }
 vm.runInNewContext('let chooseCensusAttempted=false;globalThis.observe=()=>{'+body+'}',scope,{timeout:1000});return{observe:()=>scope.observe(),calls}
}
test('705 choose census uses the actual Swift producer and strict owned receipt without lifecycle authority',()=>{
 const identities:Array<[string,string]>=[['','Choose'],['Open','Go'],['Cancel','PRIVATE_CENSUS'],['choose','Choose'],['PRIVATE_CENSUS/中','Open'],['Go','Cancel'],['Open',''],['Cancel','Go'],['IGNORED_PRIVATE_CENSUS','IGNORED_PRIVATE_CENSUS']]
 const expected=[[0,1],[2,3],[4,5],[5,1],[5,2],[3,4],[2,0],[4,3]]
 for(const counts of[[0,0,0],[1,1,1],[2,3,7],[99,10,100],[0,8,0]]){
  const f=loadBoundary();assert.equal(f.api.uiChooseCensus().status,'UNKNOWN');let writes=0
  const actual=actualChooseCensus705((name,value)=>{writes++;f.api.write(name,value)},counts,identities);actual.observe();actual.observe();assert.equal(writes,1)
  const callNames=['sheetLabel','sheetButtons','ownerLabel'];for(let index=0;index<Math.min(counts[1],8);index++)callNames.push('element:'+index,'label:'+index,'title:'+index);callNames.push('write');assert.deepEqual(actual.calls,callNames)
  const receipt=JSON.parse(f.store.get(f.root+'/ui-choose-census.json').bytes.toString('utf8')),value=JSON.parse(JSON.stringify(f.api.uiChooseCensus()));assert.equal(value.status,'OBSERVED');assert.equal(value.schema,1);for(const [field,index]of[['sheetLabelCount',0],['sheetButtonCount',1],['ownerLabelCount',2]]as const)assert.equal(value[field],Math.min(counts[index],2))
  assert.equal(value.buttonCount,Math.min(counts[1],8));assert.equal(value.buttonsMore,counts[1]>8);assert.deepEqual(value.buttonIdentityRows,expected.slice(0,Math.min(counts[1],8)));assert.equal(JSON.stringify(receipt).includes('PRIVATE_CENSUS'),false)
  assert.equal(f.api.uiRefusal(),null);assert.equal(f.api.uiProgress(),null);assert.equal(f.api.receiptMask(),0);assert.equal(f.api.closure(true,true),false)
  const unknown=()=>{const v=f.api.uiChooseCensus();assert.equal(v.status,'UNKNOWN');for(const field of['sheetLabelCount','sheetButtonCount','ownerLabelCount','buttonCount','buttonsMore','buttonIdentityRows'])assert.equal(v[field],null);assert.equal(JSON.stringify(v).includes('PRIVATE_CENSUS'),false)}
  const badRows=[null,{},'PRIVATE_CENSUS',[[6,0]],[[-1,0]],[[true,0]],[[1.5,0]],[['Choose',0]],[[null,0]],[[0]],[[0,0,0]],Array.from({length:9},()=>[0,0])]
  for(const mutation of[{schema:2},{nonce:'b'.repeat(64)},{status:'PRIVATE_CENSUS'},{extra:'PRIVATE_CENSUS'},...['sheetLabelCount','sheetButtonCount','ownerLabelCount'].flatMap(field=>[-1,3,1.5,true,'1',null].map(bad=>({[field]:bad}))),...[-1,9,1.5,true,'1',null].map(buttonCount=>({buttonCount})),...['true',1,null].map(buttonsMore=>({buttonsMore})),...badRows.map(buttonIdentityRows=>({buttonIdentityRows})),{buttonCount:0,buttonsMore:true,buttonIdentityRows:[]},{buttonCount:1,buttonsMore:false,buttonIdentityRows:[[0,0]],sheetButtonCount:0}]){f.put('ui-choose-census.json',{...receipt,...mutation});unknown()}
  for(const field of['schema','nonce','status','sheetLabelCount','sheetButtonCount','ownerLabelCount','buttonCount','buttonsMore','buttonIdentityRows']){const v={...receipt};delete v[field];f.put('ui-choose-census.json',v);unknown()}
  for(const fault of['nonfile','symlink','nlink','uid','mode','oversize','empty','utf8','duplicate']){f.put('ui-choose-census.json',receipt);const row=f.store.get(f.root+'/ui-choose-census.json');if(fault==='nonfile')row.nonfile=true;if(fault==='symlink')row.symlink=true;if(fault==='nlink')row.nlink=2;if(fault==='uid')row.uid=8;if(fault==='mode')row.mode=0o644;if(fault==='oversize')row.bytes=Buffer.alloc(4097,65);if(fault==='empty')row.bytes=Buffer.alloc(0);if(fault==='utf8')row.bytes=Buffer.from([255]);if(fault==='duplicate')row.bytes=Buffer.from(row.bytes.toString().replace('"schema":1','"schema":1,"schema":1'));unknown()}
  f.store.delete(f.root+'/ui-choose-census.json');unknown();f.full();assert.equal(f.api.receiptMask(),31);assert.equal(f.api.closure(true,true),true);f.put('ui-choose-census.json',receipt);assert.equal(f.api.uiChooseCensus().status,'OBSERVED');assert.equal(f.api.receiptMask(),31);assert.equal(f.api.closure(true,true),true)
 }
 let writes=0;const refused=actualChooseCensus705(()=>{writes++;throw Error('PRIVATE_CENSUS')},[1,2,3],identities);assert.doesNotThrow(refused.observe);assert.doesNotThrow(refused.observe);assert.equal(writes,1)
 const invalid=actualChooseCensus705(()=>assert.fail('no publication'),[-1,1,1]);invalid.observe();invalid.observe();assert.deepEqual(invalid.calls,['sheetLabel','sheetButtons','ownerLabel'])
 for(const fault of['label','title']as const){const f=loadBoundary(),broken=actualChooseCensus705((name,value)=>f.api.write(name,value),[1,2,0],identities,fault);assert.throws(broken.observe,/PRIVATE_CENSUS/);assert.doesNotThrow(broken.observe);assert.equal(f.api.uiChooseCensus().status,'UNKNOWN');assert.equal(f.store.has(f.root+'/ui-choose-census.json'),false)}
})
test('705 choose census restores all four prior sources and preserves original query budget and actions',()=>{
 const actual={ui:fs.readFileSync(path.join(files,'WorkspacePickerUITests.swift'),'utf8'),protocol:fs.readFileSync(path.join(files,'OwnedUIProtocol.swift'),'utf8'),helper:fs.readFileSync(helper,'utf8'),native:fs.readFileSync(path.resolve('tests/desktop-native-thread-metadata-476.test.ts'),'utf8')}
 for(const eol of['\n','\r\n'])for(const kind of['ui','protocol','helper','native']as const){const source=actual[kind].replace(/\r\n/g,'\n').replace(/\n/g,eol);assert.ok(previousCensus705(kind,source));assert.throws(()=>previousCensus705(kind,source+'\n'),{code:'ERR_ASSERTION'})}
 const ui=previousCriticalCensus705('ui',actual.ui),start=ui.indexOf('  uiStage=11;'),end=ui.indexOf('  uiStage=12;',start);assert.ok(start>=0&&end>start);const sequence=ui.slice(start,end),ordered=['let chooseElement=choose.firstMatch','observeChooseCensus()','let chooseTimeout=try remaining()','let chooseSeen=chooseElement.waitForExistence(timeout:chooseTimeout)','guard chooseSeen else','let chooseCount=choose.count','guard chooseCount==1 else'];let at=-1;for(const piece of ordered){const next=sequence.indexOf(piece);assert.ok(next>at,piece);at=next}
 assert.equal(ui.split('observeChooseCensus();').length,2);assert.equal(sequence.match(/waitForExistence\(/g)?.length,1);assert.equal(sequence.match(/try remaining\(\)/g)?.length,1);assert.ok(ui.includes('guard chooseHittable else{throw OwnedUI705Error.refused}'));assert.ok(ui.includes('choose.element.click()'));assert.ok(ui.includes('guard r>0,r<=45 else'))
 const census=ui.slice(ui.indexOf('  func observeChooseCensus(){'),start);assert.doesNotMatch(census,/debugDescription|allElements|\.click\(|\.waitForExistence\(|Timer|sleep|Dispatch|Task\./);assert.equal(census.split('button.label').length,2);assert.equal(census.split('button.title').length,2);assert.equal(census.split('for index in 0..<min(sheetButtonCount,8)').length,2);assert.equal(census.match(/\.count\b/g)?.length,3);const payload=/try\? scene\.write\(\.uiChooseCensus,([^\n]+)/.exec(census);assert.ok(payload);assert.doesNotMatch(payload[1],/button\.label|button\.title|description/)
 const attributes=fs.readFileSync(path.resolve('../.gitattributes'),'utf8').replace(/\r\n/g,'\n'),file=fs.readFileSync(helper,'utf8');for(const name of['WorkspacePickerUITests.swift','OwnedUIProtocol.swift']){assert.equal(attributes.split('/companion/tests/fixtures/workspace-ui-705/'+name+' text eol=lf\n').length,2);assert.ok(file.includes(createHash('sha256').update(fs.readFileSync(path.join(files,name))).digest('hex')))}
})

test('705 same owned sheet title or label query preserves one unique hittable approval and actual title census',()=>{
 const ui=fs.readFileSync(path.join(files,'WorkspacePickerUITests.swift'),'utf8').replace(/\r\n/g,'\n')
 const query=/let choose=first\.buttons\.matching\(NSPredicate\(format:"([^"]+)",\["Choose","Open"\],\["Choose","Open"\]\)\)/.exec(ui);assert.ok(query)
 const attributes=query[1].split(' OR ').map(value=>{const m=/^(label|title) IN %@$/.exec(value);assert.ok(m);return m[1] as 'label'|'title'});assert.deepEqual(attributes,['label','title'])
 const matches=(buttons:Array<{label:string;title:string}>)=>buttons.filter(button=>attributes.some(attribute=>['Choose','Open'].includes(button[attribute])))
 assert.equal(matches([{label:'',title:'Choose'}]).length,1)
 assert.equal(matches([{label:'Choose',title:'Choose'}]).length,1)
 assert.equal(matches([{label:'Open',title:''}]).length,1)
 assert.equal(matches([{label:'Go',title:'Go'},{label:'Cancel',title:'Cancel'}]).length,0)
 assert.equal(matches([{label:'Choose',title:''},{label:'',title:'Open'}]).length,2)
 const fragment=ui.slice(ui.indexOf('  uiStage=11;'),ui.indexOf('  uiStage=14;'))
 assert.ok(fragment.indexOf('guard chooseCount==1 else')<fragment.indexOf('let chooseHittable=choose.element.isHittable'))
 assert.ok(fragment.indexOf('guard chooseHittable else')<fragment.indexOf('choose.element.click()'))
 assert.ok(ui.includes('let sheetLabelCount=labelChoose.count'));assert.ok(ui.includes('buttonIdentityRows.append([label,title])'))
 assert.ok(ui.includes('guard r>0,r<=45 else'));assert.ok(ui.includes('cancel=second.buttons.matching(identifier:"Cancel")'))
 assert.equal(createHash('sha256').update(previousTitle705('ui',ui)).digest('hex'),"182d2773a37134d289fec9c80a27107b5359c51d2cab1545bdfd62c3f6a2cee4")
})

test('705 actual POSIX snapshot model is independent of the host path namespace',()=>{
 const current=fs.readFileSync(path.resolve('tests/desktop-workspace-xctest-705.test.ts'),'utf8'),ast=ts.createSourceFile('current.ts',current,ts.ScriptTarget.Latest,true)
 const functions=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&['loadXcode705','xcodeModel705'].includes(n.name?.text??''));assert.equal(functions.length,2)
 const code=ts.transpileModule(functions.map(n=>n.getText(ast)).join('\n')+';globalThis.model=xcodeModel705',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 for(const hostPath of[path.posix,path.win32]){
  const scope:any={fs,helper,ts,vm,Buffer,TextDecoder,assert,path:hostPath,process};vm.runInNewContext(code,scope,{timeout:1000})
  const f=scope.model(),value=f.observe();assert.equal(value.stdout.status,'OBSERVED');assert.equal(value.stdout.firstNSError.code,4);assert.equal(f.fds.size,0)
  // A Windows join against the POSIX-keyed inert store is the original mismatch.
  assert.equal(loadXcode705(f.io,{getuid:()=>7},path.win32)(f.state).stdout.status,'MISSING')
 }
})


test('705 live Choose path omits the synchronous auxiliary census and restores entire dc9 authorities',()=>{
 const actual=fs.readFileSync(path.join(files,'WorkspacePickerUITests.swift'),'utf8'),owner=fs.readFileSync(helper,'utf8')
 for(const eol of ['\n','\r\n']){
  const source=actual.replace(/\r\n/g,'\n').replace(/\n/g,eol),canonical=source.replace(/\r\n/g,'\n'),prior=previousCriticalCensus705('ui',source)
  assert.equal(canonical.split('observeChooseCensus();').length,1,'historical census definition is not invoked')
  assert.equal(prior.split('observeChooseCensus();').length,2,'inverse restores the original one call')
  assert.equal(previousCriticalCensus705('helper',owner).includes('1c9da3dd55238e24652db387a3dd351ae49f40bc4c566c5db8621a9fdf453b68'),true)
  for(const mutant of [source+'\n',source.replace('guard chooseCount==1 else','guard chooseCount>=1 else'),source.replace('guard chooseHittable else','guard true else'),source.replace('choose.element.click()','choose.element.doubleClick()'),source.replace('guard r>0,r<=45 else','guard r>0,r<=46 else')])assert.throws(()=>previousCriticalCensus705('ui',mutant),{code:'ERR_ASSERTION'})
  assert.throws(()=>previousCriticalCensus705('helper',owner+'\n'),{code:'ERR_ASSERTION'})
 }
 // Project the actual stage11→13 statements; this is a controlled synchronous
 // framework fault, not an AX/macOS execution or the hosted physical cause.
 function run(source:string,{seen=true,count=1,hittable=true}={}){
  const ui=source.replace(/\r\n/g,'\n'),start=ui.indexOf('  uiStage=11;'),end=ui.indexOf('  uiStage=14;',start);assert.ok(start>=0&&end>start)
  let body=ui.slice(start,end)
  for(const [current,replacement]of [
   ['guard chooseSeen else{throw OwnedUI705Error.refused}',"if(!chooseSeen){throw Error('OWNED_UI_REFUSED')}"],
   ['guard chooseCount==1 else{throw OwnedUI705Error.refused}',"if(!(chooseCount==1)){throw Error('OWNED_UI_REFUSED')}"],
   ['guard chooseHittable else{throw OwnedUI705Error.refused}',"if(!chooseHittable){throw Error('OWNED_UI_REFUSED')}"],
   ['chooseElement.waitForExistence(timeout:chooseTimeout)','chooseElement.waitForExistence({timeout:chooseTimeout})']
  ]){assert.equal(body.split(current).length,2,current);body=body.replace(current,replacement)}
  body=body.replaceAll('_ = try remaining()','remaining()').replaceAll('try remaining()','remaining()').replaceAll('let ','const ').replaceAll('min(chooseCount,2)','Math.min(chooseCount,2)')
  assert.doesNotMatch(body,/\bguard\b|\btry\b|OwnedUI|waitForExistence\(timeout:|_ =|\blet\b/)
  const calls:string[]=[],element={get isHittable(){calls.push('hittable');return hittable},click(){calls.push('click')}}
  const scope={Math,observeUIStage(){},observeChooseCensus(){calls.push('census');throw Error('OWNED_CENSUS_INTERFERENCE')},remaining(){calls.push('remaining');return 1},choose:{get firstMatch(){calls.push('firstMatch');return{waitForExistence(value:{timeout:number}){assert.equal(value.timeout,1);calls.push('wait');return seen}}},get count(){calls.push('count');return count},element}}
  return{calls,run:()=>vm.runInNewContext('let uiStage=0,uiDetail=0;'+body,scope,{timeout:1000})}
 }
 const current=run(actual);assert.doesNotThrow(current.run);assert.deepEqual(current.calls,['firstMatch','remaining','wait','count','hittable','remaining','click'])
 const old=run(previousCriticalCensus705('ui',actual));assert.throws(old.run,/OWNED_CENSUS_INTERFERENCE/);assert.deepEqual(old.calls,['firstMatch','census'])
 for(const options of [{seen:false},{count:0},{count:2},{hittable:false}]){const refusal=run(actual,options);assert.throws(refusal.run,/OWNED_UI_REFUSED/);assert.equal(refusal.calls.includes('click'),false);assert.equal(refusal.calls.includes('census'),false)}
})


// Actual Swift statements with explicit inert XCUI/clock seams. This neither
// executes Swift nor simulates the observed macOS AX hierarchy.
function inputReadyProjection705(source:string,options:{initial?:boolean;appears?:boolean;kind?:'combo'|'text';count?:number;hittable?:boolean;cancelled?:boolean;expired?:boolean;cancelOnWait?:boolean;expireOnWait?:boolean}={}){
 const ui=source.replace(/\r\n/g,'\n'),start=ui.indexOf('  uiStage=7;'),end=ui.indexOf('  let choose=first.buttons.matching(',start)
 assert.ok(start>=0&&end>start);let body=ui.slice(start,end)
 const remainingLine=ui.split('\n').find(line=>line.includes('func remaining() throws ->TimeInterval {'));assert.ok(remainingLine)
 const signature='  func remaining() throws ->TimeInterval {';assert.ok(remainingLine.startsWith(signature)&&remainingLine.endsWith('}'))
 let remaining=remainingLine.slice(signature.length,-1)
 for(const [current,replacement]of[
  ['try scene.requireActive()','scene.requireActive()'],
  ['let r=','const r='],['Date().timeIntervalSince1970','clock()'],
  ['guard r>0,r<=45 else{','if(!(r>0&&r<=45)){'],
  ['throw OwnedUI705Error.refused',"throw Error('OWNED_UI_REFUSED')"],
 ]as const){assert.equal(remaining.split(current).length,2,current);remaining=remaining.replace(current,replacement)}
 const predicate='NSPredicate(format:"elementType IN %@",[XCUIElement.ElementType.comboBox.rawValue,XCUIElement.ElementType.textField.rawValue])'
 if(body.includes('let inputCandidates=')){
  assert.equal(body.split(predicate).length,2);body=body.replace(predicate,'predicate("elementType IN %@",["comboBox","textField"])')
  for(const [current,replacement]of[
   ['first.descendants(matching:.any)','first.descendants({matching:"any"})'],
   ['guard inputCandidates.firstMatch.waitForExistence(timeout:try remaining()) else{throw OwnedUI705Error.refused}',"if(!inputCandidates.firstMatch.waitForExistence({timeout:remaining()})){throw Error('OWNED_UI_REFUSED')}"],
  ]as const){assert.equal(body.split(current).length,2,current);body=body.replace(current,replacement)}
 }
 for(const [current,replacement]of[
  ['guard inputCount==1 else{throw OwnedUI705Error.refused}',"if(!(inputCount==1)){throw Error('OWNED_UI_REFUSED')}"],
  ['guard inputHittable else{throw OwnedUI705Error.refused}',"if(!inputHittable){throw Error('OWNED_UI_REFUSED')}"],
  ['min(comboCount,2)','Math.min(comboCount,2)'],['min(inputCount,2)','Math.min(inputCount,2)'],
  ['modifierFlags:[]','{modifierFlags:[]}'],
 ]as const){assert.equal(body.split(current).length,2,current);body=body.replace(current,replacement)}
 body=body.replaceAll('_ = try remaining()','remaining()').replaceAll('try remaining()','remaining()').replaceAll('let ','const ')
 assert.doesNotMatch(body+'\n'+remaining,/\bguard\b|\btry\b|OwnedUI705Error|NSPredicate|XCUIElement|matching:\.any|_ =|\blet\b|Date\(\)/)
 let available=options.initial??true,cancelled=options.cancelled??false,expired=options.expired??false;const kind=options.kind??'combo',count=options.count??1,calls:string[]=[]
 const element={get isHittable(){calls.push('hittable');return options.hittable??true},click(){calls.push('click')},typeText(value:string){assert.equal(value,'/owned/selection705');calls.push('text')},typeKey(key:string,flags:{modifierFlags:unknown[]}){assert.equal(key,'\r');assert.equal(flags.modifierFlags.length,0);calls.push('return')}}
 const query=(name:'combo'|'text')=>({get count(){calls.push(name+'Count');return available&&name===kind?count:0},get element(){calls.push(name+'Element');return element}})
 const combo=query('combo'),text=query('text')
 const candidateQuery={get firstMatch(){
  calls.push('firstMatch')
  return{waitForExistence(value:{timeout:number}){
   assert.equal(value.timeout,1);calls.push('wait')
   if(options.appears===false)return false
   if(options.cancelOnWait){cancelled=true;calls.push('cancelOnWait')}
   if(options.expireOnWait){expired=true;calls.push('expireOnWait')}
   // Post-wait count controls may model disappearance or ambiguity; not AX evidence.
   available=true;return true
  }}
 }}
 const first={
  get comboBoxes(){return combo},get textFields(){return text},
  descendants(value:{matching:string}){
   assert.equal(value.matching,'any');assert.deepEqual(Object.keys(value),['matching']);calls.push('descendants')
   return{matching(value:{format:string;types:string[]}){
    assert.equal(value.format,'elementType IN %@');assert.deepEqual(Array.from(value.types),['comboBox','textField']);calls.push('matching');return candidateQuery
   }}
  },
 }
 const scope={Math,Error,calls,first,deadline:1000,clock:()=>expired?1:0,observeUIStage(){},
  scene:{selection:{path:'/owned/selection705'},requireActive(){calls.push('active');if(cancelled)throw Error('OWNED_UI_CANCELLED')}},
  predicate(format:string,types:string[]){assert.equal(format,'elementType IN %@');assert.deepEqual(Array.from(types),['comboBox','textField']);calls.push('predicate');return{format,types}},
 }
 return{calls,run:()=>vm.runInNewContext("let uiStage=0,uiDetail=0;function remaining(){calls.push('remaining');"+remaining+'}\n'+body,scope,{timeout:1000})}
}
test('705 actual input readiness waits in the owned sheet before original count priority hittability and path actions',()=>{
 const actual=fs.readFileSync(path.join(files,'WorkspacePickerUITests.swift'),'utf8')
 for(const eol of ['\n','\r\n']){
  const source=actual.replace(/\r\n/g,'\n').replace(/\n/g,eol),prior=previousInputReady705('ui',source)
  for(const kind of ['combo','text']as const)for(const initial of [true,false]){
   const current=inputReadyProjection705(source,{kind,initial});assert.doesNotThrow(current.run)
   assert.deepEqual(current.calls.filter(value=>['click','text','return'].includes(value)),['click','text','return'])
   assert.equal(current.calls.filter(value=>value==='wait').length,1)
   assert.ok(current.calls.indexOf('wait')<current.calls.indexOf('comboCount'))
   assert.ok(current.calls.indexOf('hittable')<current.calls.indexOf('click'))
   const old=inputReadyProjection705(prior,{kind,initial})
   if(initial){assert.doesNotThrow(old.run);assert.deepEqual(old.calls,current.calls.filter(value=>!['descendants','predicate','matching','firstMatch','wait'].includes(value)).slice(2))}
   else{assert.throws(old.run,/OWNED_UI_REFUSED/);assert.equal(old.calls.some(value=>['click','text','return'].includes(value)),false)}
  }
  for(const options of [{initial:false,appears:false},{cancelled:true},{expired:true},{count:0},{kind:'text' as const,count:2},{kind:'combo' as const,count:2},{hittable:false},{cancelOnWait:true},{expireOnWait:true}]){
   const refused=inputReadyProjection705(source,options);assert.throws(refused.run,/OWNED_UI_(?:REFUSED|CANCELLED)/)
   assert.equal(refused.calls.some(value=>['click','text','return'].includes(value)),false)
   if('cancelOnWait'in options||'expireOnWait'in options){assert.equal(refused.calls.filter(value=>value==='wait').length,1);assert.ok(refused.calls.includes('hittable'),'post-wait original count/hit precedes the existing action boundary')}
  }
 }
})
test('705 input readiness restores exact preceding UI and helper for both source EOL profiles without weakening any authority',()=>{
 const ui=fs.readFileSync(path.join(files,'WorkspacePickerUITests.swift'),'utf8'),owner=fs.readFileSync(helper,'utf8')
 for(const eol of ['\n','\r\n'])for(const [kind,actual,expected]of [['ui',ui,'0b193e101ccee97e618500e56208e6e1740bad28558a8c2439252efca7b9b572'],['helper',owner,'1f8e2f2129378ec2ccc4510e6a4ab29a4445fa71208223ef04c4114b2bf0885d']]as const){
  const source=actual.replace(/\r\n/g,'\n').replace(/\n/g,eol),prior=previousInputReady705(kind,source)
  assert.equal(createHash('sha256').update(prior).digest('hex'),expected)
  assert.throws(()=>previousInputReady705(kind,source+'\n'),{code:'ERR_ASSERTION'})
 }
 const canonical=ui.replace(/\r\n/g,'\n'),start=canonical.indexOf('  uiStage=7;'),end=canonical.indexOf('  let choose=first.buttons.matching(',start),fragment=canonical.slice(start,end)
 assert.ok(start>=0&&end>start);assert.equal(fragment.match(/waitForExistence\(/g)?.length,1)
 assert.ok(fragment.indexOf('first.descendants(matching:.any)')<fragment.indexOf('let comboCount=first.comboBoxes.count'))
 assert.ok(fragment.includes('let inputs=comboCount==1 ? first.comboBoxes:first.textFields'))
 assert.ok(fragment.includes('guard inputCount==1 else{throw OwnedUI705Error.refused}'))
 assert.ok(fragment.includes('guard inputHittable else{throw OwnedUI705Error.refused}'))
 assert.doesNotMatch(fragment,/Timer|sleep|Dispatch|Task\.|app\.|\.activate\(|\.launch\(|\.terminate\(|\.count\s*>=|doubleClick|coordinate/)
 assert.ok(canonical.includes('guard r>0,r<=45 else'))
 assert.ok(canonical.includes('first.typeKey("g",modifierFlags:[.command,.shift])'))
 assert.ok(canonical.includes('cancel=second.buttons.matching(identifier:"Cancel")'))
 for(const [current,mutation]of [['guard inputCount==1 else','guard inputCount>=1 else'],['guard inputHittable else','guard true else'],['inputs.element.click()','inputs.element.doubleClick()'],['guard r>0,r<=45 else','guard r>0,r<=46 else']]as const){assert.equal(canonical.split(current).length,2);assert.throws(()=>previousInputReady705('ui',canonical.replace(current,mutation)),{code:'ERR_ASSERTION'})}
})

// Source text only: undo the exact #772 passive observation before existing authorities.
// All prior hashes, predicates and executable native assertions remain unchanged.
function confirmationObservationInverse772(raw:string){
 const pairs:[string,string][]=[["import { createConfirmationObservation772 } from \"./fixtures/native-confirmation-observer-772\"\nimport { createTerminalObserver747, rawMarker747 } from \"./helpers/terminal-observer-747\"\n","import { createTerminalObserver747, rawMarker747 } from \"./helpers/terminal-observer-747\"\n"],["test('#476 native local-work keys→real PTY/ACP→explicit handback→same history',{skip:!['darwin','win32'].includes(process.platform),timeout:45000},async t=>withSurface650(t,async(t,surfaceLease)=>{\n const confirmationObservation772=createConfirmationObservation772('LOCAL',()=>performance.now(),line=>t.diagnostic(line));let confirmationOrdinal772=0\n t.signal.addEventListener('abort',()=>confirmationObservation772.emit('ABORT'),{once:true})\n const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'native-local-work-476-'))),previous=process.env.CMSPARK_DATA_DIR,skipLogin=process.env.CMSPARK_SKIP_LOGIN_ENV;process.env.CMSPARK_DATA_DIR=dir;process.env.CMSPARK_SKIP_LOGIN_ENV='1'\n","test('#476 native local-work keys→real PTY/ACP→explicit handback→same history',{skip:!['darwin','win32'].includes(process.platform),timeout:45000},async t=>withSurface650(t,async(t,surfaceLease)=>{\n const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'native-local-work-476-'))),previous=process.env.CMSPARK_DATA_DIR,skipLogin=process.env.CMSPARK_SKIP_LOGIN_ENV;process.env.CMSPARK_DATA_DIR=dir;process.env.CMSPARK_SKIP_LOGIN_ENV='1'\n"],[" const realAgentStart=runtime.startAgent;runtime.startAgent=input=>{localProgress.runtime();return Reflect.apply(realAgentStart!,runtime,[input])}\n const realOpen=runtime.openTerminal,realInput=runtime.input,realResize=runtime.resize,realClose=runtime.close;runtime.openTerminal=input=>{confirmationObservation772.server(4);assert.equal(input.owner,current);assert.equal(input.threadId,'native-local-A');assert.equal(fs.realpathSync(input.cwd),dir);let closed!:()=>void;const closeState={closed:false},close=new Promise<void>(resolve=>closed=()=>{closeState.closed=true;resolve()});ownedSpawn=true;try{const result=realOpen({...input,send:frame=>{try{dataObservation.frame(frame)}catch{dataObservation.incomplete() /* Observation cannot replace the original send. */}if(frame.type==='terminal.closed')closed();input.send(frame)}});if(result.ok){ptyClosed.push(close);ptyClosedStates.push(closeState)}return result}finally{ownedSpawn=false}};runtime.input=(id,b64)=>{if(Buffer.from(b64,'base64').toString('utf8').includes('中'))inputUnicode=true;return realInput(id,b64)};runtime.resize=(id,c,r)=>{resizeCalls++;return realResize(id,c,r)};runtime.close=id=>{terminalStops++;return realClose(id)}\n const registry=new DesktopIdentityRegistry(),boot=registry.issue('owned-local-work-476'),confirmations=new SecurityConfirmationManager(),required=['D476_LOCAL_OUTPUT','D476_LOCAL_RESIZED','D476_LOCAL_STOPPED','D476_LOCAL_SAVED','D476_LOCAL_REOPENED','D476_LOCAL_AGENT_SAVED','D476_LOCAL_AGENT_STOPPED','D476_LOCAL_DONE'],receipts=new Set<string>()\n"," const realAgentStart=runtime.startAgent;runtime.startAgent=input=>{localProgress.runtime();return Reflect.apply(realAgentStart!,runtime,[input])}\n const realOpen=runtime.openTerminal,realInput=runtime.input,realResize=runtime.resize,realClose=runtime.close;runtime.openTerminal=input=>{assert.equal(input.owner,current);assert.equal(input.threadId,'native-local-A');assert.equal(fs.realpathSync(input.cwd),dir);let closed!:()=>void;const closeState={closed:false},close=new Promise<void>(resolve=>closed=()=>{closeState.closed=true;resolve()});ownedSpawn=true;try{const result=realOpen({...input,send:frame=>{try{dataObservation.frame(frame)}catch{dataObservation.incomplete() /* Observation cannot replace the original send. */}if(frame.type==='terminal.closed')closed();input.send(frame)}});if(result.ok){ptyClosed.push(close);ptyClosedStates.push(closeState)}return result}finally{ownedSpawn=false}};runtime.input=(id,b64)=>{if(Buffer.from(b64,'base64').toString('utf8').includes('中'))inputUnicode=true;return realInput(id,b64)};runtime.resize=(id,c,r)=>{resizeCalls++;return realResize(id,c,r)};runtime.close=id=>{terminalStops++;return realClose(id)}\n const registry=new DesktopIdentityRegistry(),boot=registry.issue('owned-local-work-476'),confirmations=new SecurityConfirmationManager(),required=['D476_LOCAL_OUTPUT','D476_LOCAL_RESIZED','D476_LOCAL_STOPPED','D476_LOCAL_SAVED','D476_LOCAL_REOPENED','D476_LOCAL_AGENT_SAVED','D476_LOCAL_AGENT_STOPPED','D476_LOCAL_DONE'],receipts=new Set<string>()\n"],[" const deadline=new Promise<never>((_,reject)=>t.signal.addEventListener('abort',()=>reject(Error('OWNED_LOCAL_NATIVE_DEADLINE')),{once:true}));const fail=()=>{failed=true;failResolve()}\n channel.wss.on('connection',ws=>{current=ws;connections++;const originalSend=ws.send;ws.send=function(this:typeof ws,data:any,...args:any[]){try{if(authenticated)localProgress.outgoing(data)}catch{}let observedOrdinal772=0;try{const f=typeof data==='string'?JSON.parse(data):null;if(authenticated&&f?.type==='desktop.confirmation.request'&&f.purpose==='local-work'){observedOrdinal772=++confirmationOrdinal772;confirmationObservation772.server(1,observedOrdinal772)}}catch{}const result772=Reflect.apply(originalSend,this,[data,...args]);if(observedOrdinal772)confirmationObservation772.server(2,observedOrdinal772);return result772} as typeof ws.send;ws.on('message',raw=>{let frame:any;try{frame=JSON.parse(String(raw))}catch{return}try{if(authenticated)localProgress.incoming(frame)}catch{};if(authenticated){confirmationObservation772.native(frame);if(frame.type==='desktop.confirmation.decision'&&frame.purpose==='local-work')confirmationObservation772.server(3,confirmationOrdinal772)};if(!authenticated||frame.type!=='system.ping')return;if(frame.id==='D476_LOCAL_DATA_SEEN'){if(Object.keys(frame).sort().join()==='id,type')dataObservation.renderer();return}try{const activation=parseLocalActivation705(frame.id);if(activation){if(Object.keys(frame).sort().join()==='id,type'&&process.platform==='win32'&&localActivation===null)localActivation=activation;return}}catch{}const focus=parseLocalFocus705(frame.id);if(focus){if(Object.keys(frame).sort().join()==='id,type'&&process.platform==='win32'&&localFocusResult===null)localFocusResult=focus;return}const first=parseLocalFirstSite705(frame.id);if(first){if(Object.keys(frame).sort().join()==='id,type'&&(first.origin==='R'||first.origin==='W'&&process.platform==='win32'||first.origin==='M'&&process.platform==='darwin')&&localFirstSite[first.origin]===null)localFirstSite[first.origin]=first.site;return}if(frame.id==='D476_LOCAL_FAIL'){fail();return}if(!required.includes(frame.id))return;if(receipts.has(frame.id)){fail();return}receipts.add(frame.id);if(frame.id==='D476_LOCAL_DONE'){\n   completion=(async()=>{await Promise.race([Promise.all(childClosures),deadline]);assert.equal(receipts.size,required.length);assert.equal(protocolStarts,2);assert.equal(saved,1);assert.equal(fs.readFileSync(permissionFile,'utf8'),'DENIED');assert.equal(inputUnicode,true);assert.ok(resizeCalls>=2);assert.ok(terminalStops>=1);const disk=new ThreadManager().readDesktopDialog('native-local-A');assert.equal(disk.messages.length,2);assert.ok(disk.messages.some(m=>m.content.includes('D476_LOCAL_中')));assert.ok(disk.messages.some(m=>m.content.includes('D476_AGENT_PERMISSION_DENIED')));assert.equal(new ThreadManager().readDesktopDialog('native-local-B').messages.length,0);assert.equal(manager.hasProjectThreadActivity('native-local-A'),false);ws.send(JSON.stringify({type:'D476.local.complete',result:'COMPLETE'}))})();completion.catch(fail)\n"," const deadline=new Promise<never>((_,reject)=>t.signal.addEventListener('abort',()=>reject(Error('OWNED_LOCAL_NATIVE_DEADLINE')),{once:true}));const fail=()=>{failed=true;failResolve()}\n channel.wss.on('connection',ws=>{current=ws;connections++;const originalSend=ws.send;ws.send=function(this:typeof ws,data:any,...args:any[]){try{if(authenticated)localProgress.outgoing(data)}catch{}return Reflect.apply(originalSend,this,[data,...args])} as typeof ws.send;ws.on('message',raw=>{let frame:any;try{frame=JSON.parse(String(raw))}catch{return}try{if(authenticated)localProgress.incoming(frame)}catch{};if(!authenticated||frame.type!=='system.ping')return;if(frame.id==='D476_LOCAL_DATA_SEEN'){if(Object.keys(frame).sort().join()==='id,type')dataObservation.renderer();return}try{const activation=parseLocalActivation705(frame.id);if(activation){if(Object.keys(frame).sort().join()==='id,type'&&process.platform==='win32'&&localActivation===null)localActivation=activation;return}}catch{}const focus=parseLocalFocus705(frame.id);if(focus){if(Object.keys(frame).sort().join()==='id,type'&&process.platform==='win32'&&localFocusResult===null)localFocusResult=focus;return}const first=parseLocalFirstSite705(frame.id);if(first){if(Object.keys(frame).sort().join()==='id,type'&&(first.origin==='R'||first.origin==='W'&&process.platform==='win32'||first.origin==='M'&&process.platform==='darwin')&&localFirstSite[first.origin]===null)localFirstSite[first.origin]=first.site;return}if(frame.id==='D476_LOCAL_FAIL'){fail();return}if(!required.includes(frame.id))return;if(receipts.has(frame.id)){fail();return}receipts.add(frame.id);if(frame.id==='D476_LOCAL_DONE'){\n   completion=(async()=>{await Promise.race([Promise.all(childClosures),deadline]);assert.equal(receipts.size,required.length);assert.equal(protocolStarts,2);assert.equal(saved,1);assert.equal(fs.readFileSync(permissionFile,'utf8'),'DENIED');assert.equal(inputUnicode,true);assert.ok(resizeCalls>=2);assert.ok(terminalStops>=1);const disk=new ThreadManager().readDesktopDialog('native-local-A');assert.equal(disk.messages.length,2);assert.ok(disk.messages.some(m=>m.content.includes('D476_LOCAL_中')));assert.ok(disk.messages.some(m=>m.content.includes('D476_AGENT_PERMISSION_DENIED')));assert.equal(new ThreadManager().readDesktopDialog('native-local-B').messages.length,0);assert.equal(manager.hasProjectThreadActivity('native-local-A'),false);ws.send(JSON.stringify({type:'D476.local.complete',result:'COMPLETE'}))})();completion.catch(fail)\n"],["  assert.equal(pty.isPtyBusy(),false,'LOCAL476_NO_FOREIGN_LIVE_SLOT')\n  const output=path.resolve(__dirname,'../../dist/desktop-native'),binary=path.join(output,'acceptance/local',process.platform==='win32'?'cmspark-desktop.exe':'cmspark-desktop');assert.ok(fs.existsSync(binary),'actual local-work acceptance host must be built');surfaceLease.checkpoint();native=(require(path.join(output,'desktop-launcher.node')) as DesktopNativeBinding).launch(binary,boot.capabilityId,boot.secret,`ws://127.0.0.1:${(server.address() as any).port}/desktop`,code=>{confirmationObservation772.server(5);settled=true;exitResolve(code)})\n  assert.equal(await Promise.race([exited,failure.then(()=>{throw Error('OWNED_LOCAL_NATIVE_PHASE_FAILED')}),deadline]),77);if(completion)await completion;assert.equal(failed,false);assert.equal(authenticated,true);assert.equal(windowRequested,true);assert.equal(connections,1);assert.deepEqual([...receipts].sort(),[...required].sort());assert.equal(confirmations.pendingCount(),0)\n","  assert.equal(pty.isPtyBusy(),false,'LOCAL476_NO_FOREIGN_LIVE_SLOT')\n  const output=path.resolve(__dirname,'../../dist/desktop-native'),binary=path.join(output,'acceptance/local',process.platform==='win32'?'cmspark-desktop.exe':'cmspark-desktop');assert.ok(fs.existsSync(binary),'actual local-work acceptance host must be built');surfaceLease.checkpoint();native=(require(path.join(output,'desktop-launcher.node')) as DesktopNativeBinding).launch(binary,boot.capabilityId,boot.secret,`ws://127.0.0.1:${(server.address() as any).port}/desktop`,code=>{settled=true;exitResolve(code)})\n  assert.equal(await Promise.race([exited,failure.then(()=>{throw Error('OWNED_LOCAL_NATIVE_PHASE_FAILED')}),deadline]),77);if(completion)await completion;assert.equal(failed,false);assert.equal(authenticated,true);assert.equal(windowRequested,true);assert.equal(connections,1);assert.deepEqual([...receipts].sort(),[...required].sort());assert.equal(confirmations.pendingCount(),0)\n"],[" }catch(error){primaryFailed=true;throw error}finally{\n  confirmationObservation772.emit('FINALLY');surfaceLease.retain();try{t.diagnostic('D476_LOCAL_NATIVE_PHASE '+JSON.stringify({schema:1,failed,receiptMask:required.reduce((m,id,i)=>m|(receipts.has(id)?1<<i:0),0),protocolStarts,saved,inputUnicode,resizeCalls,terminalStops,authenticated,windowRequested,connections,childExited:settled,localFirstSite,localFocusResult,localActivation,localData:dataObservation.snapshot(),localProgress:localProgress.snapshot()}))}catch{}\n  let cleanupError:unknown,ptyReaped=false;const clean=async(fn:()=>unknown)=>{try{await fn()}catch(error){cleanupError??=error}}\n"," }catch(error){primaryFailed=true;throw error}finally{\n  surfaceLease.retain();try{t.diagnostic('D476_LOCAL_NATIVE_PHASE '+JSON.stringify({schema:1,failed,receiptMask:required.reduce((m,id,i)=>m|(receipts.has(id)?1<<i:0),0),protocolStarts,saved,inputUnicode,resizeCalls,terminalStops,authenticated,windowRequested,connections,childExited:settled,localFirstSite,localFocusResult,localActivation,localData:dataObservation.snapshot(),localProgress:localProgress.snapshot()}))}catch{}\n  let cleanupError:unknown,ptyReaped=false;const clean=async(fn:()=>unknown)=>{try{await fn()}catch(error){cleanupError??=error}}\n"],[" return withSurface650(t,async(t,surfaceLease)=>{\n  const confirmationObservation772=createConfirmationObservation772('TERMINAL',()=>performance.now(),line=>t.diagnostic(line))\n  t.signal.addEventListener('abort',()=>confirmationObservation772.emit('ABORT'),{once:true})\n  const previous=process.env.CMSPARK_DATA_DIR,dir=fs.realpathSync(fs.mkdtempSync(path.join(owned,'native-terminal705-')));process.env.CMSPARK_DATA_DIR=dir\n"," return withSurface650(t,async(t,surfaceLease)=>{\n  const previous=process.env.CMSPARK_DATA_DIR,dir=fs.realpathSync(fs.mkdtempSync(path.join(owned,'native-terminal705-')));process.env.CMSPARK_DATA_DIR=dir\n"],["  const realOpen=runtime.openTerminal,realInput=runtime.input,realResize=runtime.resize,realAck=runtime.ack,realClose=runtime.close\n  runtime.openTerminal=input=>{confirmationObservation772.server(4);openAttempts++;assert.equal(input.owner,primary);assert.equal(confirmations.pendingCount(),0);const observation=outputObserver.reserveOpen(input);const result=realOpen(input);outputObserver.commitOpen(observation,result.ok);if(result.ok){assert.ok(pty.getOwnedPtyContext(input.id,primary));assert.equal(pty.getOwnedPtyContext(input.id,null),null);assert.equal(pty.getOwnedPtyContext(input.id,{}),null);assert.equal(pty.readPtyTail(input.id,primary,'native-terminal-A').success,false,'shell consent is not private model-tail consent')}return result}\n  runtime.input=(id,b64)=>{const bytes=Buffer.from(b64,'base64');assert.ok(bytes.length<=16384);inputEnterObserved=inputEnterObserved||bytes.includes(13);inputSuffix=(inputSuffix+inputDecoder.decode(bytes,{stream:true})).slice(-256);assert.equal(inputSuffix.includes('D476_TERMINAL_中'),false,'complete output marker must not come from input echo');if(inputSuffix.includes('中'))inputUnicode=true;return realInput(id,b64)}\n","  const realOpen=runtime.openTerminal,realInput=runtime.input,realResize=runtime.resize,realAck=runtime.ack,realClose=runtime.close\n  runtime.openTerminal=input=>{openAttempts++;assert.equal(input.owner,primary);assert.equal(confirmations.pendingCount(),0);const observation=outputObserver.reserveOpen(input);const result=realOpen(input);outputObserver.commitOpen(observation,result.ok);if(result.ok){assert.ok(pty.getOwnedPtyContext(input.id,primary));assert.equal(pty.getOwnedPtyContext(input.id,null),null);assert.equal(pty.getOwnedPtyContext(input.id,{}),null);assert.equal(pty.readPtyTail(input.id,primary,'native-terminal-A').success,false,'shell consent is not private model-tail consent')}return result}\n  runtime.input=(id,b64)=>{const bytes=Buffer.from(b64,'base64');assert.ok(bytes.length<=16384);inputEnterObserved=inputEnterObserved||bytes.includes(13);inputSuffix=(inputSuffix+inputDecoder.decode(bytes,{stream:true})).slice(-256);assert.equal(inputSuffix.includes('D476_TERMINAL_中'),false,'complete output marker must not come from input echo');if(inputSuffix.includes('中'))inputUnicode=true;return realInput(id,b64)}\n"],["    if(ws===primary){\n     if(f.type==='desktop.confirmation.request'&&f.purpose==='local-work'){confirmationRequests++;confirmationObservation772.server(1,confirmationRequests);assert.ok(confirmationRequests<=4);assert.equal(JSON.parse(f.action_json).kind,confirmationRequests<=3?'terminal-open':'terminal-return')}\n     if(f.type==='desktop.terminal.open.result'){\n","    if(ws===primary){\n     if(f.type==='desktop.confirmation.request'&&f.purpose==='local-work'){confirmationRequests++;assert.ok(confirmationRequests<=4);assert.equal(JSON.parse(f.action_json).kind,confirmationRequests<=3?'terminal-open':'terminal-return')}\n     if(f.type==='desktop.terminal.open.result'){\n"],["    }\n    const result772=Reflect.apply(original,ws,[data,...args]);if(ws===primary&&f.type==='desktop.confirmation.request'&&f.purpose==='local-work')confirmationObservation772.server(2,confirmationRequests);return result772\n   })as typeof ws.send\n   ws.on('message',raw=>{let f:any;try{f=JSON.parse(String(raw))}catch{return}if(ws!==primary||!authenticated)return\n    confirmationObservation772.native(f)\n     if(f.type==='desktop.confirmation.decision'&&f.purpose==='local-work'){decisions++;confirmationObservation772.server(3,decisions)}\n    if(f.type!=='system.ping'||typeof f.id!=='string')return\n","    }\n    return Reflect.apply(original,ws,[data,...args])\n   })as typeof ws.send\n   ws.on('message',raw=>{let f:any;try{f=JSON.parse(String(raw))}catch{return}if(ws!==primary||!authenticated)return\n    if(f.type==='desktop.confirmation.decision'&&f.purpose==='local-work')decisions++\n    if(f.type!=='system.ping'||typeof f.id!=='string')return\n"],["   const native=path.resolve(__dirname,'../../dist/desktop-native'),binary=path.join(native,'acceptance/terminal',process.platform==='win32'?'cmspark-desktop.exe':'cmspark-desktop');assert.ok(fs.existsSync(binary),'actual terminal-only acceptance host must be built');surfaceLease.checkpoint()\n   child=(require(path.join(native,'desktop-launcher.node'))as DesktopNativeBinding).launch(binary,boot.capabilityId,boot.secret,`ws://127.0.0.1:${(server.address()as any).port}/desktop`,code=>{confirmationObservation772.server(5);firstFailure.seal();childExited=true;exitResolve(code)})\n   assert.equal(await Promise.race([exited,failure.then(()=>{throw completionFailure??Error('OWNED_TERMINAL705_NATIVE_PHASE_FAILED')}),deadline]),77);if(completion)await completion;assert.equal(failed,false);assert.equal(authenticated,true);assert.equal(windowRequested,true);assert.equal(connections,2);assert.deepEqual([...receipts].sort(),[...required].sort())\n","   const native=path.resolve(__dirname,'../../dist/desktop-native'),binary=path.join(native,'acceptance/terminal',process.platform==='win32'?'cmspark-desktop.exe':'cmspark-desktop');assert.ok(fs.existsSync(binary),'actual terminal-only acceptance host must be built');surfaceLease.checkpoint()\n   child=(require(path.join(native,'desktop-launcher.node'))as DesktopNativeBinding).launch(binary,boot.capabilityId,boot.secret,`ws://127.0.0.1:${(server.address()as any).port}/desktop`,code=>{firstFailure.seal();childExited=true;exitResolve(code)})\n   assert.equal(await Promise.race([exited,failure.then(()=>{throw completionFailure??Error('OWNED_TERMINAL705_NATIVE_PHASE_FAILED')}),deadline]),77);if(completion)await completion;assert.equal(failed,false);assert.equal(authenticated,true);assert.equal(windowRequested,true);assert.equal(connections,2);assert.deepEqual([...receipts].sort(),[...required].sort())\n"],["  }catch(error){primaryFailure=error;throw error}finally{\n   confirmationObservation772.emit('FINALLY');firstFailure.seal();surfaceLease.retain();emitTerminalPhase('FINALLY')\n   let cleanupError:unknown;const clean=async(fn:()=>unknown)=>{try{await fn()}catch(error){cleanupError??=error}}\n","  }catch(error){primaryFailure=error;throw error}finally{\n   firstFailure.seal();surfaceLease.retain();emitTerminalPhase('FINALLY')\n   let cleanupError:unknown;const clean=async(fn:()=>unknown)=>{try{await fn()}catch(error){cleanupError??=error}}\n"]]
 let value=raw.replace(/\r\n/g,'\n')
 value=workspaceAbortPhaseInverse705(value)
 for(const [current,prior]of pairs){assert.equal(value.split(current).length,2,'one exact #772 observation-only source hunk');value=value.replace(current,prior)}
 assert.equal(createHash('sha256').update(value).digest('hex'),'6d79c72e958fb35b40c42086c098235425b1f2b1b63e4ef95295d4c085007b4b','whole original native source conserved before all older authorities');return value
}

// Undo only the aborted-context delivery addition, before all existing raw source authorities.
function workspaceAbortPhaseInverse705(raw:string){
 raw=require(path.resolve('scripts/tests/observation-788-inverse.mjs')).restoreObservation788(raw)
 raw=archiveObservationInverse782(raw)
 const eol=raw.includes('\r\n')?'\r\n':'\n'
 const current="try{const workspacePhase705='D476_WORKSPACE_NATIVE_PHASE '+JSON.stringify({schema:1,failed,receiptMask:required.reduce((m,id,i)=>m|(receipts.has(id)?1<<i:0),0),picks,pickerObserved,pickerReturned,cancelReturned,connections,authenticated,windowRequested,childExited:settled,childExitCode,firstFailedAssertion,diagnosticVersion:2,failureSite,pickOutcome,pickerLifecycle,nativeDiagnostic,diagnosticInvalid,selectedOutcome,selectedIdentity,uiLifecycle,uiReceiptMask,...(uiOwner?{uiRefusal,uiProgress,uiChooseCensus}:{}),cancelClose,cancelShow,cancelSettled,cancelCurrent});try{t.diagnostic(workspacePhase705)}catch{};if(t.signal.aborted)try{const workspaceLine705=workspacePhase705+'\\n';if(Buffer.byteLength(workspaceLine705,'utf8')<=4096)process.stdout.write(workspaceLine705)}catch{}}catch{}".replace(/\n/g,eol),prior="try{t.diagnostic('D476_WORKSPACE_NATIVE_PHASE '+JSON.stringify({schema:1,failed,receiptMask:required.reduce((m,id,i)=>m|(receipts.has(id)?1<<i:0),0),picks,pickerObserved,pickerReturned,cancelReturned,connections,authenticated,windowRequested,childExited:settled,childExitCode,firstFailedAssertion,diagnosticVersion:2,failureSite,pickOutcome,pickerLifecycle,nativeDiagnostic,diagnosticInvalid,selectedOutcome,selectedIdentity,uiLifecycle,uiReceiptMask,...(uiOwner?{uiRefusal,uiProgress,uiChooseCensus}:{}),cancelClose,cancelShow,cancelSettled,cancelCurrent}))}catch{}".replace(/\n/g,eol)
 assert.equal(raw.split(current).length,2,'one exact abort-phase delivery block')
 return raw.replace(current,prior)
}

function actualWorkspaceAbortPhase705(source:string){
 const ast=ts.createSourceFile('actual-workspace-native.ts',source,ts.ScriptTarget.Latest,true),blocks:ts.TryStatement[]=[]
 const visit=(n:ts.Node)=>{if(ts.isTryStatement(n)&&n.tryBlock.statements.some(s=>ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>d.name.getText(ast)==='workspacePhase705')))blocks.push(n);ts.forEachChild(n,visit)}
 visit(ast);assert.equal(blocks.length,1,'select one actual closed phase delivery block');return blocks[0].getText(ast)
}
for(const eol of ['LF','CRLF'] as const)test(`705 aborted workspace context preserves the same closed phase through bounded stdout ${eol}`,()=>{
 const raw=fs.readFileSync(path.resolve('tests/desktop-native-thread-metadata-476.test.ts'),'utf8'),source=raw.replace(/\r?\n/g,eol==='LF'?'\n':'\r\n'),block=actualWorkspaceAbortPhase705(source)
 let originalPhase:string|undefined
 for(const variant of ['normal','aborted','diagnostic-throws','stdout-throws','oversize']){
  const diagnostic:string[]=[],output:string[]=[],primary=Error('OWNED_PRIMARY'),scope:any={Buffer,primary,required:Array.from({length:10},(_,i)=>'OWNED_'+i),receipts:new Set(),failed:true,picks:3,pickerObserved:2,pickerReturned:1,cancelReturned:0,connections:1,authenticated:true,windowRequested:true,settled:false,childExitCode:-2147483648,firstFailedAssertion:15,failureSite:9,pickOutcome:6,pickerLifecycle:{mode:3,childClosed:true,childExit:255,childSignal:4,childError:true},nativeDiagnostic:{platform:2,phaseMask:1023,failureSite:10,localPanels:2,ownedPanels:2,flags:15,flagsKnown:15},diagnosticInvalid:false,selectedOutcome:false,selectedIdentity:false,uiLifecycle:{begun:true,invalid:false,observerClosed:false,observerCode:255,xcodeClosed:true,xcodeCode:255},uiReceiptMask:31,uiOwner:{},cancelTiming788:null,uiRefusal:{stage:20,detail:5},uiProgress:{stage:20,detail:5},uiChooseCensus:{schema:1,status:'OBSERVED',sheetLabelCount:2,sheetButtonCount:2,ownerLabelCount:2,buttonCount:8,buttonsMore:true,buttonIdentityRows:Array.from({length:8},()=>[5,5])},cancelClose:2,cancelShow:3,cancelSettled:false,cancelCurrent:true,t:{signal:{aborted:variant!=='normal'},diagnostic(line:string){if(variant==='diagnostic-throws')throw Error('OWNED_DIAGNOSTIC');diagnostic.push(line)}},process:{stdout:{write(line:string){output.push(line);if(variant==='stdout-throws')throw Error('OWNED_STDOUT')}}}}
  if(variant==='oversize')scope.uiLifecycle={corruptedObserver:'OWNED_PRIVATE'.repeat(500)}
  assert.throws(()=>vm.runInNewContext('try{throw primary}finally{'+ts.transpileModule(block,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+'}',scope),error=>error===primary,'observer faults cannot replace original failure')
  if(variant==='normal')originalPhase=diagnostic[0]
  assert.equal(diagnostic.length,variant==='diagnostic-throws'?0:1)
  assert.equal(output.length,variant==='normal'||variant==='oversize'?0:1)
  if(output.length){assert.equal(output[0],originalPhase+'\n');assert.ok(Buffer.byteLength(output[0],'utf8')<=4096);const value=JSON.parse(output[0].slice('D476_WORKSPACE_NATIVE_PHASE '.length));assert.equal(value.uiChooseCensus.buttonIdentityRows.length,8);assert.equal(value.failed,true);assert.equal(value.childExited,false);assert.equal(output[0].includes('OWNED_PRIVATE'),false)}
 }
})
for(const [eol,expected]of [['LF','6fadbe6027b50d5a1b0654ba30641d260e7dcaa098d38ad90a398fe4639eed3c'],['CRLF','7c5d8b54f03c68fa285d60d8fd029cd10dbbf5c0073e79d5944778435e3d1288']]as const)test(`705 aborted-phase inverse conserves the complete preceding native source ${eol}`,()=>{
 const raw=fs.readFileSync(path.resolve('tests/desktop-native-thread-metadata-476.test.ts'),'utf8'),source=raw.replace(/\r?\n/g,eol==='LF'?'\n':'\r\n'),prior=workspaceAbortPhaseInverse705(source)
 assert.equal(createHash('sha256').update(prior).digest('hex'),expected)
 assert.throws(()=>actualWorkspaceAbortPhase705(prior),{code:'ERR_ASSERTION'})
 assert.throws(()=>workspaceAbortPhaseInverse705(source+source),{code:'ERR_ASSERTION'})
 assert.throws(()=>workspaceAbortPhaseInverse705(source.replace('const workspacePhase705=','const changedPhase705=')),{code:'ERR_ASSERTION'})
 assert.equal(source.includes('timeout:45000'),true)
})
