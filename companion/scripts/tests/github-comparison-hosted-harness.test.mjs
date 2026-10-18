import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
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
  const ctx={BrowserBridge,PageSanitizer:class{},WSClient,chrome:{runtime:{onInstalled:{addListener(){}}},debugger:{async getTargets(){return[{id:'ACTUAL-OWNED',type:'page',tabId:41},{id:'FOREIGN',type:'page',tabId:42}]}},tabs:{async create(options){effects.created++;assert.equal(options.url,PAGE);return{id:41}}}}}
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
