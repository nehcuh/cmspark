/** Pure source/parser controls. No Python/X11/process/native execution. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {desktopLinuxAppsObservation758,projectLinuxAppsObservation758} from '../desktop-linux-apps-observation-fixture-758.mjs'
const producer758=()=>fs.readFileSync(new URL('../../src/activity/linux-recorder.py',import.meta.url),'utf8')
test('758 Linux app observation copies the actual producer with whole-source inverse and unchanged native operations',()=>{
 const canonical=producer758().replace(/\r\n/g,'\n') // Source checkout profiles only, never runtime evidence.
 for(const eol of ['\n','\r\n']){
  const original=canonical.replace(/\n/g,eol),actual=desktopLinuxAppsObservation758(original)
  assert.equal(actual.inverse,original);assert.equal(actual.productionChanged,false)
  assert.deepEqual(actual.sites.map(s=>s.point),Array.from({length:12},(_,i)=>i+1))
  for(const token of ['self.x.XGetWindowAttributes(', 'self.res.XResQueryClientIds(', 'self.res.XResGetClientPid(', 'os.stat(f"/proc/{pid}")', 'os.readlink(f"/proc/{pid}/exe")', 'stream.read(8192)'])assert.equal(actual.source.split(token).length,original.split(token).length,token)
  assert.ok(actual.source.includes('except (OSError, RuntimeError) as error758:'))
  assert.ok(actual.source.includes('"observation758": _d758_snapshot(desktop, len(apps))'))
  assert.throws(()=>desktopLinuxAppsObservation758(original.replace('for window in stack:','for window in []:')),/ACTIVITY758_OBSERVATION_ANCHOR/)
 }
})
test('758 Linux app finite parser refuses non-record and accessor inputs without coercion',()=>{
 let traps=0;const proxy=new Proxy({},{get(){traps++;throw Error('PRIVATE')},ownKeys(){traps++;throw Error('PRIVATE')}}),revoked=Proxy.revocable({},{});revoked.revoke()
 const accessor=Object.defineProperty({},'schema',{enumerable:true,get(){traps++;throw Error('PRIVATE')}})
 for(const value of [undefined,null,false,1,'PRIVATE',[],{},proxy,revoked.proxy,accessor])assert.deepEqual(projectLinuxAppsObservation758(value),{status:'UNKNOWN',reason:'INVALID_SNAPSHOT'})
 assert.equal(traps,0)
 // Positive snapshots are obtained from the actual Python AST producer control,
 // then passed through this actual parser by the shared trusted CPU driver.
})
