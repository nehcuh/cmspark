'use strict';
// Exercises actual TS methods with inert EventEmitter children; no native process starts.
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), vm=require('node:vm'), {EventEmitter}=require('node:events');
const ts=require(require.resolve('typescript',{paths:[path.join(__dirname,'../../companion')]}));
const root=path.resolve(__dirname,'../..');
function actual(){
 const source=fs.readFileSync(path.join(root,'companion/tests/helpers/workspace-xctest-owned-705.ts'),'utf8');
 const ast=ts.createSourceFile('owner.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='OwnedWorkspaceUI705');
 assert.ok(cls);const method=cls.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(ast)==='observeObserverCloseOnce');assert.ok(method);
 const start=cls.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(ast)==='start');let callback;function visit(n){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='on'&&n.arguments[0]?.getText(ast)==="'close'")callback=n.arguments[1];ts.forEachChild(n,visit)}visit(start);assert.ok(callback);
 const code=`class Actual { observerClosed=false; observerCode=null; xcodeClosed=false; xcodeCode=null; observerCloseObservationRegistered=false; notifications=0; notify(){this.notifications++} register(child){let kind='observer';child.on('close',${callback.getText(ast)})} ${method.getText(ast)} };globalThis.Actual=Actual`;
 const context={Number};vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);return context.Actual;
}
test('actual observer listener reports once for close before and after registration',()=>{
 const Actual=actual();for(const early of [false,true])for(const [code,expected] of [[0,'ZERO'],[41,'NONZERO'],[null,'UNKNOWN']]){
  const owner=new Actual(),child=new EventEmitter(),observed=[];owner.observer=child;owner.register(child);
  if(early)child.emit('close',code);owner.observeObserverCloseOnce(v=>observed.push(v));owner.observeObserverCloseOnce(()=>assert.fail('duplicate listener'));if(!early)child.emit('close',code);
  assert.deepEqual(observed,[expected]);assert.equal(owner.observerClosed,true);assert.equal(owner.observerCode,code);assert.equal(owner.xcodeClosed,false);assert.equal(owner.notifications,1);
 }
});
test('missing child and throwing sink do not alter lifecycle or throw',()=>{
 const Actual=actual(),missing=new Actual();assert.doesNotThrow(()=>missing.observeObserverCloseOnce(()=>assert.fail('missing child')));assert.equal(missing.observerClosed,false);
 const owner=new Actual(),child=new EventEmitter();owner.observer=child;owner.register(child);owner.observeObserverCloseOnce(()=>{throw Error('private')});assert.doesNotThrow(()=>child.emit('close',0));assert.equal(owner.observerClosed,true);assert.equal(owner.observerCode,0);
});
test('actual failure-only producer registers after cancel and never changes cleanup authority',()=>{
 const source=fs.readFileSync(path.join(root,'companion/tests/desktop-native-thread-metadata-476.test.ts'),'utf8');const match=source.match(/\/\*OBS788_JOIN_BEGIN\*\/(try\{if\(primaryFailed&&uiOwner\)uiOwner\.observeObserverCloseOnce[\s\S]*?)\/\*OBS788_JOIN_END\*\//);assert.ok(match);
 const emitted=[],owners=[];const code=ts.transpileModule('globalThis.invoke=(primaryFailed,uiOwner,process)=>{'+match[1]+'}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,realm={JSON};vm.runInNewContext(code,realm);
 const owner={observeObserverCloseOnce(cb){owners.push(1);cb('ZERO')}};const output={stdout:{write(v){emitted.push(v)}}};realm.invoke(false,owner,output);assert.equal(owners.length,0);realm.invoke(true,owner,output);assert.equal(owners.length,1);assert.deepEqual(emitted,['D705_OBSERVER_CLOSE_AFTER_CANCEL {"schema":1,"exit":"ZERO"}\n']);assert.doesNotThrow(()=>realm.invoke(true,{observeObserverCloseOnce(){throw Error('private')}},output));
 assert.ok(source.indexOf('uiOwner?.cancel();'+match[0])>=0);
});
