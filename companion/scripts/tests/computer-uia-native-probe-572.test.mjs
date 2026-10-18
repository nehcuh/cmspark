import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import cp from 'node:child_process'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import { syncBuiltinESMExports } from 'node:module'
let forbiddenEffects = 0
for(const [module,keys] of [[cp,['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']],[net,['connect','createConnection']],[http,['request','get']],[https,['request','get']]])for(const key of keys)module[key]=()=>{forbiddenEffects++;throw Error('UIA572_FORBIDDEN_OS_NETWORK')}
syncBuiltinESMExports()
import { generateNativeProbe572, stripNativeProbe572, projectNativeProbe572, probe572 } from '../computer-uia-native-probe-572.mjs'
const original = fs.readFileSync(fileURLToPath(new URL('../../src/host-use/win/native/computer-uia-no-focus.cpp',import.meta.url)))
const words = (phases=[1,2,3,4,5]) => {
  const rows=phases.flatMap(phase=>[phase,2,1,0,1,1])
  return [1,phases.length,0,6,1,...rows,...Array(35-5-rows.length).fill(0)]
}
test('native probe is whole-byte reversible including BOM/CRLF and leaves normal source untouched',()=>{
  for(const source of [original,Buffer.from(original.toString().replace(/\r?\n/g,'\r\n')),Buffer.concat([Buffer.from([239,187,191]),original])]) {
    const before=Buffer.from(source),generated=generateNativeProbe572(source)
    assert.ok(stripNativeProbe572(generated).equals(source));assert.ok(source.equals(before))
    assert.match(generated.toString(),/int32_t WINAPI CUiProbeRead572\(int32_t\* output,int32_t capacity\) noexcept/)
    assert.doesNotMatch(source.toString(),/CUiProbeRead572/)
    assert.equal((generated.toString().match(/probeStage572\(4\);\/\*UIA572_NATIVE_PROBE_\d+_END\*\/hr=p->/g)||[]).length,5)
    assert.equal((generated.toString().match(/;\/\*UIA572_NATIVE_PROBE_\d+_BEGIN\*\/probeStage572\(5\);/g)||[]).length,5)
  }
})
test('native probe refuses duplicate/missing anchors and already observed CPP',()=>{
  const anchor='  int32_t status=boundary(r);if(status!=OK)return status;'
  for(const source of [Buffer.from(original.toString().replace(anchor,'')),Buffer.concat([original,Buffer.from(anchor)]),Buffer.from([255])])assert.throws(()=>generateNativeProbe572(source))
  const generated=generateNativeProbe572(original)
  assert.throws(()=>generateNativeProbe572(generated))
  assert.throws(()=>stripNativeProbe572(Buffer.from(generated.toString().replace('UIA572_NATIVE_PROBE_1_END','UIA572_NATIVE_PROBE_99_END'))))
})
test('native probe uses same client and bounded int32-only storage after original call completion',()=>{
  const generated=generateNativeProbe572(original).toString()
  assert.match(generated,/activeProbe572->client=client.Get\(\)/)
  assert.match(generated,/p->client->get_AutoSetFocus\(&focus\)/)
  assert.match(generated,/probeState572.load\(std::memory_order_acquire\)!=2/)
  assert.match(generated,/capacity!=35/)
  assert.match(generated,/if\(count>=5\|\|phase!=count\+1\)\{p->words\[2\]=1;return;\}/)
  for(const term of ['SetForegroundWindow','SetFocus(','SendInput','Sleep(','std::cout','WriteFile','GetEnvironmentVariable'])assert.equal(generated.includes(term),original.toString().includes(term))
  assert.equal(probe572.headerWords+probe572.capacity*probe572.rowWords,35)
})
test('finite ABI decoder accepts exact complete/prefix outcomes without raw identifier fields',()=>{
  const value=projectNativeProbe572(words())
  assert.equal(value.valid,true);assert.equal(value.complete,true);assert.equal(value.rows.length,5)
  for(const phases of [[],[1],[1,2],[1,2,3],[1,2,3,4]])assert.equal(projectNativeProbe572(words(phases)).complete,false)
  assert.equal(projectNativeProbe572([...words(),4,5]).valid,false)
  const unknown=words();unknown[9]=0;unknown[10]=0
  assert.equal(projectNativeProbe572(unknown).rows[0].readback,0)
})
test('ABI negative controls reject widths/caps/extra data/unknown enums/reorder and never reflect input',()=>{
  for(const changed of [
    a=>a.pop(),a=>a.push(123),a=>a[0]=2,a=>a[1]=6,a=>a[2]=1,a=>a[2]=2,a=>a[3]=8,a=>a[4]=0,
    a=>a[5]=2,a=>a[6]=9,a=>a[7]=2,a=>a[9]=2,a=>a[10]=3,a=>a[11]=1,a=>a[34]=3,
    a=>a[9]=0,a=>a[5]='SECRET_PATH',a=>a[5]=2147483648,
  ]){const input=words();changed(input);const output=projectNativeProbe572(input);assert.equal(output.valid,false);assert.deepEqual(output.rows,[]);assert.doesNotMatch(JSON.stringify(output),/SECRET/)}
})

test('diagnostic PS reads fixed ABI after original Act and before JSON; inverse preserves shipped PS',async()=>{
  const {generateNativeProbeScript572,stripNativeProbeScript572,nativeProbeArgs572}=await import('../computer-uia-native-probe-572.mjs')
  const originalPs=fs.readFileSync(fileURLToPath(new URL('../../src/host-use/win/scripts/computer-uia-invoke.ps1',import.meta.url)))
  for(const source of [originalPs,Buffer.from(originalPs.toString().replace(/\r?\n/g,'\r\n'))]){
    const observed=generateNativeProbeScript572(source)
    assert.ok(stripNativeProbeScript572(observed).equals(source))
    const text=observed.toString()
    assert.match(text,/return \[CU.NoFocus\]::Act\([\s\S]+?\} catch \{ Fail "UIA_TERMINAL" "UIA_PATTERN_UNAVAILABLE" 6 \}.*?finally \{/)
    assert.match(text,/ReadProbe\(\$probeWords572, 35\)/)
    assert.ok(text.indexOf('ReadProbe($probeWords572')>text.indexOf('return [CU.NoFocus]::Act'))
  }
  const args=['-Hwnd','44','-NoFocusLibrary','normal.dll','-StopFile','owned.stop']
  assert.deepEqual(nativeProbeArgs572(args,'probe.dll'),['-Hwnd','44','-NoFocusLibrary','probe.dll','-StopFile','owned.stop'])
  assert.equal(args[3],'normal.dll')
  for(const invalid of [[],['-NoFocusLibrary'],['-NoFocusLibrary','one','-NoFocusLibrary','two']])assert.throws(()=>nativeProbeArgs572(invalid,'probe.dll'))
})
test('probe compile outlet changes only source/output argv; production DLL/source plan stays exact',async()=>{
  const {nativeProbeCompilePlan572}=await import('../build-computer-uia-native-probe-572.mjs')
  const {computerUiaNoFocusCompilePlan}=await import('../build-computer-uia-no-focus.mjs')
  const input={cl:'C:\\owned\\cl.exe',root:'C:\\owned repo',output:'C:\\owned output'}
  const before=computerUiaNoFocusCompilePlan(input),after=nativeProbeCompilePlan572(input)
  assert.equal(before[0],after[0]);assert.equal(before[1].length,after[1].length)
  assert.equal(before[1].filter((value,index)=>value!==after[1][index]).length,2)
  assert.match(after[1].join('\n'),/computer-uia-native-probe-572\.cpp/)
  assert.match(after[1].at(-1),/computer-uia-native-probe-572\.dll$/)
  assert.ok(!after[1].at(-1).includes('dist/host-scripts-win'))
  assert.deepEqual(computerUiaNoFocusCompilePlan(input),before)
})

test('all probe CPU controls execute no OS/compiler/network calls',()=>assert.equal(forbiddenEffects,0))
test('CI retains normal build refusal before the test outlet and probe survives canonical test-dist cleanup',()=>{
  const workflow=fs.readFileSync(fileURLToPath(new URL('../../../.github/workflows/ci.yml',import.meta.url)),'utf8')
  const normal='node companion/scripts/build-computer-uia-no-focus.mjs',probe='node companion/scripts/build-computer-uia-native-probe-572.mjs'
  const guard='if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'
  const assertBuildSequence=value=>{
    assert.equal(value.split(normal).length,2);assert.equal(value.split(probe).length,2)
    assert.match(value,/^          node companion\/scripts\/build-computer-uia-no-focus\.mjs\r?\n          if \(\$LASTEXITCODE -ne 0\) \{ exit \$LASTEXITCODE \}\r?\n          node companion\/scripts\/build-computer-uia-native-probe-572\.mjs\r?$/m)
  }
  const lf=workflow.replace(/\r\n/g,'\n')
  for(const value of [lf,lf.replace(/\n/g,'\r\n')])assertBuildSequence(value)
  for(const value of [lf.replace(normal,''),lf.replace(guard,''),lf.replace(probe,''),lf.replace(normal,'BUILD_SWAP').replace(probe,normal).replace('BUILD_SWAP',probe),lf.replace(guard,'if ($LASTEXITCODE -eq 0) { exit $LASTEXITCODE }')])assert.throws(()=>assertBuildSequence(value))
  const builder=fs.readFileSync(fileURLToPath(new URL('../build-computer-uia-native-probe-572.mjs',import.meta.url)),'utf8')
  assert.match(builder,/path.join\(sourceRoot,'dist\/desktop-native\/acceptance\/uia572-probe'\)/)
  assert.doesNotMatch(builder,/\.test-dist|dist\/host-scripts-win/)
})

test('actual current factory survives diagnostic generation under LF and CRLF without changing normal calls',()=>{
  for(const source of [original,Buffer.from(original.toString().replace(/\r?\n/g,'\r\n'))]) {
    const generated=generateNativeProbe572(source),text=generated.toString();
    assert.ok(stripNativeProbe572(generated).equals(source));
    const condition=text.indexOf('client->get_ControlViewCondition(&condition)');
    const factory=text.indexOf('client->CreateTreeWalker(condition.Get(),&walker)');
    assert.ok(condition>0&&factory>condition);
    assert.equal((text.match(/client->get_ControlViewCondition\(/g)||[]).length,1);
    assert.equal((text.match(/client->CreateTreeWalker\(/g)||[]).length,1);
    assert.doesNotMatch(text,/client->get_ControlViewWalker/);
    assert.equal((text.match(/probeStage572\(4\);/g)||[]).length,5);
    assert.equal((text.match(/probeStage572\(5\);/g)||[]).length,5);
  }
});
