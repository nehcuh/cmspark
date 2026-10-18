/** #644 real Windows PowerShell5.1/Registry fixture. Never a native claim off Windows. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {randomUUID} from "node:crypto"
import {runPs} from "../../src/host-use/win/powershell"
import {types} from "node:util"
import {parseDesktopFrame} from "../../src/desktop/flat-json"
import {enumerateApps,enumerateAppsDetailed,resolveAppsEnumerateScript} from "../../src/apps/enumerate"
const fixture=path.resolve(__dirname,"../../../tests/fixtures/registry-owned-644.ps1")
const helper=path.resolve(__dirname,"../../../tests/fixtures/registry-helpers-644.ps1")
const baseline=path.resolve(__dirname,"../../../tests/fixtures/apps-enumerate-644-baseline.ps1")
// Independent filesystem oracle: never derive expected paths from the collector.
function ownedCanonicalFile(input:string):string{
 const canonical=fs.realpathSync.native(input),raw=fs.statSync(input,{bigint:true}),resolved=fs.statSync(canonical,{bigint:true})
 assert.equal(raw.isFile(),true);assert.equal(resolved.isFile(),true);assert.equal(resolved.dev,raw.dev);assert.equal(resolved.ino,raw.ino)
 return canonical
}
function assertOwnedCanonicalFile(actual:unknown,input:string,canonical:string):void{
 assert.equal(typeof actual,"string");const returned=actual as string
 assert.equal(returned.toLowerCase(),canonical.toLowerCase(),"candidate must equal the independently canonicalized owned path")
 assert.equal(fs.realpathSync.native(returned).toLowerCase(),canonical.toLowerCase())
 const expected=fs.statSync(input,{bigint:true}),observed=fs.statSync(returned,{bigint:true})
 assert.equal(observed.isFile(),true);assert.equal(observed.dev,expected.dev);assert.equal(observed.ino,expected.ino,"candidate must still name the same owned file")
}
// REGISTRY644_PASSIVE_OBSERVER_BEGIN
const registryStages644 = ["ENTERED", "OWNER_VERIFIED", "ADD_TYPE_ENTERED", "ADD_TYPE_RETURNED", "VALUES_READY", "REGISTRY_ENTERED", "REGISTRY_COMPLETE", "COMPLETE"] as const
const registryPrefix644 = "REGISTRY644_FIXTURE_PHASE "
const registryBytesLimit644 = 16 * 1024 * 1024
const registryTypedArray644 = Object.getPrototypeOf(Uint8Array.prototype)
const registryByteLength644 = Object.getOwnPropertyDescriptor(registryTypedArray644, "byteLength")!.get!
const registryByteOffset644 = Object.getOwnPropertyDescriptor(registryTypedArray644, "byteOffset")!.get!
const registryBuffer644 = Object.getOwnPropertyDescriptor(registryTypedArray644, "buffer")!.get!
const registryOwnDescriptor644 = Object.getOwnPropertyDescriptor
function ownRegistryErrorField644(error: unknown, key: string): unknown {
 try {
  if (!error || typeof error !== "object" || types.isProxy(error) || !types.isNativeError(error)) return undefined
  const descriptor = registryOwnDescriptor644(error, key)
  return descriptor && "value" in descriptor ? descriptor.value : undefined
 } catch { return undefined }
}
function registryByteCount644(value: unknown): number | null {
 try {
  if (typeof value === "string") { const n=Buffer.byteLength(value,"utf8");return n<=registryBytesLimit644?n:null }
  if (!value || typeof value !== "object" || types.isProxy(value) || !types.isUint8Array(value)) return null
  const n=registryByteLength644.call(value)
  return Number.isInteger(n)&&n>=0&&n<=registryBytesLimit644?n:null
 } catch { return null }
}
function parseRegistryPhases644(value: unknown) {
 type Row={sequence:number;stage:typeof registryStages644[number];elapsed_ms:number|null}
 const empty=(capture:"UNAVAILABLE"|"MISSING"|"INVALID"|"OVER_LIMIT")=>({capture,complete:false,rows:[]as Row[]})
 try {
  const size=registryByteCount644(value)
  if(size===null)return empty("UNAVAILABLE")
  if(size>16384)return empty("OVER_LIMIT")
  let text:string
  if(typeof value==="string"){
   if(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value))return empty("INVALID")
   text=value
  }else{
   // Internal getters ignore custom length/buffer/offset properties; no Proxy is admitted.
   const buffer=registryBuffer644.call(value),offset=registryByteOffset644.call(value)
   text=new TextDecoder("utf-8",{fatal:true}).decode(new Uint8Array(buffer,offset,size))
  }
  const rows:Row[]=[]
  for(let line of text.split("\n")){
   if(line.endsWith("\r"))line=line.slice(0,-1)
   if(!line.includes("REGISTRY644_FIXTURE_PHASE"))continue
   if(!line.startsWith(registryPrefix644)||rows.length>=8)return empty("INVALID")
   const raw=line.slice(registryPrefix644.length),d=parseDesktopFrame(raw)
   if(!d||Object.keys(d).sort().join(",")!=="elapsed_ms,mode,schema,sequence,stage"||d.schema!==1||d.mode!=="create"||d.sequence!==rows.length+1||d.stage!==registryStages644[rows.length])return empty("INVALID")
   if(d.elapsed_ms!==null&&(typeof d.elapsed_ms!=="number"||!Number.isInteger(d.elapsed_ms)||d.elapsed_ms<0||d.elapsed_ms>90000))return empty("INVALID")
   rows.push({sequence:rows.length+1,stage:registryStages644[rows.length],elapsed_ms:d.elapsed_ms as number|null})
  }
  return rows.length?{capture:"READY"as const,complete:rows.length===8,rows}:empty("MISSING")
 }catch{return empty("INVALID")}
}
function registryCause644(error: unknown) {
 const killed=ownRegistryErrorField644(error,"killed"),signal=ownRegistryErrorField644(error,"signal"),code=ownRegistryErrorField644(error,"code")
 const stdout=ownRegistryErrorField644(error,"stdout"),stderr=ownRegistryErrorField644(error,"stderr")
 return {schema:1,mode:"create",timeout_ms:10000,killed:typeof killed==="boolean"?killed:null,
  signal:typeof signal==="string"?(["SIGTERM","SIGKILL"].includes(signal)?signal:"OTHER"):null,
  code:typeof code==="number"&&Number.isInteger(code)&&code>=0&&code<=255?code:typeof code==="string"&&["ENOENT","EACCES","EPERM","ETIMEDOUT","ABORT_ERR","ERR_CHILD_PROCESS_STDIO_MAXBUFFER"].includes(code)?code:null,
  stdout_bytes:registryByteCount644(stdout),stderr_bytes:registryByteCount644(stderr),phases:parseRegistryPhases644(stderr)}
}
async function observeRegistryCreate644(run:()=>Promise<string>,sink:(line:string)=>void):Promise<string>{
 try{return await run()}catch(error){
  try{sink("REGISTRY644_CREATE_FAILURE "+JSON.stringify(registryCause644(error)))}catch{/* Preserve the original child failure, including observer/sink faults. */}
  throw error
 }
}
// REGISTRY644_PASSIVE_OBSERVER_END
const native={skip:process.platform!=="win32",timeout:90000}
test("#644 native5.1 actual collector/runPs/parser owned HKCU rows, old-producer counterfactual and cleanup",native,async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),"cmspark-registry-644-")),id=randomUUID()
 const nested=path.join(directory,"示例, 空间");fs.mkdirSync(nested)
 const good=path.join(nested,"App.EXE"),unquoted=path.join(directory,"Literal.exe"),reparse=path.join(directory,"Link"),dll=path.join(directory,"App.dll"),icon=path.join(directory,"App.ico"),folder=path.join(directory,"Folder.exe")
 fs.writeFileSync(path.join(directory,".owner"),id);fs.writeFileSync(good,"OWNED_INERT_NOT_EXECUTABLE");fs.writeFileSync(unquoted,"OWNED_INERT");fs.symlinkSync(nested,reparse,"junction");assert.equal(/\s/.test(unquoted),false,"CI owned unquoted literal path must contain no whitespace");fs.writeFileSync(dll,"OWNED");fs.writeFileSync(icon,"OWNED");fs.mkdirSync(folder)
 const canonicalGood=ownedCanonicalFile(good),canonicalUnquoted=ownedCanonicalFile(unquoted)
 const entries=[{kind:"good",value:`"${good}",-1`},{kind:"unquoted",value:unquoted+",1"},{kind:"reparse",value:`"${path.join(reparse,"App.EXE")}"`},{kind:"dll",value:`"${dll}",0`},{kind:"icon",value:`"${icon}",0`},{kind:"folder",value:`"${folder}"`},{kind:"missing",value:`"${path.join(directory,"missing.exe")}"`},{kind:"args",value:`"${good}" /quiet`},{kind:"env",value:"%SystemRoot%\\App.exe"},{kind:"relative",value:"relative.exe"},{kind:"long",value:"X".repeat(5000)}]
 fs.writeFileSync(path.join(directory,"values.json"),JSON.stringify(entries))
 let created=false
 try{
  const setup=JSON.parse((await observeRegistryCreate644(()=>runPs(fixture,["create",id,directory],{timeoutMs:10000}),line=>t.diagnostic(line))).trim());assert.equal(setup.native_ps51,true);assert.ok(setup.logical_views===1||setup.logical_views===2);assert.equal(setup.created,11*setup.logical_views);created=true
  const old=await enumerateApps((_script,args,opts)=>runPs(baseline,args,opts));assert.equal(old.some(c=>c.name.startsWith("Owned644_"+id)),false,"actual old collector cannot emit these registry-only fixture rows")
  const current=await enumerateAppsDetailed();const owned=current.candidates.filter(c=>c.name.startsWith("Owned644_"+id))
  assert.equal(owned.length,2);assert.ok(owned.every(c=>c.source==="registry"));assertOwnedCanonicalFile(owned.find(c=>c.name==="Owned644_"+id+"_good")?.path,good,canonicalGood);assertOwnedCanonicalFile(owned.find(c=>c.name==="Owned644_"+id+"_unquoted")?.path,unquoted,canonicalUnquoted)
  const precedence=JSON.parse((await runPs(helper,["owned-precedence",resolveAppsEnumerateScript(),directory],{timeoutMs:20000})).trim())
  assert.equal(precedence.apps[0].name,"OwnedLegacy644");assert.equal(precedence.apps[0].source,"running")
  assert.equal(precedence.apps.filter((c:any)=>c.path?.toLowerCase()===canonicalGood.toLowerCase()).length,1,"earlier source wins and Registry duplicates do not append")
  assertOwnedCanonicalFile(precedence.apps[0].path,good,canonicalGood)
  t.diagnostic("NATIVE_OWNED_FILESYSTEM_IDENTITY strict_canonical=true same_file=true short_alias_observed="+(/~[0-9]/i.test(directory)&&directory.toLowerCase()!==fs.realpathSync.native(directory).toLowerCase()))
  assert.equal(current.registry_summary?.status,"partial");assert.ok(current.registry_summary?.reasons.includes("VALUE_LIMIT"))
  t.diagnostic("NATIVE_PS51_REGISTRY_ACTUAL_PRODUCER owned_rows=2 old_owned_rows=0 invalid_rows=0 duplicate_paths=0 oversized_partial=true reparse_rejected=true")
 }finally{
  if(created||fs.existsSync(path.join(directory,"registry-ledger.json"))){await runPs(fixture,["cleanup",id,directory],{timeoutMs:10000});assert.equal(JSON.parse((await runPs(fixture,["check",id,directory],{timeoutMs:10000})).trim()).cleanup,true)}
  fs.rmSync(directory,{recursive:true,force:true})
 }
})
test("#644 native5.1 actual serializer/wire maxBuffer boundaries and bounded primitive query faults",{skip:process.platform!=="win32",timeout:150000},async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),"cmspark-registry-primitives-644-"));fs.writeFileSync(path.join(directory,"App.exe"),"OWNED_INERT");fs.writeFileSync(path.join(directory,"App.dll"),"OWNED");fs.mkdirSync(path.join(directory,"Folder.exe"))
 const input=path.join(directory,"App.exe"),canonical=ownedCanonicalFile(input)
 fs.writeFileSync(path.join(directory,"owned-native-files.json"),JSON.stringify({app:canonical}))
 const call=(mode:string)=>runPs(helper,[mode,resolveAppsEnumerateScript(),directory],{timeoutMs:20000})
 try{
  // Real PS5.1 parser negative: fixed public bad source, no metadata/env dump.
  const badSyntax=path.join(directory,"owned-invalid-syntax.ps1")
  fs.writeFileSync(badSyntax,"if ($true -or ) { 'OWNED_PARSE_TEXT_NEVER_LOG' }\n")
  await assert.rejects(runPs(helper,["primitives",badSyntax,directory],{timeoutMs:20000}),(e:any)=>{
   const stderr=String(e.stderr??"")
   assert.match(stderr,/OWNED_PRODUCTION_PS_SYNTAX ErrorId=[A-Za-z][A-Za-z0-9]{0,63} Line=1 Column=[0-9]+/)
   assert.equal(stderr.includes("OWNED_PARSE_TEXT_NEVER_LOG"),false,"parser diagnostic must not print raw source/Extent.Text")
   return e.code===1
  })
  const primitive=JSON.parse((await call("primitives")).trim());assert.equal(primitive.native_ps51,true);assert.equal(primitive.cases.length,12);assert.equal(primitive.literal_controls,true);assert.equal(primitive.admission_boundaries,6);assertOwnedCanonicalFile(primitive.quoted_path,input,canonical);assertOwnedCanonicalFile(primitive.unquoted_path,input,canonical)
  const small=await call("small-wire"),measure=JSON.parse((await call("measure-small")).trim()),raw=Buffer.from(small,"utf8")
  const hasBom=raw.subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf]))
  t.diagnostic("NATIVE_PS51_WIRE_MEASURE actual_bytes="+raw.length+" counted_bytes="+measure.wire_bytes+" prefix_hex="+raw.subarray(0,3).toString("hex")+" has_bom="+hasBom+" configured_preamble_bytes="+measure.configured_preamble_bytes+" newline_bytes="+measure.newline_bytes)
  assert.equal(measure.native_ps51,true);assert.equal(measure.encoding_codepage,65001);assert.equal(hasBom,false,"Console stdout must not emit the encoding's optional preamble")
  assert.equal(small.startsWith("{"),true);assert.equal(small.endsWith("\r\n"),true);assert.equal(measure.newline_bytes,2)
  assert.equal(raw.length,measure.body_bytes+measure.newline_bytes,"actual stdout is exactly UTF-8 body plus actual newline")
  assert.equal(raw.length,measure.wire_bytes,"actual emitted UTF-8/newline equals production cost")
  const partial=await call("partial-wire");assert.equal(Buffer.byteLength(partial,"utf8"),16777216);const p=JSON.parse(partial.trim());assert.deepEqual(p.registry_summary,{status:"partial",reasons:["OUTPUT_LIMIT"]});assert.equal(p.apps.length,1)
  const legacy=await call("legacy-wire");assert.equal(Buffer.byteLength(legacy,"utf8"),16777216);const l=JSON.parse(legacy.trim());assert.equal(Object.hasOwn(l,"registry_summary"),false);assert.equal(l.apps.length,1)
  await assert.rejects(call("overflow-wire"),(e:any)=>e.code==="ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
  t.diagnostic("NATIVE_PS51_REGISTRY_WIRE actual_UTF8_cost=true exact_16MiB=true zero_row_partial=true no_summary_legacy=true original_overflow_reject=true primitive_faults=12 admission_boundaries=6")
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
})

// CPU-only passive observation controls; never a Windows/Registry claim.
function phaseText644(count=8,eol="\n") { return registryStages644.slice(0,count).map((stage,i)=>registryPrefix644+JSON.stringify({schema:1,mode:"create",sequence:i+1,stage,elapsed_ms:i})).join(eol)+eol }
test('#644 passive phases retain exact LF/CRLF ordered bounded records and unknown absence',()=>{
 for(const eol of ["\n","\r\n"]){const full=parseRegistryPhases644(phaseText644(8,eol));assert.equal(full.capture,"READY");assert.equal(full.complete,true);assert.equal(full.rows.length,8);const partial=parseRegistryPhases644(phaseText644(3,eol));assert.equal(partial.complete,false);assert.equal(partial.rows.at(-1)!.stage,"ADD_TYPE_ENTERED")}
 const empty=parseRegistryPhases644("unrelated private-looking error text");assert.equal(empty.capture,"MISSING");assert.doesNotMatch(JSON.stringify(empty),/private-looking/)
})
test('#644 passive phase parser rejects duplicate escaped keys malformed framing extra types and overflow',()=>{
 const row={schema:1,mode:"create",sequence:1,stage:"ENTERED",elapsed_ms:0},valid=JSON.stringify(row)
 for(const body of [valid.replace('"schema":1','"schema":1,"schema":1'),valid.replace('"mode":"create"','"mode":"create","\\u006dode":"create"'),JSON.stringify({...row,extra:"NEVER_ECHO"}),valid.replace('"elapsed_ms":0','"elapsed_ms":NaN'),JSON.stringify({...row,sequence:true}),JSON.stringify({...row,stage:"NEVER_ECHO"}),JSON.stringify({...row,elapsed_ms:90001}),"{"]){const result=parseRegistryPhases644(registryPrefix644+body+"\n");assert.equal(result.capture,"INVALID");assert.doesNotMatch(JSON.stringify(result),/NEVER_ECHO/)}
 for(const text of [phaseText644()+phaseText644(1),phaseText644(2).split('\n').reverse().join('\n'),"noise\u000b"+phaseText644(1),phaseText644(1).replace('ENTERED','UNKNOWN'),phaseText644(1).replace('REGISTRY644_FIXTURE_PHASE ', 'REGISTRY644_FIXTURE_PHASE\t')])assert.equal(parseRegistryPhases644(text).capture,"INVALID")
 assert.equal(parseRegistryPhases644("x".repeat(16385)).capture,"OVER_LIMIT")
 assert.equal(parseRegistryPhases644(Buffer.from([0xff])).capture,"INVALID")
 assert.equal(parseRegistryPhases644("\ud800").capture,"INVALID")
})
test('#644 passive cause reads native data only and preserves UTF8 counts without reflecting body',()=>{
 const error=Object.assign(new Error('NEVER_ECHO'),{code:null,killed:true,signal:'SIGTERM',stdout:'中文',stderr:phaseText644(3)})
 const out=registryCause644(error);assert.equal(out.killed,true);assert.equal(out.signal,'SIGTERM');assert.equal(out.stdout_bytes,6);assert.equal(out.phases.rows.length,3);assert.doesNotMatch(JSON.stringify(out),/NEVER_ECHO|中文/)
 const refused=registryCause644(Object.assign(new Error('NEVER_ECHO'),{code:1,killed:false,signal:null,stderr:''}));assert.equal(refused.code,1);assert.equal(refused.killed,false);assert.equal(refused.phases.capture,'MISSING')
})
test('#644 passive cause never executes accessors error Proxy or revoked Proxy traps',()=>{
 let touches=0;const error=new Error('NEVER_ECHO')
 for(const key of ['code','killed','signal','stdout','stderr'])Object.defineProperty(error,key,{get(){touches++;throw Error('NEVER_ECHO')}})
 assert.equal(registryCause644(error).code,null);assert.equal(touches,0)
 const proxy=new Proxy(error,{get(){touches++;throw Error('NEVER_ECHO')},getPrototypeOf(){touches++;throw Error('NEVER_ECHO')},getOwnPropertyDescriptor(){touches++;throw Error('NEVER_ECHO')}})
 assert.equal(registryCause644(proxy).killed,null);assert.equal(touches,0)
 const revoked=Proxy.revocable(error,{});revoked.revoke();assert.doesNotThrow(()=>registryCause644(revoked.proxy));assert.equal(touches,0)
})
test('#644 passive byte count ignores Buffer getters and refuses Proxy buffers without traps',()=>{
 let touches=0;const bytes=Buffer.from(phaseText644(1))
 for(const key of ['length','byteLength','byteOffset','buffer'])Object.defineProperty(bytes,key,{get(){touches++;throw Error('NEVER_ECHO')}})
 const out=registryCause644(Object.assign(new Error('owned'),{stderr:bytes}));assert.equal(out.phases.capture,'READY');assert.equal(touches,0)
 const p=new Proxy(Buffer.from('owned'),{get(){touches++;throw Error('NEVER_ECHO')},getPrototypeOf(){touches++;throw Error('NEVER_ECHO')}})
 assert.equal(registryCause644(Object.assign(new Error('owned'),{stderr:p})).stderr_bytes,null);assert.equal(touches,0)
 const revoked=Proxy.revocable(Buffer.from('owned'),{});revoked.revoke();assert.equal(parseRegistryPhases644(revoked.proxy).capture,'UNAVAILABLE');assert.equal(touches,0)
})
test('#644 actual passive create wrapper preserves success error identity and sink faults with one call',async()=>{
 let calls=0,sinks=0;assert.equal(await observeRegistryCreate644(async()=>{calls++;return 'owned stdout'},()=>{sinks++}),'owned stdout');assert.equal(calls,1);assert.equal(sinks,0)
 const original=Object.assign(new Error('NEVER_ECHO'),{killed:true,signal:'SIGTERM',stderr:phaseText644(3),stdout:''}),seen:string[]=[]
 calls=0;await assert.rejects(observeRegistryCreate644(async()=>{calls++;throw original},line=>seen.push(line)),e=>e===original);assert.equal(calls,1);assert.equal(seen.length,1);assert.equal(JSON.parse(seen[0].slice('REGISTRY644_CREATE_FAILURE '.length)).phases.rows.at(-1).stage,'ADD_TYPE_ENTERED');assert.doesNotMatch(seen[0],/NEVER_ECHO/)
 await assert.rejects(observeRegistryCreate644(async()=>{throw original},()=>{throw Error('sink fault')}),e=>e===original)
})
test('#644 passive fixture contains only eight fixed create stages without additional module commands',()=>{
 const source=fs.readFileSync(fixture,'utf8'),begin=source.indexOf('# REGISTRY644_PASSIVE_PHASE_BEGIN'),end=source.indexOf('# REGISTRY644_PASSIVE_PHASE_END')
 assert.ok(begin>0&&end>begin);const helper=source.slice(begin,end)
 assert.doesNotMatch(helper,/Add-Type|ConvertTo-Json|New-Object|Write-Output|Get-Content/)
 assert.match(helper,/\$Mode -ne 'create'/)
 assert.deepEqual([...source.matchAll(/^[ \t]*Write-RegistryPhase644 '([A-Z_]+)'\r?$/gm)].map(m=>m[1]),[...registryStages644])
})
