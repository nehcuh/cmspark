// #464: hosted real Chromium acceptance, not a synthetic DOM recorder.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { once } from 'node:events'

export const BASE = '30f4aa867ca1b9970f0fa4d72fc993a13af49972'
export const HEAD = 'e40857d70c58cdd50ad52f0f78efbce35ffbac48'
export const PAGE = `https://github.com/nehcuh/cmspark/compare/${BASE}..${HEAD}`
export const BOUNDS = Object.freeze({ navigation: 60_000, outer: 120_000 })
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const REPO = ROOT
const hash = x => crypto.createHash('sha256').update(x).digest('hex')
function refusal(code) { throw new Error(code) }
export function preflight(env, platform, stat = fs.lstatSync, realpath = fs.realpathSync, uid = process.getuid?.()) {
  if (platform !== 'linux' || env.GITHUB_ACTIONS !== 'true' || env.RUNNER_OS !== 'Linux' || env.RUNNER_ENVIRONMENT !== 'github-hosted' || !env.RUNNER_TEMP || !path.isAbsolute(env.RUNNER_TEMP)) refusal('HOSTED_ONLY')
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
// The hosted image already installs this helper with stable Chrome. Raw snapshot
// Chromium can use it without disabling Ubuntu restrictions or the sandbox.
// Never accept an inherited override, install/chmod a helper, or try a fallback.
export function installedSandboxHelper464(lstat=fs.lstatSync,realpath=fs.realpathSync) {
  const helper='/opt/google/chrome/chrome-sandbox'
  for(const name of ['/','/opt','/opt/google','/opt/google/chrome']) {
    const s=lstat(name)
    if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022)!==0||realpath(name)!==name)refusal('SANDBOX_HELPER_IDENTITY_REFUSED')
  }
  const s=lstat(helper)
  if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||s.gid!==0||s.nlink!==1||(s.mode&0o7777)!==0o4755||realpath(helper)!==helper)refusal('SANDBOX_HELPER_IDENTITY_REFUSED')
  return helper
}
export function compareProduced(actual, expected, parse) {
  assert.deepEqual(parse(actual.diff_text), parse(expected))
  const hunks = s => [...s.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map(x => [Number(x[1]), Number(x[2] ?? 1), Number(x[3]), Number(x[4] ?? 1)])
  assert.deepEqual(hunks(actual.diff_text), hunks(expected))
  assert.equal(actual.base, BASE); assert.equal(actual.head, HEAD)
  assert.equal(actual.repository, 'https://github.com/nehcuh/cmspark')
  assert.equal(actual.file_count, 4); assert.equal(actual.additions, 33); assert.equal(actual.deletions, 4)
}
// Only finite constants are ever emitted, including on assertion/CDP/network failures.
const STAGES = new Set(['PREFLIGHT', 'GIT', 'BUNDLE', 'XVFB', 'CHROMIUM', 'WORKER', 'AUTH', 'NAVIGATION', 'POSITIVE', 'NEGATIVES', 'CLEANUP', 'COMPLETE'])
function startupProjection464(value) {
  if (!value || typeof value !== 'object') return undefined
  const keys=['step','spawnError','exitObserved','exitCode','signal','sandboxUnavailable','namespaceDenied','displayUnavailable','stderrTruncated'], out={}
  for(const key of keys) { const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value'))return undefined;out[key]=d.value }
  if (!['SPAWN','SANDBOX_HELPER','PORT_FILE','PORT_PARSE','CDP_CONNECT','CONNECTED'].includes(out.step) ||
      !['NONE','SIGABRT','SIGTRAP','SIGSEGV','SIGTERM','SIGKILL','OTHER'].includes(out.signal) ||
      !(out.exitCode===null||Number.isInteger(out.exitCode)&&out.exitCode>=0&&out.exitCode<=255) ||
      keys.filter(k=>!['step','exitCode','signal'].includes(k)).some(k=>typeof out[k]!=='boolean')) return undefined
  return out
}
export function receipt(stage, passed, cases, runtime = {}) {
  if (!STAGES.has(stage) || typeof passed !== 'boolean' || !Number.isSafeInteger(cases) || cases < 0 || cases > 32) refusal('INVALID_RECEIPT')
  const startup=startupProjection464(runtime.chromiumStartup)
  return { schema: 1, stage, passed, cases, browserAcceptance: passed ? 'REAL_HOSTED_CHROMIUM' : 'NOT_PASSED',
    authBoundary: 'FIXTURE_PRIMITIVES_AND_PRODUCTION_PENDING', fullStartServer: false, reviewReady: false,
    ...(startup?{chromiumStartup:startup}:{}),
    ...Object.fromEntries(Object.entries(runtime).filter(([k,v]) => ['node', 'chromium', 'image', 'source', 'base', 'head', 'expectedDiffSHA256', 'producedDiffSHA256', 'fileCount', 'additions', 'deletions'].includes(k) &&
      (typeof v === 'string' && v.length <= 200 && /^[A-Za-z0-9 ._:/+-]+$/.test(v) || typeof v === 'number' && Number.isSafeInteger(v) && v >= 0))) }
}
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a;reject=b }); return { promise, resolve, reject } }
function limit(promise, ms, code) {
  let timer; return Promise.race([promise, new Promise((_,reject) => { timer = setTimeout(() => reject(new Error(code)), ms) })]).finally(() => clearTimeout(timer))
}
async function waitForFile(filename, ms) {
  const end = Date.now() + ms
  while (Date.now() < end) { try { return fs.readFileSync(filename, 'utf8') } catch {} await new Promise(r => setTimeout(r, 25)) }
  refusal('STARTUP_FILE_MISSING')
}
// Diagnostics only: fixed categories, never stderr text/paths or success authority.
// Continue draining the pipe after the memory cap. Snapshot before cleanup so an
// owned SIGTERM during retirement cannot be reported as the startup result.
export function observeChromiumStartup464() {
  let step='SPAWN',spawnError=false,exitObserved=false,exitCode=null,signal='NONE',text='',bytes=0,stderrTruncated=false
  return {
    step(value) { if(!['SPAWN','SANDBOX_HELPER','PORT_FILE','PORT_PARSE','CDP_CONNECT','CONNECTED'].includes(value))throw new Error('INVALID_STARTUP_STEP');step=value },
    track(child) {
      child.on('error',()=>{spawnError=true})
      child.on('exit',(code,sig)=>{exitObserved=true;exitCode=Number.isInteger(code)&&code>=0&&code<=255?code:null;signal=sig==null?'NONE':['SIGABRT','SIGTRAP','SIGSEGV','SIGTERM','SIGKILL'].includes(sig)?sig:'OTHER'})
      child.stderr.on('error',()=>{stderrTruncated=true})
      child.stderr.on('data',chunk=>{
        if(!Buffer.isBuffer(chunk)){stderrTruncated=true;return}
        const count=Math.min(8192-bytes,chunk.length)
        if(count>0){text+=chunk.subarray(0,count).toString('utf8');bytes+=count}
        if(count<chunk.length)stderrTruncated=true
      })
    },
    snapshot() { return {step,spawnError,exitObserved,exitCode,signal,sandboxUnavailable:text.includes('No usable sandbox!'),namespaceDenied:text.includes('Failed to move to new namespace'),displayUnavailable:text.includes('Missing X server or $DISPLAY'),stderrTruncated} },
  }
}
class CDP {
  constructor(socket) { this.socket=socket;this.id=0;this.pending=new Map();socket.on('error',()=>socket.terminate());socket.on('message', data => {
    let m; try { m=JSON.parse(data.toString()) } catch { return }
    const p=this.pending.get(m.id);if (!p) return;this.pending.delete(m.id);m.error?p.reject(new Error('CDP_REFUSED')):p.resolve(m.result)
  }); socket.on('close', () => { for (const p of this.pending.values()) p.reject(new Error('CDP_CLOSED'));this.pending.clear() }) }
  static async connect(WebSocket, url) { const s=new WebSocket(url); await limit(once(s,'open'),5000,'CDP_CONNECT');return new CDP(s) }
  call(method, params={}, timeout=BOUNDS.navigation) { const id=++this.id, p=deferred(); this.pending.set(id,p);this.socket.send(JSON.stringify({id,method,params}));return limit(p.promise,timeout,'CDP_TIMEOUT').finally(()=>this.pending.delete(id)) }
  async evaluate(expression, awaitPromise=false) { const r=await this.call('Runtime.evaluate',{expression,awaitPromise,returnByValue:true});if(r.exceptionDetails) refusal('PAGE_EVALUATION_REFUSED');return r.result?.value }
  close() { this.socket.close() }
  abort() {
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
export async function main() {
  const envInput=process.env, platform=process.platform
  let stage='PREFLIGHT', cases=0, owned, chromium, chromiumStartup, xvfb, server, browser, peer, timer, esbuild, forward, buildTask, buildSettled=true, expired=false, profileRead=false, runtime={}, cleanupOkay=true
  const active = new Set(), sockets = new Set()
  const deadline=Date.now()+BOUNDS.outer
  const remaining=()=>{const n=deadline-Date.now();if(n<=0||expired)refusal('OUTER_TIMEOUT');return n}
  try {
    const runnerTemp=preflight(envInput,platform)
    if (process.versions.node.split('.')[0] !== '22') refusal('NODE_22_REQUIRED')
    owned=fs.mkdtempSync(path.join(runnerTemp,'cmspark-github-464-'));fs.chmodSync(owned,0o700)
    const imageVersion=String(envInput.ImageVersion||'UNKNOWN')
    const env=childEnvironment(owned,envInput)
    for (const k of ['HOME','TMPDIR','XDG_CONFIG_HOME','XDG_CACHE_HOME','CMSPARK_DATA_DIR']) fs.mkdirSync(env[k],{recursive:true,mode:0o700})
    // This occurs before ANY Companion module import, including logger/config.
    // Only this isolated harness process is retargeted. No inherited credential
    // reaches a backend import, bundler subprocess or browser child.
    for(const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env,env)
    const require=createRequire(path.join(REPO,'companion/package.json'))
    const { WebSocket, WebSocketServer }=require('ws');esbuild=require('esbuild')
    const auth=require(path.join(REPO,'companion/dist/ws-auth.js'))
    const protocol=require(path.join(REPO,'companion/dist/protocol.js'))
    const { surfaceFromOrigin }=require(path.join(REPO,'companion/dist/ws/handshake-surface.js'))
    forward=require(path.join(REPO,'companion/dist/ws/tool-forward.js'))
    const { captureLocalPageResult }=require(path.join(REPO,'companion/dist/business-evidence/executor.js'))
    const { CodeReviewService }=require(path.join(REPO,'companion/dist/code-review/service.js'))
    const { parseUnifiedDiff }=require(path.join(REPO,'companion/dist/code-review/diff.js'))
    assert.equal(auth.AUTH_TIMEOUT_MS,5000);assert.equal(forward.TOOL_EXECUTION_TIMEOUT_MS,15000)
    timer=setTimeout(() => { expired=true;for(const c of active)c.abort();for (const s of sockets) s.terminate();for(const c of [chromium,xvfb]) c?.kill('SIGTERM') },remaining())
    stage='GIT'
    const gitEnv={...env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0'}
    const git=(...args)=>execFileSync('/usr/bin/git',['-C',REPO,...args],{env:gitEnv,encoding:'utf8',timeout:5000,maxBuffer:1024*1024,stdio:['ignore','pipe','ignore']})
    assert.equal(git('rev-parse',BASE+'^{commit}').trim(),BASE);assert.equal(git('rev-parse',HEAD+'^{commit}').trim(),HEAD)
    const expected=git('diff','--no-ext-diff','--no-textconv','--no-color','--unified=3',BASE,HEAD,'--').normalize('NFC')
    const expectedFiles=parseUnifiedDiff(expected);assert.equal(expectedFiles.length,4)
    runtime={node:process.versions.node,image:imageVersion,source:git('rev-parse','HEAD').trim(),base:BASE,head:HEAD,expectedDiffSHA256:hash(expected)}
    stage='BUNDLE'
    const extension=path.join(owned,'extension');fs.mkdirSync(extension)
    buildSettled=false
    buildTask=esbuild.build({entryPoints:[path.join(HERE,'fixtures/github-comparison-hosted-worker.ts')],bundle:true,platform:'browser',format:'iife',outfile:path.join(extension,'worker.js'),logLevel:'silent'})
    buildTask.then(()=>{buildSettled=true},()=>{buildSettled=true})
    await limit(buildTask,remaining(),'BUNDLE_TIMEOUT')
    fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Owned comparison acceptance',version:'1.0.0',
      background:{service_worker:'worker.js'},permissions:['tabs','debugger','scripting','storage','alarms'],host_permissions:['https://github.com/*','http://127.0.0.1/*']}))
    stage='XVFB';remaining()
    xvfb=spawn('/usr/bin/Xvfb',['-displayfd','3','-screen','0','1280x800x24','-nolisten','tcp'],{env,stdio:['ignore','ignore','ignore','pipe']})
    let displayText='';const displayReady=deferred();xvfb.stdio[3].on('data',b=>{displayText+=b.toString();if(displayText.length>8)displayReady.reject(new Error('INVALID_DISPLAY'));else if(/^\d+\n$/.test(displayText))displayReady.resolve(':'+displayText.trim())});xvfb.on('error',()=>displayReady.reject(new Error('XVFB_START_FAILED')))
    const display=await limit(displayReady.promise,5000,'XVFB_START_TIMEOUT')
    stage='CHROMIUM'
    chromiumStartup=observeChromiumStartup464()
    const binary=['/usr/bin/chromium','/usr/bin/chromium-browser'].find(x=>{try{return fs.statSync(x).isFile()}catch{return false}})
    if(!binary)refusal('CHROMIUM_MISSING')
    const version=execFileSync(binary,['--version'],{env,encoding:'utf8',timeout:5000,stdio:['ignore','pipe','ignore']}).trim()
    if(!/^Chromium [0-9.]+(?: [A-Za-z0-9 ._-]+)?$/.test(version))refusal('CHROMIUM_IDENTITY_REFUSED')
    runtime.chromium=version
    chromiumStartup.step('SANDBOX_HELPER')
    const helper=installedSandboxHelper464()
    const browserEnv={...childEnvironment(owned,env,display),CHROME_DEVEL_SANDBOX:helper}
    chromiumStartup.step('SPAWN')
    remaining();chromium=spawn(binary,chromeArgs(owned,extension),{env:browserEnv,stdio:['ignore','ignore','pipe']})
    chromiumStartup.track(chromium);chromiumStartup.step('PORT_FILE')
    const portText=await waitForFile(path.join(owned,'profile/DevToolsActivePort'),10000), parts=portText.trim().split('\n')
    chromiumStartup.step('PORT_PARSE')
    if(parts.length!==2||!/^\d{1,5}$/.test(parts[0])||!/^\/devtools\/browser\/[a-f0-9-]+$/.test(parts[1]))refusal('CDP_IDENTITY_REFUSED')
    const endpoint='http://127.0.0.1:'+parts[0]
    chromiumStartup.step('CDP_CONNECT')
    browser=await CDP.connect(WebSocket,'ws://127.0.0.1:'+parts[0]+parts[1]);active.add(browser)
    chromiumStartup.step('CONNECTED');runtime.chromiumStartup=chromiumStartup.snapshot()
    stage='WORKER'
    let workerInfo
    const end=Date.now()+10000
    while(Date.now()<end) { const r=await fetch(endpoint+'/json/list',{signal:AbortSignal.timeout(Math.min(5000,remaining()))});const targets=await r.json();workerInfo=targets.find(x=>x.type==='service_worker'&&/^chrome-extension:\/\/[a-p]{32}\/worker.js$/.test(x.url));if(workerInfo)break;await new Promise(r=>setTimeout(r,50)) }
    if(!workerInfo)refusal('OWNED_WORKER_MISSING')
    const origin=new URL(workerInfo.url).origin==='null'?'chrome-extension://'+workerInfo.url.split('/')[2]:new URL(workerInfo.url).origin
    const worker=await CDP.connect(WebSocket,workerInfo.webSocketDebuggerUrl);active.add(worker)
    assert.equal(await worker.evaluate('typeof globalThis.cmspark464.configure'), 'function')
    const tabId=await worker.evaluate('globalThis.cmspark464.createTab()',true);assert.ok(Number.isSafeInteger(tabId))
    // Chrome's actual debugger target/tab mapping retains the exact created tab,
    // including its initial about:blank. URL selection would race navigation.
    const targetId=await worker.evaluate('globalThis.cmspark464.pageTarget()',true)
    if(typeof targetId!=='string'||!/^[A-Za-z0-9-]+$/.test(targetId))refusal('OWNED_PAGE_TARGET_MISSING')
    const openPage=async()=>{const page=await CDP.connect(WebSocket,`ws://127.0.0.1:${parts[0]}/devtools/page/${targetId}`);active.add(page);return page}
    stage='AUTH'
    const secret=crypto.randomBytes(32).toString('hex'), authenticated=new Set(), connected=deferred()
    server=new WebSocketServer({host:'127.0.0.1',port:0,maxPayload:1024*1024});await limit(once(server,'listening'),remaining(),'SERVER_LISTEN')
    server.on('connection',(ws,req)=>{
      sockets.add(ws);ws.on('error',()=>ws.terminate());const nonce=auth.issueChallenge(), timeout=setTimeout(()=>ws.terminate(),auth.AUTH_TIMEOUT_MS)
      if(req.headers.origin!==origin||!surfaceFromOrigin(req.headers.origin,undefined).ok){ws.terminate();return}
      ws.on('close',()=>{clearTimeout(timeout);authenticated.delete(ws);sockets.delete(ws)})
      ws.on('message',data=>{
        let m;try{m=JSON.parse(data.toString())}catch{ws.terminate();return}
        if(!m||typeof m!=='object'||Array.isArray(m)){ws.terminate();return}
        if(!authenticated.has(ws)){
          if(m.type!=='auth.handshake'||!auth.verifyProof(secret,nonce,String(m.proof))||!protocol.negotiateProtocolVersion(m.protocol_version).ok){ws.terminate();return}
          authenticated.add(ws);clearTimeout(timeout);ws.send(JSON.stringify({type:'auth.ok',...protocol.authOkProtocolFields()}));if(!peer){peer=ws;connected.resolve()}return
        }
        if(m.type==='tool.result')forward.handleToolResult(m,ws)
      });ws.send(JSON.stringify({type:'auth.challenge',nonce}))
    })
    const serverPort=server.address().port
    // Negative proof reaches the same actual verifier but cannot become the dispatch peer.
    const bad=new WebSocket('ws://127.0.0.1:'+serverPort,{origin});bad.on('error',()=>bad.terminate());bad.on('message',()=>bad.send(JSON.stringify({type:'auth.handshake',proof:'0'.repeat(64),protocol_version:1})))
    await limit(once(bad,'close'),5000,'BAD_PROOF_ACCEPTED');assert.equal(peer,undefined);cases++
    const early=new WebSocket('ws://127.0.0.1:'+serverPort,{origin});early.on('error',()=>early.terminate())
    early.on('message',()=>early.send(JSON.stringify({type:'tool.result',tool_call_id:'owned464-0',result:{success:true}})))
    await limit(once(early,'close'),5000,'PREAUTH_APP_ACCEPTED');assert.equal(peer,undefined);cases++
    assert.equal(await worker.evaluate(`globalThis.cmspark464.configure(${serverPort},${JSON.stringify(secret)})`),true)
    await limit(connected.promise,5000,'AUTH_TIMEOUT')
    const getWire=async()=>{ remaining();const id='owned464-'+(++getWire.counter);return forward.dispatchToExtension(id,'get_page_text',{tabId},peer,{threadId:'owned-hosted464',tabId}) };getWire.counter=0
    stage='NAVIGATION'
    let page=await openPage()
    const ready=await page.evaluate(`new Promise(resolve=>{let done=false;const check=()=>{if(location.href!==${JSON.stringify(PAGE)})return;const b=document.getElementById('files_bucket'),t=document.getElementById('toc'),f=document.getElementById('files');if(document.readyState==='complete'&&b&&t&&f&&!b.querySelector('include-fragment')&&f.querySelectorAll('.file.js-file').length===4){done=true;o.disconnect();clearTimeout(timer);resolve(true)}};const o=new MutationObserver(check);o.observe(document,{childList:true,subtree:true,attributes:true});const timer=setTimeout(()=>{o.disconnect();resolve(false)},60000);check()})`,true)
    assert.equal(ready,true);page.close();active.delete(page)
    stage='POSITIVE'
    const wire=await getWire();assert.equal(wire.success,true);assert.equal(wire.data?.provenance?.channel,'cdp');assert.equal(wire.data?.provenance?.capture_status,'eligible')
    compareProduced(wire.data.codeComparison,expected,parseUnifiedDiff)
    const scope={kind:'chat',threadId:'owned-hosted464'}, captured=captureLocalPageResult(env.CMSPARK_DATA_DIR,scope,'positive','get_page_text',wire)
    assert.equal(captured.data.evidence_capture.capture_status,'captured');assert.equal(captured.data.codeComparison,undefined)
    const input={request_id:'positive',repository:'https://github.com/nehcuh/cmspark',base:BASE,head:HEAD,comparison_observation_id:captured.data.observation_id}
    const service=new CodeReviewService(env.CMSPARK_DATA_DIR,scope),view=service.create(input)
    assert.equal(view.adapter,'github_compare_two_dot.v1');assert.equal(view.coverage,'complete');assert.equal(view.identity_state,'host_comparison_verified');assert.equal(view.review_ready,false);assert.equal(view.untrusted,true)
    assert.deepEqual(new CodeReviewService(env.CMSPARK_DATA_DIR,scope).read({review_id:view.review_id}),view)
    assert.deepEqual(view.files,expectedFiles);cases++
    runtime={...runtime,producedDiffSHA256:hash(wire.data.codeComparison.diff_text),fileCount:4,additions:33,deletions:4}
    stage='NEGATIVES'
    assert.throws(()=>service.create({...input,request_id:'wrong-base',base:'a'.repeat(40)}),/IDENTITY_MISMATCH/)
    assert.throws(()=>new CodeReviewService(env.CMSPARK_DATA_DIR,{kind:'chat',threadId:'foreign'}).create(input),/CAPTURE_REQUIRED/);cases+=2
    const manual={review_id:view.review_id,repository:view.repository,base:view.base,head:view.head,diff_hash:view.diff_hash,status:'completed',summary:'Owned manual assessment',findings:[],reviewed_files:view.files.map(x=>x.new_path||x.old_path),mappings:[]}
    assert.equal(service.receive(manual).origin,'user_confirmed_external_assessment');assert.equal(service.read({review_id:view.review_id}).review_ready,false);cases++
    // A real foreign socket may replay real wire data; only originWs can settle.
    const foreign=new WebSocket('ws://127.0.0.1:'+serverPort,{origin});foreign.on('error',()=>foreign.terminate())
    const foreignAuthed=deferred();foreign.on('message',data=>{const m=JSON.parse(data.toString());if(m.type==='auth.challenge')foreign.send(JSON.stringify({type:'auth.handshake',protocol_version:1,proof:crypto.createHmac('sha256',secret).update(m.nonce).digest('hex')}));if(m.type==='auth.ok')foreignAuthed.resolve()})
    await limit(foreignAuthed.promise,5000,'FOREIGN_AUTH_TIMEOUT')
    const foreignServer=[...authenticated].find(x=>x!==peer);assert.ok(foreignServer)
    const nextId='owned464-'+(getWire.counter+1), actualPromise=getWire()
    forward.handleToolResult({tool_call_id:nextId,result:wire},foreignServer);assert.ok(forward.pendingToolCalls.has(nextId))
    assert.equal((await actualPromise).success,true);assert.equal(forward.pendingToolCalls.has(nextId),false)
    forward.handleToolResult({tool_call_id:nextId,result:wire},peer);assert.equal(forward.pendingToolCalls.has(nextId),false);foreign.close();cases+=2
    for(const kind of ['folded','loading']){
      page=await openPage()
      const changed=await page.evaluate(`(()=>{const key='__owned464Restore';if(window[key])return false;${kind==='folded'?`const n=document.querySelector('#files .file-header button[aria-label="Toggle diff contents"]');if(!n||n.getAttribute('aria-expanded')!=='true')return false;window[key]=()=>n.setAttribute('aria-expanded','true');n.setAttribute('aria-expanded','false');`:`const b=document.getElementById('files_bucket');if(!b||b.querySelector('include-fragment'))return false;const n=document.createElement('include-fragment');window[key]=()=>n.remove();b.append(n);`}return true})()`)
      assert.equal(changed,true);page.close();active.delete(page)
      try{const refused=await getWire();assert.equal(refused.success,true);assert.equal(refused.data?.codeComparison,undefined);assert.ok(refused.data?.comparison_refusal)
        const c=captureLocalPageResult(env.CMSPARK_DATA_DIR,scope,kind,'get_page_text',refused)
        assert.throws(()=>service.create({...input,request_id:kind,comparison_observation_id:c.data.observation_id||'00000000-0000-4000-8000-000000000000'}),/CAPTURE_REQUIRED/)
      }finally{page=await openPage();assert.equal(await page.evaluate(`(()=>{const f=window.__owned464Restore;if(typeof f!=='function')return false;f();delete window.__owned464Restore;return true})()`),true);page.close();active.delete(page)}cases++
    }
    page=await openPage()
    assert.equal(await page.evaluate(`(()=>{if(Object.hasOwn(document.body,'innerText'))return false;const value=document.body.innerText;Object.defineProperty(document.body,'innerText',{configurable:true,get(){history.replaceState(null,'',${JSON.stringify(PAGE+'?owned464=changed')});return value}});return true})()`),true)
    page.close();active.delete(page)
    try{const moved=await getWire();assert.equal(moved.data?.provenance?.capture_status,'TARGET_CHANGED');assert.equal(moved.data?.codeComparison,undefined);assert.equal(captureLocalPageResult(env.CMSPARK_DATA_DIR,scope,'moved','get_page_text',moved).data.evidence_capture.capture_status,'skipped')}
    finally{page=await openPage();await page.evaluate(`delete document.body.innerText;history.replaceState(null,'',${JSON.stringify(PAGE)});true`);page.close();active.delete(page)}cases++
    remaining();profileRead=true;stage='COMPLETE'
  } catch { /* Nothing from an untrusted page/transport exception is reflected. */
    if(chromiumStartup)runtime.chromiumStartup=chromiumStartup.snapshot()
  }
  finally {
    // The same absolute120s bound remains armed through cleanup. Unknown closure
    // retains the owned directory; a late build/child may never touch a deleted root.
    if(forward)try{forward.rejectPendingForThread('owned-hosted464','OWNED_ACCEPTANCE_CLOSED')}catch{cleanupOkay=false}
    if(esbuild)try{esbuild.stop()}catch{cleanupOkay=false}
    if(buildTask&&!buildSettled)try{await limit(buildTask,cleanupRemaining(deadline),'BUILD_SETTLE')}catch{if(!buildSettled)cleanupOkay=false}
    for(const s of sockets){try{s.terminate()}catch{cleanupOkay=false}}
    if(server)try{const closing=new Promise(resolve=>server.close(resolve));await limit(closing,cleanupRemaining(deadline),'SERVER_CLOSE')}catch{cleanupOkay=false}
    for(const c of active){try{if(c!==browser)c.abort()}catch{cleanupOkay=false}}
    if(browser)try{await browser.call('Browser.close',{},cleanupRemaining(deadline))}catch{/* Actual child termination below is still required; no late ACK can grant success. */}
    for(const c of active)try{c.abort()}catch{cleanupOkay=false}
    for(const child of [chromium,xvfb])try{await stopped(child,deadline)}catch{cleanupOkay=false}
    if(Date.now()>=deadline||expired||!buildSettled)cleanupOkay=false
    if(owned&&cleanupOkay)try{fs.rmSync(owned,{recursive:true,force:true})}catch{cleanupOkay=false}
    if(Date.now()>=deadline||expired)cleanupOkay=false
    if(!cleanupOkay)stage='CLEANUP'
    clearTimeout(timer)
  }
  const out=receipt(stage,stage==='COMPLETE'&&profileRead&&cleanupOkay,cases,runtime)
  console.log(JSON.stringify(out));return out.passed?0:1
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) process.exitCode=await main()
