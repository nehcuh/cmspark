import { test } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { runInNewContext } from "node:vm"
import { promisify } from "node:util"
import { measureAppBinary, type AppBinaryMeasureDeps } from "../src/apps/binary-drift-files"
import type { AppEntry } from "../src/apps/types"

/** Actual owned inode/content IO, Windows-name and readonly PS seams; no native/GUI/token. */
function owned() {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"cmspark-drift-files-"))
 const exe="C:\\Owned\\应用 (1).exe", map=(v:string)=>path.join(root,...v.slice(3).split("\\").filter(Boolean))
 fs.mkdirSync(map("C:\\Owned"),{recursive:true}); fs.writeFileSync(map(exe),"owned executable bytes, never executed")
 let opens=0,closed=0,reads=0,probes=0,clock=0,checkpoints=0
 const io={...fs,
  lstatSync:((v:fs.PathLike,o:any)=>fs.lstatSync(map(String(v)),o)) as typeof fs.lstatSync,
  realpathSync:((v:fs.PathLike)=>{fs.realpathSync(map(String(v)));return String(v)}) as typeof fs.realpathSync,
  openSync:((v:fs.PathLike,flags:fs.OpenMode)=>{opens++;return fs.openSync(map(String(v)),flags)}) as typeof fs.openSync,
  readSync:((...args:Parameters<typeof fs.readSync>)=>{reads++;return (fs.readSync as any)(...args)}) as typeof fs.readSync,
  closeSync:(fd:number)=>{closed++;fs.closeSync(fd)},
 }
 const deps:AppBinaryMeasureDeps={platform:"win32",fs:io,now:()=>clock,
  runner:async(script,args,opts)=>{probes++;assert.ok(opts!.timeoutMs!>0&&opts!.timeoutMs!<=15000);assert.deepEqual(args,["-TargetPath",exe]);return script.endsWith("apps-signer.ps1")?JSON.stringify({status:"NotSigned",signer:""}):JSON.stringify({ok:true})},
 }
 const entry={token:"win.app.owned689",kind:"gui",enabled:true,policy:"manual",exe:{path:exe,sha256:"a".repeat(64),user_writable_dir:false},source:"user",display_name:"owned",added_at:"owned"} as AppEntry
 return {root,exe,map,io,deps,entry,checkpoint:()=>{checkpoints++},clock:(n:number)=>{clock=n},counts:()=>({opens,closed,reads,probes,checkpoints}),close:()=>fs.rmSync(root,{recursive:true,force:true})}
}
test("measure actual bytes, strict snapshot and synchronous final check, no execution",async()=>{
 const a=owned();try{const r=await measureAppBinary(a.entry,a.checkpoint,a.deps);assert.equal(r.sha256,createHash("sha256").update(fs.readFileSync(a.map(a.exe))).digest("hex"));assert.equal(r.signer,undefined);assert.equal(Object.isFrozen(r),true);r.recheck();assert.equal(a.counts().opens,a.counts().closed);assert.equal(a.counts().probes,3)}finally{a.close()}
})
for(const mode of ["sibling","dir sibling"])test(`stable ancestor accepts unrelated ${mode}`,async()=>{const a=owned();try{const r=await measureAppBinary(a.entry,a.checkpoint,a.deps);if(mode==="sibling")fs.writeFileSync(a.map("C:\\Owned\\other.txt"),"inert");else fs.mkdirSync(a.map("C:\\other"));r.recheck()}finally{a.close()}})
for(const mode of ["bytes","replacement","hardlink","symlink","directorymode"])test(`final same-file identity refuses ${mode}`,async()=>{const a=owned();try{const r=await measureAppBinary(a.entry,a.checkpoint,a.deps);const f=a.map(a.exe);if(mode==="bytes")fs.writeFileSync(f,"other");if(mode==="replacement"){fs.renameSync(f,f+".old");fs.copyFileSync(f+".old",f)}if(mode==="hardlink")fs.linkSync(f,f+".link");if(mode==="symlink"){fs.renameSync(f,f+".old");fs.symlinkSync(f+".old",f)}if(mode==="directorymode"){
 // Windows chmod does not expose POSIX directory permission bits. Exercise the
 // existing mode-identity fence through its explicit stat seam on every OS.
 const lstat=a.io.lstatSync
 a.io.lstatSync=((v:fs.PathLike,o:any)=>{
  const stat=lstat(v,o) as unknown as fs.BigIntStats
  return String(v)===path.win32.dirname(a.exe)
   ?Object.assign(Object.create(Object.getPrototypeOf(stat)),stat,{mode:stat.mode^1n}):stat
 }) as typeof fs.lstatSync
}assert.throws(r.recheck)}finally{a.close()}})
for(const body of [null,[],{ok:true,extra:true},{ok:1},{ok:false},"notjson"])test(`strict locality refuses ${JSON.stringify(body)}`,async()=>{const a=owned();try{a.deps.runner=async()=>typeof body==="string"?body:JSON.stringify(body);await assert.rejects(measureAppBinary(a.entry,a.checkpoint,a.deps));assert.equal(a.counts().opens,0)}finally{a.close()}})
for(const value of ["C:a.exe","C:\\..\\a.exe","C:\\CON.exe","C:\\a.exe:ads","\\\\host\\share\\a.exe","C:\\a%X%.exe","C:\\a.exe.","C:\\a.exe\\", "C:\\"+"a".repeat(253)+".exe"])test(`reject alias before any IO ${JSON.stringify(value)}`,async()=>{const a=owned();try{a.entry.exe!.path=value;await assert.rejects(measureAppBinary(a.entry,a.checkpoint,a.deps));assert.equal(a.counts().probes+a.counts().opens,0)}finally{a.close()}})
for(const body of [{status:"HashMismatch",signer:""},{status:"UnknownError",signer:""},{status:"Valid",signer:"unexpected"},{status:"NotSigned",signer:"unexpected"},{status:"NotSigned",signer:"",extra:true},[],null,"x".repeat(4097)])test(`strict signer wire refuses ${JSON.stringify(body).slice(0,80)}`,async()=>{const a=owned();try{const prior=a.deps.runner!;a.deps.runner=async(s,args,opts)=>s.endsWith("apps-signer.ps1")?(typeof body==="string"?body:JSON.stringify(body)):prior(s,args,opts);await assert.rejects(measureAppBinary(a.entry,a.checkpoint,a.deps));assert.equal(a.counts().opens,a.counts().closed)}finally{a.close()}})
test("actual Valid exactly registered Subject accepted; caller old signer never substituted",async()=>{const a=owned();try{a.entry.exe!.signer="CN=Owned";const prior=a.deps.runner!;a.deps.runner=async(s,args,opts)=>s.endsWith("apps-signer.ps1")?JSON.stringify({status:"Valid",signer:"CN=Owned"}):prior(s,args,opts);const r=await measureAppBinary(a.entry,a.checkpoint,a.deps);assert.equal(r.signer,"CN=Owned")}finally{a.close()}})
test("absolute deadline includes final successful await and final snapshot recheck",async()=>{const a=owned();try{const prior=a.deps.runner!;a.deps.runner=async(s,args,opts)=>{const result=await prior(s,args,opts);if(s.endsWith("apps-signer.ps1"))a.clock(15000);return result};await assert.rejects(measureAppBinary(a.entry,a.checkpoint,a.deps));assert.equal(a.counts().opens,a.counts().closed)}finally{a.close()}})
test("return snapshot does not renew the original deadline",async()=>{const a=owned();try{const r=await measureAppBinary(a.entry,a.checkpoint,a.deps);a.clock(15000);assert.throws(r.recheck)}finally{a.close()}})
test("owner stale after rejected readonly PS await is preserved with zero open",async()=>{const a=owned();try{let stale=false;a.deps.runner=async()=>{stale=true;throw Error("private path")};await assert.rejects(measureAppBinary(a.entry,()=>{if(stale)throw Error("OWNER_STALE")},a.deps),/OWNER_STALE/);assert.equal(a.counts().opens,0)}finally{a.close()}})
test("oversize refuses before reading target contents",async()=>{const a=owned();try{fs.truncateSync(a.map(a.exe),256*1024*1024+1);await assert.rejects(measureAppBinary(a.entry,a.checkpoint,a.deps));assert.equal(a.counts().reads,0)}finally{a.close()}})
test("partial/early EOF read refused and descriptor closed",async()=>{const a=owned();try{a.deps.fs={...a.io,readSync:(()=>0) as typeof fs.readSync};await assert.rejects(measureAppBinary(a.entry,a.checkpoint,a.deps));assert.equal(a.counts().opens,a.counts().closed)}finally{a.close()}})
test("file change during signer await refuses; original 8 fields remain strict",async()=>{const a=owned();try{const prior=a.deps.runner!;a.deps.runner=async(s,args,opts)=>{const r=await prior(s,args,opts);if(s.endsWith("apps-signer.ps1"))fs.writeFileSync(a.map(a.exe),"replacement during readonly probe");return r};await assert.rejects(measureAppBinary(a.entry,a.checkpoint,a.deps));assert.equal(a.counts().opens,a.counts().closed)}finally{a.close()}})
test("missing-file recheck exposes only finite code, not owned path",async()=>{const a=owned();try{const r=await measureAppBinary(a.entry,a.checkpoint,a.deps);fs.unlinkSync(a.map(a.exe));assert.throws(r.recheck,(e:unknown)=>e instanceof Error&&e.message==="APP_DRIFT_MEASUREMENT_FAILED")}finally{a.close()}})
test("chunk-boundary owner change rejects and closes real descriptor",async()=>{const a=owned();try{fs.writeFileSync(a.map(a.exe),Buffer.alloc(65537));let stale=false;const original=a.io.readSync;a.deps.fs={...a.io,readSync:((...args:Parameters<typeof fs.readSync>)=>{const n=(original as any)(...args);stale=true;return n}) as typeof fs.readSync};await assert.rejects(measureAppBinary(a.entry,()=>{if(stale)throw Error("OWNER_STALE")},a.deps),/OWNER_STALE/);assert.equal(a.counts().opens,a.counts().closed)}finally{a.close()}})
test("exact size cap is admitted with bounded chunks and actual EOF",async()=>{const a=owned();try{fs.truncateSync(a.map(a.exe),256*1024*1024);let max=0;const original=a.io.readSync;a.deps.fs={...a.io,readSync:((...args:Parameters<typeof fs.readSync>)=>{max=Math.max(max,Number((args as unknown as unknown[])[3]));return (original as any)(...args)}) as typeof fs.readSync};const r=await measureAppBinary(a.entry,a.checkpoint,a.deps);assert.match(r.sha256,/^[a-f0-9]{64}$/);assert.equal(max,65536);assert.equal(a.counts().reads,4097);assert.equal(a.counts().opens,a.counts().closed)}finally{a.close()}})
test("successful measurement then user changes subject: synchronous fence refuses",async()=>{const a=owned();try{let stale=false;const r=await measureAppBinary(a.entry,()=>{if(stale)throw Error("OWNER_STALE")},a.deps);stale=true;assert.throws(r.recheck,/OWNER_STALE/)}finally{a.close()}})
test("distinct large inode integer cannot round into prior identity",async()=>{const a=owned();try{let changed=false;const wrap=(s:fs.BigIntStats)=>Object.assign(Object.create(Object.getPrototypeOf(s)),s,{ino:9007199254740992n+(changed?1n:0n)});a.deps.fs={...a.io,lstatSync:((v:fs.PathLike,o:any)=>{const s=a.io.lstatSync(v,o) as unknown as fs.BigIntStats;return String(v)===a.exe?wrap(s):s}) as typeof fs.lstatSync,fstatSync:((fd:number,o:any)=>wrap(fs.fstatSync(fd,o) as unknown as fs.BigIntStats)) as typeof fs.fstatSync};const r=await measureAppBinary(a.entry,a.checkpoint,a.deps);changed=true;assert.throws(r.recheck)}finally{a.close()}})
test("close failure cannot expose a raw native diagnostic",async()=>{const a=owned();try{a.deps.fs={...a.io,closeSync:(fd:number)=>{a.io.closeSync(fd);throw Error("PRIVATE_NATIVE_CLOSE_DETAIL")}};await assert.rejects(measureAppBinary(a.entry,a.checkpoint,a.deps),(e:unknown)=>e instanceof Error&&e.message==="APP_DRIFT_MEASUREMENT_FAILED");assert.equal(a.counts().opens,a.counts().closed)}finally{a.close()}})
// Independent component review found these exact two boundary failures.
test("signature probe must use the canonical object already hashed, not a retargetable raw alias",async()=>{
 const a=owned();try{
  const raw="C:\\SHORT~1\\应用 (1).exe",other=a.map("C:\\Owned\\other.exe");fs.writeFileSync(other,"alternate owned bytes with controlled valid signature")
  a.entry.exe!.path=raw;a.entry.exe!.signer="CN=Owned"
  a.deps.fs={...a.io,realpathSync:((v:fs.PathLike)=>String(v)===raw?a.exe:a.io.realpathSync(v)) as typeof fs.realpathSync}
  a.deps.runner=async(s,args)=>{
   if(!s.endsWith("apps-signer.ps1"))return JSON.stringify({ok:true})
   const b=fs.readFileSync(args[1]===raw?other:a.map(args[1]))
   return JSON.stringify(b.equals(fs.readFileSync(other))?{status:"Valid",signer:"CN=Owned"}:{status:"NotSigned",signer:""})
  }
  await assert.rejects(measureAppBinary(a.entry,a.checkpoint,a.deps),/APP_DRIFT_SIGNER_UNSUPPORTED/)
  assert.equal(a.counts().opens,a.counts().closed)
 }finally{a.close()}
})
test("absolute measurement deadline includes actual descriptor cleanup",async()=>{
 const a=owned();try{
  a.deps.fs={...a.io,closeSync:(fd:number)=>{a.io.closeSync(fd);a.clock(15000)}}
  await assert.rejects(measureAppBinary(a.entry,a.checkpoint,a.deps),/APP_DRIFT_MEASUREMENT_FAILED/)
  assert.equal(a.counts().opens,a.counts().closed)
 }finally{a.close()}
})

/** Execute the actual compiled runPs in a VM with an inert execFile outlet.
 * No PowerShell/native process is started; real Windows signer coverage is separate. */
function isolatedRunPs(env: NodeJS.ProcessEnv, failure?: Error) {
 const filename=require.resolve("../src/host-use/win/powershell")
 const calls:Array<{exe:string,args:string[],options:Record<string,any>}>=[]
 const invoke=async(exe:string,args:string[],options:Record<string,any>)=>{
  calls.push({exe,args,options});if(failure)throw failure
  return {stdout:"owned stdout",stderr:""}
 }
 const execFile=Object.assign(()=>{throw Error("UNEXPECTED_CALLBACK_OUTLET")},{[promisify.custom]:invoke})
 const exports:Record<string,any>={}
 runInNewContext(fs.readFileSync(filename,"utf8"),{exports,__dirname:path.dirname(filename),process:{env},require:(name:string)=>{
  if(name==="path")return path
  if(name==="fs")return {existsSync:()=>true}
  if(name==="util")return {promisify}
  if(name==="child_process")return {execFile}
  if(name==="../types")return {WinAppNotAvailable:class extends Error{}}
  throw Error("UNEXPECTED_MODULE")
 }})
 return {runPs:exports.runPs as AppBinaryMeasureDeps["runner"],calls}
}
test("actual runPs rebuilds Windows builtin module discovery in its child only",async()=>{
 const env=Object.freeze({SystemRoot:"C:\\Windows",PATH:"owned path",PSModulePath:"owned PS7 shadow",psmodulepath:"owned lower shadow",PsMoDuLePaTh:"owned mixed shadow",PSModulePathExtra:"keep exact prefix sibling",OTHER:"keep unrelated"})
 const {runPs,calls}=isolatedRunPs(env)
 assert.equal(await runPs!("C:\\owned helper.ps1",["-TargetPath","C:\\owned application.exe"],{timeoutMs:1234}),"owned stdout")
 assert.equal(calls.length,1)
 const child=calls[0].options.env as NodeJS.ProcessEnv
 assert.ok(child&&child!==env)
 assert.equal(Object.keys(child).some(k=>k.toUpperCase()==="PSMODULEPATH"),false)
 for(const key of ["SystemRoot","PATH","PSModulePathExtra","OTHER"])assert.equal(child[key],env[key as keyof typeof env])
 assert.equal(env.PSModulePath,"owned PS7 shadow");assert.equal(env.psmodulepath,"owned lower shadow");assert.equal(env.PsMoDuLePaTh,"owned mixed shadow")
 assert.deepEqual(Array.from(calls[0].args),["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File","C:\\owned helper.ps1","-TargetPath","C:\\owned application.exe"])
 assert.equal(calls[0].options.timeout,1234);assert.equal(calls[0].options.maxBuffer,16*1024*1024);assert.equal(calls[0].options.windowsHide,true)
})
test("actual runPs preserves an absent module path, defaults, and the original failure",async()=>{
 const env=Object.freeze({SystemRoot:"C:\\Windows",PATH:"owned path"}),failure=Error("OWNED_EXEC_FAILURE")
 const {runPs,calls}=isolatedRunPs(env,failure)
 await assert.rejects(runPs!("C:\\owned helper.ps1",[]),error=>error===failure)
 assert.equal(calls.length,1);assert.equal(calls[0].options.timeout,15000)
 assert.deepEqual(Object.keys(calls[0].options.env).sort(),Object.keys(env).sort())
 assert.equal(calls[0].options.env.PATH,env.PATH)
})
