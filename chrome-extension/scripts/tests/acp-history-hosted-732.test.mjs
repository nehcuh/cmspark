import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import { BOUNDS,preflight,childEnvironment,chromeArgs,manifestPaths,choosePanel,finiteReceipt,CDP,reloadDocument,restartSequence,historyObservationExpression,closeOwnedChild,loadedExpression,privateRead,limit } from '../accept-acp-history-hosted-732.mjs'
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

function actualFinally(overrides={}) {
  const source=fs.readFileSync(fileURLToPath(new URL('../accept-acp-history-hosted-732.mjs',import.meta.url)),'utf8')
  const begin=source.lastIndexOf('  finally {\n    let clean=true')
  const end=source.indexOf('\n  Object.assign(console,originalConsole)',begin)
  assert.ok(begin>0&&end>begin)
  const finallyBlock=source.slice(begin+'  finally {'.length,end).trim().slice(0,-1)
  let deletes=0,aborts=0
  const sameOwnedRoot=source.includes('export function sameOwnedRoot(')?vm.runInNewContext('('+source.slice(source.indexOf('export function sameOwnedRoot(')+'export '.length,source.indexOf('export async function main()',source.indexOf('export function sameOwnedRoot('))).trim()+')',{fs:{},process:{getuid:()=>1000}}):()=>{throw Error('ABSENT_ROOT_FENCE')}
  const rootStat={dev:1,ino:2,uid:1000,mode:0o40700,isDirectory:()=>true,isSymbolicLink:()=>false}
  const context={ownedIdentity:rootStat,sameOwnedRoot:(r,i)=>sameOwnedRoot(r,i,()=>({...rootStat,mtimeMs:999,...overrides.currentRootStat}),x=>overrides.rootRealpath??x,1000),observer:{terminate(){aborts++}},observers:new Set([{terminate(){aborts++},closed:Promise.resolve()}]),clients:new Set([{abort(){aborts++},settled:Promise.resolve()}]),pending:new Set(),children:new Set(),remaining:()=>10,deadline:Date.now()+1000,abort:{signal:{aborted:false}},timer:undefined,secret:'PRIVATE',owned:'/owned',fs:{rmSync(){deletes++}},checks:{},stage:'COMPLETE',closeOwnedChild,limit,clearTimeout,Date,Promise,...overrides}
  if(overrides.pending)context.clients=new Set([{abort(){},settled:Promise.allSettled([...overrides.pending])}])
  return {run:()=>vm.runInNewContext(`(async()=>{${finallyBlock};return {checks,stage,secret}})()`,context),deletes:()=>deletes,aborts:()=>aborts}
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
  const begin=source.lastIndexOf('  finally {\n    let clean=true'),end=source.indexOf('\n  Object.assign(console,originalConsole)',begin)
  assert.ok(begin>0&&end>begin);const body=source.slice(begin+'  finally {'.length,end).trim().slice(0,-1)
  const clients=new Set();let socket,terminated=0,observedClose=false,deleted=0,rejected=false
  class OwnedSocket extends EventEmitter {
    constructor(){super();socket=this;this.once('close',()=>{observedClose=true});if(mode==='open-error')queueMicrotask(()=>this.emit('error',Error('PRIVATE_ERROR')));if(mode.startsWith('success'))queueMicrotask(()=>this.emit('open'))}
    terminate(){terminated++;if(mode==='success-close')queueMicrotask(()=>this.emit('close'))}
  }
  try {
    const connect=vm.runInNewContext(`(()=>{${declaration};return connect})()`,{CDP,WebSocket:OwnedSocket,clients,BOUNDS,remaining:()=>2})
    try{await connect('ws://owned-inert')}catch{rejected=true}
    const context={observers:new Set(),clients,children:new Set(),remaining:()=>5,deadline:Date.now()+100,abort:{signal:{aborted:false}},timer:undefined,secret:'PUBLIC',owned:'/owned',ownedIdentity:{},sameOwnedRoot:()=>true,fs:{rmSync(){deleted++}},checks:{},stage:'BROWSER',closeOwnedChild,limit,clearTimeout,Date,Promise}
    const result=await vm.runInNewContext(`(async()=>{${body};return checks.cleanup})()`,context)
    assert.equal(rejected,mode==='timeout'||mode==='open-error')
    assert.equal(clients.size,1,'every already-created client must be retained, including failed open')
    assert.equal(terminated>=1,true)
    assert.equal(observedClose,mode==='success-close')
    assert.equal(result,mode==='success-close')
    assert.equal(deleted,mode==='success-close'?1:0,'terminate dispatch is not actual close')
  } finally {socket?.emit('close')}
})
