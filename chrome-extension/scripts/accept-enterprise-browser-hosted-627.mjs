// #627: hosted real production-extension acceptance; fixture transport is not full startServer.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { once } from 'node:events'
export const BOUNDS = Object.freeze({ navigation: 60_000, outer: 120_000 })
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
function refusal(code) { throw new Error(code) }
export function preflight(env, platform, stat = fs.lstatSync, realpath = fs.realpathSync, uid = process.getuid?.()) {
  if (platform !== 'linux' || env.GITHUB_ACTIONS !== 'true' || env.RUNNER_OS !== 'Linux' || env.RUNNER_ENVIRONMENT !== 'github-hosted' || env.ImageOS !== 'ubuntu22' || !env.RUNNER_TEMP || !path.isAbsolute(env.RUNNER_TEMP)) refusal('HOSTED_ONLY')
  const temp = path.resolve(env.RUNNER_TEMP), s = stat(temp)
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== uid || realpath(temp) !== temp) refusal('RUNNER_TEMP_NOT_OWNED')
  return temp
}
export function childEnvironment(owned, env, display) {
  const out = { PATH: '/usr/bin:/bin', HOME: path.join(owned, 'home'), TMPDIR: path.join(owned, 'tmp'),
    XDG_CONFIG_HOME: path.join(owned, 'config'), XDG_CACHE_HOME: path.join(owned, 'cache'),
    LANG: 'C.UTF-8', TZ: 'UTC', CMSPARK_DATA_DIR: path.join(owned, 'data') }
  if (display !== undefined) { if (!/^:[0-9]{1,5}$/.test(display)) refusal('INVALID_DISPLAY'); out.DISPLAY = display }
  if (typeof env.RUNNER_TRACKING_ID === 'string') out.RUNNER_TRACKING_ID = env.RUNNER_TRACKING_ID
  return out
}
export function chromeArgs(owned, extension) {
  if (path.dirname(extension) !== owned) refusal('EXTENSION_OUTSIDE_OWNED')
  return [`--user-data-dir=${path.join(owned, 'profile')}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--no-default-browser-check', 'about:blank']
}

function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a;reject=b }); return { promise, resolve, reject } }
function limit(promise, ms, code) {
  let timer; return Promise.race([promise, new Promise((_,reject) => { timer = setTimeout(() => reject(new Error(code)), ms) })]).finally(() => clearTimeout(timer))
}
async function waitForFile(filename, ms, observe = () => {}) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    let text
    try { text = fs.readFileSync(filename, 'utf8') }
    catch (error) {
      let code = 'OTHER'
      try { const d=Object.getOwnPropertyDescriptor(error,'code');if(d&&Object.hasOwn(d,'value')&&['ENOENT','EACCES','EPERM','EISDIR'].includes(d.value))code=d.value } catch {}
      observe(code)
      await new Promise(r => setTimeout(r, 25));continue
    }
    observe('READ');return text
  }
  refusal('STARTUP_FILE_MISSING')
}

export class CDP {
  constructor(socket) { this.socket=socket;this.id=0;this.pending=new Map();this.workerLoaded=false;this.workerWaiter=undefined;this.closed=false;socket.on('error',()=>socket.terminate());socket.on('message', data => {
    let m; try { m=JSON.parse(data.toString()) } catch { return }
    if(m.method==='Inspector.workerScriptLoaded'&&!this.closed){this.workerLoaded=true;this.workerWaiter?.resolve(true);return}
    const p=this.pending.get(m.id);if (!p) return;this.pending.delete(m.id);m.error?p.reject(new Error('CDP_REFUSED')):p.resolve(m.result)
  }); socket.on('close', () => { this.closed=true;this.workerWaiter?.reject(new Error('CDP_CLOSED'));for (const p of this.pending.values()) p.reject(new Error('CDP_CLOSED'));this.pending.clear() }) }
  static async connect(WebSocket, url, timeout=5000) { const s=new WebSocket(url), client=new CDP(s);try { await limit(once(s,'open'),Math.min(5000,timeout),'CDP_CONNECT');return client } catch { s.terminate();throw new Error('CDP_CONNECT') } }
  workerScriptReady(ms) {
    if(!Number.isInteger(ms)||ms<=0||ms>BOUNDS.navigation)return Promise.reject(new Error('INVALID_WORKER_READY_BUDGET'))
    if(this.closed)return Promise.reject(new Error('CDP_CLOSED'))
    if(this.workerLoaded)return Promise.resolve(true)
    if(this.workerWaiter)return Promise.reject(new Error('WORKER_READY_ALREADY_PENDING'))
    const waiter=deferred();this.workerWaiter=waiter
    return limit(waiter.promise,ms,'WORKER_SCRIPT_TIMEOUT').finally(()=>{if(this.workerWaiter===waiter)this.workerWaiter=undefined})
  }
  call(method, params={}, timeout=BOUNDS.navigation) { const id=++this.id, p=deferred(); this.pending.set(id,p);this.socket.send(JSON.stringify({id,method,params}));return limit(p.promise,timeout,'CDP_TIMEOUT').finally(()=>this.pending.delete(id)) }
  async evaluate(expression, awaitPromise=false, timeout=BOUNDS.navigation) { const r=await this.call('Runtime.evaluate',{expression,awaitPromise,returnByValue:true},timeout);if(r.exceptionDetails) refusal('PAGE_EVALUATION_REFUSED');return r.result?.value }
  close() { this.socket.close() }
  abort() {
    this.closed=true;this.workerWaiter?.reject(new Error('CDP_CLOSED'))
    for(const p of this.pending.values())p.reject(new Error('CDP_CLOSED'))
    this.pending.clear();this.socket.terminate()
  }
}
function cleanupRemaining(deadline) {
  const n=deadline-Date.now();if(n<=0)refusal('OUTER_TIMEOUT');return n
}
async function stopped(child, deadline) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited=once(child,'exit')
  child.kill('SIGTERM')
  try { await limit(exited,Math.min(5000,cleanupRemaining(deadline)),'CHILD_CLOSE') } catch { child.kill('SIGKILL');await limit(exited,cleanupRemaining(deadline),'CHILD_CLOSE') }
}

// Only this public fixed set can leave the trusted acceptance process.
const STAGES=new Set(['PREFLIGHT','ARTIFACT','XVFB','CHROMIUM','EXTENSION','AUTH','GRANT','STATUS','IMAGE','REFUSALS','CLEANUP','COMPLETE'])
export const CHECKS=Object.freeze(['badAuth','preauth','profileBinding','ruleFreeStatus','undefinedRejected','humanImage','noStore','captureOwner','badProof','wrongPurpose','wrongSubject','nonceReplay','foreignResult','documentChanged','peerChanged','cleanup'])
export function receipt(stage, checks) {
  if(!STAGES.has(stage))refusal('INVALID_RECEIPT')
  const finite={}
  for(const key of CHECKS) {
    let d;try{d=Object.getOwnPropertyDescriptor(checks,key)}catch{}
    finite[key]=!!d&&Object.hasOwn(d,'value')&&d.value===true
  }
  return {schema:1,stage,passed:stage==='COMPLETE'&&CHECKS.every(k=>finite[k]),boundary:'REAL_SERVICE_FIXTURE_AUTH_PERMIT_PENDING_NOT_FULL_SERVER',checks:finite}
}
export function manifestPaths(manifest) {
  if(manifest.manifest_version!==3)refusal('MANIFEST_VERSION')
  const safe=p=>typeof p==='string'&&/^[A-Za-z0-9_./-]+$/.test(p)&&!p.startsWith('/')&&!p.split('/').some(v=>!v||v==='.'||v==='..')
  const worker=manifest.background?.service_worker, page=manifest.side_panel?.default_path
  if(!safe(worker)||!safe(page)||!page.endsWith('.html'))refusal('MANIFEST_PATH')
  for(const permission of ['tabs','storage','scripting','debugger'])if(!manifest.permissions?.includes(permission))refusal('MANIFEST_PERMISSION')
  return {worker,page}
}
export function loadBackend(root=ROOT) {
  const require=createRequire(path.join(root,'companion/package.json'))
  const get=p=>require(path.join(root,'companion/dist',p+'.js'))
  return {auth:get('ws-auth'),protocol:get('protocol'),surface:get('ws/handshake-surface'),forward:get('ws/tool-forward'),permits:get('outbound-mcp/enterprise-permit'),
    policy:get('outbound-mcp/enterprise-policy'),grants:get('outbound-mcp/outbound-grants'),http:get('outbound-mcp/enterprise-http'),service:get('outbound-mcp/enterprise-service')}
}
// The fixture holds actual sockets only after real production HMAC verification.
// The application payload is never an authentication or permit assertion.
export function createTransport({auth,protocol,surface,forward,permits,origin,secret,open=1}) {
  const sockets=new Set(), authenticated=new Map();let resultHold, beforeDispatch, foreignObserved, captures=0,createdTab
  const peer=()=>{const live=[...authenticated].filter(([s])=>s.readyState===open);if(live.length!==1)refusal('ENTERPRISE_PEER_AMBIGUOUS');return {peer:live[0][0],epoch:live[0][1]}}
  const receive=(m,ws)=>{
    if(!authenticated.has(ws)||ws.readyState!==open)return
    if(m.type!=='tool.result')return
    const pending=forward.pendingToolCalls.get(m.tool_call_id)
    if(pending?.originWs&&pending.originWs!==ws){foreignObserved?.();forward.handleToolResult(m,ws);return}
    if(resultHold&&!resultHold.held&&pending?.originWs===ws){resultHold.held={m,ws};resultHold.resolve(resultHold.held);return}
    forward.handleToolResult(m,ws)
  }
  return {sockets,peer,receive,captureCount:()=>captures,createdTab:()=>createdTab,authenticatedSockets:()=>[...authenticated.keys()],
    attach(ws,request) {
      sockets.add(ws);ws.on('error',()=>ws.terminate());ws.once('close',()=>sockets.delete(ws))
      if(request.headers.origin!==origin||!surface.surfaceFromOrigin(request.headers.origin,undefined).ok){ws.terminate();return}
      const nonce=auth.issueChallenge(),timer=setTimeout(()=>ws.terminate(),auth.AUTH_TIMEOUT_MS)
      ws.on('close',()=>{clearTimeout(timer);authenticated.delete(ws);sockets.delete(ws)})
      ws.on('message',data=>{
        let m;try{m=JSON.parse(data.toString())}catch{ws.terminate();return}
        if(!m||typeof m!=='object'||Array.isArray(m)){ws.terminate();return}
        if(!authenticated.has(ws)) {
          if(m.type!=='auth.handshake'||!auth.verifyProof(secret,nonce,m.proof)||!protocol.negotiateProtocolVersion(m.protocol_version).ok){ws.terminate();return}
          authenticated.set(ws,crypto.randomUUID());clearTimeout(timer);ws.send(JSON.stringify({type:'auth.ok',...protocol.authOkProtocolFields()}));return
        }
        receive(m,ws)
      })
      ws.send(JSON.stringify({type:'auth.challenge',nonce}))
    },
    runner:async(id,tool,args,options)=>{
      const current=peer(), permit=options?.enterprisePermit
      if(!permits.checkEnterprisePermit(permit,tool,args,current.peer))refusal('PERMIT_INVALID')
      if(permit.peer_epoch!==current.epoch||options?.signal?.aborted)refusal('ENTERPRISE_PEER_CHANGED')
      if(beforeDispatch){const run=beforeDispatch;beforeDispatch=undefined;await run(tool,args,permit)}
      // claim performs the final branded check. Do not check an already claimed permit.
      permits.claimEnterpriseDispatch(permit,tool,args,current.peer)
      permit.recheck();const final=peer()
      if(final.peer!==current.peer||final.epoch!==current.epoch||options?.signal?.aborted)refusal('ENTERPRISE_PEER_CHANGED')
      if(tool==='screenshot')captures++
      const result=await forward.dispatchToExtension(id,tool,{...args,__enterprise_guard:permit.guard},current.peer,{threadId:'owned-hosted627',tabId:args.tabId})
      if(tool==='create_tab'&&permit.guard.mode==='open'&&result.success&&Number.isSafeInteger(result.data?.tab_id)&&result.data.tab_id>=0)createdTab=result.data.tab_id
      return result
    },
    beforeNextDispatch(fn){if(beforeDispatch)refusal('DISPATCH_HOOK_PENDING');beforeDispatch=fn},
    holdNextResult(){if(resultHold)refusal('RESULT_HOLD_PENDING');resultHold=deferred();const hold=resultHold;return {arrival:hold.promise,release(){if(resultHold!==hold||!hold.held)refusal('RESULT_HOLD_EMPTY');resultHold=undefined;forward.handleToolResult(hold.held.m,hold.held.ws)}}},
    onForeignResult(fn){foreignObserved=fn},
    close(){if(resultHold?.held){forward.handleToolResult(resultHold.held.m,resultHold.held.ws);resultHold=undefined}forward.rejectPendingForThread('owned-hosted627','OWNED_ACCEPTANCE_CLOSED');for(const s of sockets)s.terminate()},
  }
}
// Serialized functions use only real native extension APIs; no imported closure.
export function profileExpression() {
  return `(${function(){return new Promise((resolve,reject)=>{
    let timer;const done=(value)=>{clearTimeout(timer);chrome.storage.onChanged.removeListener(changed);typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value)?resolve(value):reject(new Error('PROFILE_UNAVAILABLE'))}
    const changed=(changes,area)=>{if(area==='local'&&changes.enterprise_profile_id)done(changes.enterprise_profile_id.newValue)}
    chrome.storage.onChanged.addListener(changed);timer=setTimeout(()=>done(null),5000)
    chrome.storage.local.get('enterprise_profile_id').then(value=>{if(value.enterprise_profile_id!==undefined)done(value.enterprise_profile_id)},()=>done(null))
  })}.toString()})()`
}
export function loadedExpression(tabId,url,ms,operation='current') {
  if(!Number.isSafeInteger(tabId)||tabId<0||typeof url!=='string'||!(/^(?:http:\/\/127\.0\.0\.1:[0-9]+\/login|chrome-extension:\/\/[a-p]{32}\/[A-Za-z0-9_./-]+\.html)$/.test(url))||url.split('/').slice(3).some(p=>p==='.'||p==='..')||!Number.isInteger(ms)||ms<=0||ms>BOUNDS.navigation||!['current','reload','navigate'].includes(operation))refusal('INVALID_LOAD')
  return `(${function(id,expected,remaining,operation){return new Promise((resolve,reject)=>{
    let settled=false,api=operation==='current',complete=false,began=operation!=='reload',timer
    const done=error=>{if(settled)return;if(!error&&(!api||!complete))return;settled=true;clearTimeout(timer);chrome.tabs.onUpdated.removeListener(updated);chrome.tabs.onRemoved.removeListener(removed);error?reject(new Error('OWNED_LOAD_REFUSED')):resolve(true)}
    const check=tab=>{if(began&&tab.id===id&&tab.url===expected&&tab.status==='complete'){complete=true;done()}}
    const updated=(changed,info)=>{if(changed!==id)return;if(info.status==='loading')began=true;if(info.status==='complete')chrome.tabs.get(id).then(check,()=>done(true))}
    const removed=changed=>{if(changed===id)done(true)}
    chrome.tabs.onUpdated.addListener(updated);chrome.tabs.onRemoved.addListener(removed);timer=setTimeout(()=>done(true),remaining)
    if(operation==='reload')chrome.tabs.reload(id).then(()=>{api=true;done()},()=>done(true))
    else if(operation==='navigate')chrome.tabs.update(id,{url:expected}).then(()=>{api=true;done()},()=>done(true))
    else chrome.tabs.get(id).then(check,()=>done(true))
  })}.toString()})(${tabId},${JSON.stringify(url)},${ms},${JSON.stringify(operation)})`
}
export function pageResponse(url) {
  if(url==='/app')return {status:302,headers:{Location:'/login','Cache-Control':'no-store'},body:''}
  if(url==='/login'||url==='/decoy')return {status:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"},body:`<!doctype html><html><head><meta charset="utf-8"><title>Owned public fixture</title><style>body{padding-top:40px;box-sizing:border-box}html,body{margin:0;min-height:100vh;background:${url==='/login'?'rgb(17,34,204)':'rgb(204,34,17)'}}</style></head><body><div id="${url==='/login'?'login':'decoy'}">Public owned acceptance marker</div></body></html>`}
  return {status:404,headers:{'Cache-Control':'no-store'},body:''}
}
async function closeServer(server,deadline) {
  if(!server)return
  const closed=new Promise(resolve=>server.close(resolve));server.closeAllConnections?.()
  await limit(closed,cleanupRemaining(deadline),'SERVER_CLOSE')
}
export async function main() {
  let stage='PREFLIGHT',owned,xvfb,chromium,browser,worker,view,httpServer,wsServer,transport,api,backend,timer,expired=false,okay=true
  const checks={},active=new Set(),inflight=new Set(),deadline=Date.now()+BOUNDS.outer
  const originalConsole=Object.fromEntries(['log','info','warn','error','debug'].map(k=>[k,console[k]]))
  const remaining=()=>{const n=deadline-Date.now();if(n<=0||expired)refusal('OUTER_TIMEOUT');return n}
  const track=promise=>{inflight.add(promise);promise.finally(()=>inflight.delete(promise)).catch(()=>{});return promise}
  try {
    const input=process.env,temp=preflight(input,process.platform)
    assert.equal(process.versions.node.split('.')[0],'22')
    owned=fs.mkdtempSync(path.join(temp,'cmspark-enterprise-627-'));fs.chmodSync(owned,0o700)
    const env=childEnvironment(owned,input)
    for(const key of ['HOME','TMPDIR','XDG_CONFIG_HOME','XDG_CACHE_HOME','CMSPARK_DATA_DIR'])fs.mkdirSync(env[key],{recursive:true,mode:0o700})
    for(const key of Object.keys(process.env))delete process.env[key]
    Object.assign(process.env,env)
    // Backend diagnostic logs may contain owned IDs; never forward arbitrary text.
    for(const key of Object.keys(originalConsole))console[key]=()=>{}
    timer=setTimeout(()=>{expired=true;transport?.close();for(const c of active)c.abort();for(const child of [chromium,xvfb])child?.kill('SIGKILL')},remaining())
    backend=loadBackend();const require=createRequire(path.join(ROOT,'companion/package.json')),{WebSocket,WebSocketServer}=require('ws')
    assert.equal(backend.auth.AUTH_TIMEOUT_MS,5000);assert.equal(backend.forward.TOOL_EXECUTION_TIMEOUT_MS,15000)
    stage='ARTIFACT'
    const built=path.join(ROOT,'chrome-extension/build/chrome-mv3-prod'), manifest=JSON.parse(fs.readFileSync(path.join(built,'manifest.json'),'utf8')), paths=manifestPaths(manifest)
    const extension=path.join(owned,'extension');fs.cpSync(built,extension,{recursive:true,dereference:false})
    // Reject artifact links; this is public build output, never a runtime profile.
    const inspect=directory=>{for(const d of fs.readdirSync(directory,{withFileTypes:true})){const f=path.join(directory,d.name);if(d.isSymbolicLink())refusal('ARTIFACT_LINK');if(d.isDirectory())inspect(f);else if(!d.isFile())refusal('ARTIFACT_KIND')}};inspect(extension)
    for(const p of [paths.worker,paths.page])assert.equal(fs.lstatSync(path.join(extension,p)).isFile(),true)
    stage='XVFB'
    xvfb=spawn('/usr/bin/Xvfb',['-displayfd','3','-screen','0','1280x800x24','-nolisten','tcp'],{env,stdio:['ignore','ignore','pipe','pipe']})
    xvfb.on('error',()=>{});xvfb.stderr.on('data',()=>{});xvfb.stderr.on('error',()=>{})
    const displayReady=deferred();let displayText=''
    xvfb.stdio[3].on('error',()=>displayReady.reject(new Error('XVFB_DISPLAY')))
    xvfb.stdio[3].on('data',chunk=>{displayText+=chunk.toString();if(displayText.length>8)displayReady.reject(new Error('XVFB_DISPLAY'));if(/^\d{1,5}\n$/.test(displayText))displayReady.resolve(':'+displayText.trim())})
    const display=await limit(displayReady.promise,5000,'XVFB_START_TIMEOUT')
    stage='CHROMIUM'
    const binary=['/usr/bin/chromium-browser','/usr/bin/chromium'].find(f=>{try{return fs.statSync(f).isFile()}catch{return false}})
    if(!binary)refusal('CHROMIUM_MISSING')
    const version=execFileSync(binary,['--version'],{env,encoding:'utf8',timeout:5000,stdio:['ignore','pipe','ignore']}).trim()
    assert.match(version,/^Chromium [0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/)
    chromium=spawn(binary,chromeArgs(owned,extension),{env:childEnvironment(owned,env,display),stdio:['ignore','ignore','pipe']})
    chromium.on('error',()=>{});chromium.stderr.on('data',()=>{});chromium.stderr.on('error',()=>{})
    const parts=(await waitForFile(path.join(owned,'profile/DevToolsActivePort'),10000)).trim().split('\n')
    if(parts.length!==2||!/^\d{1,5}$/.test(parts[0])||!/^\/devtools\/browser\/[a-f0-9-]+$/.test(parts[1]))refusal('CDP_IDENTITY')
    const endpoint='http://127.0.0.1:'+parts[0]
    browser=await CDP.connect(WebSocket,'ws://127.0.0.1:'+parts[0]+parts[1]);active.add(browser)
    stage='EXTENSION'
    let info;const end=Date.now()+10000
    while(Date.now()<end){const targets=await(await fetch(endpoint+'/json/list',{signal:AbortSignal.timeout(Math.min(5000,remaining()))})).json();const matches=targets.filter(t=>t.type==='service_worker'&&new RegExp('^chrome-extension://[a-p]{32}/'+paths.worker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$').test(t.url));if(matches.length===1){info=matches[0];break}await new Promise(r=>setTimeout(r,50))}
    if(!info)refusal('PRODUCTION_WORKER_MISSING')
    const origin='chrome-extension://'+info.url.split('/')[2]
    worker=await CDP.connect(WebSocket,info.webSocketDebuggerUrl);active.add(worker);await worker.workerScriptReady(Math.min(BOUNDS.navigation,remaining()))
    const profile=await worker.evaluate(profileExpression(),true,Math.min(5000,remaining()));assert.match(profile,/^[a-f0-9-]{36}$/)
    const navigationDeadline=Date.now()+Math.min(BOUNDS.navigation,remaining())
    const navigationRemaining=()=>{const n=Math.min(navigationDeadline-Date.now(),remaining());if(n<=0)refusal('NAVIGATION_TIMEOUT');return n}
    // The extension page also has a real native load barrier, not an old blank realm.
    const viewTab=await worker.evaluate("chrome.tabs.create({url:'about:blank',active:false}).then(t=>t.id)",true,remaining())
    assert.ok(Number.isSafeInteger(viewTab))
    await worker.evaluate(loadedExpression(viewTab,origin+'/'+paths.page,navigationRemaining(),'navigate'),true,navigationRemaining())
    const pageTarget=await worker.evaluate(`chrome.debugger.getTargets().then(t=>{const m=t.filter(x=>x.tabId===${viewTab});if(m.length!==1)throw new Error('OWNED_EXTENSION_PAGE');return m[0].id})`,true,remaining())
    if(typeof pageTarget!=='string'||!/^[A-Za-z0-9-]+$/.test(pageTarget))refusal('OWNED_EXTENSION_PAGE')
    view=await CDP.connect(WebSocket,`ws://127.0.0.1:${parts[0]}/devtools/page/${pageTarget}`);active.add(view)
    const secret=crypto.randomBytes(32).toString('hex')
    transport=createTransport({...backend,origin,secret})
    stage='AUTH'
    wsServer=new WebSocketServer({host:'127.0.0.1',port:23401,maxPayload:10*1024*1024});wsServer.on('error',()=>{});wsServer.on('connection',(s,r)=>transport.attach(s,r));await limit(once(wsServer,'listening'),remaining(),'WS_LISTEN')
    const denied=async(type)=>{const socket=new WebSocket('ws://127.0.0.1:23401',{origin});socket.on('error',()=>socket.terminate());socket.on('message',()=>socket.send(JSON.stringify(type==='proof'?{type:'auth.handshake',proof:'0'.repeat(64),protocol_version:1}:{type:'tool.result',tool_call_id:'preauth-owned627',result:{success:true}})));await limit(once(socket,'close'),5000,'AUTH_NOT_REFUSED');assert.throws(()=>transport.peer())}
    await denied('proof');checks.badAuth=true;await denied('preauth');checks.preauth=true
    const connected=deferred(),onConnection=(s)=>s.on('message',()=>{try{transport.peer();connected.resolve()}catch{}});wsServer.on('connection',onConnection)
    assert.equal(await view.evaluate(`chrome.runtime.sendMessage({type:'ws.setSecret',secret:${JSON.stringify(secret)}}).then(r=>r.ok===true)`,true,5000),true)
    await limit(connected.promise,5000,'AUTH_TIMEOUT');wsServer.off('connection',onConnection)
    stage='GRANT'
    const authority=crypto.generateKeyPairSync('ed25519'),subject='owned627',instance=backend.policy.registerEnterpriseInstance(profile,subject)
    checks.profileBinding=instance.profile_id===profile
    api=new backend.service.EnterpriseBrowserService({path:path.join(env.CMSPARK_DATA_DIR,'enterprise-browser-state.json'),monitor:false,peer:transport.peer,runner:()=>transport.runner})
    httpServer=http.createServer((request,response)=>{if(request.url.startsWith('/outbound-mcp/')){void backend.http.handleEnterpriseHttp(request,response,api);return}const reply=pageResponse(request.url);response.writeHead(reply.status,reply.headers);response.end(reply.body)})
    httpServer.listen(0,'127.0.0.1');await limit(once(httpServer,'listening'),remaining(),'HTTP_LISTEN')
    const base='http://127.0.0.1:'+httpServer.address().port
    const grant=backend.grants.issueOutboundGrant({caller_id:'owned627',label:'Owned public native acceptance',profile:'outbound_l1_interact',ttl_ms:120000,enterprise_policy:{...instance,revision:'r1',expires_at:new Date(deadline).toISOString(),authority_public_key:authority.publicKey.export({type:'spki',format:'pem'}).toString(),tools:['create_tab','screenshot'],navigation:[{origin:base,path:'/app'}],evidence:[],login:[{origin:base,path:'/login'}],ready:[{selector:'#ready'}],login_markers:[{selector:'#login'}],actions:[]}})
    const request=(method,route,body)=>track((async()=>{remaining();const r=await fetch(base+'/outbound-mcp/v1/enterprise'+route,{method,headers:{Authorization:'Bearer '+grant.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(remaining())});const value=await r.json();return {status:r.status,value,headers:r.headers}})())
    const opened=await request('POST','/sessions',{subject,change_id:'change627',request_key:'open',url:base+'/app'});assert.equal(opened.status,202)
    const session=opened.value.data, route='/sessions/'+session.session_handle
    // Retain the actual production create_tab reply, never URL-based target discovery.
    const tabId=transport.createdTab();assert.ok(Number.isSafeInteger(tabId))
    await worker.evaluate(loadedExpression(tabId,base+'/login',navigationRemaining()),true,navigationRemaining())
    stage='STATUS'
    let status=await request('GET',route+'?subject='+subject);assert.equal(status.status,200);assert.equal(status.value.data.state,'login_required');checks.ruleFreeStatus=true
    checks.undefinedRejected=await worker.evaluate(`(async()=>{try{await chrome.scripting.executeScript({target:{tabId:${tabId}},world:'ISOLATED',func:(a,b)=>true,args:[{},undefined]});return false}catch{return true}})()`,true,remaining());assert.equal(checks.undefinedRejected,true)
    const sign=payload=>({payload,signature:crypto.sign(null,Buffer.from(backend.policy.canonicalJSON(payload)),authority.privateKey).toString('base64url')})
    const snapshot=proof=>request('POST',route+'/login-snapshot',{subject,presentation_proof:proof})
    const challenge=status.value.data.presentation_challenge, proof=sign(challenge), beforeRefusalCaptures=transport.captureCount()
    const rejectProof=async(body)=>{const result=await request('POST',route+'/login-snapshot',body);assert.equal(result.value.ok,false);assert.equal(result.value.data,undefined);return true}
    checks.badProof=await rejectProof({subject,presentation_proof:{payload:challenge,signature:'A'.repeat(86)}})
    checks.wrongPurpose=await rejectProof({subject,presentation_proof:sign({...challenge,purpose:'approval'})})
    checks.wrongSubject=await rejectProof({subject:'other627',presentation_proof:proof});assert.equal(transport.captureCount(),beforeRefusalCaptures)
    stage='IMAGE'
    const decoy=await worker.evaluate(`chrome.tabs.create({url:${JSON.stringify(base+'/decoy')},active:true}).then(t=>t.id)`,true,remaining());assert.ok(Number.isSafeInteger(decoy))
    assert.equal(await worker.evaluate(`chrome.tabs.query({active:true,currentWindow:true}).then(t=>t.length===1&&t[0].id===${decoy})`,true,remaining()),true)
    let image=await snapshot(proof);assert.equal(image.status,200);assert.equal(image.value.data.audience,'human_only');assert.equal(image.value.data.cache,'no-store');assert.equal(image.value.data.url,undefined);assert.equal(image.value.data.title,undefined)
    checks.noStore=image.headers.get('cache-control')==='no-store'&&image.headers.get('pragma')==='no-cache'
    assert.equal(typeof image.value.data.image_base64,'string');assert.ok(image.value.data.image_base64.length>0);assert.ok(Number.isFinite(image.value.data.width)&&image.value.data.width>0);assert.ok(Number.isFinite(image.value.data.height)&&image.value.data.height>0)
    // The raw image stays only in owned trusted memory; only this Boolean returns.
    const ownedImage=await view.evaluate(`(${async function(value){const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'}));try{const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const p=ctx.getImageData(5,5,1,1).data;return bitmap.width>0&&bitmap.height>0&&p[0]<70&&p[1]<90&&p[2]>150}finally{bitmap.close()}}.toString()})(${JSON.stringify(image.value.data.image_base64)})`,true,remaining())
    image=undefined;assert.equal(ownedImage,true);checks.humanImage=true;checks.captureOwner=true
    checks.nonceReplay=await rejectProof({subject,presentation_proof:proof})
    stage='REFUSALS'
    // Hold an ACTUAL result, reject the other actual authenticated socket, then release the original.
    const held=transport.holdNextResult(),statusPending=track(request('GET',route+'?subject='+subject)), actual=await limit(held.arrival,remaining(),'RESULT_HOLD')
    const foreign=new WebSocket('ws://127.0.0.1:23401',{origin}),foreignAuth=deferred(),seen=deferred();foreign.on('error',()=>foreign.terminate())
    foreign.on('message',data=>{const m=JSON.parse(data.toString());if(m.type==='auth.challenge')foreign.send(JSON.stringify({type:'auth.handshake',proof:crypto.createHmac('sha256',secret).update(m.nonce).digest('hex'),protocol_version:1}));if(m.type==='auth.ok')foreignAuth.resolve()})
    await limit(foreignAuth.promise,5000,'FOREIGN_AUTH');transport.onForeignResult(()=>seen.resolve());foreign.send(JSON.stringify({type:'tool.result',tool_call_id:actual.m.tool_call_id,result:{success:true,data:{untrusted:true}}}));await limit(seen.promise,remaining(),'FOREIGN_RESULT')
    assert.equal(backend.forward.pendingToolCalls.has(actual.m.tool_call_id),true)
    const foreignServers=transport.authenticatedSockets().filter(s=>s!==actual.ws);assert.equal(foreignServers.length,1)
    const clientClosed=once(foreign,'close'),serverClosed=once(foreignServers[0],'close');foreign.close();await limit(Promise.all([clientClosed,serverClosed]),remaining(),'FOREIGN_CLOSE')
    held.release();assert.equal((await statusPending).status,200);checks.foreignResult=true
    status=await request('GET',route+'?subject='+subject)
    transport.beforeNextDispatch(async(tool,args)=>{if(tool==='screenshot')await worker.evaluate(loadedExpression(args.tabId,base+'/login',navigationRemaining(),'reload'),true,navigationRemaining());else transport.beforeNextDispatch(async(t,a)=>{assert.equal(t,'screenshot');await worker.evaluate(loadedExpression(a.tabId,base+'/login',navigationRemaining(),'reload'),true,navigationRemaining())})})
    const moved=await snapshot(sign(status.value.data.presentation_challenge));assert.equal(moved.value.ok,false);assert.equal(moved.value.error_code,'NAVIGATION_CHANGED');checks.documentChanged=true
    const prior=transport.peer(),priorClosed=once(prior.peer,'close');prior.peer.terminate();await limit(priorClosed,remaining(),'OWNED_PEER_CLOSE')
    const peerResult=await request('GET',route+'?subject='+subject);assert.equal(peerResult.value.ok,false);checks.peerChanged=true
    const state=fs.readFileSync(path.join(env.CMSPARK_DATA_DIR,'enterprise-browser-state.json'),'utf8');assert.equal(state.includes('image_base64'),false)
    const logdir=path.join(env.CMSPARK_DATA_DIR,'logs');if(fs.existsSync(logdir))for(const name of fs.readdirSync(logdir)){const log=fs.readFileSync(path.join(logdir,name),'utf8');assert.equal(log.includes('image_base64'),false);assert.equal(log.includes(grant.token),false);assert.equal(log.includes(secret),false)}
    remaining();stage='COMPLETE'
  } catch { /* No raw exception, protocol, image, URL, identity or credential leaves this process. */ }
  finally {
    try{api?.close();transport?.close()}catch{okay=false}
    if(api)try{await limit(api.drain(),cleanupRemaining(deadline),'SERVICE_SETTLE')}catch{okay=false}
    if(inflight.size)try{await limit(Promise.allSettled([...inflight]),cleanupRemaining(deadline),'REQUEST_SETTLE')}catch{okay=false}
    if(backend&&backend.forward.pendingToolCalls.size!==0)okay=false
    try{await closeServer(httpServer,deadline)}catch{okay=false}
    if(wsServer)try{await limit(new Promise(r=>wsServer.close(r)),cleanupRemaining(deadline),'WS_CLOSE')}catch{okay=false}
    for(const c of active)try{if(c!==browser)c.abort()}catch{okay=false}
    if(browser)try{await browser.call('Browser.close',{},cleanupRemaining(deadline))}catch{}
    for(const c of active)try{c.abort()}catch{okay=false}
    for(const child of [chromium,xvfb])try{await stopped(child,deadline)}catch{okay=false}
    if(Date.now()>=deadline||expired)okay=false
    if(owned&&okay)try{fs.rmSync(owned,{recursive:true,force:true})}catch{okay=false}
    if(Date.now()>=deadline||expired)okay=false
    clearTimeout(timer);Object.assign(console,originalConsole);checks.cleanup=okay;if(!okay)stage='CLEANUP'
  }
  const out=receipt(stage,checks);console.log(JSON.stringify(out));return out.passed?0:1
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)process.exitCode=await main()
