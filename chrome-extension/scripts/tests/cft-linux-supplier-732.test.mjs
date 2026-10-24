import test from 'node:test'
import * as supplier from '../cft-linux-supplier-732.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { PIN,SOURCE_PIN_SHA256,validateFixedLayout,createOwnedLedger,downloadFixedArchive,supplierReceipt,runPinnedPipeline,observeSupplierChild,observeDisplayReady,displayReadyProjection,runSupplierWitness } from '../cft-linux-supplier-732.mjs'
import {devToolsPortSnapshot,childEnvironment,chromeArgs,limit} from '../accept-acp-history-hosted-732.mjs'
const source=new URL('../accept-acp-history-hosted-732.mjs',import.meta.url)
test('actual direct entry reaches the current single-business admission',async()=>{
  const text=fs.readFileSync(source,'utf8'),line=text.split('\n').find(x=>x.startsWith('if(directEntry)process.exitCode=await ')),calls=[]
  assert.ok(line)
  const ctx={directEntry:true,process:{},main:async()=>{calls.push('business');return 0},pinnedEntry:async()=>{calls.push('supply','business');return 0}}
  await vm.runInNewContext('(async()=>{'+line+'})()',ctx)
  assert.deepEqual(calls,['supply','business'])
})
test('fixed source declares exactly the admitted archive and member/layout bounds',()=>{
  assert.equal(PIN.members.length,309);assert.equal(PIN.totalMemberBytes,417963103);assert.equal(PIN.archiveBytes,199014491)
  assert.equal(PIN.version,'155.0.8059.84');assert.equal(PIN.archiveSHA256,'cf0f049892dea22e6a6db26d47ed0d7776b7158edcbec4634086633df8bafcbc')
  assert.equal(PIN.members.find(x=>x.path===PIN.executable).sha256,PIN.executableSHA256)
  assert.equal(Object.isFrozen(PIN.members[0]),true)
})
test('receipt never executes getters or emits bodies/paths and cannot fake complete',()=>{
  let reads=0;const facts={childCount:2,private:'SECRET'};Object.defineProperty(facts,'cleanup',{get(){reads++;return true}})
  const r=supplierReceipt('COMPLETE',facts);assert.equal(reads,0);assert.equal(r.passed,false);assert.equal(JSON.stringify(r).includes('SECRET'),false);assert.equal(r.sourcePinSHA256,SOURCE_PIN_SHA256);assert.ok(Buffer.byteLength(JSON.stringify(r))<=1024)
  assert.throws(()=>supplierReceipt('UNKNOWN'))
  assert.equal(supplierReceipt('COMPLETE',{childCount:2,portReady:true,versionObserved:true,allClosed:true,bothEOF:true,cleanup:true}).passed,true)
})
function displayChild(){
  const c=Object.assign(new EventEmitter(),{exitCode:null,signalCode:null,stdio:[null,null,null,new EventEmitter()]})
  c.stdio[3].resume=()=>{};return c
}
for(const event of ['end','close','pipe-error','child-error','child-close'])test('display readiness promptly rejects terminal observation before a frame: '+event,async()=>{
  const c=displayChild(),p=c.stdio[3],d=observeDisplayReady(c),rejected=assert.rejects(d.ready,{message:'DISPLAY_REFUSED'})
  if(event==='pipe-error')p.emit('error',Error('PRIVATE'))
  else if(event==='child-error')c.emit('error',Error('PRIVATE'))
  else if(event==='child-close'){c.exitCode=23;c.emit('close',23,null)}
  else p.emit(event)
  await rejected;assert.equal(d.isLive(),false);assert.equal(p.listenerCount('data'),0)
  const before=d.snapshot();c.emit('close',23,null);p.emit('error',Error('PRIVATE_LATE'));p.emit('end')
  assert.equal(d.snapshot().state,before.state);assert.equal(JSON.stringify(d.snapshot()).includes('PRIVATE'),false)
})
test('display readiness accepts split decimal frame and normal fd3 EOF only while its child is alive',async()=>{
  const c=displayChild(),p=c.stdio[3],d=observeDisplayReady(c)
  for(const b of ['1','23','\n'])p.emit('data',Buffer.from(b))
  assert.equal(await d.ready,':123');p.emit('end');p.emit('close')
  assert.equal(d.isLive(),true);assert.equal(d.snapshot().eof,true);assert.equal(p.listenerCount('data'),0)
  const before=d.snapshot();c.signalCode='SIGTERM';c.emit('close',null,'SIGTERM')
  assert.equal(d.isLive(),false);assert.equal(before.closed,false);assert.equal(before.signal,'NONE');assert.equal(d.snapshot().closed,true)
})
test('display exit observation does not discard trailing frame data but cannot authorize a dead display',async()=>{
  const c=displayChild(),p=c.stdio[3],d=observeDisplayReady(c)
  c.exitCode=0;c.emit('exit',0,null);p.emit('data',Buffer.from('12\n'))
  assert.equal(await d.ready,':12');assert.equal(d.isLive(),false)
  c.emit('close',0,null);assert.equal(d.snapshot().state,'CHILD_CLOSED')
})
for(const bytes of [Buffer.from('12'),Buffer.from('123456\n'),Buffer.from('1\r\n'),Buffer.from('1\n2'),Buffer.alloc(9,49),Buffer.from([0xb1,10])])test('display refuses incomplete or invalid fd3 bytes '+bytes.toString('hex'),async()=>{
  const c=displayChild(),p=c.stdio[3],d=observeDisplayReady(c),rejected=assert.rejects(d.ready,{message:'DISPLAY_REFUSED'})
  p.emit('data',bytes);p.emit('end');await rejected;assert.equal(d.isLive(),false);assert.ok(d.snapshot().bytes<=9)
})
test('display diagnostics project only fixed scalars without executing getters or becoming pass authority',()=>{
  let reads=0;const value={state:'PRIVATE',bytes:100,exitCode:'23',signal:'PRIVATE',raw:'PRIVATE'}
  Object.defineProperty(value,'closed',{get(){reads++;throw Error('PRIVATE')}})
  const r=displayReadyProjection(value);assert.equal(reads,0);assert.equal(r.state,null);assert.equal(r.bytes,null);assert.equal(r.closed,false);assert.equal(r.exitCode,null)
  assert.equal(JSON.stringify(r).includes('PRIVATE'),false)
  assert.equal(displayReadyProjection(new Proxy({},{getOwnPropertyDescriptor(){throw Error('PRIVATE')}})).state,null)
  const receipt=supplierReceipt('XVFB',{display:{state:'READY',bytes:3,eof:true,exitCode:0,closed:true,signal:'NONE'}})
  assert.equal(receipt.passed,false);assert.equal(receipt.display.state,'READY');assert.ok(Buffer.byteLength(JSON.stringify(receipt))<1024)
})
test('actual private supplier display producer uses the shared readiness lifecycle',async()=>{
  // The independent producer was retired. Consume the real main factory and its
  // display -> liveness -> pinned binary startup segment, not a deleted marker.
  const text=fs.readFileSync(source,'utf8'),factoryStart=text.indexOf('  const child='),factoryEnd=text.indexOf('\n  const connect=',factoryStart),start=text.indexOf("    stage='BROWSER';"),end=text.indexOf('    const parts=await poll',start)
  assert.ok(factoryStart>0&&factoryEnd>factoryStart&&start>factoryEnd&&end>start)
  const factory=text.slice(factoryStart,factoryEnd),segment=text.slice(start,end)
  function actual(mode){
    const display=displayChild(),chrome=Object.assign(new EventEmitter(),{exitCode:null,signalCode:null})
    for(const c of [display,chrome])for(const key of ['stdout','stderr']){c[key]=new EventEmitter();c[key].resume=()=>{}}
    const order=[],states=new Map(),env={},remaining=()=>100;let observed
    const context={path,env,remaining,owned:'/owned',extension:'/owned/extension',input:{},stage:'PREFLIGHT',browserPhase:null,xvfb:undefined,chromium:undefined,display:undefined,children:new Set(),supplierStates:states,observeSupplierChild,awaitSupplierChildClosed:supplier.awaitSupplierChildClosed,observeDisplayReady(child){observed=observeDisplayReady(child);return observed},limit,chromeArgs,childEnvironment,
      fail(){throw Error('OWNED_ACCEPTANCE_REFUSED')},activeSupplier:{binary:'/owned/fixed/chrome',check(value){assert.equal(value,remaining);order.push('pin');if(mode==='pin')throw Error('INERT_PIN_REFUSED')}},
      spawn(exe,args,options){
        if(exe==='/usr/bin/Xvfb'){order.push('display');assert.deepEqual(Array.from(args),['-displayfd','3','-screen','0','1280x800x24','-nolisten','tcp']);assert.equal(options.env,env);assert.deepEqual(Array.from(options.stdio),['ignore','pipe','pipe','pipe']);return display}
        order.push('browser');assert.equal(exe,'/owned/fixed/chrome');assert.deepEqual(Array.from(args),chromeArgs('/owned','/owned/extension'));assert.equal(options.env.HOME,undefined);assert.equal(options.env.DISPLAY,':23');assert.deepEqual(Array.from(options.stdio),['ignore','pipe','pipe']);return chrome
      }}
    const pending=vm.runInNewContext(`(async()=>{${factory}\n${segment};return {xvfb,chromium,screen,browserPhase}})()`,context)
    return {display,chrome,order,states,pending,observed:()=>observed}
  }
  const ended=actual('end'),rejected=assert.rejects(ended.pending,{message:'DISPLAY_REFUSED'})
  ended.display.stdio[3].emit('end');await rejected;assert.equal(ended.observed().isLive(),false);assert.equal(ended.states.get(ended.display).child,ended.display);assert.deepEqual(ended.order,['display'])
  const dead=actual('dead'),notLive=assert.rejects(dead.pending,{message:'OWNED_ACCEPTANCE_REFUSED'})
  dead.display.exitCode=0;dead.display.emit('exit',0,null);dead.display.stdio[3].emit('data',Buffer.from('23\n'));await notLive;assert.equal(dead.observed().isLive(),false);assert.deepEqual(dead.order,['display'])
  const pin=actual('pin'),pinRejected=assert.rejects(pin.pending,{message:'INERT_PIN_REFUSED'})
  pin.display.stdio[3].emit('data',Buffer.from('23\n'));await pinRejected;assert.deepEqual(pin.order,['display','pin'])
  const ready=actual('ready');for(const b of ['2','3','\n'])ready.display.stdio[3].emit('data',Buffer.from(b))
  const result=await ready.pending;assert.equal(result.xvfb,ready.display);assert.equal(result.chromium,ready.chrome);assert.equal(result.screen,':23');assert.equal(ready.observed().isLive(),true);assert.deepEqual(ready.order,['display','pin','browser']);assert.equal(ready.states.size,2)
})

function flow(overrides={}){const calls=[],bundle={check(){calls.push('check')},dispose(){calls.push('dispose')}},io={supply:async()=>{calls.push('supply');return bundle},witness:async b=>{assert.equal(b,bundle);calls.push('witness');return true},business:async b=>{assert.equal(b,bundle);calls.push('business');return 0},...overrides};return {calls,bundle,io}}
test('actual pipeline orders one supply/witness/business and disposes exactly once',async()=>{const s=flow();assert.equal(await runPinnedPipeline(s.io),0);assert.deepEqual(s.calls,['supply','witness','business','dispose'])})
for(const point of ['supply','witness','business'])test('failed '+point+' refuses downstream and preserves cleanup',async()=>{const s=flow();s.io[point]=async()=>{s.calls.push(point);throw Error('PRIVATE')};assert.equal(await runPinnedPipeline(s.io),1);assert.equal(s.calls.filter(x=>x===point).length,1);if(point!=='business')assert.equal(s.calls.includes('business'),false);assert.equal(s.calls.includes('dispose'),point!=='supply')})
test('false witness or failed bundle cleanup can never pass business',async()=>{const a=flow({witness:async()=>false});assert.equal(await runPinnedPipeline(a.io),1);assert.equal(a.calls.includes('business'),false);const b=flow();b.bundle.dispose=()=>{throw Error('PRIVATE')};assert.equal(await runPinnedPipeline(b.io),1)})
function scratch(){const p=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'owned-cft732-cpu-')));fs.chmodSync(p,0o700);return p}
test('owned ledger exclusively creates and removes its complete declared tree',()=>{const p=scratch();try{const l=createOwnedLedger(p);l.mkdir('child');const a=l.open('child/data');fs.writeSync(a.fd,'inert');l.finalize(a.file,a.fd,0o400);fs.closeSync(a.fd);assert.equal(l.inventory(),true);assert.throws(()=>l.open('child/data'));assert.throws(()=>l.open('../escape'));l.dispose();assert.equal(fs.existsSync(l.root),false);l.dispose()}finally{fs.rmdirSync(p)}})
test('unknown extra file makes cleanup refuse without deleting it or owned bytes',()=>{const p=scratch();try{const l=createOwnedLedger(p),a=l.open('data');fs.closeSync(a.fd);fs.writeFileSync(path.join(l.root,'foreign'),'foreign');assert.throws(()=>l.dispose());assert.equal(fs.existsSync(a.file),true);assert.equal(fs.existsSync(path.join(l.root,'foreign')),true);fs.unlinkSync(path.join(l.root,'foreign'));l.dispose()}finally{fs.rmdirSync(p)}})
test('replaced inode or symlink makes cleanup refuse with zero foreign deletion',()=>{const p=scratch();try{for(const link of [false,true]){const l=createOwnedLedger(p),a=l.open('data');fs.closeSync(a.fd);fs.renameSync(a.file,a.file+'.old');if(link)fs.symlinkSync(a.file+'.old',a.file);else fs.writeFileSync(a.file,'replacement');assert.throws(()=>l.dispose());assert.equal(fs.lstatSync(a.file).isSymbolicLink(),link);fs.unlinkSync(a.file);fs.renameSync(a.file+'.old',a.file);l.dispose()}}finally{fs.rmdirSync(p)}})
for(const status of [301,302,206,404])test('download rejects HTTP '+status+' without retry/redirect',async()=>{const p=scratch();try{const l=createOwnedLedger(p);let requests=0;const request=(_url,cb)=>{requests++;const req=new EventEmitter();req.destroy=()=>{};queueMicrotask(()=>cb({statusCode:status,headers:{},destroy(){}}));return req};await assert.rejects(downloadFixedArchive(l,()=>100,request));assert.equal(requests,1);l.dispose()}finally{fs.rmdirSync(p)}})
test('download rejects nonexact length or encoding before processing any body',async()=>{const p=scratch();try{for(const headers of [{'content-length':'1'},{'content-length':String(PIN.archiveBytes),'content-encoding':'gzip'}]){const l=createOwnedLedger(p);const request=(_u,cb)=>{const req=new EventEmitter();queueMicrotask(()=>cb({statusCode:200,headers,destroy(){}}));return req};await assert.rejects(downloadFixedArchive(l,()=>100,request));l.dispose()}}finally{fs.rmdirSync(p)}})
test('fixed layout refuses truncated first header before any extraction',()=>{const p=scratch(),file=path.join(p,'inert');try{fs.writeFileSync(file,Buffer.alloc(30));const fd=fs.openSync(file,'r');try{assert.throws(()=>validateFixedLayout(fd,()=>100))}finally{fs.closeSync(fd)}}finally{fs.unlinkSync(file);fs.rmdirSync(p)}})
function witness(mode='good'){
  let clock=0,removes=0,closedClients=0,calls=0;const states=[],order=[]
  function child(){const c=new EventEmitter();c.exitCode=null;c.signalCode=null;for(const key of ['stdout','stderr']){c[key]=new EventEmitter();c[key].resume=()=>{}}
    c.kill=()=>{if(mode==='killfalse')return false;c.exitCode=0;if(mode!=='missingEOF')for(const key of ['stdout','stderr'])c[key].emit('end');c.emit('close');return true};const s=observeSupplierChild(c);states.push(s);return s}
  const clients=new Set(),io={deadline:100,remaining:()=>100,now:()=>clock,wait:async n=>{clock+=n},parsePort:devToolsPortSnapshot,checkPayload(){order.push('check');if(mode==='pin')throw Error('PRIVATE')},display(){order.push('display');const state=child();state.child.stdio=[null,null,null,new EventEmitter()];state.child.stdio[3].resume=()=>{};const display=observeDisplayReady(state.child);queueMicrotask(()=>state.child.stdio[3].emit('data',Buffer.from('1\n')));return {state,...display}},browser(){order.push('browser');return child()},readPort:()=>mode==='port'?'1234\n/devtools/browser/short':'1234\n/devtools/browser/12345678-1234-1234-1234-123456789abc',async connect(){order.push('connect');const c={settled:Promise.resolve(),abort(){},async call(name,_args,ms){assert.equal(name,'Browser.getVersion');assert.ok(ms<=5000);calls++;return {product:mode==='version'?'Chrome/154.0.0.0':'Chrome/'+PIN.version}}};clients.add(c);if(mode==='connect')throw Error('PRIVATE');return c},async closeClients(){for(const c of clients)c.abort();closedClients++;if(mode==='clients')throw Error('PRIVATE')},removeOwned(){removes++;order.push('remove')}}
  return {io,states,order,calls:()=>calls,removes:()=>removes,closedClients:()=>closedClients}
}
test('actual witness requires complete UUID, exact CDP product, two real close/EOF states',async()=>{const s=witness(),r=await runSupplierWitness(s.io);assert.equal(r.passed,true);assert.equal(r.childCount,2);assert.equal(s.calls(),1);assert.equal(s.removes(),1);assert.ok(s.states.every(x=>x.closed&&x.stdoutEOF&&x.stderrEOF));assert.deepEqual(s.order,['check','display','browser','connect','check','remove'])})
test('actual witness refuses a ready frame from an already closed display before browser creation',async()=>{
  const s=witness(),display=s.io.display
  s.io.display=()=>{const d=display();d.state.child.exitCode=23;d.state.child.emit('close',23,null);for(const key of ['stdout','stderr'])d.state.child[key].emit('end');return d}
  const r=await runSupplierWitness(s.io);assert.equal(r.passed,false);assert.equal(r.phase,'XVFB');assert.equal(r.childCount,1)
  assert.equal(s.order.includes('browser'),false);assert.equal(s.calls(),0);assert.equal(r.display.closed,true);assert.equal(r.display.exitCode,23);assert.equal(r.cleanup,true)
})
test('witness snapshots display observations before cleanup termination and cannot use diagnostics to pass',async()=>{
  const s=witness('port'),r=await runSupplierWitness(s.io)
  assert.equal(r.passed,false);assert.equal(r.display.state,'READY');assert.equal(r.display.closed,false);assert.equal(r.display.exitCode,null)
  assert.equal(s.states[0].closed,true);assert.equal(s.states[0].child.exitCode,0)
})
for(const mode of ['port','version','pin','connect','clients','killfalse','missingEOF'])test('actual witness '+mode+' never becomes business permission',async()=>{const s=witness(mode),r=await runSupplierWitness(s.io);assert.equal(r.passed,false);if(['clients','killfalse','missingEOF'].includes(mode)){assert.equal(r.cleanup,false);assert.equal(s.removes(),0)}assert.equal(JSON.stringify(r).includes('PRIVATE'),false);if(mode==='port')assert.equal(s.calls(),0);if(mode==='connect')assert.equal(s.closedClients(),1)})
test('witness and business profiles remain separate with no HOME/auth inheritance or changed browser flags',()=>{const input={HOME:'/foreign',RUNNER_TRACKING_ID:'opaque',API_KEY:'PRIVATE'},a='/owned/witness',b='/owned/business';assert.notDeepEqual(chromeArgs(a,a+'/extension'),chromeArgs(b,b+'/extension'));for(const root of [a,b]){const e=childEnvironment(root,input,':1');assert.equal(e.HOME,undefined);assert.equal(e.API_KEY,undefined);assert.equal(e.RUNNER_TRACKING_ID,'opaque');assert.equal(chromeArgs(root,root+'/extension').some(x=>/sandbox|headless/.test(x)),false)}})
test('actual business finally retains an unknown child bundle before a throwing pin check',async()=>{
  const text=fs.readFileSync(source,'utf8').replaceAll('\r\n','\n'),start=text.indexOf('export async function main() {\n'),end=text.indexOf('\n  Object.assign(console,originalConsole)',start),begin=text.lastIndexOf('\n  finally {',end)
  assert.ok(begin>start&&end>begin);const body=text.slice(begin+'\n  finally {'.length,end).replace(/\n  }$/,'')
  let retained=0,removed=0
  const supplier={retain(){retained++},check(){throw Error('PIN_REFUSED')},dispose(){if(retained)throw Error('RETAINED');removed++}}
  const context={versionObserved:false,display:undefined,displayProof:undefined,supplierProof:undefined,supplierStates:new Map(),joinSupplierChild:async()=>{throw Error('UNKNOWN_EOF')},activeSupplier:supplier,browserPhase:null,chromium:undefined,xvfb:undefined,browserStartup:undefined,observeBrowserStartup:()=>({}),observers:new Set(),clients:new Set(),children:new Set([{}]),closeOwnedChild:async()=>{throw Error('UNKNOWN_CLOSE')},limit:async p=>p,remaining:()=>100,deadline:Date.now()+1000,abort:{signal:{aborted:false}},clearTimeout,timer:undefined,Date,secret:'PUBLIC',owned:undefined,checks:{},stage:'COMPLETE'}
  const result=await vm.runInNewContext('(async()=>{'+body+';return {checks,stage}})()',context)
  assert.equal(result.checks.cleanup,false);assert.equal(result.stage,'CLEANUP');assert.equal(retained,1);assert.throws(()=>supplier.dispose());assert.equal(removed,0)
})
test('actual exported business refuses absent private supplier before its first preflight/IO call',async()=>{
  const text=fs.readFileSync(source,'utf8'),begin=text.indexOf('export async function main() {'),end=text.indexOf('\nlet directEntry=false',begin)
  assert.ok(begin>0&&end>begin);let preflights=0
  const context={activeSupplier:undefined,fail(){throw Error('OWNED_ACCEPTANCE_REFUSED')},Date,AbortController,Set,Object,Promise,clearTimeout,BOUNDS:{outer:120000},process:{env:{},platform:'linux',versions:{node:'22.23.4'}},preflight(){preflights++;throw Error('INERT_PREFLIGHT_BOUNDARY')},observeBrowserStartup:()=>({}),finiteReceipt:()=>({passed:false}),console:Object.fromEntries(['log','info','warn','error','debug'].map(k=>[k,()=>{}]))}
  const actual=vm.runInNewContext('('+text.slice(begin+'export '.length,end)+')',context)
  try{await actual()}catch(e){assert.equal(e.message,'OWNED_ACCEPTANCE_REFUSED')}
  assert.equal(preflights,0)
})
test('fixed byte-fingerprinted PIN has one exact LF checkout rule, including CRLF attributes',()=>{
  const attrs=fs.readFileSync(new URL('../../../.gitattributes',import.meta.url),'utf8'),rule='/chrome-extension/scripts/fixtures/cft-linux64-732.json text eol=lf'
  const count=s=>s.replaceAll('\r\n','\n').split('\n').filter(x=>x===rule).length
  assert.equal(count(attrs),1);assert.equal(count(attrs.replaceAll('\n','\r\n')),1)
  for(const mutant of [rule.replace('text eol=lf','-text'),rule.replace('.json ','.json* '),'# '+rule])assert.equal(count(attrs.replace(rule,mutant)),0)
})
function ledgerCreateBoundary(fault){
  const text=fs.readFileSync(new URL('../cft-linux-supplier-732.mjs',import.meta.url),'utf8'),start=text.indexOf('const nofollow='),end=text.indexOf('function read(',start),beginLedger=text.indexOf('export function createOwnedLedger('),endLedger=text.indexOf('// The archive pathname',beginLedger)
  assert.ok(start>0&&end>start&&beginLedger>end&&endLedger>beginLedger)
  const makeStat=(ino,dir=false)=>({dev:1,ino,uid:1000,gid:1000,mode:dir?0o40700:0o100600,nlink:1,isDirectory:()=>dir,isFile:()=>!dir,isSymbolicLink:()=>false}),nodes=new Map([['/owned',makeStat(1,true)]]),descriptors=new Map(),events=[]
  let opened=false
  const api={constants:fs.constants,realpathSync:p=>p,lstatSync(p){if(fault==='path-read-throw'&&opened&&p.endsWith('/file'))throw Error('INERT_READ_FAULT');if(!nodes.has(p))throw Error('ENOENT');return nodes.get(p)},mkdtempSync(prefix){const p=prefix+'case';nodes.set(p,makeStat(2,true));return p},chmodSync(){},mkdirSync(p){nodes.set(p,makeStat(3,true))},openSync(p){const s=makeStat(20);if(fault==='fd-owner')s.uid=2000;if(fault==='fd-hardlink')s.nlink=2;descriptors.set(7,s);nodes.set(p,s);opened=true;if(fault==='replace-after-open')nodes.set(p,makeStat(30));events.push({type:'create',ino:20});return 7},fstatSync(fd){assert.equal(fd,7);if(fault==='fd-stat-throw')throw Error('INERT_FSTAT_FAULT');return descriptors.get(fd)},closeSync(fd){assert.equal(fd,7);events.push({type:'close',ino:descriptors.get(fd).ino})},readdirSync(p){return [...nodes].filter(([name])=>name!==p&&path.dirname(name)===p).map(([name,s])=>({name:path.basename(name),isDirectory:s.isDirectory,isSymbolicLink:s.isSymbolicLink}))},unlinkSync(p){events.push({type:'unlink',ino:nodes.get(p).ino});nodes.delete(p)},rmdirSync(p){events.push({type:'rmdir',ino:nodes.get(p).ino});nodes.delete(p)}}
  const context={fs:api,path,process:{getuid:()=>1000,getgid:()=>1000},refuse(){throw Error('PINNED_SUPPLIER_REFUSED')}}
  vm.createContext(context);vm.runInContext(text.slice(start,end)+text.slice(beginLedger,endLedger).replace('export function','function')+';globalThis.make=createOwnedLedger',context)
  const ledger=context.make('/owned');let refused=false,cleanupRefused=false
  try{const result=ledger.open('file');api.closeSync(result.fd)}catch{refused=true}
  try{ledger.dispose()}catch{cleanupRefused=true}
  return {refused,cleanupRefused,events,foreignDeletes:events.filter(x=>x.type==='unlink'&&x.ino===30).length,ownDeletes:events.filter(x=>x.type==='unlink'&&x.ino===20).length,closes:events.filter(x=>x.type==='close').length}
}
test('actual ledger never promotes a refused post-exclusive-open replacement into cleanup ownership',()=>{
  const normal=ledgerCreateBoundary('normal');assert.equal(normal.refused,false);assert.equal(normal.cleanupRefused,false);assert.equal(normal.ownDeletes,1);assert.equal(normal.closes,1)
  const replaced=ledgerCreateBoundary('replace-after-open');assert.equal(replaced.refused,true);assert.equal(replaced.foreignDeletes,0);assert.equal(replaced.cleanupRefused,true);assert.equal(replaced.closes,1)
})
test('actual ledger closes the exclusive FD on all ownership/path observation failures',()=>{
  for(const fault of ['fd-owner','fd-hardlink','fd-stat-throw','path-read-throw']){const s=ledgerCreateBoundary(fault);assert.equal(s.refused,true,fault);assert.equal(s.closes,1,fault);assert.equal(s.foreignDeletes,0,fault);assert.equal(s.cleanupRefused,true,fault)}
})
test('the existing canonical build guard command registers old and fixed-supplier controls exactly once',()=>{
  const workflow=fs.readFileSync(new URL('../../../.github/workflows/ci.yml',import.meta.url),'utf8').replaceAll('\r\n','\n')
  const command='        run: node --test chrome-extension/scripts/tests/acp-history-hosted-732.test.mjs chrome-extension/scripts/tests/cft-linux-supplier-732.test.mjs'
  assert.equal(workflow.split('\n').filter(line=>line===command).length,1)
  assert.equal(workflow.split('\n').filter(line=>line==='        run: node chrome-extension/scripts/accept-acp-history-hosted-732.mjs').length,1)
  assert.equal(workflow.includes('run: node chrome-extension/scripts/diagnose-acp-history-supplier-ab-732.mjs'),false)
})

test('actual current pipeline supplies once, runs the sole full business and closes the bundle',async()=>{
  assert.equal(typeof supplier.runPinnedBusiness,'function')
  const calls=[],bundle={dispose(){calls.push('dispose')}},io={supply:async()=>{calls.push('supply');return bundle},business:async b=>{assert.equal(b,bundle);calls.push('business');return 0}}
  assert.equal(await supplier.runPinnedBusiness(io),0);assert.deepEqual(calls,['supply','business','dispose'])
})
for(const mode of ['supply','business','business-code','dispose'])test('single business pipeline cannot turn '+mode+' refusal into success',async()=>{
  assert.equal(typeof supplier.runPinnedBusiness,'function')
  const calls=[],bundle={dispose(){calls.push('dispose');if(mode==='dispose')throw Error('PRIVATE')}},io={supply:async()=>{calls.push('supply');if(mode==='supply')throw Error('PRIVATE');return bundle},business:async()=>{calls.push('business');if(mode==='business')throw Error('PRIVATE');return mode==='business-code'?1:0}}
  assert.equal(await supplier.runPinnedBusiness(io),1);assert.equal(calls.includes('business'),mode!=='supply');assert.equal(calls.includes('dispose'),mode!=='supply')
})
test('actual production entry contains no independent witness call or fabricated witness receipt',()=>{
  const text=fs.readFileSync(source,'utf8'),entry=text.slice(text.indexOf('async function pinnedEntry()'))
  assert.ok(entry.includes('runPinnedBusiness({supply:()=>supplyFixedCft(temp),business:async bundle=>'))
  assert.equal(entry.includes('independentSupplierWitness'),false);assert.equal(entry.includes('runSupplierWitness'),false);assert.equal(entry.includes('witness:'),false)
  assert.equal(entry.includes("supplierReceipt('COMPLETE')"),false);assert.equal(text.includes('async function independentSupplierWitness('),false)
})

test('actual private pinned entry uses supply then one business with no diagnostic launch',async()=>{
  assert.equal(typeof supplier.runPinnedBusiness,'function')
  const text=fs.readFileSync(source,'utf8'),begin=text.indexOf('async function pinnedEntry() {');assert.ok(begin>0)
  const calls=[],receipts=[],sha='1'.repeat(40),bundle={dispose(){calls.push('dispose')}},context={ROOT:'/owned/repo',activeSupplier:undefined,path,process:{env:{GITHUB_SHA:sha},platform:'linux',arch:'x64',versions:{node:'22.23.4'}},preflight:()=>'/owned',manifestPaths:()=>({worker:'worker.js',page:'panel.html'}),fs:{readFileSync:file=>file.endsWith('acceptance-build-sha.txt')?sha+'\n':'{}',readdirSync:()=>[]},supplyFixedCft:async()=>{calls.push('supply');return bundle},runPinnedBusiness:supplier.runPinnedBusiness,supplierReceipt:()=>({passed:false}),console:{log(value){receipts.push(value)}},main:async()=>{assert.equal(context.activeSupplier,bundle);calls.push('business');return 0},independentSupplierWitness(){throw Error('RETIRED_WITNESS_MUST_NOT_RUN')}}
  const entry=vm.runInNewContext('('+text.slice(begin).trim()+')',context)
  assert.equal(await entry(),0);assert.deepEqual(calls,['supply','business','dispose']);assert.equal(context.activeSupplier,undefined);assert.deepEqual(receipts,[])
})
