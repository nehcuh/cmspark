import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import { BOUNDS,preflight,childEnvironment,chromeArgs,manifestPaths,choosePanel,finiteReceipt,CDP,reloadDocument,restartSequence,historyObservationExpression,closeOwnedChild,loadedExpression,privateRead,limit,observeBrowserStartup } from '../accept-acp-history-hosted-732.mjs'
const root='/owned',url='chrome-extension://'+'a'.repeat(32)+'/sidepanel.html'
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const hosted={GITHUB_ACTIONS:'true',RUNNER_OS:'Linux',RUNNER_ENVIRONMENT:'github-hosted',ImageOS:'ubuntu22',RUNNER_TEMP:root}
const directory={isDirectory:()=>true,isSymbolicLink:()=>false,uid:1000}
test('hosted admission rejects local invocation before any startup',()=>{assert.throws(()=>preflight({},'darwin'));assert.throws(()=>preflight(hosted,'win32'));assert.equal(preflight(hosted,'linux',()=>directory,x=>x,1000),root)})
test('hosted root requires exact owner and canonical non-link directory',()=>{for(const s of [{...directory,uid:1},{...directory,isSymbolicLink:()=>true},{...directory,isDirectory:()=>false}])assert.throws(()=>preflight(hosted,'linux',()=>s,x=>x,1000));assert.throws(()=>preflight(hosted,'linux',()=>directory,()=>'/other',1000))})
test('child env has no HOME or inherited credentials and keeps tracking opaque',()=>{const e=childEnvironment(root,{HOME:'/private',OPENAI_API_KEY:'PRIVATE',RUNNER_TRACKING_ID:'opaque'});assert.equal(e.HOME,undefined);assert.equal(e.OPENAI_API_KEY,undefined);assert.equal(e.RUNNER_TRACKING_ID,'opaque');assert.equal(e.CMSPARK_SKIP_LOGIN_ENV,'1');assert.equal(e.CMSPARK_DATA_DIR,'/owned/data')})
test('display and extension paths are admitted without relaxing browser sandbox flags',()=>{assert.throws(()=>childEnvironment(root,{},'remote:0'));assert.throws(()=>chromeArgs(root,'/foreign/extension'));const a=chromeArgs(root,'/owned/extension');assert.equal(a.some(x=>/no-sandbox|headless|disable-setuid/.test(x)),false);assert.equal(a.at(-1),'about:blank')})
const manifest={manifest_version:3,background:{service_worker:'static/background/index.js'},side_panel:{default_path:'sidepanel.html'},permissions:['sidePanel','tabs','storage','debugger']}
test('ordinary manifest supplies exact worker and native panel paths',()=>{assert.deepEqual(manifestPaths(manifest),{worker:'static/background/index.js',page:'sidepanel.html'});for(const p of ['../sidepanel.html','/sidepanel.html','x//panel.html'])assert.throws(()=>manifestPaths({...manifest,side_panel:{default_path:p}}));assert.throws(()=>manifestPaths({...manifest,permissions:['tabs']}))})
test('pairing tab cannot masquerade as actual native SidePanel',()=>{const old=[{targetId:'pair',url}],after=[...old,{targetId:'panel',url}];assert.equal(choosePanel(old,after,url,[{id:'pair',url,tabId:7},{id:'panel',url}]),'panel');assert.throws(()=>choosePanel([],old,url,[{id:'pair',url,tabId:7}]))})
test('panel ambiguity, old target, or wrong URL refuse',()=>{assert.throws(()=>choosePanel([],[{targetId:'p',url},{targetId:'q',url}],url,[{id:'p',url},{id:'q',url}]));assert.throws(()=>choosePanel([{targetId:'p',url}],[{targetId:'p',url}],url,[{id:'p',url}]));assert.throws(()=>choosePanel([],[{targetId:'p',url:'/wrong'}],url,[{id:'p',url}]))})
function sequence(overrides={}){const calls=[],first={},second={},io={first:async()=>{calls.push('first');return first},second:async()=>{calls.push('second');return second}};for(const k of ['durable','crash','closed','peerClosed','existing','reload','fresh','terminal'])io[k]=async()=>{calls.push(k)};return {io:{...io,...overrides},calls,first,second}}
test('actual lifecycle sequence requires durable, real close, peer quiescence before restart',async()=>{const {io,calls}=sequence();await restartSequence(io);assert.deepEqual(calls,['first','durable','crash','closed','peerClosed','second','existing','reload','fresh','terminal'])})
for(const point of ['durable','closed','peerClosed','existing','reload','fresh'])test('failed '+point+' cannot advance or pass',async()=>{const s=sequence({[point]:async()=>{s.calls.push(point);throw Error('PRIVATE_ERROR')}});await assert.rejects(restartSequence(s.io));assert.equal(s.calls.at(-1),point);assert.equal(s.calls.includes('terminal'),false);if(['durable','closed','peerClosed'].includes(point))assert.equal(s.calls.includes('second'),false)})
test('second process cannot be same retained daemon handle',async()=>{const s=sequence();s.io.second=async()=>s.first;await assert.rejects(restartSequence(s.io));assert.equal(s.calls.includes('existing'),false)})
test('late old close cannot trigger second start before exact first close',async()=>{const gate=defer(),s=sequence({closed:()=>gate.promise});const p=restartSequence(s.io);await Promise.resolve();await Promise.resolve();await Promise.resolve();assert.equal(s.calls.includes('second'),false);gate.resolve();await p;assert.equal(s.calls.includes('second'),true)})
function reloadSeam(mode='good'){const events=new Map(),off=[],f={frame:{id:'main',loaderId:'old'}},send=(n,v)=>{for(const fn of events.get(n)||[])fn(v)},view={on(n,fn){events.set(n,[...(events.get(n)||[]),fn]);return ()=>{off.push(n);events.set(n,events.get(n).filter(x=>x!==fn))}},async call(name){if(name==='Page.getFrameTree')return {frameTree:f};if(name==='Page.reload'){if(mode==='reject')throw Error('PRIVATE');send('Runtime.executionContextsCleared',{});if(mode!=='old')f.frame.loaderId='new';send('Page.frameNavigated',{frame:f.frame});if(mode!=='missing-context')send('Runtime.executionContextCreated',{context:{id:2,auxData:{isDefault:true,frameId:'main'}}});send('Page.lifecycleEvent',{frameId:'main',loaderId:f.frame.loaderId,name:'load'});return {}}return {}}};return {view,off,events}}
test('real reload helper waits changed loader, retired realm, new default context and load plus API ACK',async()=>{const s=reloadSeam();assert.equal(await reloadDocument(s.view,()=>100),true);assert.equal(s.off.length,4);assert.equal([...s.events.values()].every(x=>!x.length),true)})
for(const mode of ['old','missing-context','reject'])test('reload '+mode+' never fresh and always removes listeners',async()=>{const s=reloadSeam(mode);await assert.rejects(reloadDocument(s.view,()=>1));assert.equal(s.off.length,4)})
test('CDP abort rejects every actual pending request without reflecting errors',async()=>{const socket=new EventEmitter();socket.send=()=>{};socket.terminate=()=>{};const c=new CDP(socket),p=c.call('Runtime.evaluate',{},100);c.abort();await assert.rejects(p,/CDP_CLOSED/);assert.equal(c.pending.size,0)})
test('exact child close is awaited; child kill dispatch alone is insufficient',async()=>{const gate=defer(),signals=[],child={exitCode:null,signalCode:null,closed:gate.promise,kill:s=>signals.push(s)};let settled=false;const p=closeOwnedChild(child,()=>100).then(()=>{settled=true});await Promise.resolve();assert.deepEqual(signals,['SIGTERM']);assert.equal(settled,false);gate.resolve();await p;assert.equal(settled,true)})
test('closed child never receives a new signal',async()=>{const signals=[];await closeOwnedChild({exitCode:0,signalCode:null,closed:Promise.resolve(),kill:s=>signals.push(s)},()=>100);assert.deepEqual(signals,[])})
test('actual serialized observation only returns interrupted/noGhost fixed booleans',()=>{const row={textContent:'date · OWNED_SESSION',parentElement:{textContent:'已中断；无法恢复原进程关联'}},history={querySelectorAll:()=>[row]};const run=live=>vm.runInNewContext(historyObservationExpression('OWNED_SESSION'),{document:{querySelectorAll:()=>[history],querySelector:s=>s==='[data-agent-live-log]'&&live?{}:null}});assert.equal(run(false).interrupted,true);assert.equal(run(false).noGhost,true);assert.equal(run(true).noGhost,false);assert.deepEqual(Object.keys(run(false)).sort(),['interrupted','noGhost'])})
test('closed receipt does not invoke getters or return supplied private fields',()=>{let calls=0;const c={private:'SECRET'};Object.defineProperty(c,'durable',{get(){calls++;throw Error('SECRET')}});const r=finiteReceipt('DURABLE',c);assert.equal(calls,0);assert.equal(r.checks.durable,false);assert.equal(JSON.stringify(r).includes('SECRET'),false);assert.equal(r.passed,false);assert.throws(()=>finiteReceipt('SECRET',{}))})
test('full success requires every declared check; UNKNOWN is not success',()=>{const r=finiteReceipt('COMPLETE',{});assert.equal(r.passed,false);const c=Object.fromEntries(Object.keys(r.checks).map(k=>[k,true]));assert.equal(finiteReceipt('COMPLETE',c).passed,true);assert.equal(finiteReceipt('CLEANUP',c).passed,false)})
test('source preserves canonical daemon, HMAC, strict file bounds, real fixture and hard budgets',()=>{const s=fs.readFileSync(fileURLToPath(new URL('../accept-acp-history-hosted-732.mjs',import.meta.url)),'utf8');for(const literal of ["'daemon','start'","'SIGKILL'","'acp.sessions.list'","crypto.createHmac('sha256',secret)","fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK","'companion/tests/fixtures/acp-lifecycle.cjs'","'ws_secret'"])assert.equal(s.includes(literal),true,literal);assert.deepEqual(BOUNDS,{outer:120000,navigation:60000,auth:5000,tool:15000});assert.equal(s.includes('createTransport('),false);assert.equal(s.includes('WebSocketServer'),false)})
test('load expression is native chrome API, rejects foreign tab/url and keeps one bounded timer',()=>{assert.throws(()=>loadedExpression(-1,url,10));assert.throws(()=>loadedExpression(1,'https://foreign.example/',10));const s=loadedExpression(1,url,10,'navigate');assert.equal(s.includes('chrome.tabs.onUpdated.addListener(updated)'),true);assert.equal(s.includes('chrome.tabs.update(id,{url:expected})'),true);assert.equal(s.includes('remaining'),true)})

test('private reader keeps actual owner/kind/link/bounded-file checks (POSIX receipt is not NTFS proof)',{skip:process.platform==='win32'},()=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'owned-history732-cpu-')))
  fs.chmodSync(root,0o700)
  try {
    const file=path.join(root,'fixture');fs.writeFileSync(file,'PUBLIC',{mode:0o600})
    assert.equal(privateRead(root,'fixture',6),'PUBLIC')
    assert.throws(()=>privateRead(root,'fixture',5))
    fs.chmodSync(file,0o644);assert.throws(()=>privateRead(root,'fixture',6));fs.chmodSync(file,0o600)
    fs.linkSync(file,path.join(root,'second'));assert.throws(()=>privateRead(root,'fixture',6));fs.unlinkSync(path.join(root,'second'))
    fs.symlinkSync(file,path.join(root,'link'));assert.throws(()=>privateRead(root,'link',6))
    fs.mkdirSync(path.join(root,'directory'),{mode:0o700});assert.throws(()=>privateRead(root,'directory',6))
  } finally {fs.rmSync(root,{recursive:true,force:true})}
})

// Test-only projection: scope to the actual exported main, not the first cleanup statement.
function extractMainFinally(source) {
  assert.equal(typeof source,'string')
  const text=source.replace(/\r\n/g,'\n'),declaration='export async function main() {\n',tail='\n}\nlet directEntry=false\n',boundary='\n  Object.assign(console,originalConsole)'
  const start=text.indexOf(declaration),close=text.indexOf(tail,start),end=text.indexOf(boundary,start)
  assert.ok(start>=0&&start===text.lastIndexOf(declaration)&&close>start&&end>start&&end<close)
  assert.equal(end,text.lastIndexOf(boundary))
  const begin=text.lastIndexOf('\n  finally {',end)
  assert.ok(begin>start)
  const block=text.slice(begin+'\n  finally {'.length,end)
  assert.match(block,/\n  }$/)
  return block.slice(0,-4).trim()
}
function actualFinally(overrides={},source=fs.readFileSync(fileURLToPath(new URL('../accept-acp-history-hosted-732.mjs',import.meta.url)),'utf8')) {
  const finallyBlock=extractMainFinally(source)
  let deletes=0,aborts=0
  const sameOwnedRoot=source.includes('export function sameOwnedRoot(')?vm.runInNewContext('('+source.slice(source.indexOf('export function sameOwnedRoot(')+'export '.length,source.indexOf('export async function main()',source.indexOf('export function sameOwnedRoot('))).trim()+')',{fs:{},process:{getuid:()=>1000}}):()=>{throw Error('ABSENT_ROOT_FENCE')}
  const rootStat={dev:1,ino:2,uid:1000,mode:0o40700,isDirectory:()=>true,isSymbolicLink:()=>false}
  const context={browserPhase:'PORT_FILE',browserStartup:undefined,chromium:{exitCode:65},xvfb:{exitCode:null},observeBrowserStartup,ownedIdentity:rootStat,sameOwnedRoot:(r,i)=>sameOwnedRoot(r,i,()=>({...rootStat,mtimeMs:999,...overrides.currentRootStat}),x=>overrides.rootRealpath??x,1000),observer:{terminate(){aborts++}},observers:new Set([{terminate(){aborts++},closed:Promise.resolve()}]),clients:new Set([{abort(){aborts++},settled:Promise.resolve()}]),pending:new Set(),children:new Set(),remaining:()=>10,deadline:Date.now()+1000,abort:{signal:{aborted:false}},timer:undefined,secret:'PRIVATE',owned:'/owned',fs:{rmSync(){deletes++}},checks:{},stage:'COMPLETE',closeOwnedChild,limit,clearTimeout,Date,Promise,...overrides}
  if(overrides.pending)context.clients=new Set([{abort(){},settled:Promise.allSettled([...overrides.pending])}])
  return {run:()=>vm.runInNewContext(`(async()=>{${finallyBlock};return {checks,stage,secret,browserStartup}})()`,context),deletes:()=>deletes,aborts:()=>aborts}
}
test('actual main finally closes owned endpoints and clears secret before deleting scratch',async()=>{
  const s=actualFinally(),r=await s.run();assert.equal(r.checks.cleanup,true);assert.equal(r.secret,undefined);assert.equal(s.deletes(),1);assert.equal(s.aborts(),2)
})
test('actual main finally preserves scratch while exact child close or pending request is unknown',async()=>{
  for(const overrides of [{children:new Set([{exitCode:null,signalCode:null,closed:new Promise(()=>{}),kill(){}}]),remaining:()=>1},{pending:new Set([new Promise(()=>{})]),remaining:()=>1},{abort:{signal:{aborted:true}}}]){
    const s=actualFinally(overrides),r=await s.run();assert.equal(r.checks.cleanup,false);assert.equal(r.stage,'CLEANUP');assert.equal(s.deletes(),0)
  }
})

function factoryProjection(kind,remaining) {
  const source=fs.readFileSync(fileURLToPath(new URL('../accept-acp-history-hosted-732.mjs',import.meta.url)),'utf8')
  const declaration=kind==='child'?source.slice(source.indexOf('  const child='),source.indexOf('\n  const connect=')):source.slice(source.indexOf('    const auth='),source.indexOf('\n    await auth();'))
  let count=0
  class Socket extends EventEmitter {constructor(){super();count++}send(){}}
  const child=new EventEmitter();child.stderr=new EventEmitter()
  const context={remaining,spawn(){count++;return child},children:new Set(),deferred:defer,WebSocket:Socket,origin:url,secret:'PUBLIC',observer:undefined,observers:new Set(),BOUNDS,limit:async p=>true,crypto:{},Math}
  return {run:()=>vm.runInNewContext(`(()=>{${declaration};return ${kind==='child'?'child':'auth'}})()`,context)(),count:()=>count}
}
test('actual child factory refuses expired/aborted continuation before any new spawn',()=>{
  for(const reason of ['EXPIRED','ABORTED']){const s=factoryProjection('child',()=>{throw Error(reason)});assert.throws(()=>s.run());assert.equal(s.count(),0,reason)}
  const s=factoryProjection('child',()=>100);s.run();assert.equal(s.count(),1)
})
test('actual authentication factory refuses expired/aborted continuation before any new socket',async()=>{
  for(const reason of ['EXPIRED','ABORTED']){const s=factoryProjection('auth',()=>{throw Error(reason)});await assert.rejects(s.run());assert.equal(s.count(),0,reason)}
  const s=factoryProjection('auth',()=>100);await s.run();assert.equal(s.count(),1)
})

test('actual finally refuses deletion when root identity changed but accepts ordinary directory mtime drift',async()=>{
  for(const currentRootStat of [{ino:3},{dev:9},{uid:0},{mode:0o40701},{isDirectory:()=>false},{isSymbolicLink:()=>true}]){const s=actualFinally({currentRootStat}),r=await s.run();assert.equal(r.checks.cleanup,false);assert.equal(s.deletes(),0)}
  const replaced=actualFinally({rootRealpath:'/foreign'}),result=await replaced.run();assert.equal(result.checks.cleanup,false);assert.equal(replaced.deletes(),0)
  const okay=actualFinally(),good=await okay.run();assert.equal(good.checks.cleanup,true);assert.equal(okay.deletes(),1)
})

const CLI_GUARD="data:text/javascript;base64,aW1wb3J0IGZzIGZyb20gJ25vZGU6ZnMnO2ltcG9ydCBjcCBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO2ltcG9ydCBuZXQgZnJvbSAnbm9kZTpuZXQnO2ltcG9ydCB0bHMgZnJvbSAnbm9kZTp0bHMnO2ltcG9ydCBodHRwIGZyb20gJ25vZGU6aHR0cCc7aW1wb3J0IGh0dHBzIGZyb20gJ25vZGU6aHR0cHMnO2ltcG9ydCBkZ3JhbSBmcm9tICdub2RlOmRncmFtJztpbXBvcnQgZG5zIGZyb20gJ25vZGU6ZG5zJztpbXBvcnQge3N5bmNCdWlsdGluRVNNRXhwb3J0c30gZnJvbSAnbm9kZTptb2R1bGUnO2NvbnN0IHdyaXRlPWZzLndyaXRlRmlsZVN5bmMuYmluZChmcyk7bGV0IGRlbmllZD0wO2NvbnN0IGRlbnk9KCk9PntkZW5pZWQrKzt0aHJvdyBFcnJvcignT1dORURfQ0xJX0VGRkVDVF9ERU5JRUQnKX07Zm9yKGNvbnN0IGsgb2YgWydzcGF3bicsJ3NwYXduU3luYycsJ2V4ZWMnLCdleGVjU3luYycsJ2V4ZWNGaWxlJywnZXhlY0ZpbGVTeW5jJywnZm9yayddKWNwW2tdPWRlbnk7Y3AuQ2hpbGRQcm9jZXNzLnByb3RvdHlwZS5zcGF3bj1kZW55O3Byb2Nlc3Mua2lsbD1kZW55O3Byb2Nlc3MuZGxvcGVuPWRlbnk7Z2xvYmFsVGhpcy5mZXRjaD1kZW55O2Zvcihjb25zdCBtIG9mIFtuZXQsdGxzLGh0dHAsaHR0cHMsZGdyYW0sZG5zXSlmb3IoY29uc3QgayBvZiBbJ2Nvbm5lY3QnLCdjcmVhdGVDb25uZWN0aW9uJywnY3JlYXRlU2VydmVyJywncmVxdWVzdCcsJ2dldCcsJ2NyZWF0ZVNvY2tldCcsJ2xvb2t1cCcsJ3Jlc29sdmUnXSlpZih0eXBlb2YgbVtrXT09PSdmdW5jdGlvbicpbVtrXT1kZW55O3N5bmNCdWlsdGluRVNNRXhwb3J0cygpO3Byb2Nlc3Mub24oJ2V4aXQnLCgpPT57d3JpdGUocHJvY2Vzcy5lbnYuT1dORURfRUZGRUNUU19GSUxFLEpTT04uc3RyaW5naWZ5KHtkZW5pZWQsc3VicHJvY2VzczowLG5hdGl2ZTowLG5ldHdvcms6MH0pKydcbicpO2lmKGRlbmllZClwcm9jZXNzLmV4aXRDb2RlPTk5fSk7"
test('real CLI canonical and owned directory alias both refuse local startup with the same finite receipt',()=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'owned-history732-cli-')))
  fs.chmodSync(root,0o700)
  try {
    const canonical=path.join(root,'canonical');fs.mkdirSync(canonical,{mode:0o700})
    fs.copyFileSync(fileURLToPath(new URL('../accept-acp-history-hosted-732.mjs',import.meta.url)),path.join(canonical,'harness.mjs'))
    fs.symlinkSync(canonical,path.join(root,'alias'),process.platform==='win32'?'junction':'dir')
    const results=[]
    for(const name of ['canonical','alias']) {
      const effect=path.join(root,name+'.effects.json')
      const child=spawnSync(process.execPath,['--import',CLI_GUARD,path.join(root,name,'harness.mjs')],{encoding:'utf8',timeout:5000,maxBuffer:65536,env:{PATH:'/usr/local/bin:/usr/bin:/bin',OWNED_EFFECTS_FILE:effect}})
      assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,1,name)
      assert.equal(child.stderr,'');const receipt=JSON.parse(child.stdout.trim());assert.equal(receipt.stage,'PREFLIGHT');assert.equal(receipt.passed,false)
      assert.deepEqual(JSON.parse(fs.readFileSync(effect,'utf8')),{denied:0,subprocess:0,native:0,network:0});results.push(receipt)
    }
    assert.deepEqual(results[0],results[1])
  } finally {fs.rmSync(root,{recursive:true,force:true})}
})

for(const mode of ['timeout','open-error','success-no-close','success-close'])test('actual connect/finally retains known socket until real close: '+mode,async()=>{
  const source=fs.readFileSync(fileURLToPath(new URL('../accept-acp-history-hosted-732.mjs',import.meta.url)),'utf8')
  const declaration=source.slice(source.indexOf('  const connect='),source.indexOf('\n  let WebSocket'))
  const body=extractMainFinally(source)
  const clients=new Set();let socket,terminated=0,observedClose=false,deleted=0,rejected=false
  class OwnedSocket extends EventEmitter {
    constructor(){super();socket=this;this.once('close',()=>{observedClose=true});if(mode==='open-error')queueMicrotask(()=>this.emit('error',Error('PRIVATE_ERROR')));if(mode.startsWith('success'))queueMicrotask(()=>this.emit('open'))}
    terminate(){terminated++;if(mode==='success-close')queueMicrotask(()=>this.emit('close'))}
  }
  try {
    const connect=vm.runInNewContext(`(()=>{${declaration};return connect})()`,{CDP,WebSocket:OwnedSocket,clients,BOUNDS,remaining:()=>2})
    try{await connect('ws://owned-inert')}catch{rejected=true}
    const context={browserPhase:'PORT_FILE',browserStartup:undefined,chromium:{exitCode:65},xvfb:{exitCode:null},observeBrowserStartup,observers:new Set(),clients,children:new Set(),remaining:()=>5,deadline:Date.now()+100,abort:{signal:{aborted:false}},timer:undefined,secret:'PUBLIC',owned:'/owned',ownedIdentity:{},sameOwnedRoot:()=>true,fs:{rmSync(){deleted++}},checks:{},stage:'BROWSER',closeOwnedChild,limit,clearTimeout,Date,Promise}
    const result=await vm.runInNewContext(`(async()=>{${body};return checks.cleanup})()`,context)
    assert.equal(rejected,mode==='timeout'||mode==='open-error')
    assert.equal(clients.size,1,'every already-created client must be retained, including failed open')
    assert.equal(terminated>=1,true)
    assert.equal(observedClose,mode==='success-close')
    assert.equal(result,mode==='success-close')
    assert.equal(deleted,mode==='success-close'?1:0,'terminate dispatch is not actual close')
  } finally {socket?.emit('close')}
})

// #735 finite browser progress: actual published startup segment, inert transports.
import * as startupHarness from '../accept-acp-history-hosted-732.mjs'
function browserSegment(fault='none') {
  const source=fs.readFileSync(fileURLToPath(new URL('../accept-acp-history-hosted-732.mjs',import.meta.url)),'utf8')
  const begin=source.indexOf("    stage='BROWSER';"),end=source.indexOf("stage='PANEL';",begin)
  assert.ok(begin>0&&end>begin)
  const body=source.slice(begin,end),cleanup=source.slice(source.indexOf('  finally {\n',end),source.indexOf('    let clean=true',end))
  const capture=cleanup.includes('browserStartup=observeBrowserStartup(browserPhase,chromium,xvfb)')?'browserStartup=observeBrowserStartup(browserPhase,chromium,xvfb)':''
  const receiptCall=source.match(/const out=(finiteReceipt\(stage,checks(?:,browserStartup)?\));/)
  assert.ok(receiptCall)
  const marker='OWNED_ERROR_DO_NOT_REFLECT_PATH_PID_BODY',fail=()=>{throw Error(marker)}
  const origin='chrome-extension://'+'a'.repeat(32),workerPath='static/background/index.js'
  const xvfb={exitCode:null,stdio:[null,null,null,new EventEmitter()]},chrome={exitCode:null}
  let connectCount=0,limitCount=0,fetchCount=0
  const worker={workerScriptReady:async()=>{if(fault==='workerready')fail();return true},call:async()=>{if(fault==='runtimeenable')fail();return {}},evaluate:async expression=>{
    if(expression.startsWith('chrome.tabs.create')){if(fault==='tabcreate')fail();return 7}
    if(expression.startsWith('chrome.debugger.getTargets')){if(fault==='pairtarget')fail();return 'pair'}
    if(fault==='navigate')fail();return true
  }}
  const browser={call:async()=>({targetInfos:fault==='workerdiscovery'?[]:[{targetId:'worker',type:'service_worker',url:origin+'/'+workerPath}]})}
  const pair={evaluate:async()=>{if(fault==='pairsecret')fail();return true}}
  class Socket extends EventEmitter {
    static OPEN=1
    constructor(){super();this.readyState=1;queueMicrotask(()=>fault==='auth'?this.emit('error',Error(marker)):this.emit('message',JSON.stringify({type:'auth.challenge',nonce:'public'})))}
    send(){queueMicrotask(()=>this.emit('message',JSON.stringify({type:'auth.ok'})))}
  }
  const context={stage:'BROWSER',browserPhase:null,browserStartup:undefined,chromium:undefined,xvfb:undefined,browser:undefined,worker:undefined,observer:undefined,secret:'PUBLIC_SYNTHETIC_ONLY',owned:'/owned',paths:{worker:workerPath,page:'sidepanel.html'},navigationDeadline:undefined,
    child(exe){if(exe==='/usr/bin/Xvfb'){queueMicrotask(()=>xvfb.stdio[3].emit('data',Buffer.from('23\n')));return xvfb}return chrome},
    env:{},input:{},extension:'/owned/extension',chromeArgs:startupHarness.chromeArgs,childEnvironment:()=>({}),remaining:()=>1000,nav:()=>1000,BOUNDS,
    deferred:defer,limit:async promise=>{if(++limitCount===1&&fault==='display')fail();return promise},
    poll:async fn=>{const v=await fn();if(!v)fail();return v},
    connect:async()=>{connectCount++;if(fault===['browserconnect','workerconnect','pairconnect'][connectCount-1])fail();return [browser,worker,pair][connectCount-1]},
    fs:{statSync:()=>{if(fault==='binary')fail();return {isFile:()=>true}},readFileSync:()=>{if(fault==='port')fail();return '9222\n/devtools/browser/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\n'}},
    fetch:async()=>{const which=++fetchCount===1?'worker':'pair';if(fault===which+'fetch')fail();return {json:async()=>{if(fault===which+'json')fail();return ['worker','pair'].map(id=>({id,webSocketDebuggerUrl:'ws://127.0.0.1:9222/devtools/page/'+id}))}}},
    WebSocket:Socket,observers:new Set(),crypto:{createHmac:()=>({update:()=>({digest:()=> 'PUBLIC_PROOF'})})},AbortSignal,loadedExpression:()=> 'OWNED_NAVIGATION_EXPRESSION',Math,Date,path,fail,
    observeBrowserStartup:startupHarness.observeBrowserStartup,finiteReceipt:startupHarness.finiteReceipt,devToolsPortSnapshot:startupHarness.devToolsPortSnapshot,
  }
  return vm.runInNewContext(`(async()=>{let startupError=false;try{${body}}catch{startupError=true} ${capture}; const checks={cleanup:true};return {receipt:${receiptCall[1]},startupError}})()`,context)
}
test('#735 actual browser awaits report only the last observed fixed phase and never pass a failed startup',async()=>{
  const cases={display:'XVFB_REQUEST',binary:'DISPLAY_OBSERVED',port:'BINARY_SELECTED',browserconnect:'PORT_FILE',workerdiscovery:'CDP_CONNECTED',workerconnect:'WORKER_FOUND',workerfetch:'WORKER_FOUND',workerjson:'WORKER_FOUND',workerready:'WORKER_FOUND',runtimeenable:'WORKER_READY',tabcreate:'WORKER_READY',navigate:'WORKER_READY',pairtarget:'PAIR_PAGE',pairconnect:'PAIR_PAGE',pairfetch:'PAIR_PAGE',pairjson:'PAIR_PAGE',pairsecret:'PAIR_PAGE',auth:'PAIRED',none:'AUTH_DONE'}
  for(const [fault,phase]of Object.entries(cases)){const r=await browserSegment(fault);assert.equal(r.receipt.browserPhase,phase,fault);assert.equal(r.startupError,fault!=='none',fault);assert.equal(r.receipt.passed,false,fault);assert.equal(r.receipt.stage,'BROWSER');assert.equal(r.receipt.checks.cleanup,true);assert.equal(JSON.stringify(r).includes('DO_NOT_REFLECT'),false)}
})
test('#735 browser receipt projection refuses unknown scalars, getters, proxies and unrelated text',()=>{
  assert.equal(typeof startupHarness.browserStartupProjection,'function')
  let getters=0;const input={browserPhase:'PORT_FILE',browserPresent:true,browserExitCode:65,xvfbPresent:true,xvfbExitCode:null,raw:'SECRET_PATH_BODY'}
  Object.defineProperty(input,'xvfbExitCode',{get(){getters++;throw Error('SECRET')}})
  const r=startupHarness.browserStartupProjection(input);assert.equal(getters,0);assert.deepEqual(r,{browserPhase:'PORT_FILE',browserPresent:true,browserExitCode:65,xvfbPresent:true,xvfbExitCode:null});assert.equal(JSON.stringify(r).includes('SECRET'),false)
  for(const value of [null,[],new Proxy({},{getOwnPropertyDescriptor(){throw Error('SECRET')}}),{browserPhase:['PORT_FILE'],browserExitCode:'65',browserPresent:'true'},{browserPhase:'UNKNOWN_PRIVATE',browserExitCode:NaN},{browserPhase:'PORT_FILE',browserExitCode:Infinity},{browserPhase:'PORT_FILE',browserExitCode:2147483648}]){const r=startupHarness.browserStartupProjection(value);assert.equal(r.browserExitCode,null);assert.equal(JSON.stringify(r).includes('SECRET'),false);assert.equal(JSON.stringify(r).includes('UNKNOWN_PRIVATE'),false)}
})
test('#735 actual main snapshots before cleanup and exit observations cannot become cleanup kill outcomes',()=>{
  const s=fs.readFileSync(fileURLToPath(new URL('../accept-acp-history-hosted-732.mjs',import.meta.url)),'utf8'),start=s.lastIndexOf('  finally {\n')
  const snapshot=s.indexOf('browserStartup=observeBrowserStartup(browserPhase,chromium,xvfb)',start),terminate=s.indexOf('for(const socket of observers)socket.terminate()',start)
  assert.ok(snapshot>start&&snapshot<terminate)
  assert.equal(typeof startupHarness.observeBrowserStartup,'function')
  const browser={exitCode:65},xvfb={exitCode:null},before=startupHarness.observeBrowserStartup('WORKER_FOUND',browser,xvfb)
  browser.exitCode=143;xvfb.exitCode=143;assert.equal(before.browserExitCode,65);assert.equal(before.xvfbExitCode,null);assert.equal(before.browserPresent,true)
  const absent=startupHarness.observeBrowserStartup(null,undefined,undefined);assert.equal(absent.browserPhase,null);assert.equal(absent.browserPresent,false);assert.equal(absent.xvfbPresent,false)
})

async function activePortPublication(parts,mutateAfterRead=false) {
  const source=fs.readFileSync(fileURLToPath(new URL('../accept-acp-history-hosted-732.mjs',import.meta.url)),'utf8')
  const begin=source.indexOf("    const binary=['/usr/bin/chromium-browser'"),end=source.indexOf('    const socketBase=',begin)
  const poll=source.split('\n').find(line=>line.startsWith('  const poll=async'))
  assert.ok(begin>0&&end>begin&&poll)
  const owned=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'owned-port732-'))),profile=path.join(owned,'profile'),file=path.join(profile,'DevToolsActivePort')
  fs.mkdirSync(profile,{mode:0o700})
  let reads=0,writes=0,timer
  const deadline=Date.now()+100
  const context={path,Date,Promise,setTimeout,deadline,owned,extension:path.join(owned,'extension'),input:{},screen:':23',chromium:undefined,browserPhase:'DISPLAY_OBSERVED',
    chromeArgs,childEnvironment,devToolsPortSnapshot:startupHarness.devToolsPortSnapshot,
    remaining:()=>{if(Date.now()>=deadline)throw Error('OWNED_TEST_DEADLINE')},fail:()=>{throw Error('OWNED_ACCEPTANCE_REFUSED')},
    fs:{statSync:()=>({isFile:()=>true}),readFileSync(p,encoding){assert.equal(p,file);assert.equal(encoding,'utf8');reads++;const text=fs.readFileSync(p,encoding);if(mutateAfterRead)fs.writeFileSync(file,'INVALID_AFTER_SNAPSHOT');return text}},
    child(_binary,args,env){assert.deepEqual(Array.from(args),chromeArgs(owned,path.join(owned,'extension')));assert.equal(env.HOME,undefined);fs.writeFileSync(file,parts[0]);writes++;if(parts.length===2)timer=setTimeout(()=>{fs.appendFileSync(file,parts[1]);writes++},5);return {exitCode:null,signalCode:null}},
  }
  try {
    const result=await vm.runInNewContext(`(async()=>{${poll};try{${source.slice(begin,end)};return {ok:true,phase:browserPhase,parts}}catch{return {ok:false,phase:browserPhase}}})()`,context)
    return {...result,reads,writes}
  } finally {clearTimeout(timer);fs.rmSync(owned,{recursive:true,force:true})}
}
test('#735 actual port prefix waits published endpoint after partial first line or UUID without final newline',async()=>{
  const endpoint='/devtools/browser/11111111-1111-4111-8111-111111111111',full='9222\n'+endpoint
  for(const offset of [2,5,20,full.length-1]) {
    const result=await activePortPublication([full.slice(0,offset),full.slice(offset)])
    assert.equal(result.ok,true);assert.equal(result.phase,'PORT_FILE');assert.deepEqual(Array.from(result.parts),['9222',endpoint]);assert.ok(result.reads>=2);assert.equal(result.writes,2)
  }
  const complete=await activePortPublication([full]);assert.equal(complete.ok,true);assert.equal(complete.reads,1)
  const same=await activePortPublication([full],true);assert.equal(same.ok,true);assert.equal(same.reads,1);assert.deepEqual(Array.from(same.parts),['9222',endpoint])
})
test('#735 complete malformed active-port content never becomes a usable endpoint',async()=>{
  for(const text of ['not-a-port\n/devtools/browser/11111111-1111-4111-8111-111111111111','9222\n/devtools/page/11111111-1111-4111-8111-111111111111','9222\n/devtools/browser/11111111-1111-4111-8111-111111111111\nEXTRA']) {
    const result=await activePortPublication([text]);assert.equal(result.ok,false);assert.equal(result.phase,'BINARY_SELECTED');assert.equal(result.parts,undefined)
  }
})
test('#735 original pass predicate ignores startup diagnostics and still requires all ten checks',()=>{
  const keys=Object.keys(finiteReceipt('COMPLETE',{}).checks),all=Object.fromEntries(keys.map(k=>[k,true]));assert.equal(keys.length,10)
  assert.equal(finiteReceipt('COMPLETE',all,{browserPhase:null}).passed,true)
  for(const key of keys){const r=finiteReceipt('COMPLETE',{...all,[key]:false},{browserPhase:'AUTH_DONE',browserPresent:true,browserExitCode:0,xvfbPresent:true,xvfbExitCode:0});assert.equal(r.passed,false)}
  assert.equal(finiteReceipt('BROWSER',all,{browserPhase:'AUTH_DONE'}).passed,false)
})

// #735 extractor regression controls: actual whole main, no native/browser execution.
test('actual main finally extraction accepts LF/CRLF and executes the real pre-cleanup snapshot',async()=>{
  const source=fs.readFileSync(fileURLToPath(new URL('../accept-acp-history-hosted-732.mjs',import.meta.url)),'utf8')
  for(const text of [source,source.replace(/\r?\n/g,'\r\n')]) {
    const s=actualFinally({},text),r=await s.run()
    assert.equal(r.checks.cleanup,true);assert.equal(r.secret,undefined);assert.equal(s.deletes(),1);assert.equal(s.aborts(),2)
    assert.deepEqual(JSON.parse(JSON.stringify(r.browserStartup)),{browserPhase:'PORT_FILE',browserPresent:true,browserExitCode:65,xvfbPresent:true,xvfbExitCode:null})
    assert.equal(extractMainFinally(text).includes('browserStartup=observeBrowserStartup(browserPhase,chromium,xvfb)'),true)
  }
})
test('actual main finally extraction refuses missing/duplicate/outside boundaries without selecting another finally',()=>{
  const source=fs.readFileSync(fileURLToPath(new URL('../accept-acp-history-hosted-732.mjs',import.meta.url)),'utf8'),boundary='\n  Object.assign(console,originalConsole)'
  for(const text of [source.replace('export async function main() {','async function otherMain() {'),source.replace('\n  finally {','\n  notFinally {'),source.replace(boundary,'\n  OTHER(console,originalConsole)'),source+boundary,source.replace(boundary,'\n  OTHER(console,originalConsole)')+boundary,source.replace('\n  }\n  Object.assign','\n  NOT_CLOSING\n  Object.assign'),source+'\nexport async function main() {\n'])assert.throws(()=>extractMainFinally(text))
  const outside='  finally {\n    throw Error("FOREIGN_NOT_EXECUTED")\n  }\n'
  assert.equal(extractMainFinally(outside+source),extractMainFinally(source))
})
