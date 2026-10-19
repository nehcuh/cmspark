import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { EventEmitter, once } from 'node:events'
import { BASE, HEAD, PAGE, BOUNDS, preflight, childEnvironment, chromeArgs, compareProduced, receipt } from '../../../chrome-extension/scripts/accept-github-comparison-hosted.mjs'
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..')
const harness=fs.readFileSync(path.join(repo,'chrome-extension/scripts/accept-github-comparison-hosted.mjs'),'utf8')
const worker=fs.readFileSync(path.join(repo,'chrome-extension/scripts/fixtures/github-comparison-hosted-worker.ts'),'utf8')
const require=createRequire(path.join(repo,'companion/package.json'))
const ts=require('typescript')
const sample='diff --git a/hello.ts b/hello.ts\n--- a/hello.ts\n+++ b/hello.ts\n@@ -1 +1 @@\n-old\n+new\n'
const parse = text => text.split('\n') // Test seam exposes every line, not a canned success boolean.
test('actual main body refuses nonhosted context before any spawn/config/owned output',async()=>{
  let printed,spawned=0
  const forbidden=()=>{spawned++;throw Error('DENIED')}
  const body=harness.slice(harness.indexOf('async function stopped('),harness.indexOf("if(process.argv[1]"))
  const context={process:{env:{},platform:'linux'},BOUNDS,preflight,receipt,clearTimeout,console:{log:x=>{printed=JSON.parse(x)}},spawn:forbidden,fs:{mkdtempSync:forbidden}}
  vm.createContext(context);vm.runInContext(body.replace('export async function','async function'),context)
  assert.equal(await context.main(),1);assert.equal(spawned,0)
  assert.equal(printed.stage,'PREFLIGHT');assert.equal(printed.browserAcceptance,'NOT_PASSED')
})
test('hosted preflight requires exact OS, actual owned nonsymlink temp and UID',()=>{
  const env={GITHUB_ACTIONS:'true',RUNNER_OS:'Linux',RUNNER_ENVIRONMENT:'github-hosted',ImageOS:'ubuntu22',RUNNER_TEMP:'/owned'}
  const stat=()=>({isDirectory:()=>true,isSymbolicLink:()=>false,uid:42})
  assert.equal(preflight(env,'linux',stat,x=>x,42),'/owned')
  for(const patch of [{GITHUB_ACTIONS:'false'},{RUNNER_OS:'macOS'},{RUNNER_ENVIRONMENT:'self-hosted'},{RUNNER_ENVIRONMENT:undefined},{RUNNER_TEMP:'relative'}])assert.throws(()=>preflight({...env,...patch},'linux',stat,x=>x,42))
  assert.throws(()=>preflight(env,'darwin',stat,x=>x,42))
  assert.throws(()=>preflight(env,'linux',stat,x=>x,43))
  assert.throws(()=>preflight(env,'linux',stat,()=>'/foreign',42))
  assert.throws(()=>preflight(env,'linux',()=>({...stat(),isSymbolicLink:()=>true}),x=>x,42))
})
test('fresh child env excludes keys/providers/profiles and inherits only existing tracking',()=>{
  const env=childEnvironment('/owned',{API_KEY:'private-marker',HOME:'/foreign',DISPLAY:':99',RUNNER_TRACKING_ID:'opaque-tracking'},':12')
  assert.equal(env.RUNNER_TRACKING_ID,'opaque-tracking');assert.equal(env.DISPLAY,':12');assert.equal(env.HOME,'/owned/home')
  assert.equal(env.API_KEY,undefined);assert.equal(childEnvironment('/owned',{}).RUNNER_TRACKING_ID,undefined)
  assert.throws(()=>childEnvironment('/owned',{},':1;command'))
})
test('owned Chromium args cannot disable sandbox or reuse profile and are bounded',()=>{
  const args=chromeArgs('/owned','/owned/extension')
  assert.ok(args.includes('--user-data-dir=/owned/profile'));assert.ok(args.includes('--remote-debugging-address=127.0.0.1'))
  assert.equal(args.some(x=>/no-sandbox|disable-setuid|headless|\/foreign/.test(x)),false)
  assert.throws(()=>chromeArgs('/owned','/foreign/extension'))
  assert.deepEqual(BOUNDS,{navigation:60000,outer:120000})
})
test('immutable full40 public two-dot URL; merged commit replaces equivalent historical PRhead',()=>{
  assert.match(BASE,/^[a-f0-9]{40}$/);assert.match(HEAD,/^[a-f0-9]{40}$/)
  assert.equal(PAGE,`https://github.com/nehcuh/cmspark/compare/${BASE}..${HEAD}`)
  assert.equal(new URL(PAGE).search,'');assert.equal(new URL(PAGE).hash,'')
})
test('Git expectation compares actual complete lines plus hunk coordinates, not aggregate counts',()=>{
  const value={repository:'https://github.com/nehcuh/cmspark',base:BASE,head:HEAD,file_count:4,additions:33,deletions:4,diff_text:sample}
  compareProduced(value,sample,parse)
  for(const diff_text of [sample.replace('+new','+lie'),sample.replace('@@ -1 +1','@@ -2 +1'),sample+'+cut\n'])assert.throws(()=>compareProduced({...value,diff_text},sample,parse))
  assert.throws(()=>compareProduced({...value,base:'f'.repeat(40)},sample,parse))
  assert.throws(()=>compareProduced({...value,file_count:3},sample,parse))
})
test('finite receipt refuses arbitrary errors/secrets/objects and does not grant readiness',()=>{
  const r=receipt('POSITIVE',false,1,{error:'private-marker',RUNNER_TRACKING_ID:'opaque',node:'22.23.2',source:'a'.repeat(40),image:'private\nvalue',chromium:{value:'secret'}})
  assert.equal(r.reviewReady,false);assert.equal(r.fullStartServer,false);assert.equal(r.node,'22.23.2')
  assert.equal(JSON.stringify(r).includes('private'),false);assert.equal(JSON.stringify(r).includes('opaque'),false)
  assert.throws(()=>receipt('arbitrary-error',false,0));assert.throws(()=>receipt('AUTH',false,NaN))
})
function actualWorker(){
  const effects={execute:0,send:[],configured:0,created:0}
  class BrowserBridge{async execute(name,params){effects.execute++;return {success:true,data:{public:true}}}}
  class WSClient{constructor(o){effects.options=o}setSecret(){effects.configured++}send(m){effects.send.push(m)}}
  const source=worker.replace(/^import .+$/gm,'')
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},reportDiagnostics:true})
  assert.equal(js.diagnostics.length,0)
  const ctx={BrowserBridge,PageSanitizer:class{},WSClient,chrome:{runtime:{onInstalled:{addListener(){}}},debugger:{async getTargets(){return[{id:'ACTUAL-OWNED',type:'page',tabId:41},{id:'FOREIGN',type:'page',tabId:42}]}},tabs:{async create(options){effects.created++;assert.equal(options.url,'about:blank');return{id:41}}}}}
  vm.createContext(ctx);vm.runInContext(js.outputText,ctx)
  return {api:ctx.cmspark464,effects}
}
test('actual worker body uses only owned tab get_page_text and actual result handler',async()=>{
  const {api,effects}=actualWorker();assert.equal(await api.createTab(),41);assert.equal(await api.pageTarget(),'ACTUAL-OWNED')
  assert.equal(api.configure(23401,'a'.repeat(64)),true);assert.equal(effects.configured,1)
  for(const m of [{type:'tool.execute',tool_name:'evaluate',tool_call_id:'owned464-1',params:{tabId:41}},
    {type:'tool.execute',tool_name:'get_page_text',tool_call_id:'owned464-1',params:{tabId:42}},
    {type:'tool.execute',tool_name:'get_page_text',tool_call_id:'owned464-1',params:{tabId:41,code:'bad'}},
    {type:'tool.execute',tool_name:'get_page_text',tool_call_id:'foreign',params:{tabId:41}}])await effects.options.onMessage(m)
  assert.equal(effects.execute,0)
  await effects.options.onMessage({type:'tool.execute',tool_name:'get_page_text',tool_call_id:'owned464-1',params:{tabId:41}})
  assert.equal(effects.execute,1);assert.equal(effects.send[0].type,'tool.result');assert.equal(effects.send[0].result.data.public,true)
  assert.throws(()=>api.configure(23401,'a'.repeat(64)));await assert.rejects(()=>api.createTab())
})
test('worker imports production implementations; workflow discovers CPU and hosted gates',()=>{
  for(const text of ['../../src/background/browser-bridge','../../src/background/page-sanitizer','../../src/background/ws-client'])assert.ok(worker.includes(text))
  const ci=fs.readFileSync(path.join(repo,'.github/workflows/ci.yml'),'utf8')
  assert.ok(ci.includes('node --test companion/scripts/tests/github-comparison-hosted-harness.test.mjs'))
  assert.ok(ci.includes('node chrome-extension/scripts/accept-github-comparison-hosted.mjs'))
  assert.ok(ci.indexOf('name: Hosted GitHub comparison acceptance')>ci.indexOf('name: Build companion'))
  assert.ok(ci.indexOf('name: Hosted GitHub comparison acceptance')<ci.indexOf('name: Run companion tests'))
  assert.equal(/continue-on-error:/.test(ci.slice(ci.indexOf('name: Hosted GitHub comparison acceptance'),ci.indexOf('name: Hosted GitHub comparison acceptance')+300)),false)
  assert.ok(harness.indexOf('Object.assign(process.env,env)')<harness.indexOf("require(path.join(REPO,'companion/dist/ws-auth.js'))"))
})

test('actual preflight rejects self-hosted runner even with valid Linux owned temp',()=>{
  assert.throws(()=>preflight({GITHUB_ACTIONS:'true',RUNNER_OS:'Linux',RUNNER_ENVIRONMENT:'self-hosted',RUNNER_TEMP:'/owned'},'linux',()=>({isDirectory:()=>true,isSymbolicLink:()=>false,uid:42}),x=>x,42))
})

// Actual cleanup body/receipt tail with inert clock/resources. No browser or IO.
function actualCleanup464({closeMs=1,pendingBuild=false}={}){
 const start=harness.indexOf('  finally {',harness.indexOf('export async function main()')),end=harness.indexOf('\n}',start)
 assert.ok(start>0&&end>start)
 const actual=harness.slice(start+'  finally {'.length,end),bodyEnd=actual.indexOf('\n  }\n  const out=');assert.ok(bodyEnd>0)
 const receipts=harness.slice(harness.indexOf('const STAGES ='),harness.indexOf('\nfunction deferred()')).replace('export function','function')
 const helperStart=harness.indexOf('function cleanupRemaining('),helpers=helperStart<0?'':harness.slice(helperStart,harness.indexOf('export async function main()'))
 let now=119000,printed,deleted=false,timerCleared=false,closeBudget,clearedAtClose,resolveBuild
 const buildTask=pendingBuild?new Promise(r=>{resolveBuild=r}):undefined
 const browser={async call(method,params,ms){assert.equal(method,'Browser.close');closeBudget=ms;clearedAtClose=timerCleared;now+=closeMs;if(closeMs===60000)throw Error('INERT_CLOSE_TIMEOUT')},abort(){}}
 const c={Set,JSON,Error,Date:{now:()=>now},stage:'COMPLETE',cases:11,owned:'/OWNED_INERT',chromium:undefined,xvfb:undefined,server:undefined,browser,
  esbuild:{stop(){}},buildTask,buildSettled:!pendingBuild,forward:undefined,expired:false,profileRead:true,runtime:{},cleanupOkay:true,deadline:120000,timer:{},sockets:new Set(),active:new Set([browser]),
  clearTimeout(){timerCleared=true},fs:{rmSync(){deleted=true}},stopped:async()=>{},limit(p,ms){if(p===buildTask)return Promise.reject(Error('INERT_BUILD_UNSETTLED'));return p},refusal(){throw Error('INERT_REFUSAL')},console:{log(s){printed=JSON.parse(s)}}}
 vm.createContext(c);const task=vm.runInContext(receipts+'\n'+helpers+'\nasync function actualCleanup(){'+actual.slice(0,bodyEnd)+actual.slice(bodyEnd+'\n  }'.length)+'}\nactualCleanup()',c)
 return {async finish(){const code=await task;return{code,receipt:printed,deleted,now,closeBudget,clearedAtClose}},async lateBuild(){resolveBuild?.();await Promise.resolve();return deleted}}
}
test('actual finally keeps absolute deadline armed and cannot pass after a late Browser.close',async()=>{
 const fast=await actualCleanup464().finish();assert.equal(fast.receipt.passed,true);assert.equal(fast.deleted,true)
 const late=await actualCleanup464({closeMs:60000}).finish();assert.equal(late.receipt.passed,false);assert.equal(late.receipt.stage,'CLEANUP');assert.equal(late.deleted,false)
 assert.equal(late.clearedAtClose,false);assert.ok(late.closeBudget>0&&late.closeBudget<=1000)
})
test('actual CDP call uses supplied remaining budget and abort settles pending without waiting60s',async()=>{
 const code=harness.slice(harness.indexOf('class CDP {'),harness.indexOf('async function stopped('))
 let budget,terminated=0,events={},send=0
 const c={Map,Error,BOUNDS,limit(p,ms){budget=ms;return p},once(){throw Error('UNUSED')},WebSocket:class{},refusal(){throw Error('REFUSED')}}
 vm.createContext(c);vm.runInContext(harness.slice(harness.indexOf('function deferred()'),harness.indexOf('function limit('))+code+'\nthis.CDP=CDP',c)
 const socket={on(name,f){events[name]=f},send(){send++},close(){},terminate(){terminated++}},client=new c.CDP(socket)
 const promise=client.call('Browser.close',{},1000);assert.equal(send,1);assert.equal(budget,1000)
 assert.equal(typeof client.abort,'function');client.abort();await assert.rejects(promise);assert.equal(client.pending.size,0);assert.equal(terminated,1)
})
test('actual cleanup retains owned directory until build settles and a late promise cannot delete it',async()=>{
 const run=actualCleanup464({pendingBuild:true}),out=await run.finish();assert.equal(out.receipt.passed,false);assert.equal(out.deleted,false)
 assert.equal(await run.lateBuild(),false)
})


test('actual hosted path declarations bind imports and Git to this checkout',()=>{
  const actualURL=new URL('../../../chrome-extension/scripts/accept-github-comparison-hosted.mjs',import.meta.url).href
  const start=harness.indexOf('const HERE ='), end=harness.indexOf('const hash =',start)
  assert.ok(start>=0&&end>start)
  const actual=vm.runInNewContext(harness.slice(start,end).replaceAll('import.meta.url','actualURL')+'\n;({REPO})',{path,fileURLToPath,actualURL})
  assert.equal(actual.REPO,repo)
  assert.equal(fs.existsSync(path.join(actual.REPO,'companion/package.json')),true)
})

function actualStartupObserver464() {
  const start=harness.indexOf('export function observeChromiumStartup464()'),end=harness.indexOf('\nclass CDP {',start)
  assert.ok(start>=0&&end>start,'actual startup observation producer is present')
  const c={Buffer,Set,Error,Object,Number};vm.createContext(c)
  vm.runInContext(harness.slice(start,end).replace('export function','function')+'\nthis.observe=observeChromiumStartup464',c)
  return c.observe()
}
test('actual startup producer classifies split sandbox stderr without publishing body or cleanup exit',()=>{
  const observer=actualStartupObserver464(),child=new EventEmitter();child.stderr=new EventEmitter()
  observer.track(child);observer.step('PORT_FILE')
  child.stderr.emit('data',Buffer.from('private-owned-path No usable sand'))
  child.stderr.emit('data',Buffer.from('box! Failed to move to new namespace'))
  child.emit('exit',1,null)
  const snapshot=observer.snapshot();child.emit('exit',null,'SIGTERM')
  assert.equal(snapshot.sandboxUnavailable,true);assert.equal(snapshot.namespaceDenied,true)
  assert.equal(snapshot.exitCode,1);assert.equal(snapshot.signal,'NONE');assert.equal(snapshot.step,'PORT_FILE')
  assert.equal(JSON.stringify(snapshot).includes('private-owned-path'),false)
  const r=receipt('CHROMIUM',false,0,{chromiumStartup:snapshot})
  assert.equal(r.passed,false);assert.equal(r.chromiumStartup.exitCode,1)
})
test('startup pipe continues draining after memory cap and reports only finite categories',()=>{
  const observer=actualStartupObserver464(),child=new EventEmitter();child.stderr=new EventEmitter();observer.track(child)
  for(let i=0;i<64;i++)child.stderr.emit('data',Buffer.from('private-marker'.repeat(1024)))
  child.stderr.emit('data',Buffer.from('No usable sandbox!'))
  child.emit('error',new Error('private-error'));child.emit('exit',null,'UNRECOGNIZED_SIGNAL')
  const s=observer.snapshot();assert.equal(s.stderrTruncated,true);assert.equal(s.sandboxUnavailable,false)
  assert.equal(s.spawnError,true);assert.equal(s.signal,'OTHER');assert.equal(JSON.stringify(s).includes('private'),false)
  assert.throws(()=>observer.step('private-step'))
  let getters=0
  const fake=Object.defineProperty({},'step',{get(){getters++;return 'CONNECTED'}})
  assert.equal(receipt('CHROMIUM',false,0,{chromiumStartup:fake}).chromiumStartup,undefined)
  assert.equal(getters,0)
})
async function actualChromiumPhase464({fail=false}={}) {
  const observer=actualStartupObserver464(),child=new EventEmitter();child.stderr=new EventEmitter()
  const start=harness.indexOf("    stage='CHROMIUM'"),end=harness.indexOf("    stage='WORKER'",start)
  assert.ok(start>0&&end>start)
  let calls=0,port=false
  const c={stage:'CHROMIUM',chromiumStartup:undefined,xvfbStartup:undefined,observeChromiumStartup464:()=>observer,chromium:undefined,browser:undefined,portText:undefined,parts:undefined,
    path,fs:{statSync(){return{isFile:()=>true}}},refusal(){throw Error('REFUSED')},execFileSync(){return'Chromium 155.0.8059.0'},runtime:{},remaining(){return 10000},owned:'/owned',extension:'/owned/extension',env:{},display:':1',chromeArgs,childEnvironment,
    spawn(binary,args,options){calls++;assert.equal(binary,'/usr/bin/chromium');assert.equal(options.stdio[2],'pipe');return child},
    async waitForFile(){port=true;if(fail){child.stderr.emit('data',Buffer.from('Missing X server or $DISPLAY private-marker'));child.emit('exit',1,null);throw Error('STARTUP_FILE_MISSING')}return'12345\n/devtools/browser/a-b-c\n'},
    CDP:{async connect(){return{}}},WebSocket:class{},active:new Set()}
  vm.createContext(c)
  const catchStart=harness.indexOf('  } catch { /* Nothing from an untrusted page/transport exception'),catchEnd=harness.indexOf('\n  finally {',catchStart)
  assert.ok(catchStart>0&&catchEnd>catchStart)
  const actualCatch=harness.slice(catchStart,catchEnd)
  await vm.runInContext('async function phase(){try{'+harness.slice(start,end)+actualCatch+'}\nphase()',c)
  child.emit('exit',null,'SIGTERM')
  assert.equal(calls,1);assert.equal(port,true)
  return receipt('CHROMIUM',false,0,c.runtime)
}
test('actual main Chromium failure snapshots before finally without changing launch or pass policy',async()=>{
  const r=await actualChromiumPhase464({fail:true})
  assert.equal(r.passed,false);assert.equal(r.cases,0);assert.equal(r.chromiumStartup.step,'PORT_FILE')
  assert.equal(r.chromiumStartup.displayUnavailable,true);assert.equal(r.chromiumStartup.exitCode,1);assert.equal(r.chromiumStartup.signal,'NONE')
  assert.equal(JSON.stringify(r).includes('private-marker'),false)
})
test('actual main CDP-ready phase records connected without claiming the browser acceptance passed',async()=>{
  const r=await actualChromiumPhase464()
  assert.equal(r.chromiumStartup.step,'CONNECTED');assert.equal(r.passed,false);assert.equal(r.chromiumStartup.exitObserved,false)
})

test('hosted acceptance pins only build to available Ubuntu22 without changing the three native platforms',()=>{
 const ci=fs.readFileSync(path.join(repo,'.github/workflows/ci.yml'),'utf8')
 assert.match(ci,/build:\r?\n\s+# [^\r\n]+\r?\n\s+runs-on: ubuntu-22\.04/)
 assert.match(ci,/os: \[ubuntu-latest, macos-latest, windows-latest\]/)
 const helper=(harness.match(/installedSandboxHelper464/g)||[]).length;assert.equal(helper,0)
 assert.equal(harness.includes('CHROME_DEVEL_SANDBOX'),false)
 assert.equal(/no-sandbox|disable-setuid-sandbox|apparmor_restrict|sysctl|sudo /.test(harness),false)
})
test('actual preflight rejects other or unreported images despite hosted Linux admission',()=>{
 const env={GITHUB_ACTIONS:'true',RUNNER_OS:'Linux',RUNNER_ENVIRONMENT:'github-hosted',ImageOS:'ubuntu22',RUNNER_TEMP:'/owned'}
 const stat=()=>({isDirectory:()=>true,isSymbolicLink:()=>false,uid:42})
 assert.equal(preflight(env,'linux',stat,x=>x,42),'/owned')
 for(const ImageOS of [undefined,'ubuntu24','ubuntu26','ubuntu-22.04','private-marker'])assert.throws(()=>preflight({...env,ImageOS},'linux',stat,x=>x,42))
 assert.equal(childEnvironment('/owned',{CHROME_DEVEL_SANDBOX:'/foreign'}).CHROME_DEVEL_SANDBOX,undefined)
})


test('startup retains only capped byte count and a DevTools-listening boolean',()=>{
 const observer=actualStartupObserver464(),child=new EventEmitter();child.stderr=new EventEmitter();observer.track(child)
 child.stderr.emit('data',Buffer.from('private-owned-path DevTools list'))
 child.stderr.emit('data',Buffer.from('ening on ws://127.0.0.1:1234/private-session'))
 observer.portFile('ENOENT');const before=observer.snapshot()
 assert.equal(before.stderrRetainedBytes,76);assert.equal(before.devToolsListening,true);assert.equal(before.portFileRead,'ENOENT')
 child.stderr.emit('data',Buffer.alloc(9000,120));const capped=observer.snapshot();assert.equal(capped.stderrRetainedBytes,8192);assert.equal(capped.stderrTruncated,true)
 const r=receipt('CHROMIUM',false,0,{chromiumStartup:before});assert.equal(r.chromiumStartup.portFileRead,'ENOENT');assert.equal(r.chromiumStartup.devToolsListening,true)
 assert.equal(/private|1234|127\.0\.0\.1/.test(JSON.stringify(r)),false)
 for(const stderrRetainedBytes of [-1,8193,NaN,'private-marker'])assert.equal(receipt('CHROMIUM',false,0,{chromiumStartup:{...before,stderrRetainedBytes}}).chromiumStartup,undefined)
 assert.equal(receipt('CHROMIUM',false,0,{chromiumStartup:{...before,portFileRead:'private-marker'}}).chromiumStartup,undefined)
 assert.throws(()=>observer.portFile('private-marker'))
})
test('actual port polling observes closed IO categories without changing25ms deadline or leaking errors',async()=>{
 const start=harness.indexOf('async function waitForFile('),end=harness.indexOf('// Diagnostics only:',start);assert.ok(start>0&&end>start)
 const values=[],seen=[],bytes='12345\n/devtools/browser/a-b\n';let now=0,getters=0,reads=0
 const getter=Object.defineProperty({},'code',{get(){getters++;return 'private-marker'}})
 const errors=[{code:'ENOENT'},{code:'EACCES'},{code:'EPERM'},{code:'EISDIR'},{code:'private-marker'},getter,new Proxy({},{getOwnPropertyDescriptor(){throw Error('private-marker')}})]
 const context={Date:{now:()=>now},Object,Promise,Error,fs:{readFileSync(file,encoding){assert.equal(file,'/owned/profile/DevToolsActivePort');assert.equal(encoding,'utf8');reads++;if(errors.length)throw errors.shift();return bytes}},setTimeout(fn,ms){assert.equal(ms,25);now+=ms;fn()},refusal(code){throw Error(code)}};vm.createContext(context);vm.runInContext(harness.slice(start,end)+'\nthis.poll=waitForFile',context)
 assert.equal(await context.poll('/owned/profile/DevToolsActivePort',10000,x=>values.push(x)),bytes);assert.deepEqual(values,['ENOENT','EACCES','EPERM','EISDIR','OTHER','OTHER','OTHER','READ']);assert.equal(getters,0);assert.equal(reads,8)
 now=0;reads=0;context.fs.readFileSync=()=>{reads++;throw{code:'ENOENT'}}
 await assert.rejects(()=>context.poll('/owned/profile/DevToolsActivePort',10000,x=>seen.push(x)),/STARTUP_FILE_MISSING/);assert.equal(now,10000);assert.equal(reads,400);assert.equal(seen.length,400)
})

// The actual main Xvfb block and catch execute with inert child/clock schedules.
async function actualXvfbPhase464(kind) {
  const child=new EventEmitter();child.stderr=new EventEmitter();child.stdio=[null,null,child.stderr,new EventEmitter()]
  const start=harness.indexOf("    stage='XVFB';remaining()"),end=harness.indexOf("    stage='CHROMIUM'",start)
  const catchStart=harness.indexOf('  } catch { /* Nothing from an untrusted page/transport exception'),catchEnd=harness.indexOf('\n  finally {',catchStart)
  assert.ok(start>0&&end>start&&catchStart>0&&catchEnd>catchStart)
  let calls=0,budget,displayValue
  const c={stage:'BUNDLE',xvfb:undefined,xvfbStartup:undefined,chromiumStartup:undefined,observeChromiumStartup464:actualStartupObserver464,
    deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}},runtime:{},remaining(){return 10000},env:{FIXED:'INERT'},
    spawn(exe,args,options){calls++;if(kind==='spawnthrow')throw Error('INERT_PRIVATE_SYNC_ERROR');assert.equal(exe,'/usr/bin/Xvfb');assert.deepEqual(Array.from(args),['-displayfd','3','-screen','0','1280x800x24','-nolisten','tcp']);assert.equal(options.env,c.env);assert.equal(options.stdio[3],'pipe');return child},
    limit(p,ms){budget=ms;assert.equal(ms,5000)
      if(kind==='exit'||kind==='timeout'||kind==='partial')return Promise.resolve().then(()=>{if(kind==='exit')child.emit('exit',7,null);if(kind==='partial')child.stdio[3].emit('data',Buffer.from('27'));throw Error('INERT_XVFB_TIMEOUT')})
      queueMicrotask(()=>{if(kind==='error'){child.stderr.emit('data',Buffer.from('INERT_PRIVATE_ERROR'));child.emit('error',new Error('INERT_PRIVATE_MESSAGE'))}else if(kind==='invalid')child.stdio[3].emit('data',Buffer.from('123456789'));else child.stdio[3].emit('data',Buffer.from('27\n'))});return p},
    Buffer,Promise,Error}
  vm.createContext(c)
  await vm.runInContext('async function phase(){try{'+harness.slice(start,end)+'\nthis.actualDisplay=display;'+harness.slice(catchStart,catchEnd)+'}\nphase.call(this)',c)
  displayValue=c.actualDisplay
  const out=receipt('XVFB',false,0,c.runtime)
  child.emit('exit',null,'SIGTERM') // After catch/success snapshot: cleanup cannot rewrite it.
  return{out,calls,budget,displayValue,child,c}
}
test('actual Xvfb spawn-error observation remains false and excludes stderr/error bodies',async()=>{
 const {out,calls,budget}=await actualXvfbPhase464('error');assert.equal(calls,1);assert.equal(budget,5000)
 assert.equal(out.passed,false);assert.equal(out.cases,0);assert.equal(out.xvfbStartup.step,'DISPLAY_FD');assert.equal(out.xvfbStartup.spawnError,true)
 const sync=await actualXvfbPhase464('spawnthrow');assert.equal(sync.calls,1);assert.equal(sync.budget,undefined);assert.equal(sync.out.passed,false);assert.equal(sync.out.xvfbStartup.step,'SPAWN');assert.equal(sync.out.xvfbStartup.spawnError,false);assert.equal(sync.out.xvfbStartup.exitObserved,false)
 assert.equal(out.xvfbStartup.stderrRetainedBytes,19);assert.equal(out.xvfbStartup.signal,'NONE');assert.equal(JSON.stringify(out).includes('INERT_PRIVATE'),false)
})
test('actual Xvfb pre-ready exit and timeout retain original refusal without claiming readiness',async()=>{
 const exit=await actualXvfbPhase464('exit');assert.equal(exit.out.passed,false);assert.equal(exit.out.xvfbStartup.exitCode,7);assert.equal(exit.out.xvfbStartup.exitObserved,true);assert.equal(exit.out.xvfbStartup.signal,'NONE')
 const timeout=await actualXvfbPhase464('timeout');assert.equal(timeout.budget,5000);assert.equal(timeout.out.xvfbStartup.step,'DISPLAY_FD');assert.equal(timeout.out.xvfbStartup.exitObserved,false);assert.equal(timeout.out.passed,false)
 const partial=await actualXvfbPhase464('partial');assert.equal(partial.budget,5000);assert.equal(partial.out.xvfbStartup.step,'DISPLAY_PARTIAL');assert.equal(partial.out.passed,false)
})
test('actual Xvfb invalid display FD remains refused with only closed lifecycle fields',async()=>{
 const {out,displayValue}=await actualXvfbPhase464('invalid');assert.equal(displayValue,undefined);assert.equal(out.passed,false);assert.equal(out.xvfbStartup.step,'DISPLAY_INVALID');assert.equal(JSON.stringify(out).includes('123456789'),false)
})
test('actual Xvfb display ready does not grant acceptance and late cleanup cannot replace snapshot',async()=>{
 const {out,displayValue}=await actualXvfbPhase464('ready');assert.equal(displayValue,':27');assert.equal(out.passed,false);assert.equal(out.xvfbStartup.step,'DISPLAY_READY');assert.equal(out.xvfbStartup.portFileRead,'NOT_ATTEMPTED');assert.equal(out.xvfbStartup.exitObserved,false);assert.equal(out.xvfbStartup.signal,'NONE')
})
test('Xvfb optional DTO preserves capped drain/privacy and rejects accessors or invalid steps',()=>{
 const observer=actualStartupObserver464(),child=new EventEmitter();child.stderr=new EventEmitter();observer.track(child);observer.step('DISPLAY_FD');child.stderr.emit('data',Buffer.alloc(9000,120));const s=observer.snapshot()
 const out=receipt('XVFB',false,0,{xvfbStartup:s});assert.equal(out.xvfbStartup.stderrRetainedBytes,8192);assert.equal(out.xvfbStartup.stderrTruncated,true);assert.equal(out.chromiumStartup,undefined);assert.equal(out.passed,false)
 let gets=0;const fake={...s};Object.defineProperty(fake,'step',{get(){gets++;return'DISPLAY_READY'}});assert.equal(receipt('XVFB',false,0,{xvfbStartup:fake}).xvfbStartup,undefined);assert.equal(gets,0)
 assert.equal(receipt('XVFB',false,0,{xvfbStartup:{...s,step:'INERT_PRIVATE'}}).xvfbStartup,undefined);assert.equal(receipt('XVFB',false,0).xvfbStartup,undefined)
})


// Literal native Chromium155 prefix observations are never error-cause/pass authority.
const startupSites464=['dbus/bus.cc','ui/ozone/platform/x11/ozone_platform_x11.cc','ui/gtk/gtk_ui.cc','ui/gl/init/gl_factory.cc','content/browser/gpu/gpu_process_host.cc','components/crash/core/app/crashpad_linux.cc','components/os_crypt/async/browser/freedesktop_secret_key_provider.cc','chrome/browser/process_singleton_posix.cc','chrome/browser/chrome_browser_main.cc','content/browser/devtools/devtools_http_handler.cc']
function observedLog464(chunks){const observer=actualStartupObserver464(),child=new EventEmitter();child.stderr=new EventEmitter();observer.track(child);for(const chunk of chunks)child.stderr.emit('data',Buffer.from(chunk));return observer.snapshot()}
test('all ten fixed native log sites and four severities produce only stable bitmasks',()=>{
 for(let i=0;i<startupSites464.length;i++)for(let severity=0;severity<4;severity++){
  const name=['INFO','WARNING','ERROR','FATAL'][severity],state=observedLog464([`[12:34:1019/060102.123456:${name}:${startupSites464[i]}:123] PRIVATE_BODY_TOKEN\n`])
  assert.equal(state.stderrSiteMask,1<<i);assert.equal(state.stderrSeverityMask,1<<severity)
  const r=receipt('CHROMIUM',false,0,{chromiumStartup:state});assert.equal(r.chromiumStartup.stderrSiteMask,1<<i);assert.equal(r.passed,false);assert.equal(r.cases,0);assert.equal(r.reviewReady,false)
  for(const value of ['PRIVATE_BODY_TOKEN',startupSites464[i],'1019/060102','12:34'])assert.equal(JSON.stringify(r).includes(value),false)
 }
})
test('log categories accumulate split native prefixes and remain pre-cleanup immutable',()=>{
 const observer=actualStartupObserver464(),child=new EventEmitter();child.stderr=new EventEmitter();observer.track(child)
 for(const part of ['[1:2:ER','ROR:dbus/bus.cc:4] PRIVATE_A\n[WARNING:ui/gtk/gtk_ui.cc:5] PRIVATE_B\n'])child.stderr.emit('data',Buffer.from(part))
 const before=observer.snapshot();assert.equal(before.stderrSiteMask,5);assert.equal(before.stderrSeverityMask,6)
 child.stderr.emit('data',Buffer.from('[FATAL:chrome/browser/chrome_browser_main.cc:6] PRIVATE_AFTER\n'));child.emit('exit',null,'SIGTERM')
 assert.equal(before.stderrSiteMask,5);assert.equal(before.signal,'NONE');assert.equal(JSON.stringify(before).includes('PRIVATE'),false)
})
test('unknown malformed old-format custom-prefix and body-embedded sites stay unclassified',()=>{
 const lines=['body [ERROR:dbus/bus.cc:1] PRIVATE','[ERROR:private/site.cc:1] PRIVATE','[VERBOSE1:dbus/bus.cc:1] PRIVATE','[ERROR:dbus/bus.cc(1)] PRIVATE','[custom-prefix:ERROR:dbus/bus.cc:1] PRIVATE','[ERROR:dbus/bus.cc:1]','[ERROR:/private/dbus/bus.cc:1] PRIVATE','[ERROR:../dbus/bus.cc:1] PRIVATE','[ERROR:dbus/bus.cc:12345678901] PRIVATE','[1:ERROR:dbus/bus.cc:1]PRIVATE']
 for(const line of lines){const state=observedLog464([line]);assert.equal(state.stderrSiteMask,0);assert.equal(state.stderrSeverityMask,0);assert.equal(JSON.stringify(state).includes('PRIVATE'),false)}
})
test('cap boundary partial prefixes and later drained megabytes cannot classify or escape',()=>{
 const prefix='[ERROR:dbus/bus.cc:1] PRIVATE';const state=observedLog464(['x'.repeat(8188)+'\n'+prefix,'\n'+prefix.repeat(100000)])
 assert.equal(state.stderrRetainedBytes,8192);assert.equal(state.stderrTruncated,true);assert.equal(state.stderrSiteMask,0);assert.equal(state.stderrSeverityMask,0)
 const all=observedLog464(startupSites464.map(s=>`[ERROR:${s}:1] PRIVATE\n`));assert.equal(all.stderrSiteMask,1023);assert.equal(all.stderrSeverityMask,4)
})
test('both receipt projections reject nonfinite masks and never invoke mask accessors',()=>{
 const state=observedLog464(['[ERROR:dbus/bus.cc:1] PRIVATE'])
 for(const field of ['chromiumStartup','xvfbStartup'])for(const [key,max]of [['stderrSiteMask',1023],['stderrSeverityMask',15]]){
  for(const value of [-1,max+1,NaN,Infinity,0.5,'PRIVATE'])assert.equal(receipt('CHROMIUM',false,0,{[field]:{...state,[key]:value}})[field],undefined)
  let getters=0;const fake={...state};Object.defineProperty(fake,key,{get(){getters++;return 1}});assert.equal(receipt('CHROMIUM',false,0,{[field]:fake})[field],undefined);assert.equal(getters,0)
 }
})

test('canonical native prefix has at most two IDs then one timestamp then one tick',()=>{
 const positives=['[','[1:','[1:2:','[1:2:3:','[1019/060102.123456:','[1:1019/060102.123456:','[1:2:1019/060102.123456:3:']
 const negatives=['[1:2:3:4:','[1019/060102.123456:1019/060102.123456:','[1019/060102.123456:1:2:','[1:2:1019/060102.123456:3:4:','[1:1019/060102.123456:2:1019/060102.123456:']
 for(const prefix of positives){const state=observedLog464([prefix+'ERROR:dbus/bus.cc:1] PRIVATE\n']);assert.equal(state.stderrSiteMask,1);assert.equal(state.stderrSeverityMask,4)}
 for(const prefix of negatives){const state=observedLog464([prefix+'ERROR:dbus/bus.cc:1] PRIVATE\n']);assert.equal(state.stderrSiteMask,0);assert.equal(state.stderrSeverityMask,0)}
})


// Actual TypeScript worker body under inert Chrome events and a virtual clock.
// These controls do not create tabs, sockets, browsers, or real timers.
function navigationWorker464({update}={}) {
 const listeners=()=>{const set=new Set();return{addListener:f=>set.add(f),removeListener:f=>set.delete(f),emit(...a){for(const f of [...set])f(...a)},get size(){return set.size}}}
 const onUpdated=listeners(),onRemoved=listeners(),timers=new Map(),calls=[];let now=1000,next=0,resolveUpdate,rejectUpdate
 const pending=new Promise((resolve,reject)=>{resolveUpdate=resolve;rejectUpdate=reject})
 const chrome={runtime:{onInstalled:{addListener(){}}},tabs:{onUpdated,onRemoved,
  async create(options){calls.push(['create',options]);return{id:41}},
  update(id,options){calls.push(['update',id,options]);assert.equal(onUpdated.size,1);assert.equal(onRemoved.size,1);return update?update():pending}}}
 const c={chrome,BrowserBridge:class{},PageSanitizer:class{},WSClient:class{},Date:{now:()=>now},
  setTimeout(f,ms){const id=++next;timers.set(id,{f,ms});return id},clearTimeout:id=>timers.delete(id)}
 const compiled=ts.transpileModule(worker.replace(/^import .+$/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},reportDiagnostics:true});assert.equal(compiled.diagnostics.length,0)
 vm.createContext(c);vm.runInContext(compiled.outputText,c)
 return{api:c.cmspark464,calls,onUpdated,onRemoved,timers,resolveUpdate,rejectUpdate,
  complete(patch={}){onUpdated.emit(41,{status:'complete'},{id:41,url:PAGE,status:'complete',...patch})},
  now(value){now=value},timeout(){const tasks=[...timers.values()];for(const t of tasks)t.f()},
  clean(){assert.equal(onUpdated.size,0);assert.equal(onRemoved.size,0);assert.equal(timers.size,0)}}
}
const flushNavigation464=async()=>{for(let i=0;i<8;i++)await Promise.resolve()}
async function startNavigation464(options={}){
 const run=navigationWorker464(options);assert.equal(await run.api.createTab(),41)
 assert.equal(run.calls[0][1].url,'about:blank');assert.equal(run.calls[0][1].active,true)
 let outcome='pending';const done=run.api.navigateToPage(100).then(v=>{outcome=v;return v},()=>{outcome=false;return false})
 return{...run,done,outcome:()=>outcome}
}
test('owned navigation requires actual update success after an exact complete event; later rejection wins',async()=>{
 const good=await startNavigation464();good.complete();await flushNavigation464();assert.equal(good.outcome(),'pending')
 good.resolveUpdate({id:41,status:'loading'});assert.equal(await good.done,true);good.clean()
 assert.equal(good.calls.filter(x=>x[0]==='update').length,1);assert.equal(good.calls[1][1],41);assert.equal(good.calls[1][2].url,PAGE)
 const bad=await startNavigation464();bad.complete();bad.rejectUpdate(Error('INERT_PRIVATE'));assert.equal(await bad.done,false);bad.clean()
})
test('API returned complete cannot replace a real exact tab URL status complete event',async()=>{
 const run=await startNavigation464();run.resolveUpdate({id:41,url:PAGE,status:'complete'});await flushNavigation464();assert.equal(run.outcome(),'pending')
 for(const [id,info,tab]of [[42,{status:'complete'},{id:42,url:PAGE,status:'complete'}],[41,{}, {id:41,url:PAGE,status:'complete'}],[41,{status:'complete'},{id:41,url:'about:blank',status:'complete'}],[41,{status:'complete'},{id:42,url:PAGE,status:'complete'}],[41,{status:'complete'},{id:41,url:PAGE,status:'loading'}]]){
  run.onUpdated.emit(id,info,tab);await flushNavigation464();assert.equal(run.outcome(),'pending')
 }
 run.complete();assert.equal(await run.done,true);run.clean()
})
test('navigation loading after complete invalidates that candidate until a new exact event',async()=>{
 const run=await startNavigation464();run.complete();run.onUpdated.emit(41,{status:'loading'},{id:41,url:PAGE,status:'loading'})
 run.resolveUpdate({id:41});await flushNavigation464();assert.equal(run.outcome(),'pending');run.complete();assert.equal(await run.done,true);run.clean()
})
test('owned removal, API rejection and synchronous throw refuse once and release listeners and timer',async()=>{
 for(const mode of ['remove','reject','throw','wrong-api-id']){
  const run=await startNavigation464(mode==='throw'?{update(){throw Error('INERT_PRIVATE')}}:{})
  run.onRemoved.emit(42);if(mode!=='throw'){await flushNavigation464();assert.equal(run.outcome(),'pending')}
  if(mode==='remove')run.onRemoved.emit(41)
  if(mode==='reject')run.rejectUpdate(Error('INERT_PRIVATE'))
  if(mode==='wrong-api-id')run.resolveUpdate({id:42})
  assert.equal(await run.done,false);run.clean();run.complete();run.resolveUpdate({id:41});await flushNavigation464();assert.equal(run.outcome(),false)
 }
})
test('virtual absolute navigation deadline refuses at boundary, after it and on timeout with no late completion',async()=>{
 for(const now of [1100,1101]){
  const run=await startNavigation464();run.complete();run.now(now);run.resolveUpdate({id:41});assert.equal(await run.done,false);run.clean()
 }
 const run=await startNavigation464();assert.equal([...run.timers.values()][0].ms,100);run.timeout();assert.equal(await run.done,false);run.clean()
 run.resolveUpdate({id:41});run.complete();await flushNavigation464();assert.equal(run.outcome(),false)
 const lateEvent=await startNavigation464();lateEvent.resolveUpdate({id:41});await flushNavigation464();lateEvent.now(1100);lateEvent.complete();assert.equal(await lateEvent.done,false);lateEvent.clean()
})
test('navigation has one owned invocation and refuses absent tab, duplicate and invalid budgets without another update',async()=>{
 const absent=navigationWorker464();await assert.rejects(()=>absent.api.navigateToPage(100));absent.clean()
 const run=navigationWorker464();await run.api.createTab()
 for(const ms of [0,-1,60001,NaN,Infinity,1.5,'100',undefined])await assert.rejects(()=>run.api.navigateToPage(ms))
 assert.equal(run.calls.filter(x=>x[0]==='update').length,0)
 const first=run.api.navigateToPage(100).catch(()=>false);await assert.rejects(()=>run.api.navigateToPage(100));assert.equal(run.calls.filter(x=>x[0]==='update').length,1)
 run.timeout();assert.equal(await first,false);await assert.rejects(()=>run.api.navigateToPage(100));run.clean()
})
async function actualNavigationBudget464({loadMs=40000,domMs=1,domReady=true}={}){
 let now=1000,loadBudget,domBudget,connectBudget,expression,positive=false
 const start=harness.indexOf("    stage='NAVIGATION'"),end=harness.indexOf("    stage='POSITIVE'",start);assert.ok(start>0&&end>start)
 const c={stage:'AUTH',BOUNDS,PAGE,active:new Set(),Date:{now:()=>now},Math,assert,remaining:()=>120000-now,refusal(){throw Error('NAVIGATION_REFUSED')},
  worker:{async evaluate(code,awaited,ms){assert.equal(awaited,true);loadBudget=ms;assert.match(code,/cmspark464\.navigateToPage/);now+=loadMs;return true}},
  async openPage(ms){connectBudget=ms;return{close(){},async evaluate(code,awaited,budget){assert.equal(awaited,true);expression=code;domBudget=budget;now+=domMs;return domReady}}}}
 vm.createContext(c);let refused=false
 try{await vm.runInContext('async function actual(){'+harness.slice(start,end)+'\nreturn true};actual()',c);positive=true}catch{refused=true}
 return{loadBudget,domBudget,connectBudget,expression,positive,refused,now}
}
test('actual NAVIGATION shares one absolute 60s across load, connect and original DOM ready',async()=>{
 const out=await actualNavigationBudget464();assert.equal(out.positive,true);assert.equal(out.loadBudget,60000);assert.equal(out.domBudget,20000);assert.equal(out.connectBudget,20000)
 assert.match(out.expression,/setTimeout\(\(\)=>\{o\.disconnect\(\);resolve\(false\)\},20000\)/)
 const late=await actualNavigationBudget464({domMs:20000});assert.equal(late.refused,true);assert.equal(late.positive,false)
 const expired=await actualNavigationBudget464({loadMs:60000});assert.equal(expired.refused,true);assert.equal(expired.domBudget,undefined)
 const notReady=await actualNavigationBudget464({domReady:false});assert.equal(notReady.refused,true)
})
test('actual CDP evaluate and connection accept only supplied remaining time while defaults stay unchanged',async()=>{
 const code=harness.slice(harness.indexOf('class CDP {'),harness.indexOf('async function stopped('));let budget,terminated=0
 const c={Map,Error,Math,BOUNDS,limit(p,ms){budget=ms;return p},once:()=>Promise.reject(Error('INERT_CONNECT')),refusal(){throw Error('REFUSED')}}
 vm.createContext(c);vm.runInContext(harness.slice(harness.indexOf('function deferred()'),harness.indexOf('function limit('))+code+'\nthis.CDP=CDP',c)
 class Socket{terminate(){terminated++}}
 await assert.rejects(()=>c.CDP.connect(Socket,'INERT',321));assert.equal(budget,321);assert.equal(terminated,1)
 let message;const socket={on(){},send(text){message=JSON.parse(text)},close(){},terminate(){}}
 const client=new c.CDP(socket),first=client.evaluate('true',true,123);assert.equal(budget,123);assert.equal(message.params.awaitPromise,true);client.abort();await assert.rejects(first)
 const second=client.evaluate('true');assert.equal(budget,60000);client.abort();await assert.rejects(second)
})

// Actual worker/CDP/NAVIGATION/catch source; protocol/DOM schedule is inert, not a browser recording.
function crossDocumentEvent464(){const set=new Set();return{addListener(f){set.add(f)},removeListener(f){set.delete(f)},emit(...args){for(const f of [...set])f(...args)},size:()=>set.size}}
async function actualCrossDocument464(){
 const state={createdBeforeLoad:false,loaded:false,createURL:null,updates:0,contextDestroyed:false,pageEvaluations:0,workerEvaluations:0},updated=crossDocumentEvent464(),removed=crossDocumentEvent464();
 const chrome={runtime:{onInstalled:{addListener(){}}},debugger:{async getTargets(){return[{id:'OWNED-TARGET',tabId:41,type:'page'}]}},tabs:{onUpdated:updated,onRemoved:removed,
  async create(options){state.createURL=options.url;state.createdBeforeLoad=true;return{id:41,status:options.url==='about:blank'?'complete':'loading',url:'about:blank',pendingUrl:options.url}},
  async update(id,options){assert.equal(id,41);assert.equal(options.url,PAGE);state.updates++;await Promise.resolve();state.loaded=true;updated.emit(41,{status:'complete'},{id:41,url:PAGE,status:'complete'});return{id:41,url:PAGE,status:'complete'}}}};
 class Bridge{constructor(){}async execute(){throw Error('UNEXPECTED_BRIDGE')}}class Client{}
 const wc={BrowserBridge:Bridge,PageSanitizer:class{},WSClient:Client,chrome,console:{log(){}},setTimeout,clearTimeout,Date,Promise,Error,Number};vm.createContext(wc);const compiled=ts.transpileModule(worker.replace(/^import .+$/gm,''),{fileName:'github-comparison-hosted-worker.ts',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},reportDiagnostics:true});assert.equal(compiled.diagnostics.length,0);vm.runInContext(compiled.outputText,wc);const api=wc.cmspark464;
 assert.equal(await api.createTab(),41);assert.equal(await api.pageTarget(),'OWNED-TARGET');assert.equal(state.loaded,false);
 const helperStart=harness.indexOf('function deferred()'),helperEnd=harness.indexOf('async function waitForFile(',helperStart),cdpStart=harness.indexOf('class CDP {'),cdpEnd=harness.indexOf('function cleanupRemaining(',cdpStart);
 const cc={Map,Error,Promise,setTimeout,clearTimeout,once,BOUNDS:{navigation:60000},refusal(){throw Error('INERT_REFUSAL')}};vm.createContext(cc);vm.runInContext(harness.slice(helperStart,helperEnd)+harness.slice(cdpStart,cdpEnd)+'\nthis.CDP=CDP',cc);
 function client(kind){const sock=new EventEmitter();sock.close=()=>{};sock.terminate=()=>{};sock.send=wire=>{const req=JSON.parse(wire);assert.equal(req.method,'Runtime.evaluate');assert.equal(req.params.awaitPromise,true);
  if(kind==='worker'){state.workerEvaluations++;Promise.resolve(vm.runInContext(req.params.expression,wc)).then(value=>sock.emit('message',Buffer.from(JSON.stringify({id:req.id,result:{result:{value}}}))),()=>sock.emit('message',Buffer.from(JSON.stringify({id:req.id,error:{code:-32000,message:'INERT_WORKER_REFUSAL'}}))));return}
  state.pageEvaluations++;const file={querySelector:()=>null,querySelectorAll:()=>Array(4).fill({})};const dom={location:{href:state.loaded?PAGE:'about:blank'},document:{readyState:state.loaded?'complete':'loading',getElementById:()=>file},MutationObserver:class{observe(){}disconnect(){}},setTimeout:()=>1,clearTimeout(){},Promise};vm.createContext(dom);const value=vm.runInContext(req.params.expression,dom);
  if(!state.loaded){queueMicrotask(()=>{state.loaded=true;state.contextDestroyed=true;sock.emit('message',Buffer.from(JSON.stringify({id:req.id,error:{code:-32000,message:'Execution context was destroyed.'}})))});return}
  Promise.resolve(value).then(v=>sock.emit('message',Buffer.from(JSON.stringify({id:req.id,result:{result:{value:v}}}))))};return new cc.CDP(sock)}
 const page=client('page'),workerClient=client('worker'),c={stage:'AUTH',cases:2,runtime:{},chromiumStartup:undefined,xvfbStartup:undefined,PAGE,BOUNDS:{navigation:60000},Date,Math,assert,Error,remaining:()=>120000,profileRead:false,cleanupOkay:true,active:new Set(),worker:workerClient,openPage:async()=>page,console:{log(x){c.output=JSON.parse(x)}}};vm.createContext(c);
 const receipts=harness.slice(harness.indexOf('const STAGES ='),harness.indexOf('\nfunction deferred()')).replace('export function','function');const start=harness.indexOf("    stage='NAVIGATION'"),end=harness.indexOf("    stage='POSITIVE'",start),ca=harness.indexOf('  } catch { /* Nothing from an untrusted page/transport exception'),cb=harness.indexOf('\n  finally {',ca),tail=harness.slice(harness.indexOf('  const out=receipt(stage'),harness.indexOf('\n}\nif(process.argv'));
 vm.runInContext(receipts,c);const code=await vm.runInContext('async function actual(){try{'+harness.slice(start,end)+'\nthis.navCompleted=true;'+harness.slice(ca,cb)+'\n'+tail+'}\nactual.call(this)',c);
 const result={kind:'ACTUAL_SOURCE_INERT_CROSS_DOCUMENT_SCHEDULE',createdCallbackBeforeLoad:state.createdBeforeLoad,initialCreateURLWasPage:state.createURL===PAGE,updateCalls:state.updates,contextDestroyed:state.contextDestroyed,pageEvaluations:state.pageEvaluations,workerEvaluations:state.workerEvaluations,navigationCompleted:c.navCompleted===true,actualTailCode:code,actualStage:c.output.stage,actualCases:c.output.cases,actualPassed:c.output.passed,pendingCDP:page.pending.size+workerClient.pending.size,nativeBrowser:false};assert.equal(result.navigationCompleted,true,'created Tab must not let pending cross-document navigation destroy the ready promise');assert.equal(result.pendingCDP,0);assert.equal(result.actualPassed,false,'partial phase producer is never a whole hosted pass');return result;
}
test('actual worker load barrier prevents a permitted cross-document context-destroyed navigation failure',async()=>{const out=await actualCrossDocument464();assert.equal(out.contextDestroyed,false);assert.equal(out.initialCreateURLWasPage,false);assert.equal(out.updateCalls,1);assert.equal(out.actualCases,2)})


// Diagnostics-only controls execute actual harness/worker source in inert realms.
function actualOperationProjection464(){
 const start=harness.indexOf('const STAGES ='),end=harness.indexOf('\nfunction deferred()');assert.ok(start>0&&end>start)
 const c={};vm.createContext(c);vm.runInContext(harness.slice(start,end).replace('export function','function')+'\nthis.api={receipt,project:acceptanceOperationProjection464,operations:[...ACCEPTANCE_OPERATIONS]}',c);return c.api
}
test('all fixed acceptance operations project as closed own-data scalars without readiness authority',()=>{
 const api=actualOperationProjection464();assert.equal(api.operations.length,54)
 for(const acceptanceOperation of api.operations){const r=receipt('WORKER',false,0,{acceptanceOperation});assert.equal(r.acceptanceOperation,acceptanceOperation);assert.equal(r.passed,false);assert.equal(r.reviewReady,false);assert.equal(r.cases,0)}
 for(const value of ['PRIVATE_BODY_PATH',undefined,null,0,NaN,{},[],new String('WORKER_API'),'WORKER_API\nPRIVATE'])assert.equal(receipt('WORKER',false,0,{acceptanceOperation:value}).acceptanceOperation,undefined)
 assert.equal(receipt('WORKER',false,0,Object.create({acceptanceOperation:'WORKER_API'})).acceptanceOperation,undefined)
})
test('actual receipt skips the new getter before legacy metadata enumeration and preserves old values',()=>{
 let operationGets=0,nodeGets=0
 const runtime={get acceptanceOperation(){operationGets++;throw Error('PRIVATE_GETTER')},get node(){nodeGets++;return'22.23.2'},image:'20261012.322.1',unrelated:'PRIVATE_DATA'}
 const out=receipt('WORKER',false,0,runtime);assert.equal(operationGets,0);assert.equal(nodeGets,1);assert.equal(out.node,'22.23.2');assert.equal(out.image,'20261012.322.1');assert.equal(out.acceptanceOperation,undefined);assert.equal(JSON.stringify(out).includes('PRIVATE'),false)
})
test('operation descriptor failures and hostile values are omitted without invoking their contents',()=>{
 const api=actualOperationProjection464();let gets=0
 const runtime=new Proxy({acceptanceOperation:'WORKER_API'},{getOwnPropertyDescriptor(){throw Error('PRIVATE_DESCRIPTOR')},get(){gets++;throw Error('PRIVATE_GET')}})
 assert.equal(api.project(runtime),undefined);assert.equal(gets,0)
 const value=Object.defineProperty({},'toString',{get(){gets++;throw Error('PRIVATE_COERCION')}})
 assert.equal(receipt('WORKER',false,0,{acceptanceOperation:value}).acceptanceOperation,undefined);assert.equal(gets,0)
 // Legacy runtime enumeration can still throw for a hostile whole Proxy; no new blanket claim.
 assert.throws(()=>receipt('WORKER',false,0,runtime));assert.equal(JSON.stringify(receipt('WORKER',false,0,{})).includes('PRIVATE'),false)
})
async function actualOperationWorker464(mode){
 let now=0,created=0,targetCalls=0
 const chrome={runtime:{onInstalled:{addListener(){}}},tabs:{async create(options){created++;assert.equal(options.url,'about:blank');if(mode==='CREATE')throw Error('PRIVATE_CREATE');return{id:41}}},debugger:{async getTargets(){targetCalls++;return mode==='TARGET'?[]:[{id:'OWNED-TARGET',tabId:41,type:'page',url:'about:blank'}]}}}
 const wc={BrowserBridge:class{},PageSanitizer:class{},WSClient:class{},chrome};vm.createContext(wc)
 vm.runInContext(ts.transpileModule(worker.replace(/^import .+$/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,wc)
 const realWorker={async evaluate(expression){if(mode==='API'&&expression.startsWith('typeof'))return'undefined';return await vm.runInContext(expression,wc)}}
 const c={stage:'CHROMIUM',cases:0,runtime:{},chromiumStartup:undefined,xvfbStartup:undefined,Date:{now:()=>now},Math,URL,Number,assert,endpoint:'http://127.0.0.1:1',AbortSignal:{timeout(){return{}}},remaining:()=>120000,profileRead:false,cleanupOkay:true,active:new Set(),parts:['1'],WebSocket:class{},
  async fetch(){if(mode==='FETCH')throw Error('PRIVATE_FETCH');return{async json(){if(mode==='PARSE')throw Error('PRIVATE_PARSE');return mode==='MISSING'?[]:[{type:'service_worker',url:'chrome-extension://'+'a'.repeat(32)+'/worker.js',webSocketDebuggerUrl:'ws://127.0.0.1/OWNED'}]}}},
  setTimeout(f){now+=10001;f()},CDP:{async connect(){if(mode==='CONNECT')throw Error('PRIVATE_CONNECT');return realWorker}},console:{log(text){c.out=JSON.parse(text)}}}
 vm.createContext(c);vm.runInContext(harness.slice(harness.indexOf('const STAGES ='),harness.indexOf('\nfunction deferred()')).replace('export function','function'),c)
 const a=harness.indexOf("    stage='WORKER'"),b=harness.indexOf('    const secret=',a),ca=harness.indexOf('  } catch { /* Nothing'),cb=harness.indexOf('\n  finally {',ca),tail=harness.slice(harness.indexOf('  const out=receipt(stage'),harness.indexOf('\n}\nif(process.argv'))
 const code=await vm.runInContext('async function phase(){try{'+harness.slice(a,b)+harness.slice(ca,cb)+'\n'+tail+'};phase()',c)
 return{out:c.out,code,created,targetCalls}
}
test('actual WORKER and catch distinguish seven original same-DTO refusal sites without reflecting errors',async()=>{
 const results=[]
 for(const [mode,operation]of [['FETCH','WORKER_DISCOVER_FETCH'],['PARSE','WORKER_DISCOVER_PARSE'],['MISSING','WORKER_FOUND'],['CONNECT','WORKER_CONNECT'],['API','WORKER_API'],['CREATE','WORKER_CREATE'],['TARGET','WORKER_TARGET']]){
  const r=await actualOperationWorker464(mode);assert.equal(r.code,1);assert.equal(r.out.stage,'WORKER');assert.equal(r.out.cases,0);assert.equal(r.out.passed,false);assert.equal(r.out.acceptanceOperation,operation);assert.equal(JSON.stringify(r.out).includes('PRIVATE'),false);results.push(r.out.acceptanceOperation)
 }
 assert.equal(new Set(results).size,7)
})
test('actual AST operation writes use only the complete fixed catalog; cleanup never updates it',()=>{
 const source=ts.createSourceFile('actual-hosted.mjs',harness,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),written=new Set()
 const add=node=>{if(ts.isStringLiteral(node))written.add(node.text);else if(ts.isConditionalExpression(node)){add(node.whenTrue);add(node.whenFalse)}else assert.fail('operation assignment must be closed literal')}
 function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='operation')add(node.initializer);if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&ts.isIdentifier(node.left)&&node.left.text==='operation')add(node.right);ts.forEachChild(node,visit)}visit(source)
 assert.deepEqual([...written].sort(),Array.from(actualOperationProjection464().operations).sort())
 const a=harness.indexOf('  finally {',harness.indexOf('export async function main()')),b=harness.indexOf('\n  const out=receipt(stage',a)
 const cleanup=ts.createSourceFile('cleanup.js','async function actual(){'+harness.slice(a+'  finally {'.length,b),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
 let writes=0;function check(node){if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&node.left.getText(cleanup).includes('operation'))writes++;ts.forEachChild(node,check)}check(cleanup);assert.equal(writes,0)
})
async function actualOperationRestore464(mode){
 const a=mode==='moved'?harness.indexOf("    operation='NEG_MOVED_SETUP'"):harness.indexOf("    for(const kind of ['folded','loading'])"),b=mode==='moved'?harness.indexOf("    operation='COMPLETE'",a):harness.indexOf("    operation='NEG_MOVED_SETUP'",a)
 assert.ok(a>0&&b>a);let dispatch=0,opened=0,closed=0,evaluated=0
 const c={stage:'NEGATIVES',cases:0,runtime:{},chromiumStartup:undefined,xvfbStartup:undefined,profileRead:false,cleanupOkay:true,active:new Set(),PAGE,assert,env:{CMSPARK_DATA_DIR:'/INERT_ONLY'},scope:{},input:{},
 async openPage(){opened++;return{async evaluate(){evaluated++;return true},close(){closed++}}},async getWire(){dispatch++;if(mode!=='loading'||dispatch===2)throw Error('PRIVATE_PRIMARY');return{success:true,data:{comparison_refusal:true}}},captureLocalPageResult(){return{data:{}}},service:{create(){throw Error('CAPTURE_REQUIRED')}},console:{log(text){c.out=JSON.parse(text)}}}
 vm.createContext(c);vm.runInContext(harness.slice(harness.indexOf('const STAGES ='),harness.indexOf('\nfunction deferred()')).replace('export function','function'),c)
 const ca=harness.indexOf('  } catch { /* Nothing'),cb=harness.indexOf('\n  finally {',ca),tail=harness.slice(harness.indexOf('  const out=receipt(stage'),harness.indexOf('\n}\nif(process.argv'))
 const code=await vm.runInContext('async function phase(){let page;try{'+harness.slice(a,b)+harness.slice(ca,cb)+'\n'+tail+'};phase()',c)
 return{out:c.out,code,dispatch,opened,closed,evaluated}
}
test('actual negative finally restoration remains last-entered and never disguises failure as first-failure evidence',async()=>{
 for(const [mode,operation,dispatch,opened]of [['folded','NEG_FOLDED_RESTORE',1,2],['loading','NEG_LOADING_RESTORE',2,4],['moved','NEG_MOVED_RESTORE',1,2]]){
  const r=await actualOperationRestore464(mode);assert.equal(r.out.acceptanceOperation,operation);assert.equal(r.out.passed,false);assert.equal(r.code,1);assert.equal(r.dispatch,dispatch);assert.equal(r.opened,opened);assert.equal(r.closed,opened);assert.equal(r.evaluated,opened);assert.equal(JSON.stringify(r.out).includes('PRIVATE_PRIMARY'),false)
 }
})
async function actualOperationCleanup464(late){
 const a=harness.indexOf('  finally {',harness.indexOf('export async function main()')),b=harness.indexOf('\n}',a),part=harness.slice(a+'  finally {'.length,b),split=part.indexOf('\n  }\n  const out=')
 const helpers=harness.slice(harness.indexOf('function cleanupRemaining('),harness.indexOf('export async function main()'))
 let deleted=0,cleared=0
 const c={stage:'COMPLETE',cases:11,runtime:{acceptanceOperation:'COMPLETE'},operation:'COMPLETE',profileRead:true,cleanupOkay:true,forward:undefined,esbuild:undefined,buildTask:undefined,buildSettled:true,server:undefined,browser:undefined,chromium:undefined,xvfb:undefined,owned:'/INERT_ONLY',sockets:new Set(),active:new Set(),deadline:120000,expired:false,timer:{},Date:{now:()=>late?120000:1000},fs:{rmSync(){deleted++}},clearTimeout(){cleared++},refusal(){throw Error('INERT_DEADLINE')},console:{log(text){c.out=JSON.parse(text)}}}
 vm.createContext(c);vm.runInContext(harness.slice(harness.indexOf('const STAGES ='),harness.indexOf('\nfunction deferred()')).replace('export function','function'),c)
 const code=await vm.runInContext(helpers+'\nasync function actual(){'+part.slice(0,split)+part.slice(split+'\n  }'.length)+'};actual()',c)
 return{out:c.out,code,operation:c.operation,deleted,cleared}
}
test('actual outer cleanup preserves operation snapshot and original pass/fail and directory retention decisions',async()=>{
 const fast=await actualOperationCleanup464(false);assert.equal(fast.out.passed,true);assert.equal(fast.code,0);assert.equal(fast.deleted,1);assert.equal(fast.out.acceptanceOperation,'COMPLETE')
 const late=await actualOperationCleanup464(true);assert.equal(late.out.passed,false);assert.equal(late.out.stage,'CLEANUP');assert.equal(late.code,1);assert.equal(late.deleted,0);assert.equal(late.out.acceptanceOperation,'COMPLETE')
 assert.equal(fast.operation,'COMPLETE');assert.equal(late.operation,'COMPLETE');assert.equal(fast.cleared,1);assert.equal(late.cleared,1)
})
test('actual main preflight catch attaches finite operation without process or owned filesystem activity',async()=>{
 let printed,effects=0;const forbidden=()=>{effects++;throw Error('DENIED')}
 const a=harness.indexOf('async function stopped('),b=harness.indexOf('if(process.argv[1]')
 const c={process:{env:{},platform:'linux'},BOUNDS,preflight,receipt,clearTimeout,console:{log:s=>{printed=JSON.parse(s)}},spawn:forbidden,fs:{mkdtempSync:forbidden}}
 vm.createContext(c);vm.runInContext(harness.slice(a,b).replace('export async function','async function'),c)
 assert.equal(await c.main(),1);assert.equal(printed.acceptanceOperation,'PREFLIGHT');assert.equal(printed.passed,false);assert.equal(effects,0)
})
