import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as cp from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
let effects=0
for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) cp.default[key]=()=>{effects++;throw Error('FORBIDDEN_PROCESS')}
syncBuiltinESMExports()
const mod=await import('../build-computer-uia-no-focus.mjs')
const {computerUiaNoFocusCompilePlan:plan,stageComputerUiaNoFocus:stage,parseComputerUiaNoFocusArgs:parse}=mod
const name='computer-uia-no-focus.dll'
const fixture=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'uia-build572-'));const src=path.join(root,'compiled',name),dest=path.join(root,'staged');fs.mkdirSync(path.dirname(src));fs.writeFileSync(src,'OWNED_INERT_DLL_BYTES');return{root,src,dest}}
const cleanup=f=>fs.rmSync(f.root,{recursive:true,force:true})
test('SDK DLL plan uses actual x64 toolchain argv, static CRT and fixed output',()=>{
 const [cl,args]=plan({cl:'C:\\VS tools\\cl.exe',root:'C:\\owned repo',output:'C:\\owned objects'})
 assert.equal(cl,'C:\\VS tools\\cl.exe');assert.deepEqual(args,['/nologo','/std:c++20','/EHsc','/utf-8','/W4','/WX','/MT','/LD','/DUNICODE','/D_UNICODE','C:\\owned repo\\src\\host-use\\win\\native\\computer-uia-no-focus.cpp','/link','/MACHINE:X64','ole32.lib','oleaut32.lib','user32.lib','uiautomationcore.lib','/OUT:C:\\owned objects\\computer-uia-no-focus.dll'])
 assert.equal(args.some(v=>v.includes('WebView2')||v==='node.lib'||v==='/MD'),false)
})
test('CLI only permits build or one explicit absolute stage directory',()=>{
 assert.deepEqual(parse([]),{mode:'build'});assert.deepEqual(parse(['--stage',path.resolve('/owned stage')]),{mode:'stage',destination:path.resolve('/owned stage')})
 for(const args of [['--stage'],['--stage','relative'],['--stage','/owned','extra'],['--target=darwin'],['--install']])assert.throws(()=>parse(args),/UIA_NO_FOCUS_BUILD_ARGS/)
})
test('real owned staging copies the fixed DLL byteexact and later PS-only copies preserve it',()=>{const f=fixture();try{stage(f.src,f.dest);assert.equal(fs.readFileSync(path.join(f.dest,name),'utf8'),'OWNED_INERT_DLL_BYTES');fs.writeFileSync(path.join(f.dest,'computer-uia-invoke.ps1'),'OWNED_PS');assert.equal(fs.readFileSync(path.join(f.dest,name),'utf8'),'OWNED_INERT_DLL_BYTES')}finally{cleanup(f)}})
test('missing compiled DLL hard fails, never publishes success',()=>{const f=fixture();try{fs.unlinkSync(f.src);assert.throws(()=>stage(f.src,f.dest));assert.equal(fs.existsSync(path.join(f.dest,name)),false)}finally{cleanup(f)}})
test('only the fixed source basename can be staged',()=>{const f=fixture();try{const other=path.join(f.root,'other.dll');fs.writeFileSync(other,'OWNED');assert.throws(()=>stage(other,f.dest),/UIA_NO_FOCUS_FILE/)}finally{cleanup(f)}})
test('redirected source or output and hardlinked target cannot overwrite sibling bytes',()=>{const f=fixture();try{
 const sibling=path.join(f.root,'sibling');fs.mkdirSync(sibling);const protectedFile=path.join(sibling,'keep');fs.writeFileSync(protectedFile,'PRESERVE')
 const redirect=path.join(f.root,'redirect');fs.symlinkSync(sibling,redirect,process.platform==='win32'?'junction':'dir');assert.throws(()=>stage(f.src,redirect),/UIA_NO_FOCUS_DIRECTORY/)
 fs.mkdirSync(f.dest);fs.linkSync(protectedFile,path.join(f.dest,name));assert.throws(()=>stage(f.src,f.dest),/UIA_NO_FOCUS_FILE/);assert.equal(fs.readFileSync(protectedFile,'utf8'),'PRESERVE')
 fs.unlinkSync(path.join(f.dest,name));fs.unlinkSync(f.src);fs.symlinkSync(protectedFile,f.src);assert.throws(()=>stage(f.src,f.dest),/UIA_NO_FOCUS_FILE/)
}finally{cleanup(f)}})
test('valid rebuild replaces only its one regular destination',()=>{const f=fixture();try{stage(f.src,f.dest);fs.writeFileSync(path.join(f.dest,'untouched.ps1'),'PRESERVE');fs.writeFileSync(f.src,'NEW_OWNED');stage(f.src,f.dest);assert.equal(fs.readFileSync(path.join(f.dest,name),'utf8'),'NEW_OWNED');assert.equal(fs.readFileSync(path.join(f.dest,'untouched.ps1'),'utf8'),'PRESERVE')}finally{cleanup(f)}})
test('import and all CPU controls execute zero OS commands',()=>assert.equal(effects,0))
