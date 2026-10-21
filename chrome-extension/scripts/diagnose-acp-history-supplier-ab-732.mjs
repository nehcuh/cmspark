// #732 one remote-only causal supplier A/B; never a business acceptance substitute.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {BOUNDS,preflight,childEnvironment,chromeArgs,devToolsPortSnapshot,manifestPaths,sameOwnedRoot,CDP,limit} from './accept-acp-history-hosted-732.mjs'
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const refuse=()=>{throw Error('SUPPLIER_AB_REFUSED')}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const capped=(a,b)=>Math.min(Number.MAX_SAFE_INTEGER,a+b)
export function supplierEnvironment(variant,owned,input,display) {
  if(!['A','B'].includes(variant))refuse()
  const env=childEnvironment(owned,input,display)
  // New CI-only exception: only B's child receives a NEW exclusive owned home.
  if(variant==='B')env.HOME=path.join(owned,'home')
  return env
}
export function observeChild(child) {
  const closed=deferred(),stdout=deferred(),stderr=deferred()
  const state={child,close:closed.promise,stdoutEnd:stdout.promise,stderrEnd:stderr.promise,closed:false,error:false,stdoutEOF:false,stderrEOF:false,stdoutBytes:0,stderrBytes:0}
  child.on('error',()=>{state.error=true});child.once('close',()=>{state.closed=true;closed.resolve()})
  for(const [name,done] of [['stdout',stdout],['stderr',stderr]]) {
    const stream=child[name];if(!stream)refuse()
    stream.on('error',()=>{state.error=true})
    stream.on('data',bytes=>{state[name+'Bytes']=capped(state[name+'Bytes'],bytes.byteLength)})
    stream.once('end',()=>{state[name+'EOF']=true;done.resolve()})
    stream.resume()
  }
  return state
}
export async function closeChild(state,remaining) {
  if(!state)return
  const c=state.child
  if(!state.closed&&c.exitCode===null&&c.signalCode===null) {
    if(c.kill('SIGTERM')===false&&c.exitCode===null&&c.signalCode===null)refuse()
  }
  await limit(Promise.all([state.close,state.stdoutEnd,state.stderrEnd]),remaining())
  if(!state.closed||!state.stdoutEOF||!state.stderrEOF)refuse()
}
export function result(variant,phase,ready,children,cleanup) {
  const allowed=['NOT_RUN','PREFLIGHT','XVFB','BROWSER','PORT_FILE','CDP','VERSION']
  if(!['A','B'].includes(variant)||!allowed.includes(phase))refuse()
  return {variant,phase,portReady:ready.port===true,versionObserved:ready.version===true,
    childCount:children.length,stdoutBytes:children.reduce((n,c)=>capped(n,c.stdoutBytes),0),stderrBytes:children.reduce((n,c)=>capped(n,c.stderrBytes),0),
    allClosed:children.length===2&&children.every(c=>c.closed),bothEOF:children.length===2&&children.every(c=>c.stdoutEOF&&c.stderrEOF),cleanup:cleanup===true,
    success:phase==='VERSION'&&ready.port===true&&ready.version===true&&cleanup===true&&children.every(c=>!c.error)}
}
export async function runVariant(variant,io) {
  let phase='PREFLIGHT',screen,client;const children=[],ready={}
  try {
    await io.checkPayload()
    phase='XVFB';const display=io.display();children.push(display.state)
    screen=await limit(display.ready,Math.min(5000,io.remaining()))
    phase='BROWSER';const browser=io.browser(screen);children.push(browser)
    const end=Math.min(io.deadline,io.now()+10000)
    let parts
    while(io.now()<end) {
      io.remaining();if(browser.error||browser.closed||browser.child.exitCode!==null||browser.child.signalCode!==null)refuse()
      try{parts=devToolsPortSnapshot(io.readPort())}catch{parts=false}
      if(parts)break
      await io.wait(25)
    }
    if(!parts)refuse();phase='PORT_FILE';ready.port=true
    client=await io.connect(parts);phase='CDP'
    const version=await client.call('Browser.getVersion',{},Math.min(BOUNDS.auth,io.remaining()))
    if(typeof version?.product!=='string'||!/^Chrom(?:e|ium)\/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/.test(version.product))refuse()
    ready.version=true;phase='VERSION'
  }catch{/* Fixed state only. No arbitrary child/error/protocol body is emitted. */}
  let clean=true
  if(client)try{client.abort();await limit(client.settled,io.remaining())}catch{clean=false}
  // Also retains clients created before an open/connect failure.
  try{await io.closeClients()}catch{clean=false}
  for(const child of [...children].reverse())try{await closeChild(child,io.remaining)}catch{clean=false}
  try{if(!clean)refuse();await io.checkPayload();io.removeOwned()}catch{clean=false}
  return result(variant,phase,ready,children,clean)
}
export async function runAB(run) {
  const a=await run('A')
  if(!a.cleanup)return {complete:false,variants:[a,result('B','NOT_RUN',{},[],false)]}
  const b=await run('B')
  return {complete:b.cleanup,variants:[a,b]}
}
function pinBinary(binary,remaining) {
  const canonical=fs.realpathSync(binary),fd=fs.openSync(canonical,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK),initial=fs.fstatSync(fd)
  const same=(a,b)=>['dev','ino','uid','mode','size','mtimeMs'].every(k=>a[k]===b[k])
  try {
    if(!initial.isFile()||initial.uid!==0||(initial.mode&0o022)!==0||(initial.mode&0o111)===0||initial.nlink!==1)refuse()
    const digest=()=>{const hash=crypto.createHash('sha256'),buffer=Buffer.alloc(32768);let offset=0;while(offset<initial.size){remaining();const n=fs.readSync(fd,buffer,0,Math.min(buffer.length,initial.size-offset),offset);if(n<=0)refuse();hash.update(buffer.subarray(0,n));offset+=n}return hash.digest('hex')}
    const first=digest()
    return {check(){remaining();if(fs.realpathSync(binary)!==canonical||!same(initial,fs.fstatSync(fd))||!same(initial,fs.statSync(canonical))||digest()!==first)refuse()},close(){fs.closeSync(fd)}}
  }catch(error){fs.closeSync(fd);throw error}
}
export async function main() {
  let root,identity,pin,timer,expired=false;const retained=new Set(),deadline=Date.now()+BOUNDS.outer
  const remaining=()=>{const n=deadline-Date.now();if(n<=0||expired)refuse();return n}
  const terminateRetained=()=>{expired=true;for(const state of retained)if(!state.closed&&state.child.exitCode===null&&state.child.signalCode===null)try{state.child.kill('SIGKILL')}catch{state.error=true}}
  let comparison={complete:false,variants:[]}
  try {
    const input=Object.fromEntries(['GITHUB_ACTIONS','RUNNER_OS','RUNNER_ENVIRONMENT','ImageOS','RUNNER_TEMP','GITHUB_SHA','RUNNER_TRACKING_ID'].map(k=>[k,process.env[k]]))
    const temp=preflight(input,process.platform);if(process.versions.node.split('.')[0]!=='22')refuse()
    if(!/^[a-f0-9]{40}$/.test(input.GITHUB_SHA||'')||fs.readFileSync(path.join(ROOT,'acceptance-build-sha.txt'),'utf8')!==input.GITHUB_SHA+'\n')refuse()
    const built=path.join(ROOT,'chrome-extension/build/chrome-mv3-prod'),paths=manifestPaths(JSON.parse(fs.readFileSync(path.join(built,'manifest.json'),'utf8')))
    const inspect=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(entry.isSymbolicLink()||!entry.isFile()&&!entry.isDirectory())refuse();if(entry.isDirectory())inspect(path.join(dir,entry.name))}};inspect(built)
    const binary=['/usr/bin/chromium-browser','/usr/bin/chromium'].find(file=>{try{return fs.statSync(file).isFile()}catch{return false}});if(!binary)refuse()
    pin=pinBinary(binary,remaining)
    root=fs.mkdtempSync(path.join(temp,'cmspark-supplier-ab732-'));fs.chmodSync(root,0o700);identity=fs.lstatSync(root);if(!sameOwnedRoot(root,identity))refuse()
    const require=createRequire(path.join(ROOT,'companion/package.json')),{WebSocket}=require('ws')
    timer=setTimeout(terminateRetained,remaining())
    comparison=await runAB(async variant=>{
      const owned=fs.mkdtempSync(path.join(root,variant+'-'));fs.chmodSync(owned,0o700);const owner=fs.lstatSync(owned),extension=path.join(owned,'extension'),clients=new Set()
      const env=supplierEnvironment(variant,owned,input)
      for(const key of ['TMPDIR','XDG_CONFIG_HOME','XDG_CACHE_HOME','CMSPARK_DATA_DIR',...(variant==='B'?['HOME']:[])])fs.mkdirSync(env[key],{mode:0o700})
      fs.cpSync(built,extension,{recursive:true,dereference:false});for(const rel of [paths.worker,paths.page])if(!fs.lstatSync(path.join(extension,rel)).isFile())refuse()
      const child=(exe,args,childEnv,stdio)=>{remaining();pin.check();const state=observeChild(spawn(exe,args,{env:childEnv,stdio}));retained.add(state);return state}
      return runVariant(variant,{deadline,remaining,now:Date.now,wait:ms=>new Promise(resolve=>setTimeout(resolve,ms)),checkPayload:()=>pin.check(),
        display(){const state=child('/usr/bin/Xvfb',['-displayfd','3','-screen','0','1280x800x24','-nolisten','tcp'],env,['ignore','pipe','pipe','pipe']),d=deferred();let text=''
          let settled=false;state.child.stdio[3].on('error',()=>{settled=true;d.reject(Error('DISPLAY_REFUSED'))});state.child.stdio[3].on('data',bytes=>{if(settled)return;if(bytes.byteLength+text.length>8){settled=true;d.reject(Error('DISPLAY_REFUSED'));return}text+=bytes.toString();if(/^\d{1,5}\n$/.test(text)){settled=true;d.resolve(':'+text.trim())}});return {state,ready:d.promise}},
        browser:display=>child(binary,chromeArgs(owned,extension),supplierEnvironment(variant,owned,input,display),['ignore','pipe','pipe']),
        readPort:()=>fs.readFileSync(path.join(owned,'profile/DevToolsActivePort'),'utf8'),
        connect:parts=>CDP.connect(WebSocket,'ws://127.0.0.1:'+parts[0]+parts[1],Math.min(BOUNDS.auth,remaining()),clients),
        closeClients:async()=>{for(const client of clients)client.abort();await limit(Promise.all([...clients].map(client=>client.settled)),remaining())},
        removeOwned(){if(!sameOwnedRoot(owned,owner)||!sameOwnedRoot(root,identity))refuse();fs.rmSync(owned,{recursive:true,force:true})}})
    })
  }catch{/* No raw errors or environment values leave this boundary. */}
  let closed=true
  for(const state of [...retained].reverse())try{await closeChild(state,remaining)}catch{closed=false}
  let cleanup=comparison.complete&&closed&&[...retained].every(s=>s.closed&&s.stdoutEOF&&s.stderrEOF)
  if(expired||Date.now()>=deadline){terminateRetained();cleanup=false}
  clearTimeout(timer)
  try{pin?.close();if(root&&cleanup){if(!sameOwnedRoot(root,identity))refuse();fs.rmSync(root,{recursive:true,force:true})}}catch{cleanup=false}
  const outcomes=comparison.variants.map(v=>v.success)
  const outcome=!comparison.complete?'INCOMPLETE':outcomes.every(Boolean)?'BOTH_PASS':outcomes.every(v=>!v)?'BOTH_REFUSED':outcomes[0]?'A_PASS_B_REFUSED':'A_REFUSED_B_PASS'
  const receipt={schema:1,experiment:'SUPPLIER_AB_ONLY_NOT_BUSINESS_ACCEPTANCE',outcome,comparisonComplete:comparison.complete,cleanup,variants:comparison.variants}
  console.log(JSON.stringify(receipt));return cleanup&&outcome==='BOTH_PASS'?0:1
}
let direct=false
try{direct=!!process.argv[1]&&fs.realpathSync(process.argv[1])===fs.realpathSync(fileURLToPath(import.meta.url))}catch{}
if(direct)process.exitCode=await main()
