// Actual serialized worker/target handshake; inert Chrome API events, no browser.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'
import {openNativePanel,choosePanel,installNativePanelWitness} from '../accept-acp-history-hosted-732.mjs'
const id='a'.repeat(32),url='chrome-extension://'+id+'/sidepanel.html',nonce='b'.repeat(32),key='__cmsparkPanel732_'+nonce,cleanupKey=key+'_cleanup'
const documentId='11111111-1111-4111-8111-111111111111',contextId='22222222-2222-4222-8222-222222222222'
class ChromeEvent {listeners=new Set();addListener(fn){this.listeners.add(fn)}removeListener(fn){this.listeners.delete(fn)}emit(value){for(const fn of [...this.listeners])fn(value)}}
function fixture(fault='none') {
  let now=Date.now(),ends=now+1000,opens=0,connected=0,reads=0,opened=false,portPhase=false
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
    if(fault==='replacement'&&portPhase)result.documentId='33333333-3333-4333-8333-333333333333'
    return fault==='duplicate-context'?[result,{...result}]:[result]
  }
  const nativeInfo={windowId:9,path:'sidepanel.html'}
  const chrome={runtime:{getContexts:async filter=>{
    assert.deepEqual(JSON.parse(JSON.stringify(filter)),{contextTypes:['SIDE_PANEL'],documentUrls:[url],documentOrigins:['chrome-extension://'+id]});return contexts()
  },onConnect},sidePanel:{onOpened,open:async options=>{
    opens++;assert.deepEqual(JSON.parse(JSON.stringify(options)),{windowId:9});if(fault==='open-reject')throw Error('SYNTHETIC_OPEN_REJECTED')
    if(fault==='no-event')return
    opened=true;const event={...nativeInfo}
    if(fault==='wrong-window')event.windowId=10
    if(fault==='wrong-path')event.path='other.html'
    if(fault==='tab-specific')event.tabId=7
    onOpened.emit(event);if(fault==='duplicate-event')onOpened.emit(event)
  }},tabs:{get:async tab=>({id:tab,windowId:9,url,incognito:false})},debugger:{getTargets:async()=>[
    {id:'pair',type:'page',url,tabId:7},{id:'candidate',type:'page',url,extensionId:id,...(fault==='normal-tab'?{tabId:8}:{})},
  ]}}
  const targetChrome={runtime:{connect:({name})=>{
    connected++;portPhase=true
    const sender={id,url,origin:'chrome-extension://'+id,documentId,documentLifecycle:'active',frameId:0}
    if(fault==='foreign-sender')sender.id='c'.repeat(32)
    if(fault==='wrong-document')sender.documentId='44444444-4444-4444-8444-444444444444'
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
  const worker={evaluate:async expression=>execute(workerRealm,expression)},pairingView={evaluate:async(expression,ms,gesture)=>{assert.equal(gesture,true);assert.match(expression,/^chrome\.sidePanel\.open\(\{windowId:9\}\)$/);return execute(pairRealm,expression)}}
  const view={evaluate:async expression=>execute(targetRealm,expression)},anchor={targetId:'pair',url,browserContextId:'own'},candidate={targetId:'candidate',url,browserContextId:'own'}
  const remaining=()=>{if(now>=ends)throw Error('OWNED_TEST_EXPIRED');return ends-now}
  const io={worker,pairingView,tab:7,url,before:[anchor],targets:async()=>[anchor,candidate],targetSocket:async target=>{assert.equal(target,'candidate');return 'owned-inert'},connect:async()=>view,
    poll:async(fn,ms)=>{assert.ok(ms<=1000);for(let i=0;i<20;i++){const found=await fn();if(found)return found;await Promise.resolve()}advance(1001);throw Error('OWNED_TEST_EXPIRED')},remaining,nonce}
  return {io,view,workerRealm,targetRealm,chrome,row,advance,ports,timers,onOpened,onConnect,counts:()=>({opens,connected,reads}),clean:()=>{assert.equal(onOpened.listeners.size,0);assert.equal(onConnect.listeners.size,0);assert.equal(Object.hasOwn(workerRealm,key),false);assert.equal(Object.hasOwn(workerRealm,cleanupKey),false);assert.equal(Object.hasOwn(targetRealm,key),false);assert.equal(Object.hasOwn(targetRealm,cleanupKey),false);for(const port of ports)assert.equal(port.closed(),true);assert.equal(timers.size,0)}}
}
test('native SidePanel proof executes real serialized onOpened/context/sender lifecycle and closes all witness resources',async()=>{
  const f=fixture();assert.equal(await openNativePanel(f.io),f.view);assert.equal(f.counts().opens,1);assert.equal(f.counts().connected,1);assert.ok(f.counts().reads>=4);f.clean()
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
for(const fault of ['preexisting','wrong-window','wrong-path','tab-specific','duplicate-event','context-tab','context-popup','context-window','context-origin','context-frame','context-incognito','duplicate-context','foreign-sender','wrong-document','tab-sender','inactive-sender','sender-frame','replacement','disconnect','late-port','no-event','open-reject','normal-tab'])test('native provenance refuses '+fault+' and retires the request-local listeners/port',async()=>{
  const f=fixture(fault);await assert.rejects(openNativePanel(f.io));f.advance(1001);f.clean();assert.ok(f.counts().opens<=1)
  if(['preexisting','wrong-window','wrong-path','tab-specific','duplicate-event','context-tab','context-popup','context-window','context-origin','context-frame','context-incognito','duplicate-context','no-event','open-reject','normal-tab'].includes(fault))assert.equal(f.counts().connected,0)
})
test('the old target heuristic alone accepts a non-tab extension view; new whole producer requires native event provenance',async()=>{
  const before=[{targetId:'pair',url,browserContextId:'own'}],after=[...before,{targetId:'candidate',url,browserContextId:'own'}]
  assert.equal(choosePanel(before,after,url,[{id:'pair',url,tabId:7},{id:'candidate',url,extensionId:id}]),'candidate')
  const f=fixture('no-event');await assert.rejects(openNativePanel(f.io));assert.equal(f.counts().connected,0);f.advance(1001);f.clean()
})
test('late native event cannot revive a disposed witness or remove its replacement',async()=>{
  const f=fixture(),spec={key,port:'cmspark-panel-proof732-'+nonce,url,windowId:9,ms:1000}
  await installNativePanelWitness(f.chrome,f.workerRealm,spec);const old=f.workerRealm[key],replacement={owned:'later-request'}
  const replacementCleanup={owned:'later-cleanup'}
  f.workerRealm[key]=replacement;f.workerRealm[cleanupKey]=replacementCleanup;old.close();f.onOpened.emit({windowId:9,path:'sidepanel.html'});await Promise.resolve();assert.equal(f.workerRealm[key],replacement);assert.equal(f.workerRealm[cleanupKey],replacementCleanup);assert.equal(f.onOpened.listeners.size,0);assert.equal(f.onConnect.listeners.size,0);delete f.workerRealm[key];delete f.workerRealm[cleanupKey]
})
test('source keeps real business/daemon restart assertions and shares the unchanged navigation deadline',()=>{
  const source=fs.readFileSync(new URL('../accept-acp-history-hosted-732.mjs',import.meta.url),'utf8')
  assert.equal(source.includes('chrome.windows.getCurrent().then(w=>chrome.sidePanel.open'),false)
  assert.equal(source.includes("remaining:nav,nonce:crypto.randomBytes(16).toString('hex')"),true)
  for(const literal of ['checks.durable=true','checks.crashClosed=true','checks.peerClosed=true','checks.existingInterrupted=o.interrupted','checks.reloadedInterrupted=o.interrupted&&o.noGhost','checks.terminalPreserved='])assert.equal(source.includes(literal),true,literal)
  assert.equal(source.includes('BROWSER_PANEL_FALLBACK'),false)
})
