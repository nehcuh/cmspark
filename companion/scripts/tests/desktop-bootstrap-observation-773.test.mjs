import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {desktopAcceptanceVariant} from '../build-desktop-windows.mjs'
import {desktopBootstrapObservationFixture773,bootstrapObservationSites773} from '../desktop-bootstrap-observation-fixture.mjs'
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
 const builder=read('scripts/build-desktop-windows.mjs');assert.match(builder,/mode==="inheritance"\?desktopBootstrapObservationFixture773\(variant.source\)/)
 assert.equal(builder.includes('timeout: 120_000'),true)
 const acceptance=read('tests/desktop-native-windows-480.test.ts');assert.match(acceptance,/\["visual","hostile","reconnect","relaunch","inheritance"\].*timeout:20000/)
})
