'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..'),ts=require(require.resolve('typescript',{paths:[path.join(root,'companion')]}));
function actual(enabled=true){
 const source=fs.readFileSync(path.join(root,'companion/tests/fixtures/local-acp-observation-795.ts'),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const realm={module:{exports:{}},exports:{},performance:require('node:perf_hooks').performance,require(name){assert.equal(name,'node:util');return require(name)}};realm.exports=realm.module.exports;vm.runInNewContext(code,realm);return realm.module.exports.createLocalAcpObservation795(enabled);
}
test('actual ACP observer distinguishes a pending promise from null, handle and rejection',async()=>{
 const pending=actual();let finish;const original=new Promise(r=>{finish=r}),wrapped=pending.track(original);
 assert.equal(pending.snapshot().outcome,'PENDING');finish(null);assert.equal(await wrapped,null);assert.equal(pending.snapshot().outcome,'NULL');
 const handle={child:{}};const successful=actual();assert.equal(await successful.track(Promise.resolve(handle)),handle);assert.equal(successful.snapshot().outcome,'HANDLE');
 const fault=Error('PRIVATE_SENTINEL'),failed=actual();await assert.rejects(failed.track(Promise.reject(fault)),e=>e===fault);assert.equal(failed.snapshot().outcome,'THREW');assert.equal(JSON.stringify(failed.snapshot()).includes('PRIVATE'),false);
});
test('overlapping or subsequent attempts remain unattributed',async()=>{
 const observer=actual();let first;const a=observer.track(new Promise(r=>{first=r})),b=observer.track(Promise.resolve(null));assert.equal(await b,null);first({child:{}});await a;assert.equal(observer.snapshot().attempts,2);assert.equal(observer.snapshot().outcome,'AMBIGUOUS');
});
test('actual fixture wraps the existing exact promise and only emits fixed snapshot on failure',()=>{
 const s=fs.readFileSync(path.join(root,'companion/tests/desktop-native-thread-metadata-476.test.ts'),'utf8');
 assert.match(s,/localAcpObservation795\.track\(\/\*OBS788_JOIN_END\*\/realStart\(opts\)\/\*OBS788_JOIN_BEGIN\*\/\)/);
 assert.match(s,/if\(primaryFailed&&process\.platform==='win32'\)\{const line='D476_LOCAL_ACP_OBSERVATION_795 '\+JSON\.stringify\(localAcpObservation795\.snapshot\(\)\)/);
 const snapshot=actual().snapshot();assert.deepEqual(Object.keys(snapshot).sort(),['attempts','outcome','schema']);assert.equal(JSON.stringify(snapshot),'{"schema":1,"attempts":0,"outcome":"NOT_STARTED"}');
});

test('disabled observation returns the same promise and leaves the state untouched',async()=>{
 const observer=actual(false),promise=Promise.resolve(null);assert.equal(observer.track(promise),promise);assert.equal(await promise,null);assert.equal(observer.snapshot().outcome,'NOT_STARTED');
});
test('actual failure producer cannot emit on success or replace cleanup on synchronous sink faults',()=>{
 const source=fs.readFileSync(path.join(root,'companion/tests/desktop-native-thread-metadata-476.test.ts'),'utf8');
 const match=source.match(/\/\*OBS788_JOIN_BEGIN\*\/(try\{if\(primaryFailed&&process\.platform==='win32'\)\{const line='D476_LOCAL_ACP_OBSERVATION_795 '[\s\S]*?)\/\*OBS788_JOIN_END\*\//);assert.ok(match);
 const code=ts.transpileModule('globalThis.invoke=(primaryFailed,process,localAcpObservation795)=>{'+match[1]+';return "CLEANUP_CONTINUES"}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,realm={Buffer,JSON,localR14:null};vm.runInNewContext(code,realm);
 const lines=[],observation=actual(),ok={platform:'win32',stdout:{write(line){lines.push(line)}}},other={platform:'darwin',stdout:ok.stdout};
 assert.equal(realm.invoke(false,ok,observation),'CLEANUP_CONTINUES');assert.equal(lines.length,0);assert.equal(realm.invoke(true,other,observation),'CLEANUP_CONTINUES');assert.deepEqual(lines,['D476_LOCAL_R14_DETAIL_808 {"schema":1,"first":null}\n']);lines.length=0;
 assert.equal(realm.invoke(true,ok,observation),'CLEANUP_CONTINUES');assert.deepEqual(lines,['D476_LOCAL_ACP_OBSERVATION_795 {"schema":1,"attempts":0,"outcome":"NOT_STARTED"}\n','D476_LOCAL_ACP_DETAIL_808 {"schema":1,"attempts":0,"outcome":"NOT_STARTED","rejectionBucket":null,"abortBucket":null,"errorClass":null,"messageClass":null}\n','D476_LOCAL_R14_DETAIL_808 {"schema":1,"first":null}\n']);
 assert.equal(realm.invoke(true,{platform:'win32',stdout:{write(){throw Error('PRIVATE')}}},observation),'CLEANUP_CONTINUES');
 assert.equal(realm.invoke(true,ok,{snapshot(){throw Error('PRIVATE')}}),'CLEANUP_CONTINUES');
});
