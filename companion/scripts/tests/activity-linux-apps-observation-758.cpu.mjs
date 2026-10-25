/** Linux owning-CI preflight only. No native APIs; actual Python AST producer contract. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {desktopLinuxAppsObservation758,projectLinuxAppsObservation758} from '../desktop-linux-apps-observation-fixture-758.mjs'

const originalPath=fileURLToPath(new URL('../../src/activity/linux-recorder.py',import.meta.url))
const counterPath=fileURLToPath(new URL('./activity-linux-apps-observation-758.cpu.py',import.meta.url))
const originalBytes=fs.readFileSync(originalPath)
assert.ok(originalBytes.length>0&&originalBytes.length<=2*1024*1024)
const original=originalBytes.toString('utf8'),generated=desktopLinuxAppsObservation758(original)
assert.equal(generated.inverse,original)
assert.ok(Buffer.byteLength(generated.source)<=2*1024*1024)
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'activity758-cpu-'))
try{
 const observedPath=path.join(directory,'observed.py'),resultPath=path.join(directory,'result.json')
 fs.writeFileSync(observedPath,generated.source,{flag:'wx',mode:0o600})
 // The owning job already supplies this Python. Never fall back to host/PATH Python.
 // A single fixed child has a 60s hard limit; this preflight does not enter X11.
 execFileSync('/usr/bin/python3',['-I','-S',counterPath,originalPath,observedPath,resultPath],{timeout:60000,maxBuffer:1024*1024,stdio:'pipe',env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}})
 const bytes=fs.readFileSync(resultPath);assert.ok(bytes.length<=131072)
 const result=JSON.parse(bytes.toString('utf8')),sha=value=>createHash('sha256').update(value).digest('hex')
 assert.equal(result.schema,1);assert.equal(result.status,'CPU_CONTRACT')
 assert.equal(result.originalSHA256,sha(originalBytes));assert.equal(result.observedSHA256,sha(Buffer.from(generated.source)))
 assert.equal(result.originalOutputAmbiguityRED,true);assert.equal(result.nativeExecuted,false);assert.equal(result.realProcRead,false);assert.equal(result.apiTracesConserved,true)
 assert.equal(result.observations.length,20)
 assert.equal(new Set(result.observations.map(row=>row.case)).size,20)
 for(const row of result.observations){
  const finite=projectLinuxAppsObservation758(row.snapshot)
  assert.equal(finite.status,'OBSERVED');assert.deepEqual(finite.snapshot,row.snapshot)
  assert.ok(!JSON.stringify(finite).includes('PRIVATE'))
 }
 // Negative inputs are explicit mutants of a genuine actual-info refusal output.
 const actual=result.observations.find(row=>row.case==='attributes-zero').snapshot
 const copy=()=>JSON.parse(JSON.stringify(actual)),mutants=[]
 {const value=copy();value.rows[0][0]=2;mutants.push(value)}
 {const value=copy();value.rows[0][1]=13;mutants.push(value)}
 {const value=copy();value.rows[0][2]=7;mutants.push(value)}
 {const value=copy();value.rows[0][3]=1;mutants.push(value)}
 {const value=copy();value.stackCount=0;mutants.push(value)}
 {const value=copy();value.infoReturned=1;mutants.push(value)}
 {const value=copy();value.invalid=true;mutants.push(value)}
 {const value=copy();value.privateText='PRIVATE';mutants.push(value)}
 for(const value of mutants)assert.deepEqual(projectLinuxAppsObservation758(value),{status:'UNKNOWN',reason:'INVALID_SNAPSHOT'})
 process.stdout.write('D758_LINUX_CPU_CONTRACT '+JSON.stringify({schema:1,actualSnapshots:20,negativeMutants:8,sourceInverse:true,apiTracesConserved:true,originalOutputAmbiguityRED:true,nativeExecuted:false})+'\n')
}finally{fs.rmSync(directory,{recursive:true,force:true})}
