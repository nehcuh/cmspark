import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {desktopAcceptanceVariant} from '../build-desktop-windows.mjs'
import {desktopBootstrapObservationFixture773,desktopMcpBootstrapObservationFixture773,bootstrapObservationSites773} from '../desktop-bootstrap-observation-fixture.mjs'
import {desktopMcpFixture} from '../desktop-mcp-fixture.mjs'
const root=path.resolve(import.meta.dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
test('773 actual inheritance producer source keeps every original byte and operand in LF and CRLF',()=>{
 const original=read('src/desktop/native/DesktopHost.cpp'),fixture=read('tests/fixtures/desktop-480/native-acceptance.cpp')
 for(const eol of ['\n','\r\n']){
  const host=original.replace(/\r\n/g,'\n').replace(/\n/g,eol),control=fixture.replace(/\r\n/g,'\n').replace(/\n/g,eol)
  const base=desktopAcceptanceVariant('cpp',host,control);assert.equal(base.inverse,host)
  const result=desktopBootstrapObservationFixture773(base.source);assert.equal(result.inverse,base.source);assert.equal(result.sites.length,30)
  assert.equal(result.source.includes('obApi773(29,[&](){return web->Navigate(document_url);})'),true)
  assert.equal(result.source.includes('obApi773(9,[&](){return host->get_CoreWebView2(&web);})'),true)
  assert.equal(result.source.includes('if(FAILED(code)||!host){ExitProcess(52);return E_FAIL;}'),true)
  assert.equal(result.source.includes('obMeasure773(3,[&](){return inheritedChecker(receiver,L"--sentinel");})'),true)
  assert.equal(result.source.includes('obMeasure773(4,[&](){return inheritedChecker(receiver,L"--descendant");})'),true)
  for(let point=5;point<=29;point++)if(![6,8,26].includes(point))assert.equal(result.source.split('obApi773('+point+',').length,2)
 }
 assert.equal(bootstrapObservationSites773[28],'Navigate')
})
test('773 producer rejects changed or ambiguous original anchors instead of emitting a partial instrumented host',()=>{
 const original=read('src/desktop/native/DesktopHost.cpp'),fixture=read('tests/fixtures/desktop-480/native-acceptance.cpp'),base=desktopAcceptanceVariant('cpp',original,fixture).source
 for(const changed of [base.replace('void build_webview(){','void drift_webview(){'),base.replace('host->get_CoreWebView2(&web)','host->changed_CoreWebView2(&web)'),base.replace('void D480Acceptance::preConsume(HANDLE input){','void changed_preConsume(HANDLE input){'),base+base])assert.throws(()=>desktopBootstrapObservationFixture773(changed),/BOOT773_/)
 assert.throws(()=>desktopBootstrapObservationFixture773(''),/BOOT773_SOURCE/)
 assert.throws(()=>desktopBootstrapObservationFixture773(base+'obRecord773'),/BOOT773_SOURCE/)
 const builder=read('scripts/build-desktop-windows.mjs');assert.match(builder,/mode==="inheritance"\|\|mode==="visual"\?desktopBootstrapObservationFixture773\(variant.source\)/)
 assert.equal(builder.includes('timeout: 120_000'),true)
 const acceptance=read('tests/desktop-native-windows-480.test.ts');assert.match(acceptance,/\["visual","hostile","reconnect","relaunch","inheritance"\].*timeout:20000/)
})

test('782 visual bootstrap selection covers the actual relaunch binary and excludes hostile and parent families',()=>{
 const builder=read('scripts/build-desktop-windows.mjs'),controller=read('tests/fixtures/desktop-480/native-acceptance-controller.ts')
 const selection=/const observed=([^;]+);if\(observed\.inverse!==variant\.source\)throw Error\("BOOT773_BUILD_INVERSE"\);/g
 const mapping=/const data = ownDataRoot\(\), native = path\.resolve\("dist\/desktop-native"\), variant = ([^\r\n]+)\r?\n/g
 const expressions=[...builder.matchAll(selection)],variants=[...controller.matchAll(mapping)]
 assert.equal(expressions.length,1);assert.equal(variants.length,1)
 const select=new Function('mode','variant','desktopBootstrapObservationFixture773','return '+expressions[0][1])
 const binary=new Function('mode','return '+variants[0][1])
 const original=read('src/desktop/native/DesktopHost.cpp'),fixture=read('tests/fixtures/desktop-480/native-acceptance.cpp')
 for(const eol of ['\n','\r\n']){
  const host=original.replace(/\r\n/g,'\n').replace(/\n/g,eol),control=fixture.replace(/\r\n/g,'\n').replace(/\n/g,eol)
  const base=desktopAcceptanceVariant('cpp',host,control)
  for(const mode of ['visual','hostile','reconnect','relaunch','inheritance','parent']){
   const family=binary(mode),value=select(family,base,desktopBootstrapObservationFixture773)
   assert.equal(value.inverse,base.source)
   assert.equal(value.source.includes('obRecord773'),!['hostile','parent'].includes(mode))
   if(['visual','reconnect','relaunch'].includes(mode))assert.equal(family,'visual')
   if(['hostile','parent'].includes(mode))assert.equal(value.source,base.source)
  }
  // Restore only the newly added selector operand: the real old builder leaves relaunch unobserved.
  const current=expressions[0][1],operand='||mode==="visual"';assert.equal(current.split(operand).length,2)
  const prior=new Function('mode','variant','desktopBootstrapObservationFixture773','return '+current.replace(operand,''))
  assert.equal(prior(binary('relaunch'),base,desktopBootstrapObservationFixture773).source,base.source)
 }
})

test('782 relaunch projections expose existing bounded rows without changing authority or attributing a process',()=>{
 const source=read('tests/fixtures/desktop-480/native-acceptance-controller.ts')
 const projections=[...source.matchAll(/bootstrap773:([^?\r\n]+)\?observer\.bootstrapObservation773\(\):null/g)]
 assert.equal(projections.length,2,'deadline/cleanup and success use the same projection')
 for(const projection of projections){
  const expression=projection[1]+'?observer.bootstrapObservation773():null',project=new Function('mode','observer','return '+expression)
  const rows=[[8,1,0,0,0,2],[8,1,2,0,0,1]],snapshot={clock:'native-first-hook-250ms',processInstanceAttributed:false,rows}
  let reads=0;const observer={bootstrapObservation773(){reads++;return snapshot}}
  for(const mode of ['inheritance','relaunch'])assert.equal(project(mode,observer),snapshot)
  assert.equal(reads,2)
  for(const mode of ['visual','hostile','reconnect','parent','unknown'])assert.equal(project(mode,observer),null)
  assert.equal(reads,2);assert.equal(snapshot.processInstanceAttributed,false)
  const operand='||mode==="relaunch"';assert.equal(expression.split(operand).length,2)
  assert.equal(new Function('mode','observer','return '+expression.replace(operand,''))('relaunch',observer),null)
 }
 assert.match(source,/bootstrapObservation773:\(\)=>\(\{clock:"native-first-hook-250ms" as const,processInstanceAttributed:false,rows:bootstrapRows773\.map\(row=>\[\.\.\.row\]\)\}\)/)
 assert.match(source,/await until\(\(\) => has\("AUTH_1"\) && listReads > 0\)/)
 assert.match(source,/assert\.equal\(exits, launches, "Every actually launched owned native process must settle"\)/)
})

test('825 actual MCP producer reuses only WebView 773 sites and restores every source byte in LF/CRLF',()=>{
 const original=read('src/desktop/native/DesktopHost.cpp'),fixture=read('tests/fixtures/desktop-476/native-acceptance.cpp'),form=read('tests/fixtures/desktop-476/native-form.js')
 for(const eol of ['\n','\r\n']){
  const host=original.replace(/\r?\n/g,eol),control=fixture.replace(/\r?\n/g,eol)
  const base=desktopMcpFixture('cpp',host,control,form),result=desktopMcpBootstrapObservationFixture773(base.source)
  assert.equal(result.inverse,base.source);assert.equal(base.inverse,host)
  assert.deepEqual(result.sites,bootstrapObservationSites773)
  for(const point of [5,7,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,27,28,29])assert.equal(result.source.split('D476Acceptance::obApi773('+point+',').length,2)
  assert.equal(result.source.split('D476Acceptance::obCallback773(6,hr,env!=nullptr);').length,2)
  assert.equal(result.source.split('D476Acceptance::obCallback773(8,code,host!=nullptr);').length,2)
  assert.equal(result.source.split('D476Acceptance::ObScope773 resourceScope773(30);').length,2)
  assert.ok(result.source.includes('D476Acceptance::obApi773(29,[&](){return web->Navigate(document_url);})'))
  assert.ok(result.source.includes('D476Acceptance::obApi773(24,[&](){return web->add_NavigationCompleted('))
  assert.ok(result.source.includes('phase=L"ready";ready=true;DESKTOP_TEST_NOTE(ready_accepted)D476Acceptance::obBind773(*this);'))
  assert.ok(result.source.includes('void D476Acceptance::emit(Desktop& h,std::wstring const& value){emit(h,(L"D480A_"+value).c_str());}'))
  assert.equal(result.source.includes('D480Acceptance::'),false,'no #480 behavior is installed')
  assert.equal(result.source.includes('inheritedChecker'),false)
  assert.equal(result.source.includes('ObScope773 obScope773(26)'),false)
  assert.ok(result.source.includes('obRows773[192]'));assert.ok(result.source.includes('ordinal>8'));assert.ok(result.source.includes('elapsed/250'))
  for(const changed of [base.source.replace('struct D476Acceptance {','struct ChangedAcceptance {'),base.source.replace('web->Navigate(document_url)','web->ChangedNavigate(document_url)'),base.source+base.source])assert.throws(()=>desktopMcpBootstrapObservationFixture773(changed),/BOOT773_/)
 }
})

test('825 actual builder selects extra bootstrap observation only for the unshipped MCP family',()=>{
 const builder=read('scripts/build-desktop-windows.mjs'),selection=/const mcpObserved=([^;]+);if\(mcpObserved&&mcpObserved\.inverse!==mcpVariant\.source\)/g
 const matches=[...builder.matchAll(selection)];assert.equal(matches.length,1)
 const select=new Function('family','mcpVariant','desktopMcpBootstrapObservationFixture773','desktopConfirmationObservationFixture','return '+matches[0][1])
 const variant={source:'owned-generated-source'},mcp=value=>({kind:'mcp',inverse:value}),local=(value,kind)=>({kind,inverse:value})
 assert.deepEqual(select('mcp',variant,mcp,local),{kind:'mcp',inverse:variant.source})
 assert.deepEqual(select('local',variant,mcp,local),{kind:'LOCAL',inverse:variant.source})
 for(const family of ['metadata','dialog','resource','workspace','archive'])assert.equal(select(family,variant,mcp,local),null)
 const test=read('tests/desktop-native-mcp-476.test.ts');assert.match(test,/timeout:20000/)
 assert.match(test,/bootstrap773:\{clock:"native-first-hook-250ms",processInstanceAttributed:false,rows:bootstrapRows773\.map\(row=>\[\.\.\.row\]\)\}/)
 assert.match(test,/observeNativePhaseResponses\(ws,nativePhases,nativeNavigation,\{rows:bootstrapRows773,seen:bootstrapSeen773\}\)/)
})
