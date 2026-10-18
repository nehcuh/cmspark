import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import vm from 'node:vm'
import os from 'node:os'
import {createHash} from 'node:crypto'
import * as ui705 from '../desktop-workspace-ui-705.mjs'
import {desktopWorkspaceFixture} from '../desktop-mcp-fixture.mjs'
const {workspaceUI705Plan,WORKSPACE_UI705_ID}=ui705
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
test('705 fixed UI build plan precompiles without starting native UI tests',()=>{const p=workspaceUI705Plan('/owned/companion','/owned/native');assert.equal(p.commands.length,3);assert.equal(p.commands[0][0],'/usr/bin/swiftc');assert.equal(p.commands[2][0],'/usr/bin/xcodebuild');assert.equal(p.commands[2][1][0],'build-for-testing');assert.doesNotMatch(JSON.stringify(p.commands),/test-without-building|sudo|tccutil|DevToolsSecurity|automation|unsafe-inline/);assert.equal(WORKSPACE_UI705_ID,'com.cmspark.tests.workspace-ui-705.xctrunner')})
test('705 UI target scheme is singular and has no target app auto-launch',()=>{const project=fs.readFileSync(path.join(root,'tests/fixtures/workspace-ui-705/OwnedPickerUI.xcodeproj/project.pbxproj'),'utf8'),scheme=fs.readFileSync(path.join(root,'tests/fixtures/workspace-ui-705/OwnedPickerUI.xcodeproj/xcshareddata/xcschemes/OwnedPickerUI.xcscheme'),'utf8');assert.equal(project.split('isa=PBXNativeTarget').length,2);assert.match(project,/productType="com.apple.product-type.bundle.ui-testing"/);assert.match(project,/TEST_TARGET_NAME=""/);assert.match(project,/path=OwnedUIProtocol.swift/);assert.match(project,/path=WorkspacePickerUITests.swift/);assert.doesNotMatch(scheme,/LaunchAction|MacroExpansion|skip.*YES|testRepetition/);assert.match(scheme,/parallelizable="NO"/)})
test('705 app packaging preserves the bare binary and validates exact derived runner metadata',()=>{const source=fs.readFileSync(path.join(root,'scripts/desktop-workspace-ui-705.mjs'),'utf8');assert.match(source,/generated\/acceptance-workspace\/main.swift/);assert.match(source,/COPYFILE_EXCL/);assert.match(source,/CFBundleIdentifier/);assert.match(source,/CFBundleExecutable/);assert.match(source,/--verify.*--deep.*--strict/);assert.match(source,/package-manifest.json/);assert.match(source,/sourceRoot,fs.realpathSync/);assert.doesNotMatch(source,/NSWorkspace|XCUIApplication|open -a|register|install|\.app.*launch/);const normal=fs.readFileSync(path.join(root,'scripts/build-desktop-native.mjs'),'utf8');assert.equal(normal.split('buildWorkspaceUI705(root,dest)').length,2)})
test('705 bundled fixture lookup changes only the unique asset root and refuses drift for LF and CRLF',()=>{
 const original=fs.readFileSync(path.join(root,'src/desktop/native/DesktopHost.swift'),'utf8'),bare='executable.deletingLastPathComponent().appendingPathComponent("assets")',bundled='executable.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Resources/assets")'
 for(const text of [original,original.replace(/\r?\n/g,'\r\n')]){const result=ui705.workspaceUI705BundleSource(text);assert.equal(result.inverse,text);assert.equal(result.source.replace(bundled,bare),text);assert.equal(result.source.split(bundled).length,2);assert.throws(()=>ui705.workspaceUI705BundleSource(text.replace(bare,'missing')),/OWNED_UI_BUILD_ASSET_SOURCE/);assert.throws(()=>ui705.workspaceUI705BundleSource(text+'\n'+bare),/OWNED_UI_BUILD_ASSET_SOURCE/);assert.throws(()=>ui705.workspaceUI705BundleSource(result.source),/OWNED_UI_BUILD_ASSET_SOURCE/)}
})
test('705 actual builder stages Resources assets and compiles the matching bundle-only lookup before signing',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cmspark-ui705-bundle-')),owned=path.join(temp,'companion'),dest=path.join(owned,'dist/native'),fixture=path.join(owned,'tests/fixtures/workspace-ui-705'),work=path.join(dest,'generated/workspace-ui-705'),products=path.join(work,'DerivedData/Build/Products'),commands=[]
 const write=(file,data,mode=0o644)=>{fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,data,{mode})}
 try{
  write(path.join(fixture,'observer-main.swift'),'// inert observer input\n');write(path.join(fixture,'App-Info.plist'),fs.readFileSync(path.join(root,'tests/fixtures/workspace-ui-705/App-Info.plist')))
  const original=fs.readFileSync(path.join(root,'src/desktop/native/DesktopHost.swift'),'utf8'),variant=desktopWorkspaceFixture('swift',original,fs.readFileSync(path.join(root,'tests/fixtures/desktop-476/workspace-acceptance.swift'),'utf8'),fs.readFileSync(path.join(root,'tests/fixtures/desktop-476/workspace-form.js'),'utf8'));assert.equal(variant.inverse,original)
  write(path.join(dest,'generated/acceptance-workspace/main.swift'),variant.source);write(path.join(dest,'generated/DesktopCapabilities.swift'),'// inert generated capability input\n')
  const bare=path.join(dest,'acceptance/workspace/cmspark-desktop'),bareBytes=Buffer.from('inert-bare-binary-not-executable');write(bare,bareBytes);write(path.join(dest,'acceptance/workspace/assets/index.html'),'<p>inert public asset</p>\n')
  const spawnSync=(bin,args)=>{
   commands.push([bin,[...args]])
   if(bin==='/usr/bin/swiftc'){const output=args[args.indexOf('-o')+1];write(output,'inert-compiled-output-not-executable',0o755);return {status:0,stdout:'',stderr:''}}
   if(bin==='/usr/bin/xcodebuild'){write(path.join(products,'Debug/OwnedPickerUITests-Runner.app/Contents/Info.plist'),'<plist/>');write(path.join(products,'OwnedPickerUI_macosx-owned.xctestrun'),'<plist/>');return {status:0,stdout:'',stderr:''}}
   if(bin==='/usr/bin/plutil')return {status:0,stdout:args[1]==='CFBundleIdentifier'?WORKSPACE_UI705_ID:'OwnedPickerUITests-Runner',stderr:''}
   if(bin==='/usr/bin/codesign'){if(args[args.length-1].endsWith('OwnedPicker705.app')){assert.equal(fs.existsSync(path.join(args[args.length-1],'Contents/MacOS/assets')),false);assert.equal(fs.readFileSync(path.join(args[args.length-1],'Contents/Resources/assets/index.html'),'utf8'),'<p>inert public asset</p>\n')}return {status:0,stdout:'',stderr:''}}
   assert.fail('unexpected native command plan')
  }
  const source=fs.readFileSync(path.join(root,'scripts/desktop-workspace-ui-705.mjs'),'utf8').replace(/^import .*\n/gm,'').replace(/^export /gm,'')+'\nglobalThis.actualBuild=buildWorkspaceUI705;'
  const context=vm.createContext({fs,path,createHash,spawnSync,process:{platform:'darwin'},Buffer});new vm.Script(source).runInContext(context);context.actualBuild(owned,dest)
  assert.deepEqual(fs.readFileSync(bare),bareBytes)
  const app=path.join(dest,'acceptance/workspace-ui/OwnedPicker705.app'),compile=commands.filter(([bin,args])=>bin==='/usr/bin/swiftc'&&args.at(-1)===path.join(app,'Contents/MacOS/cmspark-desktop'));assert.equal(compile.length,1)
  const generated=fs.readFileSync(compile[0][1][1],'utf8'),bundled='executable.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Resources/assets")',plain='executable.deletingLastPathComponent().appendingPathComponent("assets")';assert.equal(generated.split(bundled).length,2);assert.equal(generated.replace(bundled,plain),variant.source)
  assert.ok(commands.findIndex(c=>c===compile[0])<commands.findIndex(([bin,args])=>bin==='/usr/bin/codesign'&&args.at(-1)===app))
  assert.equal(commands.filter(([bin])=>bin==='/usr/bin/xcodebuild').length,1)
  const inventory=JSON.parse(fs.readFileSync(path.join(dest,'acceptance/workspace-ui/package-manifest.json'),'utf8'));assert.ok(inventory.files.some(row=>row.path==='OwnedPicker705.app/Contents/Resources/assets/index.html'));assert.equal(inventory.files.some(row=>row.path.startsWith('OwnedPicker705.app/Contents/MacOS/assets/')),false)
 }finally{fs.rmSync(temp,{recursive:true,force:true})}
})

// The actual retained dialog/production branch is lowered only for inert CPU execution.
const workspaceCpp705=()=>fs.readFileSync(path.join(root,'tests/fixtures/desktop-476/workspace-acceptance.cpp'),'utf8')
function cancelSuffix705(source,hr){
 const anchor='KillTimer(h.window,476);++panels;pickerNonce.clear();expectedDirectory.Reset();'
 assert.equal(source.split(anchor).length,2)
 const start=source.indexOf(anchor),body=source.slice(start,source.indexOf('\n}',start)).replace(/\bL"/g,'"').replace(/\(void\)/g,'').replace(/->/g,'.').replace(/auto closed=/g,'const closed=').replace(/(\d+)u\b/g,'$1')
 const trace=[],s={panels:1,cancelPicker:true,h:{window:1},dialog:2,button:3,pickerNonce:{clear(){}},expectedDirectory:{Reset(){}},KillTimer(){},emit(_,id){trace.push(id)},note(){},fail(){trace.push('FAIL')},cancelNote(_,id){trace.push(id)},activeDialog:{Close(){trace.push('Close');return hr}},FAILED:v=>v<0,HRESULT_FROM_WIN32:v=>v,ERROR_CANCELLED:1223,SendMessageW(){throw Error('UNEXPECTED_CLICK')},BM_CLICK:0,IsWindow:()=>true}
 vm.compileFunction(body,Object.keys(s))(...Object.values(s));return trace
}
test('705 actual cancellation requires the retained Close result, not the earlier readiness marker',()=>{
 for(const source of [workspaceCpp705(),workspaceCpp705().replace(/\r?\n/g,'\r\n')]){
  const ok=cancelSuffix705(source,0),bad=cancelSuffix705(source,-1)
  assert.ok(ok.indexOf('D476_WS_PICKER_CANCELLED')<ok.indexOf('Close'))
  assert.ok(ok.includes('D476_WS_CANCEL_CLOSE_OK'));assert.equal(ok.includes('FAIL'),false)
  assert.ok(bad.includes('D476_WS_CANCEL_CLOSE_FAIL'));assert.ok(bad.includes('FAIL'));assert.equal(bad.includes('D476_WS_CANCEL_CLOSE_OK'),false)
  assert.equal(ok.filter(x=>x==='Close').length,1);assert.equal(bad.filter(x=>x==='Close').length,1)
 }
})
test('705 generated post-Show observer preserves the actual guard and normal-host inverse',()=>{
 const original=fs.readFileSync(path.join(root,'src/desktop/native/DesktopHost.cpp'),'utf8'),fixture=workspaceCpp705(),form=fs.readFileSync(path.join(root,'tests/fixtures/desktop-476/workspace-form.js'),'utf8')
 for(const text of [original,original.replace(/\r?\n/g,'\r\n')]){
  const result=desktopWorkspaceFixture('cpp',text,fixture,form),anchor='HRESULT shown=dialog->Show(window);KillTimer(window,workspace_picker_timer);',hook='D476Acceptance::shown(*this,shown,p->settled,picker_current(p));'
  assert.equal(result.inverse,text);assert.equal(result.source.split(hook).length,2)
  assert.ok(result.source.indexOf(hook)>result.source.indexOf(anchor));assert.ok(result.source.indexOf(hook)<result.source.indexOf('if(p->settled||!picker_current(p))return;'))
  assert.throws(()=>desktopWorkspaceFixture('cpp',text.replace(anchor,'missing'),fixture,form),/DESKTOP_WORKSPACE_FIXTURE_ANCHOR/)
  assert.throws(()=>desktopWorkspaceFixture('cpp',text+'\n'+anchor,fixture,form),/DESKTOP_WORKSPACE_FIXTURE_ANCHOR/)
 }
})
test('705 actual Show result observer cannot bypass original stale or settled guards',()=>{
 const cpp=workspaceCpp705(),match=/void D476Acceptance::shown\(Desktop& h,HRESULT result,bool settled,bool current\) noexcept \{([\s\S]*?)\n\}/.exec(cpp);assert.ok(match)
 const body=match[1].replace(/\bL"/g,'"').replace(/std::wstring\(/g,'String(').replace(/std::wstring /g,'let ').replace(/\.c_str\(\)/g,'').replace(/catch\(\.\.\.\)/g,'catch').replace(/std::to_wstring\((settled|current)\?1:0\)/g,'String($1?1:0)').replace(/auto /g,'let ')
 const host=fs.readFileSync(path.join(root,'src/desktop/native/DesktopHost.cpp'),'utf8'),a='if(p->settled||!picker_current(p))return;',b='ComPtr<IShellItem> item;'
 const branch=host.slice(host.indexOf(a),host.indexOf(b,host.indexOf(a))).replace(/->/g,'.').replace(/\bL"/g,'"')
 for(const [settled,current,shown,expected,kind]of [[false,true,1223,'cancelled','CANCELLED'],[true,true,1223,null,'CANCELLED'],[false,false,1223,null,'CANCELLED'],[false,true,-1,'unavailable','FAILED'],[false,true,0,null,'SUCCESS']]){
  const output=[];vm.compileFunction(body,['h','result','settled','current','cancelPicker','HRESULT_FROM_WIN32','ERROR_CANCELLED','FAILED','cancelNote'])({},shown,settled,current,true,x=>x,1223,x=>x<0,(_,id)=>output.push(id))
  assert.deepEqual(output,[`D476_WS_CANCEL_SHOW_${kind}_${+settled}_${+current}`]);let got=null
  vm.compileFunction(branch,['p','shown','picker_current','finish_picker','HRESULT_FROM_WIN32','ERROR_CANCELLED','FAILED','wall_ms','deadline'])({settled},shown,()=>current,(_,v)=>got=v,x=>x,1223,x=>x<0,()=>0,1);assert.equal(got,expected)
 }
 // Close's success cannot manufacture a Show return; no hook executes in that schedule.
 assert.equal(cancelSuffix705(cpp,0).some(x=>x.startsWith('D476_WS_CANCEL_SHOW_')),false)
 const quiet=[];vm.compileFunction(body,['h','result','settled','current','cancelPicker','HRESULT_FROM_WIN32','ERROR_CANCELLED','FAILED','cancelNote'])({},1223,false,true,false,x=>x,1223,x=>x<0,(_,id)=>quiet.push(id));assert.deepEqual(quiet,[])
})


test('705 actual UI app-state gate uses one observation and refuses all nonrunning states',()=>{
 const source=fs.readFileSync(path.join(root,'tests/fixtures/workspace-ui-705/WorkspacePickerUITests.swift'),'utf8').replace(/\r\n/g,'\n'),a=source.indexOf('  let app=XCUIApplication(url:scene.appBundle)'),b=source.indexOf('  func ready(',a);assert.ok(a>=0&&b>a);const body=source.slice(a,b),decl=/let ([A-Za-z_][A-Za-z0-9_]*)=app\.state/.exec(body),guard=/guard (.+) else\{throw OwnedUI705Error\.refused\}/.exec(body);assert.ok(guard);const expr=guard[1].replace(/\.(runningForeground|runningBackground)\b/g,(_,k)=>JSON.stringify(k)),code=(decl?'const '+decl[1]+'=app.state;':'')+'return Boolean('+expr+')',check=vm.compileFunction(code,['app']);
 for(const states of [['runningBackground','runningForeground'],['runningForeground','runningBackground'],['runningForeground','runningForeground'],['runningBackground','runningBackground'],['notRunning','notRunning'],['runningUnknown','runningUnknown'],['unknown','unknown']]){let calls=0;const app={get state(){assert.ok(calls<states.length,'unbounded state reads');return states[calls++]}};assert.equal(check(app),['runningForeground','runningBackground'].includes(states[0]),JSON.stringify(states));assert.equal(calls,1,'gate is one asynchronous state snapshot')}
})
