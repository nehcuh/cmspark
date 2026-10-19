// CPU controls only: native Chrome, pixels, and full startServer are NOT executed.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { fileURLToPath } from 'node:url'
const require=createRequire(import.meta.url),ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..')
const owned=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'cmspark-627-cpu-')))
for(const key of Object.keys(process.env))if(!['PATH','NODE_PATH','CMSPARK_627_TEST_BACKEND_ROOT'].includes(key))delete process.env[key]
Object.assign(process.env,{HOME:owned,TMPDIR:owned,CMSPARK_DATA_DIR:path.join(owned,'data')})
const denied=[]
const deny=()=>{denied.push('DENIED');throw new Error('CPU_OS_GUARD')}
const cp=require('node:child_process');for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[key]=deny
for(const id of ['node:net','node:tls','node:dgram','node:http','node:https','node:http2']){const mod=require(id);for(const key of ['connect','createConnection','createSocket','createServer','request','get'])if(typeof mod[key]==='function')mod[key]=deny}
require('node:net').Socket.prototype.connect=deny
cp.ChildProcess.prototype.spawn=deny
process.dlopen=deny
globalThis.WebSocket=class {constructor(){deny()}}
globalThis.fetch=deny
const ownedFDs=new Set()
const inside=value=>{if(Buffer.isBuffer(value))value=value.toString('utf8');return typeof value==='number'&&ownedFDs.has(value)||typeof value==='string'&&(path.resolve(value)===owned||path.resolve(value).startsWith(owned+path.sep))}
for(const key of ['writeFileSync','appendFileSync','mkdirSync','rmSync','unlinkSync','chmodSync','truncateSync','rmdirSync']){const original=fs[key];fs[key]=function(value,...args){if(!inside(value))return deny();return original.call(fs,value,...args)}}
for(const key of ['renameSync','copyFileSync','linkSync','symlinkSync']){const original=fs[key];fs[key]=function(a,b,...args){if(!inside(a)||!inside(b))return deny();return original.call(fs,a,b,...args)}}
const originalOpen=fs.openSync;fs.openSync=function(filename,flags,...args){if((typeof flags==='number'&&flags!==fs.constants.O_RDONLY||typeof flags==='string'&&/[wa+]/.test(flags))&&!inside(filename))return deny();const fd=originalOpen.call(fs,filename,flags,...args);if(inside(filename))ownedFDs.add(fd);return fd}
for(const key of ['writeFile','appendFile','mkdir','rm','unlink','chmod','truncate','rmdir']){const original=fs.promises[key];fs.promises[key]=async function(value,...args){if(!inside(value))return deny();return original.call(fs.promises,value,...args)}}
for(const key of ['rename','copyFile','link','symlink']){const original=fs.promises[key];fs.promises[key]=async function(a,b,...args){if(!inside(a)||!inside(b))return deny();return original.call(fs.promises,a,b,...args)}}
syncBuiltinESMExports()
const H=await import('../accept-enterprise-browser-hosted-627.mjs')
const backend=H.loadBackend(process.env.CMSPARK_627_TEST_BACKEND_ROOT||ROOT)
after(()=>{assert.deepEqual(denied,[]);fs.rmSync(owned,{recursive:true,force:true});console.log('ENTERPRISE_627_CPU {"native":false,"osEffects":0,"helperIO":0}')})
class Socket extends EventEmitter {
  readyState=1; sent=[]
  send(text){this.sent.push(JSON.parse(text));this.onSend?.(this.sent.at(-1))}
  terminate(){this.readyState=3;this.emit('close')}
}
const origin='chrome-extension://'+'a'.repeat(32),secret='0'.repeat(64)
function connected(transport){const socket=new Socket();transport.attach(socket,{headers:{origin}});const nonce=socket.sent[0].nonce;socket.emit('message',Buffer.from(JSON.stringify({type:'auth.handshake',proof:crypto.createHmac('sha256',secret).update(nonce).digest('hex'),protocol_version:1})));return socket}
function transport(){return H.createTransport({...backend,origin,secret})}
test('hosted preflight refuses local execution before browser, helper, provider or network access',()=>{
  assert.throws(()=>H.preflight({},process.platform),/HOSTED_ONLY/)
  assert.throws(()=>H.preflight({GITHUB_ACTIONS:'true',RUNNER_OS:'Linux',RUNNER_ENVIRONMENT:'github-hosted',ImageOS:'ubuntu24',RUNNER_TEMP:owned},'linux'),/HOSTED_ONLY/)
  assert.equal(H.preflight({GITHUB_ACTIONS:'true',RUNNER_OS:'Linux',RUNNER_ENVIRONMENT:'github-hosted',ImageOS:'ubuntu22',RUNNER_TEMP:owned},'linux'),owned)
})
test('clean child environment does not inherit credentials or insecure Chromium switches',()=>{
  const env=H.childEnvironment(owned,{SECRET:'not-exported',RUNNER_TRACKING_ID:'owned-tracking'},':27')
  assert.equal(env.SECRET,undefined);assert.equal(env.HOME,path.join(owned,'home'));assert.equal(env.RUNNER_TRACKING_ID,'owned-tracking')
  const args=H.chromeArgs(owned,path.join(owned,'extension'));assert.equal(args.includes('--no-sandbox'),false);assert.equal(args.some(a=>a.startsWith('--headless')),false)
  assert.equal(args.at(-1),'about:blank');assert.throws(()=>H.chromeArgs(owned,'/foreign'),/EXTENSION_OUTSIDE_OWNED/)
})
test('built production manifest supplies actual service worker and sidepanel without replacing permissions',()=>{
  const m={manifest_version:3,background:{service_worker:'static/background/index.js'},side_panel:{default_path:'sidepanel.html'},permissions:['tabs','storage','debugger','scripting']}
  assert.deepEqual(H.manifestPaths(m),{worker:'static/background/index.js',page:'sidepanel.html'})
  for(const p of ['../worker.js','/worker.js','a//worker.js','a/./worker.js','https://x/worker.js'])assert.throws(()=>H.manifestPaths({...m,background:{service_worker:p}}),/MANIFEST_PATH/)
  assert.throws(()=>H.manifestPaths({...m,permissions:['tabs']}),/MANIFEST_PERMISSION/)
})
test('finite receipt refuses accessor/proxy output, unknown fields and incomplete success',()=>{
  let calls=0;const checks=Object.fromEntries(H.CHECKS.map(k=>[k,true]));Object.defineProperty(checks,'humanImage',{get(){calls++;throw new Error('PRIVATE')}})
  const r=H.receipt('COMPLETE',checks);assert.equal(r.passed,false);assert.equal(calls,0);assert.equal(JSON.stringify(r).includes('PRIVATE'),false)
  assert.equal(H.receipt('COMPLETE',new Proxy({},{getOwnPropertyDescriptor(){throw new Error('PRIVATE')}})).passed,false)
  const complete=H.receipt('COMPLETE',Object.fromEntries(H.CHECKS.map(k=>[k,true])));assert.equal(complete.passed,true)
  assert.equal(H.receipt('IMAGE',Object.fromEntries(H.CHECKS.map(k=>[k,true]))).passed,false)
  assert.throws(()=>H.receipt('raw error',{}),/INVALID_RECEIPT/)
})
test('real HMAC verifier rejects wrong origin, bad proof and preauth tool.result',()=>{
  const t=transport(),wrong=new Socket();t.attach(wrong,{headers:{origin:'https://foreign.invalid'}});assert.equal(wrong.readyState,3)
  const bad=new Socket();t.attach(bad,{headers:{origin}});bad.emit('message',Buffer.from(JSON.stringify({type:'auth.handshake',proof:'1'.repeat(64),protocol_version:1})));assert.equal(bad.readyState,3)
  const early=new Socket();t.attach(early,{headers:{origin}});early.emit('message',Buffer.from(JSON.stringify({type:'tool.result',result:{success:true}})));assert.equal(early.readyState,3)
  assert.throws(()=>t.peer(),/ENTERPRISE_PEER_AMBIGUOUS/);t.close()
})
test('actual authenticated sockets create unique peer epochs; ambiguous and closed peers refuse',()=>{
  const t=transport(),a=connected(t),first=t.peer();assert.equal(first.peer,a);assert.equal(a.sent.at(-1).type,'auth.ok')
  const b=connected(t);assert.throws(()=>t.peer(),/ENTERPRISE_PEER_AMBIGUOUS/);a.terminate();assert.notEqual(t.peer().epoch,first.epoch);b.terminate();assert.throws(()=>t.peer());t.close()
})
test('production private-brand permit, check/claim and dispatch are not caller JSON authority',async()=>{
  const t=transport(),a=connected(t),current=t.peer();let checks=0
  await assert.rejects(t.runner('bad','list_tabs',{}, {enterprisePermit:{peer:a,peer_epoch:current.epoch}}),/PERMIT_INVALID/)
  const permit=backend.permits.mintEnterprisePermit('list_tabs',{}, {version:1,profile_id:'owned',mode:'probe'},a,current.epoch,()=>{checks++})
  a.onSend=m=>{if(m.type==='tool.execute'){assert.equal(m.params.__enterprise_guard.mode,'probe');queueMicrotask(()=>t.receive({type:'tool.result',tool_call_id:m.tool_call_id,result:{success:true,data:{enterprise_contract:1}}},a))}}
  assert.equal((await t.runner('one','list_tabs',{}, {enterprisePermit:permit})).success,true)
  assert.ok(checks>=4);await assert.rejects(t.runner('two','list_tabs',{}, {enterprisePermit:permit}),/PERMIT_MISMATCH/)
  assert.equal(backend.forward.pendingToolCalls.size,0);t.close()
})
test('foreign authenticated result cannot settle actual pending; original held result settles once',async()=>{
  const t=transport(),a=connected(t),current=t.peer(),permit=backend.permits.mintEnterprisePermit('list_tabs',{}, {version:1,mode:'probe'},a,current.epoch,()=>{})
  const hold=t.holdNextResult();a.onSend=m=>{if(m.type==='tool.execute')queueMicrotask(()=>t.receive({type:'tool.result',tool_call_id:m.tool_call_id,result:{success:true,data:{original:true}}},a))}
  const pending=t.runner('owned-pending','list_tabs',{}, {enterprisePermit:permit});const held=await hold.arrival,b=connected(t)
  t.receive({type:'tool.result',tool_call_id:held.m.tool_call_id,result:{success:true,data:{foreign:true}}},b)
  assert.equal(backend.forward.pendingToolCalls.has('owned-pending'),true);b.terminate();hold.release();assert.deepEqual((await pending).data,{original:true});assert.equal(backend.forward.pendingToolCalls.size,0);t.close()
})
test('peer change during asynchronous fixture gate refuses before actual dispatch',async()=>{
  const t=transport(),a=connected(t),current=t.peer(),permit=backend.permits.mintEnterprisePermit('list_tabs',{}, {version:1},a,current.epoch,()=>{})
  t.beforeNextDispatch(async()=>{a.terminate();connected(t)})
  await assert.rejects(t.runner('old','list_tabs',{}, {enterprisePermit:permit}),/ENTERPRISE_PEER_CHANGED/)
  assert.equal(backend.forward.pendingToolCalls.size,0);t.close()
})
test('fixture close rejects and clears actual production pending timer',async()=>{
  const t=transport(),a=connected(t),current=t.peer(),permit=backend.permits.mintEnterprisePermit('list_tabs',{}, {version:1},a,current.epoch,()=>{})
  const pending=t.runner('cleanup','list_tabs',{}, {enterprisePermit:permit});assert.equal(backend.forward.pendingToolCalls.size,1);t.close()
  assert.equal((await pending).success,false);assert.equal(backend.forward.pendingToolCalls.size,0)
})
test('owned fixed login/decoy pages are no-store, secret-free and have no external resource',()=>{
  assert.equal(H.pageResponse('/app').status,302);assert.equal(H.pageResponse('/app').headers.Location,'/login')
  const login=H.pageResponse('/login');assert.equal(login.headers['Cache-Control'],'no-store');assert.match(login.body,/id="login"/)
  assert.equal(/<script|https?:|<input|<iframe|<img/i.test(login.body),false);assert.match(H.pageResponse('/decoy').body,/rgb\(204,34,17\)/)
  assert.equal(H.pageResponse('/login?ticket=not-a-supported-input').status,404)
})
test('native expressions are self-contained and use exact owned tab, event completion and no swallowed undefined',()=>{
  const profile=H.profileExpression(),load=H.loadedExpression(7,'http://127.0.0.1:1234/login',1000,'reload')
  assert.match(profile,/chrome.storage.onChanged.addListener/);assert.match(profile,/removeListener/)
  assert.match(load,/changed===id/);assert.match(load,/tab.url===expected/);assert.match(load,/!api\|\|!complete/)
  assert.throws(()=>H.loadedExpression(7,'https://foreign.invalid',1000),/INVALID_LOAD/)
})
test('real EnterpriseBrowserService HTTP handler keeps proof/nonce/no-store and state privacy (CPU browser-result seam)',async()=>{
  // Only browser result delivery is a CPU seam here; service, authority, signatures and HTTP handler are actual production modules.
  const subject='owned-cpu627',instance=backend.policy.registerEnterpriseInstance('00000000-0000-4000-8000-000000000627',subject),keys=crypto.generateKeyPairSync('ed25519')
  const t=transport(),a=connected(t);let captures=0
  a.onSend=m=>{if(m.type!=='tool.execute')return;const g=m.params.__enterprise_guard;let data
    if(g.mode==='probe')data={enterprise_contract:1,profile_id:instance.profile_id}
    else if(g.mode==='open')data={tab_id:7}
    else if(g.mode==='inspect')data={tab_id:7,url:'http://127.0.0.1:1234/login',document_id:'controlled-document',generation:1,frames:[{id:0,document_id:'controlled-document',url:'http://127.0.0.1:1234/login'}],state:'login_required'}
    else if(g.mode==='login-screenshot'){captures++;data={image_base64:'controlled-not-native-image',width:1,height:1}}
    else throw new Error('UNEXPECTED_CPU_MODE')
    queueMicrotask(()=>t.receive({type:'tool.result',tool_call_id:m.tool_call_id,result:{success:true,data}},a))
  }
  const grant=backend.grants.issueOutboundGrant({caller_id:'owned627',profile:'outbound_l1_interact',ttl_ms:60000,enterprise_policy:{...instance,revision:'r1',expires_at:new Date(Date.now()+30000).toISOString(),authority_public_key:keys.publicKey.export({type:'spki',format:'pem'}).toString(),tools:['create_tab','screenshot'],navigation:[{origin:'http://127.0.0.1:1234',path:'/app'}],evidence:[],login:[{origin:'http://127.0.0.1:1234',path:'/login'}],ready:[{selector:'#ready'}],login_markers:[{selector:'#login'}],actions:[]}})
  const api=new backend.service.EnterpriseBrowserService({path:path.join(owned,'service-state.json'),monitor:false,peer:t.peer,runner:()=>t.runner})
  const call=async(method,route,value,token=grant.token)=>{
    const req={method,url:'/outbound-mcp/v1/enterprise'+route,headers:{authorization:'Bearer '+token,'content-type':'application/json'},async *[Symbol.asyncIterator](){if(value!==undefined)yield Buffer.from(JSON.stringify(value))}}
    let result;const res={destroyed:false,writableEnded:false,writeHead(status,headers){result={status,headers}},end(body){result.value=JSON.parse(body);this.writableEnded=true}}
    assert.equal(await backend.http.handleEnterpriseHttp(req,res,api),true);return result
  }
  try{
    const opened=await call('POST','/sessions',{subject,change_id:'cpu627',request_key:'open',url:'http://127.0.0.1:1234/app'});assert.equal(opened.status,202)
    const route='/sessions/'+opened.value.data.session_handle,status=await call('GET',route+'?subject='+subject);assert.equal(status.value.data.state,'login_required')
    const payload=status.value.data.presentation_challenge,sign=p=>({payload:p,signature:crypto.sign(null,Buffer.from(backend.policy.canonicalJSON(p)),keys.privateKey).toString('base64url')}),good=sign(payload)
    for(const proof of [{payload,signature:'A'.repeat(86)},sign({...payload,purpose:'approval'}),sign({...payload,subject:'other'})]){const r=await call('POST',route+'/login-snapshot',{subject,presentation_proof:proof});assert.equal(r.value.ok,false);assert.equal(r.value.error_code,'HUMAN_PROOF_INVALID')}
    assert.equal(captures,0)
    const image=await call('POST',route+'/login-snapshot',{subject,presentation_proof:good});assert.equal(image.status,200);assert.equal(image.value.data.audience,'human_only');assert.equal(image.value.data.cache,'no-store');assert.equal(image.headers['Cache-Control'],'no-store');assert.equal(image.headers.Pragma,'no-cache');assert.equal(captures,1)
    const replay=await call('POST',route+'/login-snapshot',{subject,presentation_proof:good});assert.equal(replay.value.ok,false);assert.equal(captures,1)
    assert.equal((await call('GET',route+'?subject=other')).value.ok,false)
    assert.equal((await call('GET',route+'?subject='+subject,undefined,'cmg_'+'0'.repeat(64))).value.ok,false)
    const state=fs.readFileSync(path.join(owned,'service-state.json'),'utf8');assert.equal(state.includes('image_base64'),false);assert.equal(state.includes('controlled-not-native-image'),false)
  } finally{api.close();t.close()}
})

function nativeEvent(){const handlers=new Set();return {handlers,addListener(fn){handlers.add(fn)},removeListener(fn){handlers.delete(fn)},emit(...args){for(const f of [...handlers])f(...args)}}}
function loadFixture({reload=false}={}){const updated=nativeEvent(),removed=nativeEvent(),timers=new Set();let finish,reject
 const api=new Promise((a,b)=>{finish=a;reject=b}),tab={id:7,url:'http://127.0.0.1:1234/login',status:'complete'}
 const chrome={tabs:{onUpdated:updated,onRemoved:removed,get:async()=>tab,reload:()=>api}}
 const result=vm.runInNewContext(H.loadedExpression(7,tab.url,1000,reload?'reload':'current'),{chrome,setTimeout(fn){timers.add(fn);return fn},clearTimeout(fn){timers.delete(fn)}})
 return {updated,removed,timers,finish,reject,tab,result}}
test('actual serialized load barrier waits for both native complete event and reload API ACK',async()=>{
 const f=loadFixture({reload:true});let settled=false;f.result.then(()=>settled=true,()=>settled=true)
 f.updated.emit(999,{status:'complete'});await Promise.resolve();assert.equal(settled,false)
 f.updated.emit(7,{status:'loading'});f.updated.emit(7,{status:'complete'});await new Promise(resolve=>queueMicrotask(resolve));assert.equal(settled,false)
 f.finish();assert.equal(await f.result,true);assert.equal(f.updated.handlers.size,0);assert.equal(f.removed.handlers.size,0);assert.equal(f.timers.size,0)
})
test('actual serialized reload rejects API error even after earlier complete and removes all listeners',async()=>{
 const f=loadFixture({reload:true});f.updated.emit(7,{status:'complete'});f.reject(new Error('controlled'))
 await assert.rejects(f.result,/OWNED_LOAD_REFUSED/);assert.equal(f.updated.handlers.size,0);assert.equal(f.removed.handlers.size,0);assert.equal(f.timers.size,0)
})
test('actual serialized missing, removed and wrong-document callbacks cannot become success after timeout',async()=>{
 const f=loadFixture({reload:true});f.tab.url='http://127.0.0.1:1234/decoy';f.updated.emit(7,{status:'complete'});f.finish()
 for(const timer of [...f.timers])timer();await assert.rejects(f.result,/OWNED_LOAD_REFUSED/);f.updated.emit(7,{status:'complete'});assert.equal(f.updated.handlers.size,0)
 const removed=loadFixture({reload:true});removed.removed.emit(7);removed.finish();await assert.rejects(removed.result,/OWNED_LOAD_REFUSED/)
})
test('actual serialized profile reader observes only the owned local key and disposes its listener',async()=>{
 const changed=nativeEvent(),timers=new Set(),chrome={storage:{onChanged:changed,local:{get:async()=>({})}}}
 const p=vm.runInNewContext(H.profileExpression(),{chrome,setTimeout(fn){timers.add(fn);return fn},clearTimeout(fn){timers.delete(fn)}})
 const profile='00000000-0000-4000-8000-000000000627';changed.emit({enterprise_profile_id:{newValue:profile}},'sync');assert.equal(changed.handlers.size,1)
 changed.emit({enterprise_profile_id:{newValue:profile}},'local');assert.equal(await p,profile);assert.equal(changed.handlers.size,0);assert.equal(timers.size,0)
})
test('actual main refuses a non-hosted process before any browser or backend import and only emits closed receipt',async()=>{
 const old=console.log,lines=[];console.log=value=>lines.push(value)
 try{assert.equal(await H.main(),1)}finally{console.log=old}
 assert.equal(lines.length,1);const r=JSON.parse(lines[0]);assert.equal(r.stage,'PREFLIGHT');assert.equal(r.passed,false);assert.equal(r.boundary,'REAL_SERVICE_FIXTURE_AUTH_PERMIT_PENDING_NOT_FULL_SERVER');assert.deepEqual(denied,[])
})

test('same-URL reload does not reuse an old complete observation without a new loading event',async()=>{
 const f=loadFixture({reload:true});f.updated.emit(7,{status:'complete'});f.finish();await new Promise(resolve=>queueMicrotask(resolve));for(const timer of [...f.timers])timer();await assert.rejects(f.result,/OWNED_LOAD_REFUSED/)
})
test('actual workflow keeps original jobs and consumes same-SHA ordinary production artifacts in a gated hosted job',()=>{
 const yaml=createRequire(path.join(ROOT,'companion/package.json'))('js-yaml'),workflow=yaml.load(fs.readFileSync(path.join(ROOT,'.github/workflows/ci.yml'),'utf8'))
 assert.deepEqual(Object.keys(workflow.jobs),['build','enterprise627-hosted','smoke-os'])
 const hosted=workflow.jobs['enterprise627-hosted'];assert.equal(hosted.needs,'build');assert.equal(hosted['runs-on'],'ubuntu-22.04');assert.equal(hosted['continue-on-error'],undefined)
 assert.deepEqual(workflow.jobs['smoke-os'].strategy.matrix.os,['ubuntu-latest','macos-latest','windows-latest']);assert.equal(workflow.jobs.build['runs-on'],'ubuntu-latest')
 const upload=workflow.jobs.build.steps.find(s=>s.uses==='actions/upload-artifact@v4'),download=hosted.steps.find(s=>s.uses==='actions/download-artifact@v4')
 assert.equal(upload.with.name,'enterprise627-build-${{ github.sha }}');assert.equal(download.with.name,upload.with.name);assert.equal(download.with.path,'.')
 assert.deepEqual(upload.with.path.trim().split('\n'),['companion/dist/','chrome-extension/build/chrome-mv3-prod/'])
 assert.equal(hosted.steps.at(-1).run,'node chrome-extension/scripts/accept-enterprise-browser-hosted-627.mjs');assert.equal(hosted.steps.at(-1)['continue-on-error'],undefined)
})

function actualWorkerPredicate() {
  const source=fs.readFileSync(new URL('../accept-enterprise-browser-hosted-627.mjs',import.meta.url),'utf8')
  const ts=createRequire(path.join(ROOT,'companion/package.json'))('typescript')
  const ast=ts.createSourceFile('actual-hosted-main.mjs',source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS),predicates=[]
  const visit=node=>{if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='filter'&&node.expression.expression.getText(ast)==='targets')predicates.push(node.arguments[0].getText(ast));ts.forEachChild(node,visit)}
  visit(ast);assert.equal(predicates.length,1,'the actual main worker discovery predicate must be unique')
  // Literal worker path is recorded from official normal-build artifact12164695718,
  // run39202399936, manifestSHA256 9d8522c217e187a439182a23935fd9c61231b9745b3dcc593b4c12b88e540de4.
  return vm.runInNewContext('('+predicates[0]+')',{paths:{worker:'static/background/index.js'}})
}
test('actual worker discovery accepts the manifest-produced literal dot path',()=>{
  const matches=actualWorkerPredicate(),base='chrome-extension://'+'a'.repeat(32)+'/'
  assert.equal(matches({type:'service_worker',url:base+'static/background/index.js'}),true)
})
test('actual worker discovery rejects substituted dots, suffixes, wrong types and foreign extension IDs',()=>{
  const matches=actualWorkerPredicate(),base='chrome-extension://'+'a'.repeat(32)+'/'
  for(const suffix of ['static/background/index$js','static/background/indexXjs','static/background/index.js?x=1','static/background/index.js#x','static/background/index.js/extra'])assert.equal(matches({type:'service_worker',url:base+suffix}),false)
  assert.equal(matches({type:'page',url:base+'static/background/index.js'}),false)
  assert.equal(matches({type:'service_worker',url:'chrome-extension://'+'q'.repeat(32)+'/static/background/index.js'}),false)
})
