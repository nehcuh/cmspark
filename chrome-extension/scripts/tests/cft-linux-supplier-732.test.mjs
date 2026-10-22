import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { PIN,SOURCE_PIN_SHA256,validateFixedLayout,createOwnedLedger,downloadFixedArchive,supplierReceipt,runPinnedPipeline,observeSupplierChild,runSupplierWitness } from '../cft-linux-supplier-732.mjs'
import {devToolsPortSnapshot,childEnvironment,chromeArgs} from '../accept-acp-history-hosted-732.mjs'
const source=new URL('../accept-acp-history-hosted-732.mjs',import.meta.url)
test('actual direct entry must supply and witness before the business gate',async()=>{
  const text=fs.readFileSync(source,'utf8'),line=text.split('\n').find(x=>x.startsWith('if(directEntry)process.exitCode=await ')),calls=[]
  assert.ok(line)
  const ctx={directEntry:true,process:{},main:async()=>{calls.push('business');return 0},pinnedEntry:async()=>{calls.push('supply','witness','business');return 0}}
  await vm.runInNewContext('(async()=>{'+line+'})()',ctx)
  assert.deepEqual(calls,['supply','witness','business'])
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
  const clients=new Set(),io={deadline:100,remaining:()=>100,now:()=>clock,wait:async n=>{clock+=n},parsePort:devToolsPortSnapshot,checkPayload(){order.push('check');if(mode==='pin')throw Error('PRIVATE')},display(){order.push('display');return {state:child(),ready:Promise.resolve(':1')}},browser(){order.push('browser');return child()},readPort:()=>mode==='port'?'1234\n/devtools/browser/short':'1234\n/devtools/browser/12345678-1234-1234-1234-123456789abc',async connect(){order.push('connect');const c={settled:Promise.resolve(),abort(){},async call(name,_args,ms){assert.equal(name,'Browser.getVersion');assert.ok(ms<=5000);calls++;return {product:mode==='version'?'Chrome/154.0.0.0':'Chrome/'+PIN.version}}};clients.add(c);if(mode==='connect')throw Error('PRIVATE');return c},async closeClients(){for(const c of clients)c.abort();closedClients++;if(mode==='clients')throw Error('PRIVATE')},removeOwned(){removes++;order.push('remove')}}
  return {io,states,order,calls:()=>calls,removes:()=>removes,closedClients:()=>closedClients}
}
test('actual witness requires complete UUID, exact CDP product, two real close/EOF states',async()=>{const s=witness(),r=await runSupplierWitness(s.io);assert.equal(r.passed,true);assert.equal(r.childCount,2);assert.equal(s.calls(),1);assert.equal(s.removes(),1);assert.ok(s.states.every(x=>x.closed&&x.stdoutEOF&&x.stderrEOF));assert.deepEqual(s.order,['check','display','browser','connect','check','remove'])})
for(const mode of ['port','version','pin','connect','clients','killfalse','missingEOF'])test('actual witness '+mode+' never becomes business permission',async()=>{const s=witness(mode),r=await runSupplierWitness(s.io);assert.equal(r.passed,false);if(['clients','killfalse','missingEOF'].includes(mode)){assert.equal(r.cleanup,false);assert.equal(s.removes(),0)}assert.equal(JSON.stringify(r).includes('PRIVATE'),false);if(mode==='port')assert.equal(s.calls(),0);if(mode==='connect')assert.equal(s.closedClients(),1)})
test('witness and business profiles remain separate with no HOME/auth inheritance or changed browser flags',()=>{const input={HOME:'/foreign',RUNNER_TRACKING_ID:'opaque',API_KEY:'PRIVATE'},a='/owned/witness',b='/owned/business';assert.notDeepEqual(chromeArgs(a,a+'/extension'),chromeArgs(b,b+'/extension'));for(const root of [a,b]){const e=childEnvironment(root,input,':1');assert.equal(e.HOME,undefined);assert.equal(e.API_KEY,undefined);assert.equal(e.RUNNER_TRACKING_ID,'opaque');assert.equal(chromeArgs(root,root+'/extension').some(x=>/sandbox|headless/.test(x)),false)}})
test('actual business finally retains an unknown child bundle before a throwing pin check',async()=>{
  const text=fs.readFileSync(source,'utf8').replaceAll('\r\n','\n'),start=text.indexOf('export async function main() {\n'),end=text.indexOf('\n  Object.assign(console,originalConsole)',start),begin=text.lastIndexOf('\n  finally {',end)
  assert.ok(begin>start&&end>begin);const body=text.slice(begin+'\n  finally {'.length,end).replace(/\n  }$/,'')
  let retained=0,removed=0
  const supplier={retain(){retained++},check(){throw Error('PIN_REFUSED')},dispose(){if(retained)throw Error('RETAINED');removed++}}
  const context={activeSupplier:supplier,browserPhase:null,chromium:undefined,xvfb:undefined,browserStartup:undefined,observeBrowserStartup:()=>({}),observers:new Set(),clients:new Set(),children:new Set([{}]),closeOwnedChild:async()=>{throw Error('UNKNOWN_CLOSE')},limit:async p=>p,remaining:()=>100,deadline:Date.now()+1000,abort:{signal:{aborted:false}},clearTimeout,timer:undefined,Date,secret:'PUBLIC',owned:undefined,checks:{},stage:'COMPLETE'}
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
