// Actual serialized worker/target handshake; inert Chrome API events, no browser.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'
import {openNativePanel,choosePanel,installNativePanelWitness,CDP} from '../accept-acp-history-hosted-732.mjs'
const id='a'.repeat(32),url='chrome-extension://'+id+'/sidepanel.html',nonce='b'.repeat(32),key='__cmsparkPanel732_'+nonce,cleanupKey=key+'_cleanup'
// Fixed CFT155 native producer domains: runtime_api.cc:1032–1042 separates
// context UUID from DocumentId=UnguessableToken; base/token.cc:33 uses two
// uppercase %016PRIX64 halves. This is source-derived CPU data, not a recording.
const nativeDocumentId=(high,low)=>[high,low].map(n=>n.toString(16).toUpperCase().padStart(16,'0')).join('')
const documentId=nativeDocumentId(0x0123456789ABCDEFn,0xFEDCBA9876543210n),contextId='22222222-2222-4222-8222-222222222222'
// message_service.cc:620–648 leaves the non-tab normal-extension FrameData
// default; native_renderer_messaging_service.cc:650–658 omits all three fields.
const nativeNonTabSender=()=>({id,url,origin:'chrome-extension://'+id})
class ChromeEvent {listeners=new Set();addListener(fn){this.listeners.add(fn)}removeListener(fn){this.listeners.delete(fn)}emit(value){for(const fn of [...this.listeners])fn(value)}}
function fixture(fault='none') {
  let now=Date.now(),ends=now+1000,opens=0,connected=0,reads=0,frameReads=0,finalNativeReads=0,opened=false,portPhase=false
  const viewEvents=new Map(),emit=(name,value={})=>{for(const fn of [...(viewEvents.get(name)||[])])fn(value)}
  const frame={id:'owned-main-frame',loaderId:'owned-loader',url}
  const timers=new Map(),clock={now:()=>now},schedule=(fn,ms)=>{const token={};timers.set(token,{fn,at:now+ms});return token},cancel=token=>timers.delete(token)
  const advance=ms=>{now+=ms;for(const [token,timer]of [...timers])if(timer.at<=now){timers.delete(token);timer.fn()}}
  const onOpened=new ChromeEvent(),onConnect=new ChromeEvent(),ports=[]
  const row={contextType:'SIDE_PANEL',contextId,documentId,documentUrl:url,documentOrigin:'chrome-extension://'+id,tabId:-1,windowId:-1,frameId:0,incognito:false}
  const contexts=()=>{
    reads++;if(!opened&&fault!=='preexisting')return []
    let result={...row}
    if(fault==='context-tab')result={...result,contextType:'TAB',tabId:7}
    if(fault==='context-popup')result.contextType='POPUP'
    if(fault==='context-window')result.windowId=99
    if(fault==='context-origin')result.documentOrigin='chrome-extension://'+'c'.repeat(32)
    if(fault==='context-frame')result.frameId=1
    if(fault==='context-incognito')result.incognito=true
    if(fault==='context-id-after-port'&&portPhase)result.contextId='33333333-3333-4333-8333-333333333333'
    if(fault==='replacement'&&portPhase||fault==='document-before-port'&&frameReads||fault==='document-after-port'&&portPhase)result.documentId=nativeDocumentId(3n,4n)
    if(fault==='legacy-document-uuid')result.documentId='11111111-1111-4111-8111-111111111111'
    if(fault==='lower-document')result.documentId=documentId.toLowerCase()
    if(fault==='zero-document')result.documentId='0'.repeat(32)
    if(fault==='missing-context')return []
    return fault==='duplicate-context'?[result,{...result}]:[result]
  }
  // Chromium's native onOpened serializes GURL::path(), including the leading
  // slash. getOptions/setOptions use a different, relative resource domain.
  const nativeInfo={windowId:9,path:new URL(url).pathname}
  const chrome={runtime:{getContexts:async filter=>{
    assert.deepEqual(JSON.parse(JSON.stringify(filter)),{contextTypes:['SIDE_PANEL'],documentUrls:[url],documentOrigins:['chrome-extension://'+id]});return contexts()
  },onConnect},sidePanel:{onOpened,open:async options=>{
    opens++;assert.deepEqual(JSON.parse(JSON.stringify(options)),{windowId:9});if(fault==='open-reject')throw Error('SYNTHETIC_OPEN_REJECTED')
    if(fault==='no-event')return
    opened=true;const event={...nativeInfo}
    if(fault==='wrong-window')event.windowId=10
    if(fault==='wrong-path')event.path=new URL('other.html',url).pathname
    if(fault==='relative-path')event.path=new URL(url).pathname.slice(1)
    if(fault==='tab-specific')event.tabId=7
    onOpened.emit(event);if(fault==='duplicate-event')onOpened.emit(event)
  }},tabs:{get:async tab=>({id:tab,windowId:9,url,incognito:false})},debugger:{getTargets:async()=>[
    {id:'pair',type:'page',url,tabId:7},{id:portPhase&&fault==='target-after-port'?'replacement':'candidate',type:'page',url,extensionId:fault==='target-extension'?'c'.repeat(32):id,...(fault==='normal-tab'?{tabId:8}:{})},
    ...(fault==='old-popup'?[{id:'old-popup',type:'page',url,extensionId:id}]:[]),
    ...(fault==='debugger-extra'?[{id:'extra',type:'page',url,extensionId:id}]:[]),
  ]}}
  const targetChrome={runtime:{connect:({name})=>{
    connected++;portPhase=true
    const sender=nativeNonTabSender()
    if(fault==='foreign-sender')sender.id='c'.repeat(32)
    if(fault==='wrong-document')sender.documentId=nativeDocumentId(4n,5n)
    if(fault==='sender-origin')sender.origin='chrome-extension://'+'c'.repeat(32)
    if(fault==='sender-url')sender.url=new URL('other.html',url).href
    if(fault==='legacy-port-fields')Object.assign(sender,{documentId,documentLifecycle:'active',frameId:0})
    if(fault==='tab-sender')sender.tab={id:7}
    if(fault==='inactive-sender')sender.documentLifecycle='cached'
    if(fault==='sender-frame')sender.frameId=1
    const client={name,onDisconnect:new ChromeEvent()},server={name,sender,onDisconnect:new ChromeEvent()};let closed=false
    const disconnect=()=>{if(closed)return;closed=true;client.onDisconnect.emit();server.onDisconnect.emit()};client.disconnect=server.disconnect=disconnect
    ports.push({client,server,closed:()=>closed});queueMicrotask(()=>onConnect.emit(server))
    if(fault==='disconnect')queueMicrotask(disconnect)
    if(fault==='late-port')advance(1001)
    return client
  }}}
  const realm=api=>vm.createContext({chrome:api,Date:clock,setTimeout:schedule,clearTimeout:cancel}),workerRealm=realm(chrome),pairRealm=realm(chrome),targetRealm=realm(targetChrome)
  const execute=(context,expression)=>vm.runInContext(expression,context,{timeout:1000})
  const worker={evaluate:async expression=>{const value=await execute(workerRealm,expression);if(expression.startsWith('chrome.runtime.getContexts(')&&++finalNativeReads===2&&fault==='late-client-close')CDP.prototype.abort.call(view);if(fault==='late-return-navigation'&&portPhase&&frameReads>=4)emit('Page.frameNavigated',{frame:{...frame,loaderId:'late-loader'}});return value}},pairingView={evaluate:async(expression,ms,gesture)=>{assert.equal(gesture,true);assert.match(expression,/^chrome\.sidePanel\.open\(\{windowId:9\}\)$/);return execute(pairRealm,expression)}}
  const view={closed:false,pending:new Map(),events:viewEvents,socket:{terminate(){}},evaluate:async expression=>{
    const result=await execute(targetRealm,expression)
    if(expression.startsWith('(function connectNativePanelWitness(')){
      if(fault==='navigation-after-port'||fault==='navigation-aba')emit('Page.frameNavigated',{frame:{...frame,loaderId:'new-loader'}})
      if(fault==='navigation-aba')emit('Page.frameNavigated',{frame:{...frame}})
      if(fault==='context-clear-after-port')emit('Runtime.executionContextsCleared')
      if(fault==='context-destroy-after-port')emit('Runtime.executionContextDestroyed',{executionContextId:1})
      if(fault==='detach-after-port')emit('Page.frameDetached',{frameId:frame.id})
      if(fault==='inspector-detach-after-port')emit('Inspector.detached')
      if(fault==='loader-after-port')frame.loaderId='changed-loader'
      if(fault==='frame-id-after-port')frame.id='changed-frame'
    }
    if(fault==='cleanup-navigation'&&expression.startsWith('(()=>{const d=Object.getOwnPropertyDescriptor(globalThis,'))emit('Page.frameNavigated',{frame:{...frame,loaderId:'cleanup-navigation'}})
    return result
  },on:(name,fn)=>{let set=viewEvents.get(name);if(!set)viewEvents.set(name,set=new Set());set.add(fn);return()=>set.delete(fn)},call:async(method)=>{
    if(method==='Page.enable'||method==='Runtime.enable')return {}
    assert.equal(method,'Page.getFrameTree');frameReads++
    if(fault==='navigation-before-port')emit('Page.frameNavigated',{frame:{...frame}})
    if(fault==='wrong-frame-url')return {frameTree:{frame:{...frame,url:new URL('other.html',url).href}}}
    if(fault==='missing-loader')return {frameTree:{frame:{...frame,loaderId:''}}}
    return {frameTree:{frame:{...frame}}}
  }},anchor={targetId:'pair',type:'page',url,browserContextId:'own'},candidate={targetId:'candidate',type:'page',url,browserContextId:'own'}
  if(fault==='unknown-profile')delete anchor.browserContextId
  if(fault==='wrong-profile')candidate.browserContextId='foreign'
  if(fault==='missing-profile')delete candidate.browserContextId
  const oldPopup={targetId:'old-popup',type:'page',url,browserContextId:'own'}
  const currentTargets=()=>[{...anchor,...(fault==='pairing-profile-after-port'&&portPhase?{browserContextId:'foreign'}:{})},...(fault==='cdp-missing'||fault==='target-missing-after-port'&&portPhase?[]:[{...candidate,...(portPhase&&fault==='target-after-port'?{targetId:'replacement'}:{})}]),...(fault==='old-popup'?[oldPopup]:[]),...(fault==='cdp-extra'?[{targetId:'extra',type:'page',url,browserContextId:'own'}]:[])]
  const remaining=()=>{if(now>=ends)throw Error('OWNED_TEST_EXPIRED');return ends-now}
  const io={worker,pairingView,tab:7,url,before:[anchor,...(fault==='old-popup'?[oldPopup]:[])].map(row=>({...row})),targets:async()=>currentTargets(),targetSocket:async target=>{assert.equal(target,'candidate');return 'owned-inert'},connect:async()=>view,
    poll:async(fn,ms)=>{assert.ok(ms<=1000);for(let i=0;i<20;i++){const found=await fn();if(found)return found;await Promise.resolve()}advance(1001);throw Error('OWNED_TEST_EXPIRED')},remaining,nonce}
  return {io,view,workerRealm,targetRealm,chrome,row,advance,ports,timers,onOpened,onConnect,counts:()=>({opens,connected,reads,frameReads,finalNativeReads}),clean:()=>{assert.equal([...viewEvents.values()].every(set=>set.size===0),true);assert.equal(onOpened.listeners.size,0);assert.equal(onConnect.listeners.size,0);assert.equal(Object.hasOwn(workerRealm,key),false);assert.equal(Object.hasOwn(workerRealm,cleanupKey),false);assert.equal(Object.hasOwn(targetRealm,key),false);assert.equal(Object.hasOwn(targetRealm,cleanupKey),false);for(const port of ports)assert.equal(port.closed(),true);assert.equal(timers.size,0)}}
}
test('native SidePanel proof executes real serialized onOpened/context/sender lifecycle and closes all witness resources',async()=>{
  const f=fixture();assert.equal(await openNativePanel(f.io),f.view);assert.equal(f.counts().opens,1);assert.equal(f.counts().connected,1);assert.ok(f.counts().reads>=4);assert.ok(f.counts().frameReads>=4);assert.equal(f.view.closed,false);f.clean()
})
for(const moment of ['before-effect','after-effect'])test('installation '+moment+' acknowledgement failure immediately retires only this request',async()=>{
  const f=fixture(),evaluate=f.io.worker.evaluate
  f.io.worker.evaluate=async expression=>{
    if(!expression.startsWith('(async function installNativePanelWitness('))return evaluate(expression)
    if(moment==='after-effect')await evaluate(expression)
    throw Error('SYNTHETIC_INSTALL_ACK_LOST')
  }
  await assert.rejects(openNativePanel(f.io));assert.equal(f.counts().opens,0);assert.equal(f.counts().connected,0)
  // Deliberately no clock advance: explicit retirement, not eventual TTL.
  f.clean()
})
for(const moment of ['before-effect','after-effect'])test('installation '+moment+' failure preserves a replacement without calling its close',async()=>{
  const f=fixture(),evaluate=f.io.worker.evaluate;let closes=0
  const replacement={close(){closes++;return true}}
  f.io.worker.evaluate=async expression=>{
    if(!expression.startsWith('(async function installNativePanelWitness('))return evaluate(expression)
    if(moment==='after-effect')await evaluate(expression)
    f.workerRealm[key]=replacement
    throw Error('SYNTHETIC_INSTALL_ACK_LOST')
  }
  await assert.rejects(openNativePanel(f.io));assert.equal(closes,0);assert.equal(f.workerRealm[key],replacement)
  assert.equal(f.counts().opens,0);delete f.workerRealm[key];f.clean()
})
for(const slot of [key,cleanupKey])test('preoccupied request slot refuses without invoking or deleting foreign cleanup',async()=>{
  const f=fixture();let closes=0;const foreign={close(){closes++;return true}}
  f.workerRealm[slot]=foreign;await assert.rejects(openNativePanel(f.io));assert.equal(closes,0);assert.equal(f.workerRealm[slot],foreign);assert.equal(f.counts().opens,0)
  delete f.workerRealm[slot];f.clean()
})
for(const replacementType of ['object','function','wrong-request'])test('unknown '+replacementType+' cleanup replacement is refused and never invoked',async()=>{
  const f=fixture(),evaluate=f.io.worker.evaluate;let closes=0
  const close=()=>{closes++;return true},foreign=replacementType==='function'?close:replacementType==='wrong-request'?Object.freeze({request:'foreign',close}):{close}
  f.io.worker.evaluate=async expression=>{
    if(!expression.startsWith('(async function installNativePanelWitness('))return evaluate(expression)
    await evaluate(expression);f.workerRealm[cleanupKey]=foreign;throw Error('SYNTHETIC_INSTALL_ACK_LOST')
  }
  await assert.rejects(openNativePanel(f.io));assert.equal(closes,0);assert.equal(f.workerRealm[cleanupKey],foreign);assert.equal(f.counts().opens,0)
  // The original closure remains timer-bounded when its handle is replaced.
  assert.equal(f.onOpened.listeners.size,1);f.advance(1001);assert.equal(f.onOpened.listeners.size,0);assert.equal(f.onConnect.listeners.size,0);assert.equal(f.workerRealm[cleanupKey],foreign)
  delete f.workerRealm[cleanupKey];f.clean()
})
for(const slot of [key,cleanupKey])test('replacement accessor is never executed during request retirement',async()=>{
  const f=fixture(),evaluate=f.io.worker.evaluate;let getters=0
  const getter=()=>{getters++;throw Error('FOREIGN_GETTER_MUST_NOT_RUN')}
  f.io.worker.evaluate=async expression=>{
    if(!expression.startsWith('(async function installNativePanelWitness('))return evaluate(expression)
    await evaluate(expression);Object.defineProperty(f.workerRealm,slot,{get:getter,configurable:true});throw Error('SYNTHETIC_INSTALL_ACK_LOST')
  }
  await assert.rejects(openNativePanel(f.io));assert.equal(getters,0);assert.equal(Object.getOwnPropertyDescriptor(f.workerRealm,slot).get,getter)
  if(slot===cleanupKey)f.advance(1001)
  assert.equal(getters,0);assert.equal(f.onOpened.listeners.size,0);assert.equal(f.onConnect.listeners.size,0)
  delete f.workerRealm[slot];f.clean()
})
test('target preoccupation refuses without disconnecting or deleting foreign state',async()=>{
  const f=fixture();let disconnects=0;const foreign={disconnect(){disconnects++}}
  f.targetRealm[key]=foreign;await assert.rejects(openNativePanel(f.io));assert.equal(disconnects,0);assert.equal(f.targetRealm[key],foreign);assert.equal(f.counts().connected,0)
  delete f.targetRealm[key];f.clean()
})
test('target preoccupied accessor is never read by installation or cleanup',async()=>{
  const f=fixture();let getters=0;const getter=()=>{getters++;return {disconnect(){}}}
  Object.defineProperty(f.targetRealm,key,{get:getter,configurable:true});await assert.rejects(openNativePanel(f.io));assert.equal(getters,0);assert.equal(Object.getOwnPropertyDescriptor(f.targetRealm,key).get,getter);assert.equal(f.counts().connected,0)
  delete f.targetRealm[key];f.clean()
})
test('target lost install ACK immediately closes captured port before delayed onConnect and preserves replacement',async()=>{
  const f=fixture(),evaluate=f.view.evaluate,deliver=f.onConnect.emit.bind(f.onConnect);let disconnects=0;const replacement={disconnect(){disconnects++}},queued=[]
  f.onConnect.emit=port=>queued.push(port)
  f.view.evaluate=async expression=>{
    const result=await evaluate(expression)
    if(expression.startsWith('(function connectNativePanelWitness(')){f.targetRealm[key]=replacement;throw Error('SYNTHETIC_TARGET_ACK_LOST')}
    return result
  }
  await assert.rejects(openNativePanel(f.io));assert.equal(queued.length,1);assert.equal(f.counts().connected,1);assert.equal(disconnects,0);assert.equal(f.targetRealm[key],replacement);assert.equal(f.ports[0].closed(),true)
  assert.equal(f.onConnect.listeners.size,0);for(const port of queued)deliver(port)
  delete f.targetRealm[key];f.clean()
})
test('target rejection before installation has no port or foreign cleanup effects',async()=>{
  const f=fixture(),evaluate=f.view.evaluate
  f.view.evaluate=async expression=>{if(expression.startsWith('(function connectNativePanelWitness('))throw Error('SYNTHETIC_TARGET_INSTALL_REJECTED');return evaluate(expression)}
  await assert.rejects(openNativePanel(f.io));assert.equal(f.counts().connected,0);f.clean()
})
test('target preoccupied cleanup record refuses without invoking or removing it',async()=>{
  const f=fixture();let closes=0;const foreign={close(){closes++;return true}}
  f.targetRealm[cleanupKey]=foreign;await assert.rejects(openNativePanel(f.io));assert.equal(closes,0);assert.equal(f.targetRealm[cleanupKey],foreign);assert.equal(f.counts().connected,0)
  delete f.targetRealm[cleanupKey];f.clean()
})
test('target primary accessor replacement never executes during captured-port close',async()=>{
  const f=fixture(),evaluate=f.view.evaluate;let getters=0;const getter=()=>{getters++;return {disconnect(){}}}
  f.onConnect.emit=()=>{}
  f.view.evaluate=async expression=>{
    const result=await evaluate(expression)
    if(expression.startsWith('(function connectNativePanelWitness(')){Object.defineProperty(f.targetRealm,key,{get:getter,configurable:true});throw Error('SYNTHETIC_TARGET_ACK_LOST')}
    return result
  }
  await assert.rejects(openNativePanel(f.io));assert.equal(getters,0);assert.equal(Object.getOwnPropertyDescriptor(f.targetRealm,key).get,getter);assert.equal(f.ports[0].closed(),true)
  delete f.targetRealm[key];f.clean()
})
for(const kind of ['object','function','wrong-request','accessor'])test('unknown target '+kind+' cleanup handle is not invoked and retains original bounded cleanup',async()=>{
  const f=fixture(),evaluate=f.view.evaluate;let invoked=0
  const close=()=>{invoked++;return true},foreign=kind==='function'?close:kind==='wrong-request'?Object.freeze({request:'foreign',close}):{close}
  const getter=()=>{invoked++;return foreign};f.onConnect.emit=()=>{}
  f.view.evaluate=async expression=>{
    const result=await evaluate(expression)
    if(expression.startsWith('(function connectNativePanelWitness(')){
      if(kind==='accessor')Object.defineProperty(f.targetRealm,cleanupKey,{get:getter,configurable:true})
      else f.targetRealm[cleanupKey]=foreign
      throw Error('SYNTHETIC_TARGET_ACK_LOST')
    }
    return result
  }
  await assert.rejects(openNativePanel(f.io));assert.equal(invoked,0);assert.equal(f.ports[0].closed(),false)
  f.advance(1001);assert.equal(invoked,0);assert.equal(f.ports[0].closed(),true)
  const d=Object.getOwnPropertyDescriptor(f.targetRealm,cleanupKey);assert.equal(kind==='accessor'?d.get:d.value,kind==='accessor'?getter:foreign)
  delete f.targetRealm[cleanupKey];f.clean()
})
for(const fault of ['preexisting','wrong-window','wrong-path','relative-path','tab-specific','duplicate-event','context-tab','context-popup','context-window','context-origin','context-frame','context-incognito','duplicate-context','foreign-sender','wrong-document','tab-sender','inactive-sender','sender-frame','replacement','disconnect','late-port','no-event','open-reject','normal-tab','legacy-document-uuid','lower-document','zero-document','legacy-port-fields','sender-origin','sender-url','missing-context','old-popup','debugger-extra','cdp-extra','cdp-missing','unknown-profile','wrong-profile','missing-profile','target-extension','navigation-before-port','navigation-after-port','navigation-aba','context-clear-after-port','context-destroy-after-port','detach-after-port','inspector-detach-after-port','loader-after-port','wrong-frame-url','missing-loader','document-before-port','document-after-port','target-after-port','late-return-navigation','context-id-after-port','frame-id-after-port','target-missing-after-port','pairing-profile-after-port','cleanup-navigation','late-client-close'])test('native provenance refuses '+fault+' and retires the request-local listeners/port',async()=>{
  const f=fixture(fault);await assert.rejects(openNativePanel(f.io));if(fault==='late-client-close'){assert.equal(f.view.closed,true);assert.equal(f.counts().finalNativeReads,2)}f.advance(1001);f.clean();assert.ok(f.counts().opens<=1)
  if(['preexisting','wrong-window','wrong-path','relative-path','tab-specific','duplicate-event','context-tab','context-popup','context-window','context-origin','context-frame','context-incognito','duplicate-context','no-event','open-reject','normal-tab'].includes(fault))assert.equal(f.counts().connected,0)
})
test('the old target heuristic alone accepts a non-tab extension view; new whole producer requires native event provenance',async()=>{
  const before=[{targetId:'pair',type:'page',url,browserContextId:'own'}],after=[...before,{targetId:'candidate',type:'page',url,browserContextId:'own'}]
  assert.equal(choosePanel(before,after,url,[{id:'pair',type:'page',url,tabId:7},{id:'candidate',type:'page',url,extensionId:id}],7),'candidate')
  const f=fixture('no-event');await assert.rejects(openNativePanel(f.io));assert.equal(f.counts().connected,0);f.advance(1001);f.clean()
})
test('late native event cannot revive a disposed witness or remove its replacement',async()=>{
  const f=fixture(),spec={key,port:'cmspark-panel-proof732-'+nonce,url,windowId:9,ms:1000}
  await installNativePanelWitness(f.chrome,f.workerRealm,spec);const old=f.workerRealm[key],replacement={owned:'later-request'}
  const replacementCleanup={owned:'later-cleanup'}
  f.workerRealm[key]=replacement;f.workerRealm[cleanupKey]=replacementCleanup;old.close();f.onOpened.emit({windowId:9,path:new URL(url).pathname});await Promise.resolve();assert.equal(f.workerRealm[key],replacement);assert.equal(f.workerRealm[cleanupKey],replacementCleanup);assert.equal(f.onOpened.listeners.size,0);assert.equal(f.onConnect.listeners.size,0);delete f.workerRealm[key];delete f.workerRealm[cleanupKey]
})
test('source keeps real business/daemon restart assertions and shares the unchanged navigation deadline',()=>{
  const source=fs.readFileSync(new URL('../accept-acp-history-hosted-732.mjs',import.meta.url),'utf8')
  assert.equal(source.includes('chrome.windows.getCurrent().then(w=>chrome.sidePanel.open'),false)
  assert.equal(source.includes("remaining:nav,nonce:crypto.randomBytes(16).toString('hex')"),true)
  for(const literal of ['checks.durable=true','checks.crashClosed=true','checks.peerClosed=true','checks.existingInterrupted=o.interrupted','checks.reloadedInterrupted=o.interrupted&&o.noGhost','checks.terminalPreserved='])assert.equal(source.includes(literal),true,literal)
  assert.equal(source.includes('BROWSER_PANEL_FALLBACK'),false)
})

test('fixed155 source-derived DTO domains keep native token separate and non-tab sender fields absent',()=>{
  assert.match(documentId,/^[0-9A-F]{32}$/);assert.notEqual(documentId,'0'.repeat(32));assert.match(contextId,/^[a-f0-9-]{36}$/)
  const sender=nativeNonTabSender();assert.deepEqual(Object.keys(sender).sort(),['id','origin','url'])
  for(const field of ['tab','frameId','documentId','documentLifecycle'])assert.equal(Object.hasOwn(sender,field),false)
})

// The original root whole-set counterexamples use the actual exported selector,
// independently of the earlier context/port checks that could mask these faults.
const targetPage=(targetId,profile='owned-profile')=>({targetId,type:'page',url,browserContextId:profile})
const nativeTarget=(targetId,tabId)=>({id:targetId,type:'page',url,...(tabId===undefined?{extensionId:id}:{tabId})})
test('joint target set coherent fresh panel calibration',()=>{
  const before=[targetPage('pair')],after=[...before,targetPage('native')]
  assert.equal(choosePanel(before,after,url,[nativeTarget('pair',7),nativeTarget('native')]),'native')
})
test('joint target set refuses an old same-URL popup alongside the fresh genuine panel',()=>{
  const before=[targetPage('pair'),targetPage('old-popup')],after=[...before,targetPage('native')]
  assert.throws(()=>choosePanel(before,after,url,[nativeTarget('pair',7),nativeTarget('old-popup'),nativeTarget('native')]))
})
test('joint target set refuses undefined profile equality as positive provenance',()=>{
  const pair=targetPage('pair'),panel=targetPage('native');delete pair.browserContextId;delete panel.browserContextId
  assert.throws(()=>choosePanel([pair],[pair,panel],url,[nativeTarget('pair',7),nativeTarget('native')]))
})

test('joint target set retains prior-target refusal after complete native and CDP agreement',()=>{
  const rows=[targetPage('pair'),targetPage('native')],debug=[nativeTarget('pair',7),nativeTarget('native')]
  assert.throws(()=>choosePanel(rows,rows,url,debug,7))
})
test('joint target set must anchor the actual owned pairing tab when it is supplied',()=>{
  const before=[targetPage('pair')],after=[...before,targetPage('native')],debug=[nativeTarget('pair',8),nativeTarget('native')]
  assert.throws(()=>choosePanel(before,after,url,debug,7))
})

// EventRouter and RequestWorker share the worker proxy associated group; CDP
// script replies do not. Only the external delivery order is controlled here.
for(const mode of ['delayed','barrier-reject','barrier-context'])test('browser listener registration response barrier '+mode,async()=>{
  const f=fixture(),add=f.onOpened.addListener.bind(f.onOpened),emit=f.onOpened.emit.bind(f.onOpened),get=f.chrome.runtime.getContexts
  let browserInstalled=false,pending=false,responses=0,drops=0
  f.onOpened.addListener=fn=>{add(fn);pending=true}
  f.onOpened.emit=info=>{if(browserInstalled)emit(info);else drops++}
  f.chrome.runtime.getContexts=async filter=>{
    if(pending&&!browserInstalled){browserInstalled=true;responses++;if(mode==='barrier-reject')throw Error('SYNTHETIC_BROWSER_RESPONSE_REFUSED');if(mode==='barrier-context')return [f.row]}
    return get(filter)
  }
  if(mode==='delayed'){assert.equal(await openNativePanel(f.io),f.view);assert.equal(responses,1);assert.equal(drops,0);assert.equal(f.counts().connected,1)}
  else {await assert.rejects(openNativePanel(f.io));assert.equal(f.counts().opens,0);assert.equal(f.counts().connected,0)}
  f.clean()
})
