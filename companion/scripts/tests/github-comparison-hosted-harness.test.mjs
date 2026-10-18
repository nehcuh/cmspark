import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
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
  const env={GITHUB_ACTIONS:'true',RUNNER_OS:'Linux',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_TEMP:'/owned'}
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
  assert.ok(ci.indexOf('name: Hosted GitHub comparison acceptance')>ci.indexOf('name: Run chrome-extension tests'))
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
