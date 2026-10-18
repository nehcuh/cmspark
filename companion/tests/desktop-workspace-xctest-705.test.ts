/** Guarded source-derived protocol controls. Never starts a UI test or native executable. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import * as ts from 'typescript'
import {pathToFileURL} from 'node:url'
const files=path.resolve('tests/fixtures/workspace-ui-705'),helper=path.resolve('tests/helpers/workspace-xctest-owned-705.ts')
function loadBoundary(mutant?:[string,string]){
 let source=fs.readFileSync(helper,'utf8');if(mutant){assert.equal(source.split(mutant[0]).length,2);source=source.replace(...mutant)}
 const parsed=ts.createSourceFile('helper.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),selected=parsed.statements.filter(n=>(ts.isClassDeclaration(n)&&n.name?.text==='OwnedUI705Boundary')||(ts.isVariableStatement(n)&&['refused','canonical','regular','UI705_RUNNER_ID','UI705_FILES'].some(v=>n.declarationList.declarations.some(d=>d.name.getText(parsed)===v)))).map(n=>n.getText(parsed)).join('\n')
 const out=ts.transpileModule(selected,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});assert.equal(out.diagnostics!.length,0)
 const nonce='a'.repeat(64),root='/owned/cmspark-workspace-ui-705-'+nonce,store=new Map<string,any>(),fd=new Map<number,string>();let serial=3,opens=0
 const stat=(f:string)=>{if(f===root)return{isDirectory:()=>true,isSymbolicLink:()=>false,dev:1,ino:2,uid:7,mode:0o700};const v=store.get(f);if(!v)throw Object.assign(Error('ENOENT'),{code:'ENOENT'});return{isFile:()=>!v.nonfile,isSymbolicLink:()=>!!v.symlink,nlink:v.nlink??1,uid:v.uid??7,mode:v.mode??0o600,size:v.bytes.length,dev:1,ino:v.ino??8}}
 const flags={O_RDONLY:0,O_NOFOLLOW:0x20000,O_NONBLOCK:0x4}
 const mock={constants:flags,lstatSync:stat,realpathSync:(s:string)=>s,openSync:(s:string,bits:number)=>{opens++;assert.ok(bits&flags.O_NONBLOCK);assert.ok(bits&flags.O_NOFOLLOW);stat(s);fd.set(++serial,s);return serial},fstatSync:(n:number)=>stat(fd.get(n)!),readSync:(n:number,b:Buffer)=>{const v=store.get(fd.get(n)!);v.bytes.copy(b);return v.bytes.length},closeSync:(n:number)=>fd.delete(n),writeFileSync:(s:string,b:Buffer)=>{if(store.has(s))throw Error('EXISTS');store.set(s,{bytes:b})}}
 const mod:any={exports:{}};vm.runInNewContext(out.outputText,{module:mod,exports:mod.exports,fs:mock,path:path.posix,pathToFileURL,Buffer,TextDecoder,process:{getuid:()=>7,pid:123}})
 const api=new mod.exports.OwnedUI705Boundary(root,nonce),put=(name:string,value:any,extra:any={})=>store.set(root+'/'+name,{bytes:Buffer.from(JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])))),...extra})
 const base={schema:1,nonce},pid=321
 const full=()=>{put('runner-start.json',{...base,pid,bundle_id:'com.cmspark.tests.workspace-ui-705.xctrunner',bundle_url:pathToFileURL(api.runner()).href,executable_url:pathToFileURL(api.runnerExecutable()).href});put('owner-ack.json',{...base,pid,identity_bound:true});put('runner-closed.json',{...base,pid,terminated:true});put('ui-begin.json',{...base,pid,phase:'UI_SEQUENCE_STARTED'});put('ui-quiescent.json',{...base,pid,phase:'UI_SEQUENCE_RETURNED'})}
 return{api,put,full,store,root,base,pid,opens:()=>opens}
}
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
 const api=new mod.exports.OwnedUI705Boundary(root,nonce),pid=process.pid===321?322:321,base={schema:1,nonce};return{api,root,parent,base,pid,put:(name:string,value:any)=>api.write(name,value),startup:()=>api.write('runner-start.json',{...base,pid,bundle_id:'com.cmspark.tests.workspace-ui-705.xctrunner',bundle_url:pathToFileURL(api.runner()).href,executable_url:pathToFileURL(api.runnerExecutable()).href})}
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
function createRequireForReceipt705(){return (name:string)=>{if(name==='node:test')return test;if(name==='node:assert/strict')return assert;if(name==='node:fs')return fs;if(name==='node:path')return path;if(name==='node:vm')return vm;if(name==='node:os')return os;if(name==='typescript')return ts;if(name==='node:url')return{pathToFileURL};throw Error('OWNED_TEST_IMPORT_REFUSED')}}


test('705 actual receipt callbacks tolerate absent or empty TMPDIR without mutating the global environment',()=>{
 const current=fs.readFileSync(path.resolve('tests/desktop-workspace-xctest-705.test.ts'),'utf8'),compiled=ts.transpileModule(current,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,parent=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'receipt-fallback-705-')))
 try{for(const empty of[false,true]){const cases=new Map<string,()=>void>(),mod:any={exports:{}},localProcess={pid:process.pid,platform:process.platform,env:empty?{TMPDIR:''}:{}},require=createRequireForReceipt705();let fallbacks=0
  vm.runInNewContext(compiled,{module:mod,exports:mod.exports,require:(name:string)=>name==='node:os'?{tmpdir(){fallbacks++;return parent}}:name==='node:test'?(name:string,callback:()=>void)=>cases.set(name,callback):require(name),process:localProcess,Buffer,TextDecoder,URL,console},{timeout:3000})
  for(const name of['705 receipt mask actual strict reader handles owned files links directory and partial publication','705 actual physical receipt callback is portable without host getuid POSIX modes or file-symlink privilege']){const callback=cases.get(name);assert.ok(callback);callback()}
  assert.equal(fallbacks,3,'real FS callback and both Windows-shaped parents use the same private fallback');assert.deepEqual(fs.readdirSync(parent),[])
 }}finally{fs.rmSync(parent,{recursive:true,force:true})}
})
