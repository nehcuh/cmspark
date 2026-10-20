// #732 remote-only: normal daemon + normal built extension. No fixture WS server.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
export const BOUNDS=Object.freeze({outer:120000,navigation:60000,auth:5000,tool:15000})
const fail=()=>{throw new Error('OWNED_ACCEPTANCE_REFUSED')}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
// Passive progress only: a phase is the last reached source observation, not a cause.
function ownStartupValue(value,key) {
  try {const d=Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value:undefined}catch{return undefined}
}
export function browserStartupProjection(value) {
  const phase=ownStartupValue(value,'browserPhase')
  const phases=['XVFB_REQUEST','DISPLAY_OBSERVED','BINARY_SELECTED','PORT_FILE','CDP_CONNECTED','WORKER_FOUND','WORKER_READY','PAIR_PAGE','PAIRED','AUTH_DONE']
  const code=key=>{const n=ownStartupValue(value,key);return typeof n==='number'&&Number.isInteger(n)&&n>=-2147483648&&n<=2147483647?n:null}
  return {browserPhase:typeof phase==='string'&&phases.includes(phase)?phase:null,
    browserPresent:ownStartupValue(value,'browserPresent')===true,browserExitCode:code('browserExitCode'),
    xvfbPresent:ownStartupValue(value,'xvfbPresent')===true,xvfbExitCode:code('xvfbExitCode')}
}
export function observeBrowserStartup(phase,browser,xvfb) {
  return browserStartupProjection({browserPhase:phase,browserPresent:browser!=null,browserExitCode:ownStartupValue(browser,'exitCode'),
    xvfbPresent:xvfb!=null,xvfbExitCode:ownStartupValue(xvfb,'exitCode')})
}
export function finiteReceipt(stage,checks,startup) {
  const stages=['PREFLIGHT','ARTIFACT','DAEMON','BROWSER','PANEL','START','DURABLE','CRASH','RECONNECT','EXISTING_DOCUMENT','RELOAD','TERMINAL','CLEANUP','COMPLETE']
  if(!stages.includes(stage))fail()
  const output={}
  for(const key of ['durable','crashClosed','peerClosed','sameData','existingInterrupted','noGhost','freshDocument','reloadedInterrupted','terminalPreserved','cleanup']) {
    let d;try{d=Object.getOwnPropertyDescriptor(checks,key)}catch{}
    output[key]=!!d&&Object.hasOwn(d,'value')&&d.value===true
  }
  return {schema:1,stage,boundary:'REAL_DAEMON_PRODUCTION_EXTENSION_TRUE_SIDEPANEL_SYNTHETIC_ACP',checks:output,passed:stage==='COMPLETE'&&Object.values(output).every(Boolean),...browserStartupProjection(startup)}
}
export function preflight(env,platform,stat=fs.lstatSync,realpath=fs.realpathSync,uid=process.getuid?.()) {
  if(platform!=='linux'||env.GITHUB_ACTIONS!=='true'||env.RUNNER_OS!=='Linux'||env.RUNNER_ENVIRONMENT!=='github-hosted'||env.ImageOS!=='ubuntu22'||!path.isAbsolute(env.RUNNER_TEMP||''))fail()
  const root=path.resolve(env.RUNNER_TEMP),s=stat(root)
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==uid||realpath(root)!==root)fail()
  return root
}
export function childEnvironment(owned,input,display) {
  if(!path.isAbsolute(owned))fail()
  const env={PATH:'/usr/local/bin:/usr/bin:/bin',TMPDIR:path.join(owned,'tmp'),XDG_CONFIG_HOME:path.join(owned,'config'),XDG_CACHE_HOME:path.join(owned,'cache'),CMSPARK_DATA_DIR:path.join(owned,'data'),CMSPARK_SKIP_LOGIN_ENV:'1',LANG:'C.UTF-8',TZ:'UTC'}
  if(display!==undefined){if(!/^:[0-9]{1,5}$/.test(display))fail();env.DISPLAY=display}
  if(typeof input.RUNNER_TRACKING_ID==='string')env.RUNNER_TRACKING_ID=input.RUNNER_TRACKING_ID
  return env
}
export function chromeArgs(owned,extension) {
  if(path.dirname(extension)!==owned)fail()
  return [`--user-data-dir=${path.join(owned,'profile')}`,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-first-run','--no-default-browser-check','about:blank']
}
export function devToolsPortSnapshot(text) {
  if(typeof text!=='string')return false
  const parts=text.trim().split('\n')
  // Chromium writes without a final newline and may expose a short-write prefix.
  // Its browser endpoint contains the complete lowercase UUID, not a prefix.
  if(parts.length!==2||!/^\d{1,5}$/.test(parts[0])||!/^\/devtools\/browser\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(parts[1]))return false
  return parts
}
export function manifestPaths(m) {
  const safe=s=>typeof s==='string'&&/^[A-Za-z0-9_./-]+$/.test(s)&&!s.startsWith('/')&&s.split('/').every(v=>v&&v!=='.'&&v!=='..')
  if(m.manifest_version!==3||!safe(m.background?.service_worker)||!safe(m.side_panel?.default_path)||!m.side_panel.default_path.endsWith('.html')||!['sidePanel','tabs','storage','debugger'].every(p=>m.permissions?.includes(p)))fail()
  return {worker:m.background.service_worker,page:m.side_panel.default_path}
}
export function loadedExpression(tabId,url,ms,operation='current') {
  if(!Number.isSafeInteger(tabId)||tabId<0||typeof url!=='string'||!(/^(?:http:\/\/127\.0\.0\.1:[0-9]+\/login|chrome-extension:\/\/[a-p]{32}\/[A-Za-z0-9_./-]+\.html)$/.test(url))||url.split('/').slice(3).some(p=>p==='.'||p==='..')||!Number.isInteger(ms)||ms<=0||ms>BOUNDS.navigation||!['current','reload','navigate'].includes(operation))fail()
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
export function choosePanel(before,after,url,debugTargets) {
  const prior=new Set(before.map(t=>t.targetId))
  const anchors=before.filter(t=>t.url===url&&debugTargets.some(d=>d.id===t.targetId&&Number.isSafeInteger(d.tabId)))
  if(anchors.length!==1)fail()
  const matches=after.filter(t=>!prior.has(t.targetId)&&t.url===url&&t.browserContextId===anchors[0].browserContextId&&debugTargets.some(d=>d.id===t.targetId&&d.tabId===undefined&&d.url===url))
  if(matches.length!==1)fail()
  return matches[0].targetId
}
// Serialized into the owned real extension worker. These witnesses never enter
// production messages/storage and caller-provided IDs are not sender proof.
export async function installNativePanelWitness(api,scope,spec) {
  const refuse=()=>{throw new Error('OWNED_PANEL_PROOF_REFUSED')}
  if(!spec||!/^__cmsparkPanel732_[a-f0-9]{32}$/.test(spec.key)||spec.port!=='cmspark-panel-proof732-'+spec.key.slice(-32)||
    !/^chrome-extension:\/\/[a-p]{32}\/[A-Za-z0-9_./-]+\.html$/.test(spec.url)||
    !Number.isSafeInteger(spec.windowId)||spec.windowId<0||!Number.isInteger(spec.ms)||spec.ms<=0||spec.ms>60000||Object.hasOwn(scope,spec.key)||Object.hasOwn(scope,spec.key+'_cleanup'))refuse()
  const cleanupKey=spec.key+'_cleanup'
  const origin='chrome-extension://'+spec.url.split('/')[2],extensionId=spec.url.split('/')[2],page=spec.url.slice(origin.length+1),expires=Date.now()+spec.ms
  const filter={contextTypes:['SIDE_PANEL'],documentUrls:[spec.url],documentOrigins:[origin]},previous=await api.runtime.getContexts(filter)
  if(!Array.isArray(previous)||previous.length||Date.now()>=expires)refuse()
  let disposed=false,failed=false,bound=false,opened=0,context,port,timer,witness,cleanup
  const current=()=>{if(disposed||failed||Date.now()>=expires)refuse()}
  const close=()=>{
    if(disposed)return true
    disposed=true;clearTimeout(timer)
    try{api.sidePanel.onOpened.removeListener(onOpened)}catch{failed=true}
    try{api.runtime.onConnect.removeListener(onConnect)}catch{failed=true}
    if(port){port.onDisconnect.removeListener(disconnected);try{port.disconnect()}catch{failed=true}}
    if(Object.getOwnPropertyDescriptor(scope,spec.key)?.value===witness)delete scope[spec.key]
    if(Object.getOwnPropertyDescriptor(scope,cleanupKey)?.value===cleanup)delete scope[cleanupKey]
    return !failed
  }
  const bad=()=>{failed=true;close()}
  const nativeContext=rows=>{
    if(!Array.isArray(rows)||rows.length!==1)refuse()
    const row=rows[0],uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
    if(row.contextType!=='SIDE_PANEL'||row.documentUrl!==spec.url||row.documentOrigin!==origin||row.incognito!==false||
      row.tabId!==-1||row.frameId!==0||!uuid(row.contextId)||!uuid(row.documentId)||(row.windowId!==-1&&row.windowId!==spec.windowId))refuse()
    return Object.freeze({contextId:row.contextId,documentId:row.documentId,frameId:row.frameId})
  }
  const same=(a,b)=>a.contextId===b.contextId&&a.documentId===b.documentId&&a.frameId===b.frameId
  const recheck=async()=>{current();const captured=context;if(!captured)refuse();const latest=nativeContext(await api.runtime.getContexts(filter));current();if(context!==captured||!same(captured,latest))refuse();return captured}
  const onOpened=async info=>{
    if(disposed)return
    try{
      current();if(++opened!==1||info.windowId!==spec.windowId||info.path!==page||info.tabId!==undefined)refuse()
      const found=nativeContext(await api.runtime.getContexts(filter));current();context=found
    }catch{bad()}
  }
  const disconnected=()=>bad()
  const onConnect=async incoming=>{
    if(incoming.name!==spec.port)return
    try{
      current();if(opened!==1||!context||port)refuse()
      port=incoming;port.onDisconnect.addListener(disconnected)
      // The native Chrome Port supplies sender; no message body supplies it.
      const sender=port.sender
      if(sender?.id!==extensionId||sender.url!==spec.url||sender.origin!==origin||sender.frameId!==context.frameId||
        sender.documentId!==context.documentId||sender.documentLifecycle!=='active'||sender.tab!==undefined)refuse()
      const captured=port;await recheck();current();if(port!==captured)refuse()
      bound=true
    }catch{if(incoming!==port)try{incoming.disconnect()}catch{};bad()}
  }
  witness={async snapshot(){try{current();if(!context)return {state:'pending'};const captured=await recheck();return {state:bound?'bound':'opened',...captured}}catch{bad();refuse()}},close}
  cleanup=Object.freeze({request:spec.key,close})
  scope[spec.key]=witness
  scope[cleanupKey]=cleanup
  try{api.sidePanel.onOpened.addListener(onOpened);api.runtime.onConnect.addListener(onConnect);timer=setTimeout(close,Math.max(0,expires-Date.now()));return true}catch{bad();refuse()}
}
export function connectNativePanelWitness(api,scope,key,name,expires) {
  const cleanupKey=key+'_cleanup'
  if(Date.now()>=expires||Object.hasOwn(scope,key)||Object.hasOwn(scope,cleanupKey))throw new Error('OWNED_PANEL_PROOF_REFUSED')
  let timer,cleanup,disposed=false
  const port=api.runtime.connect({name}),done=()=>{
    if(disposed)return true
    disposed=true;clearTimeout(timer);port.onDisconnect.removeListener(done)
    if(Object.getOwnPropertyDescriptor(scope,key)?.value===port)delete scope[key]
    if(Object.getOwnPropertyDescriptor(scope,cleanupKey)?.value===cleanup)delete scope[cleanupKey]
    return true
  },close=()=>{let closed=true;try{port.disconnect()}catch{closed=false}finally{done()}return closed}
  cleanup=Object.freeze({request:key,close})
  scope[key]=port;scope[cleanupKey]=cleanup;port.onDisconnect.addListener(done)
  timer=setTimeout(close,Math.max(0,expires-Date.now()))
  return true
}
export async function openNativePanel(io) {
  const {worker,pairingView,tab,url,before,targets,connect,targetSocket,poll,remaining,nonce}=io
  if(!Number.isSafeInteger(tab)||tab<0||!/^chrome-extension:\/\/[a-p]{32}\/[A-Za-z0-9_./-]+\.html$/.test(url)||!/^([a-f0-9]{32})$/.test(nonce))fail()
  const key='__cmsparkPanel732_'+nonce,name='cmspark-panel-proof732-'+nonce,ms=remaining(),deadline=Date.now()+ms
  if(!Number.isInteger(ms)||ms<=0||ms>BOUNDS.navigation)fail()
  const left=()=>{const n=Math.min(remaining(),deadline-Date.now());if(n<=0)fail();return n}
  let view,installed=false,targetAttempted=false
  const inspect=()=>worker.evaluate(`globalThis[${JSON.stringify(key)}].snapshot()`,left())
  try{
    const record=await worker.evaluate(`chrome.tabs.get(${tab}).then(t=>({id:t.id,windowId:t.windowId,url:t.url,incognito:t.incognito}))`,left())
    if(record?.id!==tab||record.url!==url||record.incognito!==false||!Number.isSafeInteger(record.windowId)||record.windowId<0)fail()
    const spec={key,port:name,url,windowId:record.windowId,ms:left()}
    installed=true
    await worker.evaluate(`(${installNativePanelWitness.toString()})(chrome,globalThis,${JSON.stringify(spec)})`,left())
    await pairingView.evaluate(`chrome.sidePanel.open({windowId:${record.windowId}})`,left(),true)
    const opened=await poll(async()=>{const value=await inspect();return value.state==='opened'?value:false},left())
    const panelId=await poll(async()=>{
      const debug=await worker.evaluate('chrome.debugger.getTargets()',left()),list=await targets()
      try{const id=choosePanel(before,list,url,debug),matches=debug.filter(d=>d.id===id&&d.type==='page'&&d.extensionId===url.split('/')[2]&&d.tabId===undefined&&d.url===url);return matches.length===1?id:false}catch{return false}
    },left())
    const socket=await limit(targetSocket(panelId),left());view=await limit(connect(socket),left())
    targetAttempted=true
    await view.evaluate(`(${connectNativePanelWitness.toString()})(chrome,globalThis,${JSON.stringify(key)},${JSON.stringify(name)},${deadline})`,left())
    const bound=await poll(async()=>{const value=await inspect();return value.state==='bound'?value:false},left())
    if(bound.contextId!==opened.contextId||bound.documentId!==opened.documentId||bound.frameId!==opened.frameId)fail()
    return view
  }finally{
    // Remote timer uses the same phase deadline; original outer cleanup still
    // awaits actual clients and owned browser close if a CDP endpoint is lost.
    let clean=true
    // This structural handle belongs only to the owned worker's random nonce
    // namespace; it is not an authorization proof against hostile realm code.
    if(installed)try{if(await worker.evaluate(`(()=>{const d=Object.getOwnPropertyDescriptor(globalThis,${JSON.stringify(key+'_cleanup')});if(!d)return true;if(!Object.hasOwn(d,'value')||!d.value||!Object.isFrozen(d.value))throw Error('OWNED_PANEL_CLEANUP_REFUSED');const r=Object.getOwnPropertyDescriptor(d.value,'request'),c=Object.getOwnPropertyDescriptor(d.value,'close');if(!r||!Object.hasOwn(r,'value')||r.value!==${JSON.stringify(key)}||!c||!Object.hasOwn(c,'value')||typeof c.value!=='function')throw Error('OWNED_PANEL_CLEANUP_REFUSED');return c.value()})()`,left())!==true)clean=false}catch{clean=false}
    if(targetAttempted)try{if(await view.evaluate(`(()=>{const d=Object.getOwnPropertyDescriptor(globalThis,${JSON.stringify(key+'_cleanup')});if(!d)return true;if(!Object.hasOwn(d,'value')||!d.value||!Object.isFrozen(d.value))throw Error('OWNED_PANEL_CLEANUP_REFUSED');const r=Object.getOwnPropertyDescriptor(d.value,'request'),c=Object.getOwnPropertyDescriptor(d.value,'close');if(!r||!Object.hasOwn(r,'value')||r.value!==${JSON.stringify(key)}||!c||!Object.hasOwn(c,'value')||typeof c.value!=='function')throw Error('OWNED_PANEL_CLEANUP_REFUSED');return c.value()})()`,left())!==true)clean=false}catch{clean=false}
    if(!clean)fail()
  }
}
export function limit(promise,ms) {if(!(ms>0))fail();let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('OWNED_TIMEOUT')),ms)})]).finally(()=>clearTimeout(timer))}
export class CDP {
  constructor(socket) {
    this.settled=new Promise(resolve=>socket.once('close',resolve));this.socket=socket;this.id=0;this.pending=new Map();this.events=new Map();this.closed=false;this.workerLoaded=false;this.workerWaiter=undefined
    socket.on('error',()=>this.abort());socket.on('message',data=>{let m;try{m=JSON.parse(data.toString())}catch{return}
      if(m.method==='Inspector.workerScriptLoaded'){this.workerLoaded=true;this.workerWaiter?.resolve(true)}
      if(m.method){for(const fn of this.events.get(m.method)||[])fn(m.params);return}
      const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);m.error?p.reject(new Error('CDP_REFUSED')):p.resolve(m.result)})
    socket.once('close',()=>this.abort())
  }
  static async connect(WebSocket,url,ms,ownedClients){if(!(ownedClients instanceof Set))fail();const socket=new WebSocket(url),c=new CDP(socket);ownedClients.add(c);try{await limit(once(socket,'open'),ms);return c}catch{c.abort();fail()}}
  workerScriptReady(ms){if(this.closed)return Promise.reject(new Error('CDP_CLOSED'));if(this.workerLoaded)return Promise.resolve(true);if(this.workerWaiter)fail();const d=deferred();this.workerWaiter=d;return limit(d.promise,ms).finally(()=>{if(this.workerWaiter===d)this.workerWaiter=undefined})}
  on(name,fn){let set=this.events.get(name);if(!set)this.events.set(name,set=new Set());set.add(fn);return ()=>set.delete(fn)}
  async call(method,params={},ms=BOUNDS.auth){if(this.closed)fail();const id=++this.id,d=deferred();this.pending.set(id,d);this.socket.send(JSON.stringify({id,method,params}));return limit(d.promise,ms).finally(()=>this.pending.delete(id))}
  async evaluate(expression,ms,userGesture=false){const r=await this.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture},ms);if(r.exceptionDetails)fail();return r.result?.value}
  abort(){if(this.closed)return;this.closed=true;this.workerWaiter?.reject(new Error('CDP_CLOSED'));for(const p of this.pending.values())p.reject(new Error('CDP_CLOSED'));this.pending.clear();this.events.clear();this.socket.terminate()}
}
export async function reloadDocument(view,remaining) {
  await view.call('Page.enable',{},remaining())
  await view.call('Runtime.enable',{},remaining())
  await view.call('Page.setLifecycleEventsEnabled',{enabled:true},remaining())
  const before=await view.call('Page.getFrameTree',{},remaining())
  const frame=before.frameTree.frame.id,oldLoader=before.frameTree.frame.loaderId
  const loaded=deferred();let loader,cleared=false,context=false,load=false,api=false,settled=false
  const done=()=>{if(!settled&&api&&loader&&cleared&&context&&load){settled=true;loaded.resolve(true)}}
  const offFrame=view.on('Page.frameNavigated',p=>{
    if(!p.frame.parentId&&p.frame.id===frame&&p.frame.loaderId!==oldLoader){loader=p.frame.loaderId;done()}
  })
  const offCleared=view.on('Runtime.executionContextsCleared',()=>{cleared=true;done()})
  const offContext=view.on('Runtime.executionContextCreated',p=>{
    if(cleared&&p.context?.auxData?.isDefault===true&&p.context.auxData.frameId===frame){context=true;done()}
  })
  const offLoad=view.on('Page.lifecycleEvent',p=>{
    if(p.frameId===frame&&p.loaderId!==oldLoader&&p.name==='load'){load=p.loaderId;done()}
  })
  try {
    await view.call('Page.reload',{ignoreCache:false},remaining());api=true;done()
    await limit(loaded.promise,remaining())
    const after=await view.call('Page.getFrameTree',{},remaining())
    if(after.frameTree.frame.loaderId!==loader||load!==loader)fail()
    return true
  } finally {offFrame();offCleared();offContext();offLoad()}
}
// Fixed operation order; DI is test transport, never a product runtime hook.
export async function restartSequence(io) {
  const first=await io.first();await io.durable(first)
  await io.crash(first);await io.closed(first);await io.peerClosed(first)
  const second=await io.second();if(second===first)fail()
  await io.existing(second);await io.reload(second);await io.fresh(second);await io.terminal(second)
}
export function historyObservationExpression(session) {
  if(typeof session!=='string'||!session||session.length>256||/[\x00-\x1f\x7f]/.test(session))fail()
  return `(${function(id){const roots=[...document.querySelectorAll('[data-acp-history]')];if(roots.length!==1)return {interrupted:false,noGhost:false};const rows=[...roots[0].querySelectorAll('small')].filter(e=>e.textContent.endsWith(' · '+id));const interrupted=rows.length===1&&rows[0].parentElement.textContent.includes('已中断；无法恢复原进程关联');return {interrupted,noGhost:interrupted&&!document.querySelector('[data-agent-live-log]')&&!document.querySelector('[data-acp-confirm]')}}.toString()})(${JSON.stringify(session)})`
}
export async function closeOwnedChild(child,remaining,signal='SIGTERM') {
  if(!child)return
  if(child.exitCode!==null||child.signalCode!==null){await child.closed;return}
  child.kill(signal);await limit(child.closed,remaining())
}
export function privateRead(root,name,max=1024*1024) {
  const rs=fs.lstatSync(root);if(!rs.isDirectory()||rs.isSymbolicLink()||rs.uid!==process.getuid()||(rs.mode&0o077)!==0||fs.realpathSync(root)!==root)fail()
  const file=path.join(root,name),s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==rs.uid||(s.mode&0o077)!==0||s.size>max)fail()
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK)
  try{const b=fs.fstatSync(fd);if(b.dev!==s.dev||b.ino!==s.ino)fail();const bytes=Buffer.alloc(max+1),n=fs.readSync(fd,bytes,0,max+1,0),a=fs.fstatSync(fd),l=fs.lstatSync(file),r=fs.lstatSync(root);if(n>max||a.size!==n||a.size!==b.size||a.mtimeMs!==b.mtimeMs||a.ino!==l.ino||a.dev!==l.dev||a.nlink!==1||l.nlink!==1||a.mode!==s.mode||a.uid!==s.uid||l.mode!==s.mode||l.uid!==s.uid||r.ino!==rs.ino||r.dev!==rs.dev||r.mode!==rs.mode||r.uid!==rs.uid||r.isSymbolicLink())fail();return bytes.subarray(0,n).toString('utf8')}finally{fs.closeSync(fd)}
}
// Root contents may change; inode/dev/uid/mode/type/canonical path must not.
export function sameOwnedRoot(root,identity,stat=fs.lstatSync,realpath=fs.realpathSync,uid=process.getuid?.()) {
  try {
    if(!identity||!Number.isFinite(identity.dev)||!Number.isSafeInteger(identity.ino)||identity.ino<=0||identity.uid!==uid||identity.mode!==0o40700)return false
    const current=stat(root)
    return current.isDirectory()&&!current.isSymbolicLink()&&current.dev===identity.dev&&current.ino===identity.ino&&current.uid===identity.uid&&current.mode===identity.mode&&realpath(root)===root
  } catch {return false}
}
export async function main() {
  let stage='PREFLIGHT',browserPhase=null,browserStartup,owned,ownedIdentity,daemon,browser,worker,view,observer,xvfb,chromium,timer,secret,peerIdentity,session,thread
  const checks={},children=new Set(),clients=new Set(),observers=new Set(),deadline=Date.now()+BOUNDS.outer,abort=new AbortController()
  const remaining=()=>{const n=deadline-Date.now();if(n<=0||abort.signal.aborted)fail();return n}
  let navigationDeadline;const nav=()=>{const n=Math.min(remaining(),(navigationDeadline??deadline)-Date.now());if(n<=0)fail();return n}
  const poll=async(fn,ms)=>{const end=Math.min(deadline,Date.now()+ms);while(Date.now()<end){remaining();const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,25))}fail()}
  const child=(exe,args,env,stdio=['ignore','ignore','pipe'])=>{remaining();const c=spawn(exe,args,{env,stdio});c.closed=new Promise(resolve=>c.once('close',resolve));c.on('error',()=>{});c.stderr?.on('data',()=>{});c.stderr?.on('error',()=>{});children.add(c);return c}
  const connect=async(url)=>CDP.connect(WebSocket,url,Math.min(BOUNDS.auth,remaining()),clients)
  let WebSocket
  const originalConsole=Object.fromEntries(['log','info','warn','error','debug'].map(k=>[k,console[k]]))
  try {
    const input=Object.fromEntries(['GITHUB_ACTIONS','RUNNER_OS','RUNNER_ENVIRONMENT','ImageOS','RUNNER_TEMP','GITHUB_SHA','RUNNER_TRACKING_ID'].map(k=>[k,process.env[k]])),temp=preflight(input,process.platform);assert.equal(process.versions.node.split('.')[0],'22')
    owned=fs.mkdtempSync(path.join(temp,'cmspark-history732-'));fs.chmodSync(owned,0o700);ownedIdentity=fs.lstatSync(owned);if(!sameOwnedRoot(owned,ownedIdentity))fail()
    const env=childEnvironment(owned,input);for(const k of ['TMPDIR','XDG_CONFIG_HOME','XDG_CACHE_HOME','CMSPARK_DATA_DIR'])fs.mkdirSync(env[k],{recursive:true,mode:0o700})
    const workspace=path.join(owned,'workspace');fs.mkdirSync(workspace,{mode:0o700})
    // Backend config imports only in a retained clean-env child with owned DATA.
    // Closing preparation first also prevents a parent logger surviving scratch cleanup.
    for(const key of Object.keys(process.env))delete process.env[key]
    Object.assign(process.env,env)
    for(const key of Object.keys(originalConsole))console[key]=()=>{}
    const require=createRequire(path.join(ROOT,'companion/package.json'));({WebSocket}=require('ws'))
    timer=setTimeout(()=>{abort.abort();for(const c of clients)c.abort();observer?.terminate();for(const c of children)if(c.exitCode===null&&c.signalCode===null)c.kill('SIGKILL')},remaining())
    const cfg={port:23401,llm:{api_key:''},vision:{api_key:''},voice:{modelPrewarm:false},embedded_terminal:{enabled:false},coding_handoff:{open_local_terminal:false},mcp:{enabled:false,servers:{}},acp:{enabled:true,servers:{owned732:{enabled:true,display_name:'Owned history fixture',transport:'stdio',protocol:'acp',command:process.execPath,args:[path.join(ROOT,'companion/tests/fixtures/acp-lifecycle.cjs')],env:{FIXTURE_MODE:'hang-prompt',FIXTURE_PID_FILE:path.join(owned,'peer.pid'),FIXTURE_STAGE_FILE:path.join(owned,'peer.stage')},policy:{profile:'review_readonly',allow_write:false,allow_exec:false}}},policy:{require_workspace:true,force_confirm_session_start:true,default_profile:'review_readonly'}}}
    const prepared=child(process.execPath,['-e',`require(${JSON.stringify(path.join(ROOT,'companion/dist/config.js'))}).saveConfig(${JSON.stringify(cfg)})`],env)
    await limit(prepared.closed,remaining());if(prepared.exitCode!==0)fail()
    stage='ARTIFACT';if(!/^[a-f0-9]{40}$/.test(input.GITHUB_SHA||'')||fs.readFileSync(path.join(ROOT,'acceptance-build-sha.txt'),'utf8')!==input.GITHUB_SHA+'\n')fail();const built=path.join(ROOT,'chrome-extension/build/chrome-mv3-prod'),m=JSON.parse(fs.readFileSync(path.join(built,'manifest.json'),'utf8')),paths=manifestPaths(m),extension=path.join(owned,'extension')
    const inspect=dir=>{for(const s of fs.readdirSync(dir,{withFileTypes:true})){if(s.isSymbolicLink()||!s.isDirectory()&&!s.isFile())fail();if(s.isDirectory())inspect(path.join(dir,s.name))}};inspect(built);fs.cpSync(built,extension,{recursive:true,dereference:false})
    if(!fs.lstatSync(path.join(extension,paths.worker)).isFile()||!fs.lstatSync(path.join(extension,paths.page)).isFile())fail()
    const health=async()=>{try{const r=await fetch('http://127.0.0.1:23401/healthz',{signal:AbortSignal.timeout(Math.min(1000,remaining()))});return r.ok}catch{return false}}
    if(await health())fail()
    const start=async()=>{daemon=child(process.execPath,[path.join(ROOT,'companion/dist/index.js'),'daemon','start'],env);await poll(async()=>{if(daemon.exitCode!==null||daemon.signalCode!==null)fail();return health()},BOUNDS.auth);return daemon}
    stage='DAEMON';await start();secret=privateRead(env.CMSPARK_DATA_DIR,'ws_secret',256).trim();if(!/^[a-f0-9]{64}$/.test(secret))fail()
    stage='BROWSER';browserPhase='XVFB_REQUEST';xvfb=child('/usr/bin/Xvfb',['-displayfd','3','-screen','0','1280x800x24','-nolisten','tcp'],env,['ignore','ignore','pipe','pipe']);const display=deferred();let text='';xvfb.stdio[3].on('error',()=>display.reject(new Error('DISPLAY')));xvfb.stdio[3].on('data',b=>{text+=b.toString();if(text.length>8)display.reject(new Error('DISPLAY'));if(/^\d{1,5}\n$/.test(text))display.resolve(':'+text.trim())});const screen=await limit(display.promise,Math.min(5000,remaining()));browserPhase='DISPLAY_OBSERVED'
    const binary=['/usr/bin/chromium-browser','/usr/bin/chromium'].find(p=>{try{return fs.statSync(p).isFile()}catch{return false}});if(!binary)fail();browserPhase='BINARY_SELECTED'
    chromium=child(binary,chromeArgs(owned,extension),childEnvironment(owned,input,screen));const portFile=path.join(owned,'profile/DevToolsActivePort')
    const parts=await poll(()=>{try{return devToolsPortSnapshot(fs.readFileSync(portFile,'utf8'))}catch{return false}},10000);browserPhase='PORT_FILE'
    const socketBase='ws://127.0.0.1:'+parts[0];browser=await connect(socketBase+parts[1]);browserPhase='CDP_CONNECTED';const targets=()=>browser.call('Target.getTargets',{},remaining()).then(r=>r.targetInfos)
    const targetSocket=async id=>{const list=await (await fetch('http://127.0.0.1:'+parts[0]+'/json/list',{signal:AbortSignal.timeout(Math.min(BOUNDS.auth,remaining()))})).json();const matches=list.filter(t=>t.id===id);if(matches.length!==1||typeof matches[0].webSocketDebuggerUrl!=='string'||!matches[0].webSocketDebuggerUrl.startsWith(socketBase+'/devtools/'))fail();return matches[0].webSocketDebuggerUrl}
    const sw=await poll(async()=>{const list=(await targets()).filter(t=>t.type==='service_worker'&&new RegExp('^chrome-extension://[a-p]{32}/'+paths.worker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$').test(t.url));if(list.length>1)fail();return list[0]},10000),origin='chrome-extension://'+sw.url.split('/')[2];browserPhase='WORKER_FOUND'
    worker=await connect(await targetSocket(sw.targetId));await worker.workerScriptReady(Math.min(BOUNDS.auth,remaining()));browserPhase='WORKER_READY';await worker.call('Runtime.enable',{},remaining())
    // A real tab is used only for pairing; it is never accepted as the SidePanel.
    navigationDeadline=Date.now()+Math.min(BOUNDS.navigation,remaining())
    const tab=await worker.evaluate("chrome.tabs.create({url:'about:blank',active:true}).then(t=>t.id)",nav())
    if(!Number.isSafeInteger(tab))fail()
    await worker.evaluate(loadedExpression(tab,origin+'/'+paths.page,nav(),'navigate'),nav());browserPhase='PAIR_PAGE'
    const pairing=await worker.evaluate(`chrome.debugger.getTargets().then(ts=>{const m=ts.filter(t=>t.tabId===${tab});if(m.length!==1)throw new Error('PAIR_TARGET');return m[0].id})`,nav())
    const pairingView=await connect(await targetSocket(pairing))
    await pairingView.evaluate(`chrome.runtime.sendMessage({type:'ws.setSecret',secret:${JSON.stringify(secret)}}).then(r=>{if(r?.ok!==true)throw new Error('PAIR')})`,Math.min(BOUNDS.auth,remaining()));browserPhase='PAIRED'
    const request=async message=>{if(!observer||observer.readyState!==WebSocket.OPEN)fail();const d=deferred(),on=b=>{let r;try{r=JSON.parse(b.toString())}catch{return}if(message.type==='thread.list'?r.type==='thread.list':r.type==='acp.sessions.list_result'&&r.request_id===message.request_id)d.resolve(r)};observer.on('message',on);observer.send(JSON.stringify(message));try{return await limit(d.promise,Math.min(BOUNDS.auth,remaining()))}finally{observer.off('message',on)}}
    const auth=async()=>{remaining();const socket=new WebSocket('ws://127.0.0.1:23401',{origin}),ready=deferred();socket.closed=new Promise(resolve=>socket.once('close',resolve));observers.add(socket);socket.on('error',()=>ready.reject(new Error('AUTH')));socket.on('message',b=>{let r;try{r=JSON.parse(b.toString())}catch{return}if(r.type==='auth.challenge')socket.send(JSON.stringify({type:'auth.handshake',proof:crypto.createHmac('sha256',secret).update(r.nonce).digest('hex'),protocol_version:1}));if(r.type==='auth.ok')ready.resolve(true)});observer=socket;await limit(ready.promise,Math.min(BOUNDS.auth,remaining()))}
    await auth();browserPhase='AUTH_DONE';stage='PANEL';const before=await targets();view=await openNativePanel({worker,pairingView,tab,url:origin+'/'+paths.page,before,targets,connect,targetSocket,poll,remaining:nav,nonce:crypto.randomBytes(16).toString('hex')})
    const evaluate=expression=>view.evaluate(expression,nav());const waitDOM=expression=>poll(()=>evaluate(expression),nav())
    await waitDOM("!!document.querySelector('.cm-header-new')");const initialList=await request({type:'thread.list'});if(!Array.isArray(initialList.threads))fail();const oldThreads=new Set(initialList.threads.map(t=>t.id));await evaluate("document.querySelector('.cm-header-new').click();true")
    thread=await poll(async()=>{const list=await request({type:'thread.list'});if(!Array.isArray(list.threads))fail();const created=list.threads.filter(t=>!oldThreads.has(t.id));if(created.length>1)fail();return created[0]?.id},BOUNDS.auth)
    await evaluate(`chrome.runtime.sendMessage({type:'workspace.set',thread_id:${JSON.stringify(thread)},path:${JSON.stringify(workspace)}}).then(r=>{if(r?.ok===false)throw new Error('WORKSPACE')})`)
    const openPanel=()=>evaluate("window.dispatchEvent(new CustomEvent('cmspark:open-coding-handoff'));true");await openPanel()
    await waitDOM(`!![...document.querySelectorAll('[title]')].find(e=>e.title===${JSON.stringify(workspace)})`)
    await waitDOM("[...document.querySelectorAll('select option')].some(x=>x.value==='owned732')")
    const startUI=async()=>{await evaluate(`(()=>{const t=document.querySelector('textarea[placeholder="描述要审查或修改的问题…"]');if(!t)throw new Error('GOAL');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Owned history acceptance');t.dispatchEvent(new Event('input',{bubbles:true}));const a=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='owned732'));if(!a)throw new Error('AGENT');a.value='owned732';a.dispatchEvent(new Event('change',{bubbles:true}));const c=[...document.querySelectorAll('label')].find(x=>x.textContent.includes('云模型'));if(!c)throw new Error('DISCLOSURE');const b=c.querySelector('input[type=checkbox]');if(!b.checked)b.click();return true})()`)
    await waitDOM("[...document.querySelectorAll('button')].some(b=>b.textContent==='在本面板启动 · 审查'&&!b.disabled)");await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='在本面板启动 · 审查').click();true")
    await waitDOM("!!document.querySelector('[data-acp-confirm]')");await evaluate("(()=>{const a=[...document.querySelectorAll('[data-acp-confirm] button')].filter(b=>b.textContent==='允许'&&!b.disabled);if(a.length!==1)throw new Error('CONFIRM');a[0].click();return true})()")
    };stage='START';await startUI()
    await poll(()=>{try{return fs.readFileSync(path.join(owned,'peer.stage'),'utf8')==='prompt'}catch{return false}},BOUNDS.tool)
    const pid=Number(fs.readFileSync(path.join(owned,'peer.pid'),'utf8'));if(!Number.isSafeInteger(pid)||pid<=0)fail();const proc=()=>{try{return fs.readFileSync('/proc/'+pid+'/stat','utf8').split(') ')[1].split(' ')[19]}catch{return null}};peerIdentity=proc();if(!peerIdentity)fail()
    const history=async()=>{const h=await request({type:'acp.sessions.list',thread_id:thread,request_id:crypto.randomUUID()});if(h.thread_id!==thread||!Array.isArray(h.rows)||h.rows.length>32||Buffer.byteLength(JSON.stringify(h.rows))>65536||h.rows.some(r=>r.thread_id!==thread||r.agent_id!=='owned732'||r.mode!=='review_readonly'))fail();return h}
    await restartSequence({first:async()=>daemon,durable:async()=>{stage='DURABLE';const h=await history();if(h.status!=='ok'||h.rows.length!==1||h.rows[0].source!=='live'||h.rows[0].history_status!=='running')fail();session=h.rows[0].session_id;privateRead(env.CMSPARK_DATA_DIR,'acp-history.json');checks.durable=true},crash:async c=>{stage='CRASH';c.kill('SIGKILL')},closed:async c=>{await limit(c.closed,remaining());await poll(async()=>!(await health()),BOUNDS.auth);checks.crashClosed=true},peerClosed:async()=>{await poll(()=>proc()!==peerIdentity,BOUNDS.auth);checks.peerClosed=true},second:async()=>{stage='RECONNECT';const value=privateRead(env.CMSPARK_DATA_DIR,'ws_secret',256).trim();if(value!==secret)fail();await start();observer.terminate();await auth();checks.sameData=true;return daemon},existing:async()=>{stage='EXISTING_DOCUMENT';const h=await history();if(h.status!=='ok'||h.rows.length!==1||h.rows[0].session_id!==session||h.rows[0].source!=='history'||h.rows[0].history_status!=='interrupted')fail();const o=await waitDOM(`(()=>{const r=${historyObservationExpression(session)};return r.interrupted&&r.noGhost?r:false})()`);checks.existingInterrupted=o.interrupted;checks.noGhost=o.noGhost},reload:async()=>{stage='RELOAD';checks.freshDocument=await reloadDocument(view,nav)},fresh:async()=>{await waitDOM("!!document.querySelector('.cm-header-new')");await openPanel();const o=await waitDOM(`(()=>{const r=${historyObservationExpression(session)};return r.interrupted&&r.noGhost?r:false})()`);checks.reloadedInterrupted=o.interrupted&&o.noGhost},terminal:async()=>{stage='TERMINAL';await startUI();const secondSession=await poll(async()=>{const h=await history();return h.status==='ok'&&h.rows.find(r=>r.session_id!==session&&r.source==='live'&&r.history_status==='running')?.session_id},BOUNDS.tool);await waitDOM("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='停止编程会话'&&!b.disabled)");await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='停止编程会话'&&!b.disabled).click();true");await poll(async()=>{const h=await history();return h.status==='ok'&&h.rows.some(r=>r.session_id===secondSession&&r.terminal_kind==='cancelled'&&r.history_status==='closed')},BOUNDS.tool);await closeOwnedChild(daemon,remaining);const records=JSON.parse(privateRead(env.CMSPARK_DATA_DIR,'acp-history.json')).records;checks.terminalPreserved=Array.isArray(records)&&records.some(r=>r.session_id===secondSession&&r.terminal_kind==='cancelled')&&records.some(r=>r.session_id===session&&r.observed_state==='running')}})
    stage='COMPLETE'
  }catch{/* Fixed receipt only; no protocol, IDs, paths, titles, errors or secrets. */}
  finally {
    // Snapshot before cleanup termination can change either exitCode.
    browserStartup=observeBrowserStartup(browserPhase,chromium,xvfb)
    let clean=true
    for(const socket of observers)socket.terminate()
    for(const c of clients)c.abort()
    try{await limit(Promise.all([...observers].map(s=>s.closed).concat([...clients].map(c=>c.settled))),remaining())}catch{clean=false}
    for(const c of [...children].reverse())try{await closeOwnedChild(c,remaining)}catch{clean=false}
    if(Date.now()>=deadline||abort.signal.aborted)clean=false
    clearTimeout(timer);secret=undefined
    if(owned&&clean){if(!sameOwnedRoot(owned,ownedIdentity))clean=false;else try{fs.rmSync(owned,{recursive:true,force:true})}catch{clean=false}}
    checks.cleanup=clean;if(!clean)stage='CLEANUP'
  }
  Object.assign(console,originalConsole);const out=finiteReceipt(stage,checks,browserStartup);console.log(JSON.stringify(out));return out.passed?0:1
}
let directEntry=false
try{directEntry=!!process.argv[1]&&fs.realpathSync(process.argv[1])===fs.realpathSync(fileURLToPath(import.meta.url))}catch{}
if(directEntry)process.exitCode=await main()
