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
test('pairing tab cannot masquerade as actual native SidePanel',()=>{const old=[{targetId:'pair',type:'page',url,browserContextId:'owned'}],after=[...old,{targetId:'panel',type:'page',url,browserContextId:'owned'}];assert.equal(choosePanel(old,after,url,[{id:'pair',type:'page',url,tabId:7},{id:'panel',type:'page',url,extensionId:'a'.repeat(32)}]),'panel');assert.throws(()=>choosePanel([],old,url,[{id:'pair',type:'page',url,tabId:7}]))})
test('panel ambiguity, old target, or wrong URL refuse',()=>{const pair={targetId:'pair',type:'page',url,browserContextId:'owned'},p={targetId:'p',type:'page',url,browserContextId:'owned'},d={id:'p',type:'page',url,extensionId:'a'.repeat(32)},anchor={id:'pair',type:'page',url,tabId:7};assert.throws(()=>choosePanel([pair],[pair,p,{...p,targetId:'q'}],url,[anchor,d,{...d,id:'q'}]));assert.throws(()=>choosePanel([pair,p],[pair,p],url,[anchor,d]));assert.throws(()=>choosePanel([pair],[pair,{...p,url:'/wrong'}],url,[anchor,d]))})
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
  const context={activeSupplier:undefined,browserPhase:'PORT_FILE',browserStartup:undefined,chromium:{exitCode:65},xvfb:{exitCode:null},observeBrowserStartup,ownedIdentity:rootStat,sameOwnedRoot:(r,i)=>sameOwnedRoot(r,i,()=>({...rootStat,mtimeMs:999,...overrides.currentRootStat}),x=>overrides.rootRealpath??x,1000),observer:{terminate(){aborts++}},observers:new Set([{terminate(){aborts++},closed:Promise.resolve()}]),clients:new Set([{abort(){aborts++},settled:Promise.resolve()}]),pending:new Set(),children:new Set(),remaining:()=>10,deadline:Date.now()+1000,abort:{signal:{aborted:false}},timer:undefined,secret:'PRIVATE',owned:'/owned',fs:{rmSync(){deletes++}},checks:{},stage:'COMPLETE',closeOwnedChild,limit,clearTimeout,Date,Promise,...overrides}
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
    fs.copyFileSync(fileURLToPath(new URL('../cft-linux-supplier-732.mjs',import.meta.url)),path.join(canonical,'cft-linux-supplier-732.mjs'))
    fs.mkdirSync(path.join(canonical,'fixtures'));fs.copyFileSync(fileURLToPath(new URL('../fixtures/cft-linux64-732.json',import.meta.url)),path.join(canonical,'fixtures/cft-linux64-732.json'))
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
    const context={activeSupplier:undefined,browserPhase:'PORT_FILE',browserStartup:undefined,chromium:{exitCode:65},xvfb:{exitCode:null},observeBrowserStartup,observers:new Set(),clients,children:new Set(),remaining:()=>5,deadline:Date.now()+100,abort:{signal:{aborted:false}},timer:undefined,secret:'PUBLIC',owned:'/owned',ownedIdentity:{},sameOwnedRoot:()=>true,fs:{rmSync(){deleted++}},checks:{},stage:'BROWSER',closeOwnedChild,limit,clearTimeout,Date,Promise}
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
  const context={activeSupplier:{binary:'/owned/fixed/chrome',check(){if(fault==='binary')fail()}},stage:'BROWSER',browserPhase:null,browserStartup:undefined,chromium:undefined,xvfb:undefined,browser:undefined,worker:undefined,observer:undefined,secret:'PUBLIC_SYNTHETIC_ONLY',owned:'/owned',paths:{worker:workerPath,page:'sidepanel.html'},navigationDeadline:undefined,
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
  const begin=source.indexOf("    if(!activeSupplier)fail();activeSupplier.check(remaining);"),end=source.indexOf('    const socketBase=',begin)
  const poll=source.split('\n').find(line=>line.startsWith('  const poll=async'))
  assert.ok(begin>0&&end>begin&&poll)
  const owned=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'owned-port732-'))),profile=path.join(owned,'profile'),file=path.join(profile,'DevToolsActivePort')
  fs.mkdirSync(profile,{mode:0o700})
  let reads=0,writes=0,timer
  const deadline=Date.now()+100
  const context={activeSupplier:{binary:'/owned/fixed/chrome',check(){}},path,Date,Promise,setTimeout,deadline,owned,extension:path.join(owned,'extension'),input:{},screen:':23',chromium:undefined,browserPhase:'DISPLAY_OBSERVED',
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

// Normal ThreadManager and atomicWriteJSON execute on real owned files; only
// configuration-root and unused imports are inert. This is not a daemon run.
async function actualSeedStore(dir) {
  const {createRequire}=await import('node:module'),require=createRequire(new URL('../../../companion/package.json',import.meta.url)),ts=require('typescript')
  const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'),cache=new Map()
  const options=ts.convertCompilerOptionsFromJson(JSON.parse(fs.readFileSync(path.join(repo,'companion/tsconfig.json'),'utf8')).compilerOptions,path.join(repo,'companion')).options
  const sourceModule=(relative)=>{
    if(cache.has(relative))return cache.get(relative)
    const file=path.join(repo,'companion/src',relative),text=fs.readFileSync(file,'utf8'),out=ts.transpileModule(text,{fileName:file,compilerOptions:options,reportDiagnostics:true})
    assert.equal(out.diagnostics.length,0)
    const module={exports:{}},unused=new Proxy({},{get(){throw Error('UNUSED_STORE_IMPORT_EXECUTED')}})
    const req=id=>{
      if(id==='fs'||id==='node:fs')return fs;if(id==='path'||id==='node:path')return path;if(id==='node:crypto')return require('node:crypto')
      if(id==='../config')return {getConfigDir:()=>dir,getConfig:()=>{throw Error('UNUSED_CONFIG_READ')}}
      if(relative==='threads/thread-manager.ts'&&id==='../io')return sourceModule('io.ts')
      if(relative==='threads/thread-manager.ts'&&id==='./project-store')return sourceModule('threads/project-store.ts')
      if(relative==='threads/thread-manager.ts'&&id==='./thread-inspect')return sourceModule('threads/thread-inspect.ts')
      if(relative==='threads/thread-inspect.ts'&&id==='./cleanup-rules')return sourceModule('threads/cleanup-rules.ts')
      if(relative==='threads/thread-manager.ts'&&id==='./run-progress')return sourceModule('threads/run-progress.ts')
      if(relative==='threads/run-progress.ts'&&id==='../orchestrator/constants')return sourceModule('orchestrator/constants.ts')
      if(['./digest','./user-tags','./metadata-patch','./distill','./thread-inspect','./runtime-context-budget','../loop/loop-state','./project-store','../tool/plan-readonly','../llm/image-sniff','./image-sidecar'].includes(id))return unused
      throw Error('UNEXPECTED_STORE_IMPORT')
    }
    new vm.Script(out.outputText,{filename:file}).runInNewContext({module,exports:module.exports,require:req,process,Buffer,console,Date,setTimeout,clearTimeout})
    cache.set(relative,module.exports);return module.exports
  }
  return {ThreadManager:sourceModule('threads/thread-manager.ts').ThreadManager,ts,repo}
}
function actualPreparationExpression(source,ts,bindings){
  const file=ts.createSourceFile('actual-hosted.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),found=[]
  const visit=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(file)==='prepared'&&n.initializer&&ts.isCallExpression(n.initializer)){const args=n.initializer.arguments[1];if(args&&ts.isArrayLiteralExpression(args)&&args.elements.length===2&&args.elements[0].getText(file)==="'-e'")found.push(args.elements[1])}ts.forEachChild(n,visit)};visit(file);assert.equal(found.length,1)
  return new vm.Script(found[0].getText(file)).runInNewContext(bindings)
}
test('seeded preparation actual normal store serializes one prebound conversation and reloads it',async()=>{
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'owned-history732-seed-'))),workspace=path.join(dir,'workspace');fs.mkdirSync(workspace,{mode:0o700})
  try {
    const h=await import('../accept-acp-history-hosted-732.mjs'),{ThreadManager,ts,repo}=await actualSeedStore(dir),configFile=path.join(repo,'companion/dist/config.js'),storeFile=path.join(repo,'companion/dist/threads/thread-manager.js'),calls=[]
    const source=fs.readFileSync(path.join(repo,'chrome-extension/scripts/accept-acp-history-hosted-732.mjs'),'utf8')
    const expression=actualPreparationExpression(source,ts,{path,ROOT:repo,cfg:{acp:{enabled:true}},workspace,OWNED_THREAD:h.OWNED_THREAD,seedOwnedThread:h.seedOwnedThread,JSON})
    new vm.Script(expression).runInNewContext({require:id=>{calls.push(id);if(id===configFile)return{saveConfig:()=>{}};if(id===storeFile)return{ThreadManager};throw Error('UNEXPECTED_PREPARATION_IMPORT')},process,Buffer})
    const reloaded=new ThreadManager(),rows=reloaded.list({include_trashed:true});assert.equal(rows.length,1);assert.equal(rows[0].id,'owned-history-732');assert.equal(rows[0].alias,'Owned history acceptance');assert.equal(rows[0].workspace_root,workspace);assert.equal(reloaded.getMessages(rows[0].id).length,0)
    const index=path.join(dir,'threads/index.json'),messages=path.join(dir,'threads',rows[0].id+'.json');assert.equal(fs.statSync(index).mode&0o777,0o600);assert.equal(fs.statSync(messages).mode&0o777,0o600);assert.equal(fs.readdirSync(path.join(dir,'threads')).length,2);assert.deepEqual(calls,[configFile,storeFile]);assert.throws(()=>h.seedOwnedThread(ThreadManager,workspace));assert.equal(new ThreadManager().list().length,1)
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
})

function stockNavigationContract(ts,repo,thread) {
  const file=path.join(repo,'chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx'),text=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),buttons=[]
  const visit=n=>{if(ts.isJsxOpeningElement(n)&&n.tagName.getText(tree)==='button'&&n.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(tree)==='className'&&p.initializer&&ts.isStringLiteral(p.initializer)&&p.initializer.text==='cm-nav-thread'))buttons.push(n);ts.forEachChild(n,visit)};visit(tree);assert.equal(buttons.length,1)
  const attr=name=>{const rows=buttons[0].attributes.properties.filter(p=>ts.isJsxAttribute(p)&&p.name.getText(tree)===name);assert.equal(rows.length,1);return rows[0].initializer.expression.getText(tree)}
  const timelineFile=path.join(repo,'chrome-extension/src/sidepanel/utils/thread-timeline.ts'),timeline=ts.createSourceFile(timelineFile,fs.readFileSync(timelineFile,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
  const actualFunction=name=>{const found=timeline.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.equal(found.length,1);const output=ts.transpileModule(found[0].getText(timeline),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const m={exports:{}};new vm.Script(output).runInNewContext({module:m,exports:m.exports});return m.exports[name]}
  const messages=[],state={activeThreadId:null,threads:[thread]},context={thread,state,displayThreadTitle:actualFunction('displayThreadTitle'),isFleetWorkerThread:actualFunction('isFleetWorkerThread'),workerBelongTitle(){throw Error('UNEXPECTED_WORKER')},dispatch(action){assert.equal(action.type,'SET_ACTIVE_THREAD');state.activeThreadId=action.threadId},chrome:{runtime:{sendMessage:frame=>messages.push(frame)}},onNavigate(){if(context.deferNavigate)context.pendingNavigate=true;else context.open=false},open:false}
  const evaluate=expression=>new vm.Script(expression).runInNewContext(context),button={disabled:false,get title(){return evaluate(attr('title'))},getAttribute:name=>name==='aria-current'?evaluate(attr('aria-current')):null,click:evaluate('('+attr('onClick')+')')}
  return {context,button,messages,state}
}
test('seeded UI selector clicks actual shipping navigation handler and checks actual selected aria-current',async()=>{
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'owned-history732-ui-')))
  try{
    const h=await import('../accept-acp-history-hosted-732.mjs'),{ThreadManager,ts,repo}=await actualSeedStore(dir),workspace=path.join(dir,'workspace');fs.mkdirSync(workspace);h.seedOwnedThread(ThreadManager,workspace)
    const s=stockNavigationContract(ts,repo,new ThreadManager().get(h.OWNED_THREAD.id)),toggle={disabled:false,click(){s.context.open=true}},close={click(){s.context.open=false}}
    const doc={querySelector:q=>q==='.cm-navigation'&&s.context.open?{}:null,querySelectorAll:q=>q==='.cm-navigation-toggle'?[toggle]:q==='.cm-nav-thread'&&s.context.open?[s.button]:q==='.cm-navigation-disclosure button[aria-label="关闭导航"]'&&s.context.open?[close]:[]}
    const run=action=>vm.runInNewContext(h.seededThreadSelectionExpression(action),{document:doc})
    assert.equal(run('open'),true);assert.equal(run('exists'),true);assert.equal(run('selected'),false);assert.equal(run('select'),true);assert.equal(s.state.activeThreadId,h.OWNED_THREAD.id);assert.equal(JSON.stringify(s.messages),JSON.stringify([{type:'thread.select',threadId:h.OWNED_THREAD.id}]))
    assert.equal(run('open'),true);assert.equal(run('selected'),true);assert.equal(run('close'),true);assert.equal(s.context.open,false)
    // Execute the actual main caller span with a deferred React close commit.
    // onNavigate is real above; only its render scheduling is controlled here.
    let closeWaits=0;s.context.deferNavigate=true;s.context.open=true
    const originalQuery=doc.querySelector;doc.querySelector=q=>q==='.cm-navigation-disclosure'&&s.context.open?{}:originalQuery(q)
    const source=fs.readFileSync(path.join(repo,'chrome-extension/scripts/accept-acp-history-hosted-732.mjs'),'utf8'),begin=source.indexOf("    await evaluate(seededThreadSelectionExpression('select'))"),end=source.indexOf("    await evaluate(seededThreadSelectionExpression('close'))",begin)
    assert.ok(begin>0&&end>begin)
    const body=source.slice(begin,end),evaluate=async expression=>vm.runInNewContext(expression,{document:doc}),waitDOM=async expression=>{if(expression==="!document.querySelector('.cm-navigation-disclosure')"){assert.equal(await evaluate(expression),false);closeWaits++}if(s.context.pendingNavigate){s.context.open=false;s.context.pendingNavigate=false}assert.equal(await evaluate(expression),true)}
    await new vm.Script('(async()=>{'+body+'})()').runInNewContext({evaluate,waitDOM,seededThreadSelectionExpression:h.seededThreadSelectionExpression})
    assert.equal(closeWaits,1);assert.equal(s.context.open,true);assert.equal(run('selected'),true);run('close')
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('seeded UI selector refuses duplicate disabled wrong-alias and stale-selection projections',async()=>{
  const h=await import('../accept-acp-history-hosted-732.mjs');let clicked=0
  const own={title:h.OWNED_THREAD.alias,disabled:false,getAttribute:()=>null,click(){clicked++}},doc=rows=>({querySelectorAll:()=>rows})
  const run=(operation,rows)=>vm.runInNewContext(h.seededThreadSelectionExpression(operation),{document:doc(rows)})
  assert.throws(()=>run('select',[own,own]));assert.throws(()=>run('select',[{...own,disabled:true}]));assert.equal(run('select',[{...own,title:'foreign'}]),false);assert.equal(run('selected',[own]),false);assert.equal(clicked,0);assert.throws(()=>h.seededThreadSelectionExpression('bind'))
})
test('synthetic prebound store does not bypass actual workspace.set native-pick policy',async()=>{
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'owned-history732-policy-')))
  try{
    const {ThreadManager,ts,repo}=await actualSeedStore(dir),workspace=path.join(dir,'workspace');fs.mkdirSync(workspace)
    const h=await import('../accept-acp-history-hosted-732.mjs');h.seedOwnedThread(ThreadManager,workspace)
    const file=path.join(repo,'companion/src/capability/workspace.ts'),output=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,work={exports:{}}
    const req=id=>{if(id==='fs')return fs;if(id==='path')return path;if(id==='os')return os;if(id==='./modules')return {requireModule(){throw Error('UNUSED_MODULE')}};if(id==='./project-dir')return {cmsparkProjectsRoot(){throw Error('UNUSED_PROJECT_ROOT')}};throw Error('UNEXPECTED_WORKSPACE_IMPORT')}
    new vm.Script(output).runInNewContext({require:req,module:work,exports:work.exports,process,Buffer,Date})
    const source=fs.readFileSync(path.join(repo,'companion/src/message-router.ts'),'utf8'),start=source.indexOf('case "workspace.set": {'),end=source.indexOf('case "workspace.clear":',start);assert.ok(start>0&&end>start)
    let body=source.slice(start+'case "workspace.set": {'.length,end).trim();assert.ok(body.endsWith('}'));body=body.slice(0,-1);assert.equal(body.split('await import("./capability/workspace")').length,2);body=body.replace('await import("./capability/workspace")','await io.workspace()')
    const compiled=ts.transpileModule('async function run(rest,threadManager,io){'+body+'}',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,run=new vm.Script(compiled+';run').runInNewContext({})
    const manager=new ThreadManager();let updates=0;const result=await run({thread_id:h.OWNED_THREAD.id,path:workspace},{get:id=>manager.get(id),update(){updates++;throw Error('UNAUTHORIZED_UPDATE')}},{workspace:async()=>work.exports})
    assert.equal(result.type,'error');assert.match(result.error,/recent workspace.pick/);assert.equal(updates,0);assert.equal(new ThreadManager().get(h.OWNED_THREAD.id).workspace_root,workspace)
    const main=fs.readFileSync(path.join(repo,'chrome-extension/scripts/accept-acp-history-hosted-732.mjs'),'utf8');assert.equal(main.includes("type:'workspace.set'"),false);assert.equal(main.includes('recordNativePick'),false);assert.equal(main.includes("if(fs.existsSync(path.join(env.CMSPARK_DATA_DIR,'threads')))fail()"),true)
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
})

// Fresh document readiness is the committed owner, not only the header. These
// projections execute current shipping reducers/effects and real row onClick;
// the tiny DOM host supplies no browser/layout/native or history-success DTO.
async function freshOwnerControl(dir,{ready=false,deferClose=false,missing=false,disabled=false}={}) {
  const h=await import('../accept-acp-history-hosted-732.mjs'),{ThreadManager,ts,repo}=await actualSeedStore(dir),workspace=path.join(dir,'workspace');fs.mkdirSync(workspace);h.seedOwnedThread(ThreadManager,workspace)
  const manager=new ThreadManager(),cache=new Map(),shared=vm.createContext({process,Buffer,console,Date,TextEncoder,Map,Set})
  const lower=(text,file)=>{const out=ts.transpileModule(text,{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});assert.equal(out.diagnostics.length,0);return out.outputText}
  const actual=(relative)=>{if(cache.has(relative))return cache.get(relative);const file=path.join(repo,'chrome-extension',relative),m={exports:{}};const require=id=>{if(id==='react')return{createContext:()=>({}),useContext(){throw Error('UNUSED_MOUNT')},useReducer(){throw Error('UNUSED_MOUNT')}};if(id==='react/jsx-runtime')return{jsx(){throw Error('UNUSED_RENDER')},jsxs(){throw Error('UNUSED_RENDER')}};if(id.startsWith('.')){const base=path.resolve(path.dirname(file),id);for(const ext of ['.ts','.tsx'])if(fs.existsSync(base+ext))return actual(path.relative(path.join(repo,'chrome-extension'),base+ext))}throw Error('UNEXPECTED_FRONT_IMPORT')};const run=new vm.Script('(function(exports,require,module){'+lower(fs.readFileSync(file,'utf8'),file)+'\n})',{filename:file}).runInContext(shared);run(m.exports,require,m);cache.set(relative,m.exports);return m.exports}
  const {agentReducer,initialState,selectCodingSession}=actual('src/sidepanel/store/agentStore.tsx')
  const parse=file=>ts.createSourceFile(file,fs.readFileSync(path.join(repo,file),'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:file.endsWith('mjs')?ts.ScriptKind.JS:ts.ScriptKind.TS)
  const exact=(sf,match)=>{const found=[];const visit=n=>{if(match(n))found.push(n);ts.forEachChild(n,visit)};visit(sf);assert.equal(found.length,1);return found[0]}
  const compile=(text,globals={})=>{const m={exports:{}};new vm.Script(lower(text,'actual.ts')).runInNewContext({module:m,exports:m.exports,process,Buffer,Date,Map,Set,...globals});return m.exports}
  const hook=parse('chrome-extension/src/sidepanel/hooks/useWebSocket.ts'),app=parse('chrome-extension/src/sidepanel/App.tsx'),host=parse('chrome-extension/scripts/accept-acp-history-hosted-732.mjs'),panel=parse('chrome-extension/src/sidepanel/components/CodingAgentPanel.tsx')
  const router=parse('companion/src/message-router.ts'),routerClause=exact(router,n=>ts.isCaseClause(n)&&n.expression.getText(router)==='"thread.list"').getText(router)
  const list=compile('export async function run(rest){switch("thread.list"){'+routerClause+'}}',{threadManager:manager,session:null,require:id=>{assert.equal(id,'./packs/pack-engine');return{isPackTrustSnapshot:()=>false,clearTrustCookieWithoutRestore(){throw Error('UNEXPECTED_TRASH')}}}}).run
  const threadClause=exact(hook,n=>ts.isCaseClause(n)&&n.expression.getText(hook)==='"thread.list"').getText(hook)
  const appBody=exact(app,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='AppContent'),effects=[]
  for(const n of appBody.body.statements)if(ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(app)==='useEffect'&&(n.getText(app).includes('cmspark:open-coding-handoff')||n.getText(app).includes('codingPanelThreadRef.current')))effects.push(n.getText(app));assert.equal(effects.length,2)
  const control=exact(app,n=>ts.isJsxSelfClosingElement(n)&&n.tagName.getText(app)==='CodingAgentPanel'),attr=control.attributes.properties.find(n=>ts.isJsxAttribute(n)&&n.name.getText(app)==='open').initializer.expression.getText(app)
  const fresh=exact(host,n=>ts.isPropertyAssignment(n)&&n.name.getText(host)==='fresh'&&n.getText(host).includes('cm-header-new')).initializer
  assert.ok(ts.isArrowFunction(fresh)&&ts.isBlock(fresh.body));const until=fresh.body.statements.findIndex(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(host)==='o'));assert.ok(until>0)
  const prefix=fresh.body.statements.slice(0,until).map(n=>n.getText(host)).join('\n')
  const historyEffect=exact(panel,n=>ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(panel)==='useEffect'&&n.getText(panel).includes('type: "acp.sessions.list"')).getText(panel)
  let state=agentReducer(initialState,{type:'SET_CONNECTION',state:'connected'}),opened=false,navigation=false,pendingClose=false,owner={current:null},active={current:null},deps=[],events=new Map(),wire=[],historyDeps,openCalls=0,hydrations=0
  const dispatch=a=>{state=agentReducer(state,a);s.context.state=state},s=stockNavigationContract(ts,repo,manager.get(h.OWNED_THREAD.id));s.button.disabled=disabled;s.context.dispatch=dispatch;s.context.onNavigate=()=>{if(deferClose)pendingClose=true;else navigation=false}
  const render=()=>{active.current=state.activeThreadId;s.context.state=state;effects.forEach((effect,i)=>compile('export function install(){'+effect+'}',{appState:state,activeCodingSession:selectCodingSession(state),codingPanelThreadRef:owner,setCodingPanelOpen:v=>{opened=v},setCodingPanelSeed(){},window:{addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)},useEffect:(fn,next)=>{if(!deps[i]||next.some((v,j)=>!Object.is(v,deps[i][j]))){deps[i]=next;fn()}}}).install())}
  const isOpen=()=>new vm.Script(attr).runInNewContext({codingPanelOpen:opened,codingPanelThreadRef:owner,appState:state})
  const consume=compile('export function consume(msg){switch(msg.type){'+threadClause+'}}',{dispatch,creatingBlankThreadRef:{current:false},activeThreadRef:active,chrome:{runtime:{sendMessage(){}}},generateShortId(){throw Error('NO_BLANK')}}).consume
  const hydrate=async()=>{assert.equal(hydrations++,0);const reply=await list({});assert.equal(reply.type,'thread.list');assert.equal(reply.list_scope,'active');consume(JSON.parse(JSON.stringify(reply)));render()}
  const toggle={disabled:false,click(){navigation=true}},close={click(){if(deferClose)pendingClose=true;else navigation=false}},doc={querySelector:q=>q==='.cm-navigation'||q==='.cm-navigation-disclosure'?navigation?{}:null:q==='.cm-header-new'?{}:null,querySelectorAll:q=>q==='.cm-navigation-toggle'?[toggle]:q==='.cm-nav-thread'&&navigation&&!missing&&state.threads.length?[s.button]:q==='.cm-navigation-disclosure button[aria-label="关闭导航"]'&&navigation?[close]:[]}
  const evaluate=async expression=>vm.runInNewContext(expression,{document:doc}),waitDOM=async expression=>{if(expression.includes('OWNED_THREAD_UI_REFUSED')&&!state.threads.length)await hydrate();if(expression==="!document.querySelector('.cm-navigation-disclosure')"&&pendingClose){pendingClose=false;navigation=false}const value=await evaluate(expression);assert.equal(value,true,'exact stock UI predicate must commit');return value}
  render();if(ready)await hydrate()
  const run=()=>new vm.Script('(async()=>{'+prefix+'})()').runInNewContext({evaluate,waitDOM,seededThreadSelectionExpression:h.seededThreadSelectionExpression,openPanel:async()=>{openCalls++;events.get('cmspark:open-coding-handoff')({detail:undefined})}})
  const readHistory=()=>compile('export function install(){'+historyEffect+'}',{open:isOpen(),threadId:state.activeThreadId,state,session:selectCodingSession(state),storeAcpEnabled:true,dispatch,crypto:{randomUUID:()=> 'owned-fresh'},chrome:{runtime:{sendMessage:(m,done)=>{wire.push(m);done()},lastError:undefined}},useEffect:(fn,next)=>{if(!historyDeps||next.some((v,i)=>!Object.is(v,historyDeps[i]))){historyDeps=next;fn()}}}).install()
  return {run,render,hydrate,dispatch,readHistory,isOpen,wire,get state(){return state},get openCalls(){return openCalls},get hydrated(){return hydrations>0}}
}
test('fresh document waits real selected owner before opening, with late hydration and delayed navigation close',async()=>{
  for(const variant of [{ready:false},{ready:true},{ready:false,deferClose:true}]){const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'owned-history732-fresh-')));try{const f=await freshOwnerControl(dir,variant);await f.run();if(!f.hydrated)await f.hydrate();f.render();assert.equal(f.state.activeThreadId,'owned-history-732');assert.equal(f.isOpen(),true);f.readHistory();assert.equal(f.wire.length,1);assert.equal(f.wire[0].thread_id,'owned-history-732')}finally{fs.rmSync(dir,{recursive:true,force:true})}}
})
test('fresh document missing or disabled owned navigation row cannot open or query another owner',async()=>{
  for(const mode of ['missing','disabled']){const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'owned-history732-fresh-missing-')));try{const f=await freshOwnerControl(dir,{[mode]:true});await assert.rejects(f.run());assert.equal(f.openCalls,0);f.readHistory();assert.equal(f.wire.length,0)}finally{fs.rmSync(dir,{recursive:true,force:true})}}
})
test('fresh document owner changes still close panel and refuse foreign history',async()=>{
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'owned-history732-fresh-owner-')));try{const f=await freshOwnerControl(dir,{ready:true});await f.run();f.render();assert.equal(f.isOpen(),true);f.dispatch({type:'SET_ACTIVE_THREAD',threadId:'foreign'});f.render();assert.equal(f.isOpen(),false);f.readHistory();assert.equal(f.wire.length,0)}finally{fs.rmSync(dir,{recursive:true,force:true})}
})
