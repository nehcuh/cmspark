/** Guarded source-derived protocol controls. Never starts a UI test or native executable. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
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
