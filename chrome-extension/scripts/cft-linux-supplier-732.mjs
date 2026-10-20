// #732: one fixed, statically admitted CFT artifact. Not a general ZIP reader.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import https from 'node:https'
import zlib from 'node:zlib'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
export const SOURCE_PIN_SHA256='7496428019bcdc725c39148c4ddb031e5300ab880b346c96b23bdc013e14632c'
const pinBytes=fs.readFileSync(new URL('./fixtures/cft-linux64-732.json',import.meta.url))
const refuse=()=>{throw new Error('PINNED_SUPPLIER_REFUSED')}
const hash=b=>crypto.createHash('sha256').update(b).digest('hex')
if(hash(pinBytes)!==SOURCE_PIN_SHA256)refuse()
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x)}return x}
export const PIN=freeze(JSON.parse(pinBytes))
const nofollow=fs.constants.O_NOFOLLOW
const identity=s=>({dev:s.dev,ino:s.ino,uid:s.uid,gid:s.gid,mode:s.mode,...(s.isDirectory()?{}:{nlink:s.nlink})})
const same=(a,b)=>Object.keys(a).every(k=>a[k]===b[k])
const exact=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i])
function ownedStat(file,directory,expected){
  const s=fs.lstatSync(file)
  if(s.isSymbolicLink()||s.uid!==process.getuid()||s.gid!==process.getgid()||
    (directory?!s.isDirectory():!s.isFile()||s.nlink!==1)||fs.realpathSync(file)!==file||expected&&!same(expected,identity(s)))refuse()
  return s
}
function read(fd,offset,bytes){const b=Buffer.alloc(bytes);if(fs.readSync(fd,b,0,bytes,offset)!==bytes)refuse();return b}
function noZip64(extra){let i=0;while(i<extra.length){if(i+4>extra.length)refuse();const id=extra.readUInt16LE(i),n=extra.readUInt16LE(i+2);if(id===1||i+4+n>extra.length)refuse();i+=4+n}}
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0})
function crcUpdate(crc,b){for(const x of b)crc=crcTable[(crc^x)&255]^(crc>>>8);return crc>>>0}
function fileHash(file,remaining){
  const initial=ownedStat(file,false),fd=fs.openSync(file,fs.constants.O_RDONLY|nofollow),sha=crypto.createHash('sha256'),b=Buffer.alloc(65536)
  try{if(!same(identity(initial),identity(fs.fstatSync(fd))))refuse();let offset=0;while(offset<initial.size){remaining();const n=fs.readSync(fd,b,0,Math.min(b.length,initial.size-offset),offset);if(n<=0)refuse();sha.update(b.subarray(0,n));offset+=n}if(!same(identity(initial),identity(ownedStat(file,false)))||fs.fstatSync(fd).size!==initial.size)refuse();return sha.digest('hex')}finally{fs.closeSync(fd)}
}
export function validateFixedLayout(fd,remaining){
  let cursor=PIN.centralDirectoryOffset,lastEnd=0,total=0
  const names=new Set()
  for(const m of PIN.members){
    remaining();const name=Buffer.from(m.path),parts=m.path.replace(/\/$/,'').split('/')
    if(!m.path.startsWith('chrome-linux64/')||/[\\\0:]/.test(m.path)||parts.some(x=>!x||x==='.'||x==='..')||names.has(m.path))refuse()
    names.add(m.path);total+=m.bytes
    if(m.localHeaderOffset<lastEnd||m.dataEnd>PIN.centralDirectoryOffset||m.dataEnd-m.dataStart!==m.compressedBytes||m.bytes!==m.fileBytes||![0,8].includes(m.method)||![0,4].includes(m.flags)||m.localFlags!==m.flags||m.descriptor||m.zip64LocalExtra||m.symlink)refuse()
    const l=read(fd,m.localHeaderOffset,30),ln=l.readUInt16LE(26),le=l.readUInt16LE(28)
    if(l.readUInt32LE(0)!==0x04034b50||l.readUInt16LE(6)!==m.flags||l.readUInt16LE(8)!==m.method||l.readUInt32LE(14)!==parseInt(m.crc32,16)||l.readUInt32LE(18)!==m.compressedBytes||l.readUInt32LE(22)!==m.bytes||ln!==name.length||m.dataStart!==m.localHeaderOffset+30+ln+le||!read(fd,m.localHeaderOffset+30,ln).equals(name))refuse()
    noZip64(read(fd,m.localHeaderOffset+30+ln,le));lastEnd=m.dataEnd
    const c=read(fd,cursor,46),cn=c.readUInt16LE(28),ce=c.readUInt16LE(30),cc=c.readUInt16LE(32)
    if(c.readUInt32LE(0)!==0x02014b50||c.readUInt16LE(8)!==m.flags||c.readUInt16LE(10)!==m.method||c.readUInt32LE(16)!==parseInt(m.crc32,16)||c.readUInt32LE(20)!==m.compressedBytes||c.readUInt32LE(24)!==m.bytes||cn!==name.length||c.readUInt16LE(34)!==0||c.readUInt32LE(42)!==m.localHeaderOffset||(c.readUInt32LE(38)>>>16)!==Number(m.mode)||!read(fd,cursor+46,cn).equals(name))refuse()
    noZip64(read(fd,cursor+46+cn,ce));cursor+=46+cn+ce+cc
  }
  const e=read(fd,cursor,22)
  if(names.size!==309||total!==PIN.totalMemberBytes||e.readUInt32LE(0)!==0x06054b50||e.readUInt16LE(4)!==0||e.readUInt16LE(6)!==0||e.readUInt16LE(8)!==309||e.readUInt16LE(10)!==309||e.readUInt32LE(12)!==cursor-PIN.centralDirectoryOffset||e.readUInt32LE(16)!==PIN.centralDirectoryOffset||e.readUInt16LE(20)!==0||cursor+22!==PIN.archiveBytes)refuse()
  return true
}
function digests(fd,remaining){
  const sha=crypto.createHash('sha256'),md5=crypto.createHash('md5'),b=Buffer.alloc(65536)
  let offset=0
  while(offset<PIN.archiveBytes){remaining();const n=fs.readSync(fd,b,0,Math.min(b.length,PIN.archiveBytes-offset),offset);if(!n)refuse();sha.update(b.subarray(0,n));md5.update(b.subarray(0,n));offset+=n}
  if(sha.digest('hex')!==PIN.archiveSHA256||md5.digest('hex')!==PIN.archiveMD5)refuse()
}
// This ledger deletes only objects created by this invocation and still identical.
// It is an owned-CI scope check, not a hostile same-UID operating-system sandbox.
export function createOwnedLedger(parent,prefix='cmspark-cft732-'){
  ownedStat(parent,true);const root=fs.mkdtempSync(path.join(parent,prefix));fs.chmodSync(root,0o700)
  const entries=new Map([[root,{directory:true,id:identity(ownedStat(root,true))}]])
  function checked(file,directory){const e=entries.get(file);if(!e||e.directory!==directory)refuse();return ownedStat(file,directory,e.id)}
  function destination(relative){if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||relative.split('/').some(x=>!x||x==='.'||x==='..')||/[\\\0:]/.test(relative))refuse();return path.join(root,relative)}
  function mkdir(relative){const file=destination(relative);if(entries.has(file)){checked(file,true);return file}const p=path.dirname(file);checked(p,true);fs.mkdirSync(file,{mode:0o700});entries.set(file,{directory:true,id:identity(ownedStat(file,true))});return file}
  function open(relative){
    const file=destination(relative);checked(path.dirname(file),true)
    const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|nofollow,0o600)
    try{
      const created=fs.fstatSync(fd)
      if(!created.isFile()||created.uid!==process.getuid()||created.gid!==process.getgid()||created.nlink!==1||created.mode!==0o100600)refuse()
      // Ownership comes only from the exclusive FD, including refusal paths.
      // A replaced pathname must never be promoted into this invocation's ledger.
      entries.set(file,{directory:false,id:identity(created)})
      checked(file,false)
      return {fd,file}
    }catch(error){try{fs.closeSync(fd)}catch{}throw error}
  }
  function finalize(file,fd,mode){checked(file,false);fs.fchmodSync(fd,mode);const e=entries.get(file);e.id=identity(fs.fstatSync(fd));checked(file,false)}
  function inventory(){for(const [file,e] of entries)checked(file,e.directory);const actual=[];const visit=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(!entries.has(p))refuse();actual.push(p);if(e.isDirectory()&&!e.isSymbolicLink())visit(p)}};visit(root);if(actual.length!==entries.size-1)refuse();return true}
  let disposed=false
  function dispose(){if(disposed)return;inventory();for(const [file,e] of [...entries].reverse()){checked(file,e.directory);e.directory?fs.rmdirSync(file):fs.unlinkSync(file)}disposed=true}
  return {root,mkdir,open,finalize,checked,inventory,dispose}
}
// The archive pathname is a private caller-selected owned object, never a browser
// executable override. Production only supplies the single fixed download below.
export async function extractFixedArchive(archive,parent,remaining){
  const a=ownedStat(archive,false);if(a.size!==PIN.archiveBytes||(a.mode&0o022)!==0)refuse()
  const fd=fs.openSync(archive,fs.constants.O_RDONLY|nofollow),before=identity(a);let ledger
  try{
    if(!same(before,identity(fs.fstatSync(fd))))refuse();digests(fd,remaining);validateFixedLayout(fd,remaining)
    ledger=createOwnedLedger(parent)
    const dirs=new Set()
    for(const m of PIN.members){const bits=m.path.replace(/\/$/,'').split('/');if(!m.directory)bits.pop();for(let n=1;n<=bits.length;n++)dirs.add(bits.slice(0,n).join('/'))}
    for(const dir of [...dirs].sort((a,b)=>a.split('/').length-b.split('/').length||a.localeCompare(b)))ledger.mkdir(dir)
    for(const m of PIN.members){
      remaining();if(m.directory)continue
      const {fd:out,file}=ledger.open(m.path),sha=crypto.createHash('sha256');let count=0,crc=0xffffffff
      try{
        const source=fs.createReadStream(null,{fd,autoClose:false,start:m.dataStart,end:m.dataEnd-1}),sink=new Writable({write(b,_encoding,done){try{remaining();count+=b.length;if(count>m.bytes)refuse();sha.update(b);crc=crcUpdate(crc,b);let offset=0;while(offset<b.length)offset+=fs.writeSync(out,b,offset,b.length-offset);done()}catch(e){done(e)}}})
        if(m.method===8)await pipeline(source,zlib.createInflateRaw(),sink);else await pipeline(source,sink)
        if(count!==m.bytes||((crc^0xffffffff)>>>0).toString(16).padStart(8,'0')!==m.crc32||sha.digest('hex')!==m.sha256)refuse()
        ledger.finalize(file,out,Number(m.mode)&0o111?0o500:0o400)
      }finally{fs.closeSync(out)}
    }
    if(!same(before,identity(ownedStat(archive,false)))||fs.fstatSync(fd).size!==PIN.archiveBytes)refuse()
    const check=checkRemaining=>{if(typeof checkRemaining!=='function')refuse();checkRemaining();ledger.inventory();for(const m of PIN.members){if(m.directory)continue;const file=path.join(ledger.root,m.path),s=ledger.checked(file,false),mode=Number(m.mode)&0o111?0o100500:0o100400;if(s.size!==m.bytes||s.mode!==mode||fileHash(file,checkRemaining)!==m.sha256)refuse()}return true}
    check(remaining);let retained=false;return {binary:path.join(ledger.root,PIN.executable),check,retain:()=>{retained=true},dispose:()=>{if(retained)refuse();ledger.dispose()},root:ledger.root}
  }catch(e){if(ledger)try{ledger.dispose()}catch{}throw e}finally{fs.closeSync(fd)}
}
export async function downloadFixedArchive(ledger,remaining,request=https.get){
  const {fd,file}=ledger.open('chrome-linux64.zip.partial');let response,req
  try{
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{req?.destroy();response?.destroy();reject(new Error('PINNED_SUPPLIER_REFUSED'))},remaining())
      const done=e=>{clearTimeout(timer);e?reject(e):resolve()}
      req=request(PIN.source,r=>{response=r;if(r.statusCode!==200||r.headers['content-encoding']&&r.headers['content-encoding']!=='identity'||r.headers['content-length']!==String(PIN.archiveBytes)){r.destroy();done(new Error('PINNED_SUPPLIER_REFUSED'));return}let count=0;const bound=new Transform({transform(b,_e,cb){try{remaining();count+=b.length;if(count>PIN.archiveBytes)refuse();cb(null,b)}catch(e){cb(e)}}});const sink=new Writable({write(b,_e,cb){try{let offset=0;while(offset<b.length)offset+=fs.writeSync(fd,b,offset,b.length-offset);cb()}catch(e){cb(e)}}});pipeline(r,bound,sink).then(()=>{if(count!==PIN.archiveBytes)done(new Error('PINNED_SUPPLIER_REFUSED'));else done()},done)})
      req.on('error',done)
    });ledger.finalize(file,fd,0o400);return file
  }finally{fs.closeSync(fd)}
}
export async function supplyFixedCft(parent){
  const deadline=Date.now()+120000,remaining=()=>{const n=deadline-Date.now();if(n<=0)refuse();return n},download=createOwnedLedger(parent,'cmspark-cft-download732-');let bundle
  try{const archive=await downloadFixedArchive(download,remaining);bundle=await extractFixedArchive(archive,parent,remaining);bundle.check(remaining);download.dispose();return bundle}catch(e){try{bundle?.dispose()}finally{download.dispose()}throw e}
}
export function supplierReceipt(phase,facts={}){
  if(!['PREFLIGHT','XVFB','BROWSER','PORT_FILE','CDP','VERSION','CLEANUP','COMPLETE'].includes(phase))refuse()
  const out={schema:1,boundary:'PINNED_CFT_LINUX64_SUPPLIER_ONLY',phase,sourcePinSHA256:SOURCE_PIN_SHA256}
  for(const key of ['portReady','versionObserved','allClosed','bothEOF','cleanup'])out[key]=Object.getOwnPropertyDescriptor(facts,key)?.value===true
  const n=Object.getOwnPropertyDescriptor(facts,'childCount')?.value;out.childCount=Number.isInteger(n)&&n>=0&&n<=2?n:0
  out.passed=phase==='COMPLETE'&&['portReady','versionObserved','allClosed','bothEOF','cleanup'].every(k=>out[k]);if(Buffer.byteLength(JSON.stringify(out))>1024)refuse();return out
}
export async function runPinnedPipeline(io){
  let bundle,code=1
  try{bundle=await io.supply();if(await io.witness(bundle)!==true)refuse();code=await io.business(bundle);if(code!==0)code=1}
  catch{code=1}finally{try{await bundle?.dispose()}catch{code=1}}
  return code
}
const limit=(p,ms)=>{if(!Number.isFinite(ms)||ms<=0)refuse();let timer;return Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('PINNED_SUPPLIER_REFUSED')),ms)})]).finally(()=>clearTimeout(timer))}
export function observeSupplierChild(child){
  let closed,stdout,stderr
  const state={child,close:new Promise(r=>{closed=r}),stdoutEnd:new Promise(r=>{stdout=r}),stderrEnd:new Promise(r=>{stderr=r}),closed:false,error:false,stdoutEOF:false,stderrEOF:false}
  child.on('error',()=>{state.error=true});child.once('close',()=>{state.closed=true;closed()})
  for(const [key,done] of [['stdout',stdout],['stderr',stderr]]){const stream=child[key];if(!stream)refuse();stream.on('error',()=>{state.error=true});stream.on('data',()=>{});stream.once('end',()=>{state[key+'EOF']=true;done()});stream.resume()}
  return state
}
export async function closeSupplierChild(state,remaining){
  const c=state.child;if(!state.closed&&c.exitCode===null&&c.signalCode===null&&c.kill('SIGTERM')===false&&c.exitCode===null&&c.signalCode===null)refuse()
  await limit(Promise.all([state.close,state.stdoutEnd,state.stderrEnd]),remaining());if(!state.closed||!state.stdoutEOF||!state.stderrEOF)refuse()
}
// Same source-driven port grammar as the original business, supplied explicitly
// by its private caller. No daemon, pairing, grant or authentication is accepted.
export async function runSupplierWitness(io){
  let phase='PREFLIGHT',client;const children=[],facts={}
  try{
    io.checkPayload();phase='XVFB';const display=io.display();children.push(display.state)
    const screen=await limit(display.ready,Math.min(5000,io.remaining()))
    phase='BROWSER';const browser=io.browser(screen);children.push(browser)
    const end=Math.min(io.deadline,io.now()+10000);let parts
    while(io.now()<end){io.remaining();if(browser.error||browser.closed||browser.child.exitCode!==null||browser.child.signalCode!==null)refuse();try{parts=io.parsePort(io.readPort())}catch{parts=false}if(parts)break;await io.wait(25)}
    if(!parts)refuse();facts.portReady=true;phase='PORT_FILE';client=await io.connect(parts);phase='CDP'
    const version=await client.call('Browser.getVersion',{},Math.min(5000,io.remaining()))
    if(version?.product!=='Chrome/'+PIN.version)refuse();facts.versionObserved=true;phase='VERSION'
  }catch{/* Only the fixed finite receipt leaves this boundary. */}
  let clean=true
  if(client)try{client.abort();await limit(client.settled,io.remaining())}catch{clean=false}
  try{await io.closeClients()}catch{clean=false}
  for(const state of [...children].reverse())try{await closeSupplierChild(state,io.remaining)}catch{clean=false}
  facts.childCount=children.length;facts.allClosed=children.length===2&&children.every(x=>x.closed);facts.bothEOF=children.length===2&&children.every(x=>x.stdoutEOF&&x.stderrEOF)
  try{if(!clean||children.some(x=>x.error))refuse();io.checkPayload();io.removeOwned()}catch{clean=false}
  facts.cleanup=clean
  return supplierReceipt(clean&&facts.portReady&&facts.versionObserved?'COMPLETE':clean?phase:'CLEANUP',facts)
}
