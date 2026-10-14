/** #644 real Windows PowerShell5.1/Registry fixture. Never a native claim off Windows. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {randomUUID} from "node:crypto"
import {runPs} from "../../src/host-use/win/powershell"
import {enumerateApps,enumerateAppsDetailed,resolveAppsEnumerateScript} from "../../src/apps/enumerate"
const fixture=path.resolve(__dirname,"../../../tests/fixtures/registry-owned-644.ps1")
const helper=path.resolve(__dirname,"../../../tests/fixtures/registry-helpers-644.ps1")
const baseline=path.resolve(__dirname,"../../../tests/fixtures/apps-enumerate-644-baseline.ps1")
const native={skip:process.platform!=="win32",timeout:90000}
test("#644 native5.1 actual collector/runPs/parser owned HKCU rows, old-producer counterfactual and cleanup",native,async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),"cmspark-registry-644-")),id=randomUUID()
 const nested=path.join(directory,"示例, 空间");fs.mkdirSync(nested)
 const good=path.join(nested,"App.EXE"),unquoted=path.join(directory,"Literal.exe"),reparse=path.join(directory,"Link"),dll=path.join(directory,"App.dll"),icon=path.join(directory,"App.ico"),folder=path.join(directory,"Folder.exe")
 fs.writeFileSync(path.join(directory,".owner"),id);fs.writeFileSync(good,"OWNED_INERT_NOT_EXECUTABLE");fs.writeFileSync(unquoted,"OWNED_INERT");fs.symlinkSync(nested,reparse,"junction");assert.equal(/\s/.test(unquoted),false,"CI owned unquoted literal path must contain no whitespace");fs.writeFileSync(dll,"OWNED");fs.writeFileSync(icon,"OWNED");fs.mkdirSync(folder)
 const entries=[{kind:"good",value:`"${good}",-1`},{kind:"unquoted",value:unquoted+",1"},{kind:"reparse",value:`"${path.join(reparse,"App.EXE")}"`},{kind:"dll",value:`"${dll}",0`},{kind:"icon",value:`"${icon}",0`},{kind:"folder",value:`"${folder}"`},{kind:"missing",value:`"${path.join(directory,"missing.exe")}"`},{kind:"args",value:`"${good}" /quiet`},{kind:"env",value:"%SystemRoot%\\App.exe"},{kind:"relative",value:"relative.exe"},{kind:"long",value:"X".repeat(5000)}]
 fs.writeFileSync(path.join(directory,"values.json"),JSON.stringify(entries))
 let created=false
 try{
  const setup=JSON.parse((await runPs(fixture,["create",id,directory],{timeoutMs:10000})).trim());assert.equal(setup.native_ps51,true);assert.ok(setup.logical_views===1||setup.logical_views===2);assert.equal(setup.created,11*setup.logical_views);created=true
  const old=await enumerateApps((_script,args,opts)=>runPs(baseline,args,opts));assert.equal(old.some(c=>c.name.startsWith("Owned644_"+id)),false,"actual old collector cannot emit these registry-only fixture rows")
  const current=await enumerateAppsDetailed();const owned=current.candidates.filter(c=>c.name.startsWith("Owned644_"+id))
  assert.equal(owned.length,2);assert.ok(owned.every(c=>c.source==="registry"));assert.equal(owned.find(c=>c.name==="Owned644_"+id+"_good")?.path?.toLowerCase(),good.toLowerCase());assert.equal(owned.find(c=>c.name==="Owned644_"+id+"_unquoted")?.path?.toLowerCase(),unquoted.toLowerCase())
  const precedence=JSON.parse((await runPs(helper,["owned-precedence",resolveAppsEnumerateScript(),directory],{timeoutMs:20000})).trim())
  assert.equal(precedence.apps[0].name,"OwnedLegacy644");assert.equal(precedence.apps[0].source,"running")
  assert.equal(precedence.apps.filter((c:any)=>c.path?.toLowerCase()===good.toLowerCase()).length,1,"earlier source wins and Registry duplicates do not append")
  assert.equal(current.registry_summary?.status,"partial");assert.ok(current.registry_summary?.reasons.includes("VALUE_LIMIT"))
  t.diagnostic("NATIVE_PS51_REGISTRY_ACTUAL_PRODUCER owned_rows=2 old_owned_rows=0 invalid_rows=0 duplicate_paths=0 oversized_partial=true reparse_rejected=true")
 }finally{
  if(created||fs.existsSync(path.join(directory,"registry-ledger.json"))){await runPs(fixture,["cleanup",id,directory],{timeoutMs:10000});assert.equal(JSON.parse((await runPs(fixture,["check",id,directory],{timeoutMs:10000})).trim()).cleanup,true)}
  fs.rmSync(directory,{recursive:true,force:true})
 }
})
test("#644 native5.1 actual serializer/wire maxBuffer boundaries and bounded primitive query faults",{skip:process.platform!=="win32",timeout:150000},async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),"cmspark-registry-primitives-644-"));fs.writeFileSync(path.join(directory,"App.exe"),"OWNED_INERT");fs.writeFileSync(path.join(directory,"App.dll"),"OWNED");fs.mkdirSync(path.join(directory,"Folder.exe"))
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
  const primitive=JSON.parse((await call("primitives")).trim());assert.equal(primitive.native_ps51,true);assert.equal(primitive.cases.length,12);assert.equal(primitive.literal_controls,true);assert.equal(primitive.admission_boundaries,6)
  const small=await call("small-wire"),measure=JSON.parse((await call("measure-small")).trim());assert.equal(Buffer.byteLength(small,"utf8"),measure.wire_bytes,"actual emitted UTF-8/newline/preamble equals production cost")
  const partial=await call("partial-wire");assert.equal(Buffer.byteLength(partial,"utf8"),16777216);const p=JSON.parse(partial.trim());assert.deepEqual(p.registry_summary,{status:"partial",reasons:["OUTPUT_LIMIT"]});assert.equal(p.apps.length,1)
  const legacy=await call("legacy-wire");assert.equal(Buffer.byteLength(legacy,"utf8"),16777216);const l=JSON.parse(legacy.trim());assert.equal(Object.hasOwn(l,"registry_summary"),false);assert.equal(l.apps.length,1)
  await assert.rejects(call("overflow-wire"),(e:any)=>e.code==="ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
  t.diagnostic("NATIVE_PS51_REGISTRY_WIRE actual_UTF8_cost=true exact_16MiB=true zero_row_partial=true no_summary_legacy=true original_overflow_reject=true primitive_faults=12 admission_boundaries=6")
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
})
