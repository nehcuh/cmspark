import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import * as cp from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
let effects=0
for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp.default[key]=()=>{effects++;throw Error('FORBIDDEN_PROCESS')}
syncBuiltinESMExports()
const root=new URL('../../',import.meta.url)
const whole=fs.readFileSync(new URL('src/host-use/win/powershell.ts',root),'utf8')
const source=whole.match(/export function resolveComputerUiaNoFocusDll\(\): string \{[\s\S]*?\n\}/)?.[0]
assert.ok(source,'actual complete dedicated resolver must exist')
const create=new Function('path','fs','process','__dirname',source.replace('export function','return function').replace('(): string','()'))
const dll='computer-uia-no-focus.dll'
function resolve(dir,files=[],env={}){const reads=[],proc={execPath:'C:\\runtime\\node.exe',env};const value=create(path.win32,{existsSync:p=>{reads.push(p);return files.includes(p)}},proc,dir)();return{value,reads}}
test('SEA and flat bundle resolve the fixed adjacent packaged DLL',()=>{
 const sea='C:\\runtime\\host-scripts-win\\'+dll;assert.equal(resolve('C:\\package',[sea]).value,sea)
 const flat='C:\\repo\\companion\\dist\\host-scripts-win\\'+dll;assert.equal(resolve('C:\\repo\\companion\\dist',[flat]).value,flat)
})
test('src and compiled dist use the same built artifact, never a source-tree DLL',()=>{
 const built='C:\\repo\\companion\\dist\\host-scripts-win\\'+dll
 for(const dir of ['C:\\repo\\companion\\src\\host-use\\win','C:\\repo\\companion\\dist\\host-use\\win'])assert.equal(resolve(dir,[built]).value,built)
 const unsafe='C:\\repo\\companion\\src\\host-use\\win\\scripts\\'+dll
 const r=resolve('C:\\repo\\companion\\src\\host-use\\win',[unsafe]);assert.equal(r.reads.includes(unsafe),false);assert.equal(r.value,'C:\\runtime\\host-scripts-win\\'+dll)
})
test('.test-dist resolves companion/dist with the required four-level root',()=>{
 const built='C:\\repo\\companion\\dist\\host-scripts-win\\'+dll
 assert.equal(resolve('C:\\repo\\companion\\.test-dist\\src\\host-use\\win',[built]).value,built)
})
test('override requires the existing explicit opt-in and never changes parent values',()=>{
 const env={CMSPARK_WIN_SCRIPTS:'C:\\owned override',CMSPARK_ALLOW_WIN_SCRIPTS_OVERRIDE:'1',KEEP:'owned'};const before={...env}
 assert.equal(resolve('C:\\unused',[],env).value,'C:\\owned override\\'+dll);assert.deepEqual(env,before)
 for(const flag of [undefined,'0','true'])assert.throws(()=>resolve('C:\\unused',[],{CMSPARK_WIN_SCRIPTS:'C:\\owned',CMSPARK_ALLOW_WIN_SCRIPTS_OVERRIDE:flag}),/DLL override requires/)
})
test('absent output is a deterministic fake-runner argument, not a false native load',()=>{
 const r=resolve('C:\\repo\\companion\\.test-dist\\src\\host-use\\win');assert.equal(r.value,'C:\\runtime\\host-scripts-win\\'+dll);assert.equal(r.reads.length,6);assert.ok(r.reads.every(p=>p.endsWith('\\host-scripts-win\\'+dll)))
})
test('CI compiles before UIA, and both actual packaging producers explicitly stage the DLL',()=>{
 const ci=fs.readFileSync(new URL('../.github/workflows/ci.yml',root),'utf8')
 const normal='node companion/scripts/build-computer-uia-no-focus.mjs',probe='node companion/scripts/build-computer-uia-native-probe-572.mjs'
 const guard='if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'
 const assertBuildOrder=value=>{
  const sequence=/^          node companion\/scripts\/build-computer-uia-no-focus\.mjs\r?\n          if \(\$LASTEXITCODE -ne 0\) \{ exit \$LASTEXITCODE \}\r?\n          node companion\/scripts\/build-computer-uia-native-probe-572\.mjs\r?$/m.exec(value)
  assert.ok(sequence,'normal build must refuse failure before the probe build')
  assert.equal(value.split(normal).length,2);assert.equal(value.split(probe).length,2)
  assert.ok(sequence.index>0&&sequence.index<value.indexOf('Build native desktop fixtures (#480)'))
  assert.ok(sequence.index<value.indexOf('Actual Windows background oracle comparator'))
 }
 const lf=ci.replace(/\r\n/g,'\n')
 for(const value of [lf,lf.replace(/\n/g,'\r\n')])assertBuildOrder(value)
 for(const value of [lf.replace(normal,''),lf.replace(guard,''),lf.replace(probe,''),lf.replace(normal,'BUILD_SWAP').replace(probe,normal).replace('BUILD_SWAP',probe),lf.replace(guard,'if ($LASTEXITCODE -eq 0) { exit $LASTEXITCODE }'),lf.replace('Build native desktop fixtures (#480)','MISSING_NATIVE_STEP')])assert.throws(()=>assertBuildOrder(value))
 const sh=fs.readFileSync(new URL('../scripts/package.sh',root),'utf8');assert.ok(sh.includes('node "${ROOT_DIR}/companion/scripts/build-computer-uia-no-focus.mjs" --stage "${STAGING}/host-scripts-win"'))
 const ps=fs.readFileSync(new URL('../scripts/build-windows-exe.ps1',root),'utf8');assert.ok(ps.includes('& $NodeExe "$CompanionDir\\scripts\\build-computer-uia-no-focus.mjs" --stage "$StagingDir\\host-scripts-win"'));assert.ok(ps.includes('if ($LASTEXITCODE -ne 0) { Fail "Fixed no-autofocus UIA DLL staging failed" }'))
})
test('CPU resolver/pipeline controls execute zero OS commands',()=>assert.equal(effects,0))
