/** Source/formatter/inverse contracts only. No Swift/C/C++ compiler or native execution. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {desktopLocalFixture} from '../desktop-mcp-fixture.mjs'
const root=new URL('../../',import.meta.url),read=rel=>fs.readFileSync(new URL(rel,root),'utf8')
const methods=['desktop.local.state','desktop.terminal.open','desktop.terminal.input','desktop.terminal.resize','desktop.terminal.ack','desktop.terminal.ping','desktop.terminal.close','desktop.terminal.return','desktop.agent.start','desktop.agent.prompt','desktop.agent.cancel']
test('both native finite method grammars agree with exactly eleven approved local methods',()=>{
 const cpp=read('src/desktop/native/DesktopHost.cpp'),swift=read('src/desktop/native/DesktopHost.swift'),c=cpp.match(/static bool local_method[^\n]+/)[0],s=swift.match(/static let localMethods[^\n]+/)[0]
 for(const body of [c,s])assert.deepEqual([...body.matchAll(/"(desktop\.[a-z.]+)"/g)].map(v=>v[1]),methods)
 assert.match(cpp,/local_requests\[native\]=\{pending,type,operation\}/);assert.match(swift,/localRequests\[native\]=\(pending,type,operation\)/)
 assert.match(cpp,/kind!=L"agent-permission"&&!std::any_of\(local_requests/);assert.match(swift,/kind != "agent-permission" \{guard localRequests.values.contains/)
})
test('actual launcher snprintf formats emit version9 while malformed controls retain their intentional protocol faults',()=>{
 for(const file of ['src/desktop/native/launcher.c','tests/fixtures/desktop-480/synchronize-handle-probe.c','tests/fixtures/desktop-480/windows-inheritance.c','tests/fixtures/desktop-480/windows-malformed-bootstrap.c']){
  const formats=[...read(file).matchAll(/"((?:\\.|[^"\\])*)"/g)].map(m=>JSON.parse('"'+m[1]+'"')).filter(s=>s.includes('"issued_method_set_version"'))
  assert.ok(formats.length>=1);for(const format of formats){assert.equal(/"issued_method_set_version":9/.test(format),true);assert.equal(/"issued_method_set_version":7/.test(format),false);assert.ok(format.includes('"protocol_version"'))}
 }
})
test('native local acceptance generation is reversible over both source and controller newline conventions',()=>{
 for(const language of ['cpp','swift'])for(const sourceEol of ['\n','\r\n'])for(const fixtureEol of ['\n','\r\n']){
  const source=read('src/desktop/native/DesktopHost.'+language).replace(/\r\n/g,'\n').replace(/\n/g,sourceEol),fixture=read('tests/fixtures/desktop-476/local-acceptance.'+language).replace(/\r\n/g,'\n').replace(/\n/g,fixtureEol),form=read('tests/fixtures/desktop-476/local-form.js'),actual=desktopLocalFixture(language,source,fixture,form)
  assert.equal(actual.inverse,source);assert.ok(actual.source.includes('D476_LOCAL_DONE'));assert.ok(actual.source.includes('D476.local.complete'));assert.ok(actual.source.includes('77'));assert.ok(actual.source.includes(language==='cpp'?'D476LocalAcceptance::confirmation(*this)':'D476LocalAcceptance.confirmation(self)'))
  assert.throws(()=>desktopLocalFixture(language,source+source,fixture,form),/ANCHOR/)
 }
})
test('style-only HTML placeholders are unique and all other original CSP directives are unchanged',()=>{
 const html=read('src/desktop/assets/index.html'),csp=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1]
 for(const token of ['__CMSPARK_STYLE_NONCE_CSP__','__CMSPARK_STYLE_NONCE_META__'])assert.equal(html.split(token).length,2)
 for(const part of ["default-src 'none'","script-src 'self'","connect-src 'none'","frame-src 'none'","object-src 'none'","base-uri 'none'","form-action 'none'"])assert.ok(csp.split(';').map(s=>s.trim()).includes(part))
 assert.ok(csp.includes("style-src-elem 'self' 'nonce-__CMSPARK_STYLE_NONCE_CSP__'"));assert.equal(csp.includes('unsafe-inline'),false);assert.equal(csp.includes('unsafe-eval'),false)
 const cpp=read('src/desktop/native/DesktopHost.cpp'),swift=read('src/desktop/native/DesktopHost.swift');assert.match(cpp,/style_nonce=random_id\(\)\+random_id\(\)/);assert.match(cpp,/data.find\(marker,at\+1\)!=std::string::npos/);assert.match(swift,/bundledScheme\?\.newDocument\(\)/);assert.match(swift,/UUID\(\).uuidString\+UUID\(\).uuidString/);assert.match(swift,/components\(separatedBy:\$0\).count==2/)
})

test('composed picker and local-work families preserve every normal host byte in both EOL conventions',async()=>{
 const hooks=await import('../desktop-mcp-fixture.mjs'),{desktopAcceptanceVariant}=await import('../build-desktop-windows.mjs')
 for(const language of ['cpp','swift'])for(const eol of ['\n','\r\n']){
  const source=read('src/desktop/native/DesktopHost.'+language).replace(/\r?\n/g,eol),fixture=n=>read('tests/fixtures/desktop-476/'+n+'.'+language),form=n=>read('tests/fixtures/desktop-476/'+n+'-form.js')
  const base=fixture('native-acceptance')
  const variants=[
   hooks.desktopMcpFixture(language,source,base,form('native')),
   hooks.desktopMetadataFixture(language,source,base,form('metadata'),fixture('metadata-acceptance')),
   hooks.desktopDialogFixture(language,source,base,form('dialog'),fixture('dialog-acceptance')),
   hooks.desktopResourceFixture(language,source,fixture('resource-acceptance'),form('resource')),
   hooks.desktopWorkspaceFixture(language,source,fixture('workspace-acceptance'),form('workspace')),
   hooks.desktopLocalFixture(language,source,fixture('local-acceptance'),form('local')),
   desktopAcceptanceVariant(language,source,read('tests/fixtures/desktop-480/native-acceptance.'+language))
  ]
  for(const actual of variants){assert.equal(actual.inverse,source);assert.ok(actual.source.length>source.length)}
  const picker=language==='cpp'?'picker_current(workspace_selection)':'pickerCurrent(selection)',local=language==='cpp'?'void retire_local()':'func retireLocal()',deadline=language==='cpp'?'WM_TIMER&&w==workspace_picker_timer':'p.timer=Timer.scheduledTimer'
  for(const token of [picker,local,deadline])assert.ok(source.includes(token))
  assert.equal(source.includes('pickFolderNative('),false)
 }
})
