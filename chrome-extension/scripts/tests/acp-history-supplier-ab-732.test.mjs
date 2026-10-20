import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import crypto from 'node:crypto'
import {EventEmitter} from 'node:events'
import {fileURLToPath} from 'node:url'
import {supplierEnvironment,observeChild,closeChild,result,runVariant,runAB,main} from '../diagnose-acp-history-supplier-ab-732.mjs'
import {chromeArgs} from '../accept-acp-history-hosted-732.mjs'
const defer=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
function child() {
  const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdout.resume=c.stderr.resume=()=>{};c.exitCode=null;c.signalCode=null;c.signals=[]
  c.finish=()=>{c.exitCode=0;c.stdout.emit('end');c.stderr.emit('end');c.emit('close',0,null)}
  c.kill=signal=>{c.signals.push(signal);queueMicrotask(c.finish);return true}
  return c
}
test('only B receives new child-owned HOME, with no input/parent HOME read',()=>{
  let reads=0;const input={RUNNER_TRACKING_ID:'opaque-inert'};Object.defineProperty(input,'HOME',{get(){reads++;throw Error('PRIVATE')}})
  const a=supplierEnvironment('A','/owned/A',input,':23'),b=supplierEnvironment('B','/owned/A',input,':23')
  assert.equal(a.HOME,undefined);assert.equal(b.HOME,'/owned/A/home');delete b.HOME;assert.deepEqual(a,b);assert.equal(reads,0)
  assert.equal(a.RUNNER_TRACKING_ID,'opaque-inert');assert.equal(a.OPENAI_API_KEY,undefined);assert.throws(()=>supplierEnvironment('C','/owned/A',input,':23'))
})
test('original strict headful args remain unchanged and no sandbox fallback is added',()=>{
  const args=chromeArgs('/owned/A','/owned/A/extension')
  assert.deepEqual(args,['--user-data-dir=/owned/A/profile','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--disable-extensions-except=/owned/A/extension','--load-extension=/owned/A/extension','--no-first-run','--no-default-browser-check','about:blank'])
})
test('actual stream observer drains and counts without retaining child body',async()=>{
  const c=child(),s=observeChild(c);c.stdout.emit('data',Buffer.from('PRIVATE_BODY'));c.stderr.emit('data',Buffer.from('PRIVATE_ERROR'))
  await closeChild(s,()=>100);assert.equal(s.stdoutBytes,12);assert.equal(s.stderrBytes,13);assert.equal(s.closed,true);assert.equal(s.stdoutEOF,true);assert.equal(s.stderrEOF,true)
  const r=result('A','BROWSER',{},[s,s],true);assert.equal(JSON.stringify(r).includes('PRIVATE'),false);assert.equal(r.success,false)
})
test('child close alone is not stdout/stderr EOF and cannot release cleanup',async()=>{
  const c=child(),s=observeChild(c),gate=defer();c.exitCode=0;c.emit('close',0,null)
  let done=false;const p=closeChild(s,()=>100).then(()=>{done=true});await Promise.resolve();assert.equal(done,false)
  c.stdout.emit('end');await Promise.resolve();assert.equal(done,false);c.stderr.emit('end');gate.resolve();await p;assert.equal(done,true)
})
test('already exited child still waits close and both EOF without an extra kill',async()=>{
  const c=child(),s=observeChild(c);c.exitCode=0;let done=false
  const p=closeChild(s,()=>100).then(()=>{done=true});await Promise.resolve();assert.equal(done,false);assert.deepEqual(c.signals,[]);c.finish();await p
})
test('live child refusing termination remains a hard cleanup failure',async()=>{
  const c=child(),s=observeChild(c);c.kill=()=>false
  await assert.rejects(closeChild(s,()=>100));assert.equal(s.closed,false);assert.equal(s.stdoutEOF,false)
})
function variantIO(fault='none') {
  let now=0,reads=0,removed=0,checked=0,calls=0;const display=child(),browser=child(),states=[observeChild(display),observeChild(browser)]
  if(fault==='killfalse')browser.kill=()=>false
  const client={settled:Promise.resolve(),abort(){},async call(method){calls++;assert.equal(method,'Browser.getVersion');return fault==='badversion'?{product:'PRIVATE_BODY'}:{product:'Chrome/155.0.8059.0'}}}
  const io={deadline:120000,remaining:()=>120000-now,now:()=>now,wait:async ms=>{assert.equal(ms,25);now+=ms},checkPayload(){checked++;if(fault==='payload')throw Error('REFUSED')},
    display:()=>({state:states[0],ready:Promise.resolve(':23')}),browser(screen){assert.equal(screen,':23');return states[1]},
    readPort(){reads++;if(fault==='port')return '9222\n/devtools/browser/not-a-complete-uuid';if(fault==='prefix'&&reads===1)return '9222\n/devtools';return '9222\n/devtools/browser/11111111-1111-4111-8111-111111111111'},
    async connect(parts){assert.deepEqual(Array.from(parts),['9222','/devtools/browser/11111111-1111-4111-8111-111111111111']);if(fault==='connect')throw Error('PRIVATE_ERROR');return client},
    closeClients:async()=>{},removeOwned(){removed++}}
  return {io,states,facts:()=>({now,reads,removed,checked,calls})}
}
test('whole variant reaches real method seam, then actual close/EOF before removal',async()=>{
  const s=variantIO(),r=await runVariant('A',s.io)
  assert.equal(r.phase,'VERSION');assert.equal(r.success,true);assert.equal(r.allClosed,true);assert.equal(r.bothEOF,true);assert.equal(s.facts().calls,1);assert.equal(s.facts().removed,1)
})
test('actual late child error cannot become supplier success even after version and proper cleanup',async()=>{
  const s=variantIO();s.io.remaining=()=>30;s.io.closeClients=async()=>{s.states[1].child.emit('error',Error('PRIVATE_LATE_ERROR'))}
  const r=await runVariant('A',s.io);assert.equal(r.versionObserved,true);assert.equal(r.cleanup,true);assert.equal(r.allClosed,true);assert.equal(r.bothEOF,true);assert.equal(r.success,false);assert.equal(JSON.stringify(r).includes('PRIVATE'),false)
})
test('whole variant waits partial port publication and never admits malformed UUID',async()=>{
  const partial=variantIO('prefix'),p=await runVariant('A',partial.io);assert.equal(p.success,true);assert.equal(partial.facts().reads,2);assert.equal(partial.facts().now,25)
  const bad=variantIO('port'),r=await runVariant('A',bad.io);assert.equal(r.success,false);assert.equal(r.phase,'BROWSER');assert.equal(bad.facts().now,10000);assert.equal(bad.facts().calls,0);assert.equal(r.cleanup,true)
})
for(const fault of ['payload','connect','badversion','killfalse'])test('whole variant '+fault+' is not supplier success',async()=>{
  const s=variantIO(fault),r=await runVariant('B',s.io);assert.equal(r.success,false)
  if(fault==='payload')assert.equal(r.childCount,0)
  if(fault==='killfalse'){assert.equal(r.cleanup,false);assert.equal(s.facts().removed,0)}
})
test('exactly A then B once, after A cleanup; unresolved A forbids B',async()=>{
  const order=[],a=variantIO(),b=variantIO();const both=await runAB(async id=>{order.push(id);return runVariant(id,id==='A'?a.io:b.io)})
  assert.deepEqual(order,['A','B']);assert.equal(both.complete,true);assert.equal(both.variants.every(v=>v.success),true)
  const blocked=[],bad=variantIO('killfalse'),r=await runAB(async id=>{blocked.push(id);return runVariant(id,bad.io)})
  assert.deepEqual(blocked,['A']);assert.equal(r.complete,false);assert.equal(r.variants[1].phase,'NOT_RUN')
})
test('a refused but fully cleaned A is retained, then exactly one B executes',async()=>{
  const a=variantIO('port'),b=variantIO(),calls=[];const r=await runAB(async id=>{calls.push(id);return runVariant(id,id==='A'?a.io:b.io)})
  assert.deepEqual(calls,['A','B']);assert.equal(r.complete,true);assert.equal(r.variants[0].success,false);assert.equal(r.variants[1].success,true)
})
test('fixed supplier retires the old A/B workflow without weakening the original business gate',()=>{
  const workflow=fs.readFileSync(fileURLToPath(new URL('../../../.github/workflows/ci.yml',import.meta.url)),'utf8')
  const job=workflow.slice(workflow.indexOf('  acp-history-restart:'))
  assert.equal(job.match(/run: node chrome-extension\/scripts\/accept-acp-history-hosted-732\.mjs/g)?.length,1)
  assert.equal(job.includes('diagnose-acp-history-supplier-ab-732.mjs'),false)
  assert.equal(job.includes('continue-on-error'),false);assert.equal(job.includes('if: always()'),false)
  assert.match(job,/run: node chrome-extension\/scripts\/accept-acp-history-hosted-732\.mjs\n$/)
})
test('actual retained payload pin rejects byte drift, replacement, writable owner and retargeted aliases',()=>{
  const source=fs.readFileSync(fileURLToPath(new URL('../diagnose-acp-history-supplier-ab-732.mjs',import.meta.url)),'utf8')
  const start=source.indexOf('function pinBinary('),end=source.indexOf('export async function main()',start);assert.ok(start>0&&end>start)
  for(const mode of ['good','bytes','identity','writable','alias','short']) {
    let bytes=Buffer.from('ABCD'),canonical='/fixed/chrome',closed=0,reads=0
    const stat={dev:1,ino:2,uid:0,mode:mode==='writable'?0o100777:0o100755,size:4,mtimeMs:1,nlink:1,isFile:()=>true}
    const fake={constants:{O_RDONLY:0,O_NOFOLLOW:1,O_NONBLOCK:2},realpathSync:()=>canonical,openSync:()=>9,fstatSync:()=>({...stat}),statSync:()=>({...stat}),closeSync(fd){assert.equal(fd,9);closed++},readSync(fd,out,offset,length,position){assert.equal(fd,9);reads++;if(mode==='short')return 0;const n=Math.min(length,bytes.length-position);bytes.copy(out,offset,position,position+n);return n}}
    const pinBinary=vm.runInNewContext('('+source.slice(start,end).trim()+')',{fs:fake,crypto,Buffer,refuse:()=>{throw Error('REFUSED')}})
    if(mode==='writable'||mode==='short'){assert.throws(()=>pinBinary('/alias',()=>100));assert.equal(closed,1);continue}
    const pin=pinBinary('/alias',()=>100)
    if(mode==='bytes')bytes=Buffer.from('ABCE')
    if(mode==='identity')stat.ino=3
    if(mode==='alias')canonical='/other/chrome'
    if(mode==='good'){assert.doesNotThrow(()=>pin.check());assert.equal(reads,2)}else assert.throws(()=>pin.check())
    pin.close();assert.equal(closed,1)
  }
})
test('actual main refuses local admission before any supplier or application import',async()=>{
  const old=console.log,rows=[];console.log=value=>rows.push(value)
  try{assert.equal(await main(),1)}finally{console.log=old}
  assert.equal(rows.length,1);const receipt=JSON.parse(rows[0]);assert.equal(receipt.outcome,'INCOMPLETE');assert.equal(receipt.comparisonComplete,false);assert.deepEqual(receipt.variants,[])
})
test('actual outer-expiry termination targets only retained live children and never invents close',()=>{
  const source=fs.readFileSync(fileURLToPath(new URL('../diagnose-acp-history-supplier-ab-732.mjs',import.meta.url)),'utf8')
  const line=source.split('\n').find(s=>s.startsWith('  const terminateRetained='));assert.ok(line)
  const signals=[],live={closed:false,error:false,child:{exitCode:null,signalCode:null,kill:s=>{signals.push(s);return true}}},closed={closed:true,error:false,child:{exitCode:null,signalCode:null,kill:()=>{throw Error('NO_KILL')}}},exited={closed:false,error:false,child:{exitCode:0,signalCode:null,kill:()=>{throw Error('NO_KILL')}}},bad={closed:false,error:false,child:{exitCode:null,signalCode:null,kill(){throw Error('INERT_REFUSAL')}}}
  const context={retained:new Set([live,closed,exited,bad]),expired:false}
  vm.runInNewContext(line+';terminateRetained()',context)
  assert.deepEqual(signals,['SIGKILL']);assert.equal(context.expired,true);assert.equal(live.closed,false);assert.equal(exited.closed,false);assert.equal(bad.error,true)
  assert.equal(source.includes('if(expired||Date.now()>=deadline){terminateRetained();cleanup=false}'),true)
})
