import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import vm from 'node:vm'
import os from 'node:os'
import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
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
 const observations=[],temp=fs.mkdtempSync(path.join(os.tmpdir(),'cmspark-ui705-bundle-')),owned=path.join(temp,'companion'),dest=path.join(owned,'dist/native'),fixture=path.join(owned,'tests/fixtures/workspace-ui-705'),work=path.join(dest,'generated/workspace-ui-705'),products=path.join(work,'DerivedData/Build/Products'),commands=[]
 const write=(file,data,mode=0o644)=>{fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,data,{mode})}
 try{
  write(path.join(fixture,'observer-main.swift'),'// inert observer input\n');write(path.join(fixture,'App-Info.plist'),fs.readFileSync(path.join(root,'tests/fixtures/workspace-ui-705/App-Info.plist')))
  const original=fs.readFileSync(path.join(root,'src/desktop/native/DesktopHost.swift'),'utf8'),variant=desktopWorkspaceFixture('swift',original,fs.readFileSync(path.join(root,'tests/fixtures/desktop-476/workspace-acceptance.swift'),'utf8'),fs.readFileSync(path.join(root,'tests/fixtures/desktop-476/workspace-form.js'),'utf8'));assert.equal(variant.inverse,original)
  write(path.join(dest,'generated/acceptance-workspace/main.swift'),variant.source);write(path.join(dest,'generated/DesktopCapabilities.swift'),'// inert generated capability input\n')
  const bare=path.join(dest,'acceptance/workspace/cmspark-desktop'),bareBytes=Buffer.from('inert-bare-binary-not-executable');write(bare,bareBytes);write(path.join(dest,'acceptance/workspace/assets/index.html'),'<p>inert public asset</p>\n')
  let convertedDescriptor
  const spawnSync=(bin,args,options)=>{
   commands.push([bin,[...args]])
   if(bin==='/usr/bin/swiftc'){const output=args[args.indexOf('-o')+1];write(output,'inert-compiled-output-not-executable',0o755);return {status:0,stdout:'',stderr:''}}
   if(bin==='/usr/bin/xcodebuild'){write(path.join(products,'Debug/OwnedPickerUITests-Runner.app/Contents/Info.plist'),'<plist/>');write(path.join(products,'OwnedPickerUI_macosx-owned.xctestrun'),'<plist/>');return {status:0,stdout:'',stderr:''}}
   if(bin==='/usr/bin/plutil'&&args[0]==='-convert'){
    assert.equal(options.timeout,5000);assert.equal(options.maxBuffer,65536)
    if(args[1]==='xml1'){assert.deepEqual([...args],['-convert','xml1','-o','-','-']);convertedDescriptor=JSON.parse(options.input.toString('utf8'));assert.equal(convertedDescriptor.OwnedPickerUITests.UITargetAppPath,'__TESTROOT__/../OwnedPicker705.app');return{status:0,stdout:Buffer.from('<plist>'+JSON.stringify(convertedDescriptor)+'</plist>')}}
    assert.equal(args[1],'json');assert.ok([path.join(products,'OwnedPickerUI_macosx-owned.xctestrun'),path.join(dest,'acceptance/workspace-ui/Products/OwnedPickerUI.xctestrun')].includes(args[4]))
    const value=args[4].startsWith(products+'/')||convertedDescriptor===undefined?{OwnedPickerUITests:{TestHostPath:'__TESTROOT__/Debug/OwnedPickerUITests-Runner.app',TestBundlePath:'__TESTHOST__/Contents/PlugIns/OwnedPickerUITests.xctest',Unchanged:'PUBLIC_CONTROL'}}:convertedDescriptor
    return {status:0,stdout:Buffer.from(JSON.stringify(value)),stderr:Buffer.alloc(0)}
   }
   if(bin==='/usr/bin/plutil')return {status:0,stdout:args[1]==='CFBundleIdentifier'?WORKSPACE_UI705_ID:'OwnedPickerUITests-Runner',stderr:''}
   if(bin==='/usr/bin/codesign'){if(args[args.length-1].endsWith('OwnedPicker705.app')){assert.equal(fs.existsSync(path.join(args[args.length-1],'Contents/MacOS/assets')),false);assert.equal(fs.readFileSync(path.join(args[args.length-1],'Contents/Resources/assets/index.html'),'utf8'),'<p>inert public asset</p>\n')}return {status:0,stdout:'',stderr:''}}
   assert.fail('unexpected native command plan')
  }
  const source=fs.readFileSync(path.join(root,'scripts/desktop-workspace-ui-705.mjs'),'utf8').replace(/^import .*\n/gm,'').replace(/^export /gm,'')+'\nglobalThis.actualBuild=buildWorkspaceUI705;'
  const context=vm.createContext({fs:{...fs,writeSync(fd,value){assert.equal(fd,1);observations.push(value);return Buffer.byteLength(value)}},path,createHash,spawnSync,isDeepStrictEqual,process:{platform:'darwin',stdout:{write(value){observations.push(value)}}},Buffer,TextDecoder});new vm.Script(source).runInContext(context);context.actualBuild(owned,dest)
  assert.deepEqual(fs.readFileSync(bare),bareBytes)
  const app=path.join(dest,'acceptance/workspace-ui/OwnedPicker705.app'),compile=commands.filter(([bin,args])=>bin==='/usr/bin/swiftc'&&args.at(-1)===path.join(app,'Contents/MacOS/cmspark-desktop'));assert.equal(compile.length,1)
  const generated=fs.readFileSync(compile[0][1][1],'utf8'),bundled='executable.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Resources/assets")',plain='executable.deletingLastPathComponent().appendingPathComponent("assets")';assert.equal(generated.split(bundled).length,2);assert.equal(generated.replace(bundled,plain),variant.source)
  assert.ok(commands.findIndex(c=>c===compile[0])<commands.findIndex(([bin,args])=>bin==='/usr/bin/codesign'&&args.at(-1)===app))
  assert.equal(commands.filter(([bin])=>bin==='/usr/bin/xcodebuild').length,1)
  const inventory=JSON.parse(fs.readFileSync(path.join(dest,'acceptance/workspace-ui/package-manifest.json'),'utf8'));assert.ok(inventory.files.some(row=>row.path==='OwnedPicker705.app/Contents/Resources/assets/index.html'));assert.equal(inventory.files.some(row=>row.path.startsWith('OwnedPicker705.app/Contents/MacOS/assets/')),false)
  const finalDescriptor=path.join(dest,'acceptance/workspace-ui/Products/OwnedPickerUI.xctestrun'),descriptorRows=inventory.files.filter(row=>row.path==='Products/OwnedPickerUI.xctestrun');assert.equal(descriptorRows.length,1);assert.equal(descriptorRows[0].sha256,createHash('sha256').update(fs.readFileSync(finalDescriptor)).digest('hex'));assert.equal(descriptorRows[0].bytes,fs.statSync(finalDescriptor).size)
  assert.notEqual(fs.readFileSync(finalDescriptor,'utf8'),'<plist/>','actual generated missing binding must be repaired before final inventory')
  assert.equal(convertedDescriptor.OwnedPickerUITests.Unchanged,'PUBLIC_CONTROL');assert.equal(fs.readFileSync(path.join(work,'descriptor-original.xctestrun'),'utf8'),'<plist/>');assert.equal(fs.readFileSync(path.join(products,'OwnedPickerUI_macosx-owned.xctestrun'),'utf8'),'<plist/>');const binding=JSON.parse(fs.readFileSync(path.join(work,'descriptor-binding-proof.json'),'utf8'));assert.equal(binding.originalSHA256,createHash('sha256').update('<plist/>').digest('hex'));assert.equal(binding.finalSHA256,descriptorRows[0].sha256)
  assert.equal(observations.length,1,'actual successful builder must emit one closed descriptor observation');assert.ok(observations[0].startsWith('D705_UI_DESCRIPTOR '));const descriptor=JSON.parse(observations[0].slice('D705_UI_DESCRIPTOR '.length));assert.equal(descriptor.schema,1);assert.equal(descriptor.status,'OBSERVED');assert.equal(descriptor.format,1);assert.equal(descriptor.expectedTarget,true);assert.equal(descriptor.targetCount,'ONE');assert.equal(descriptor.TestHostPath.exists,true);assert.equal(descriptor.TestBundlePath.exists,false);assert.equal(descriptor.UITargetAppPath.exists,true);assert.equal(observations[0].includes(temp),false)
 }finally{fs.rmSync(temp,{recursive:true,force:true})}
})

test('705 fixed Format1 binding preserves every other descriptor semantic for LF and CRLF',()=>{
 const s=descriptorScene705();try{
  const original=descriptorInput705();delete original.OwnedPickerUITests.UITargetAppPath;original.OwnedPickerUITests.CommandLineArguments=['unchanged'];original.__xctestrun_metadata__={FormatVersion:1,PublicMarker:'UNCHANGED'}
  for(const text of [JSON.stringify(original,null,2),JSON.stringify(original,null,2).replace(/\n/g,'\r\n')]){
   const result=JSON.parse(ui705.workspaceUI705BoundDescriptor(text,s.stage));assert.equal(result.OwnedPickerUITests.UITargetAppPath,'__TESTROOT__/../OwnedPicker705.app');delete result.OwnedPickerUITests.UITargetAppPath;assert.deepEqual(result,original)
  }
  const exact=descriptorInput705();assert.deepEqual(JSON.parse(ui705.workspaceUI705BoundDescriptor(JSON.stringify(exact),s.stage)),exact)
 }finally{s.clean()}
})
test('705 fixed Format1 binding refuses unknown target shapes and all nonliteral existing app paths',()=>{
 const s=descriptorScene705();try{
  const missing=descriptorInput705();delete missing.OwnedPickerUITests.UITargetAppPath
  const inputs=['null','[]','{}','{','{"OwnedPickerUITests":{"unchanged":9007199254740993}}','{"OwnedPickerUITests":{"unchanged":-0}}','{"OwnedPickerUITests":{"unchanged":1e400}}',JSON.stringify({Other:missing.OwnedPickerUITests}),JSON.stringify({...missing,Other:{}}),JSON.stringify({OwnedPickerUITests:[]}),JSON.stringify({__xctestrun_metadata__:{FormatVersion:2},...missing}),JSON.stringify({__xctestrun_metadata__:false,...missing})]
  for(const v of ['/foreign/PRIVATE_SENTINEL','__TESTROOT__/../Other.app','__TESTHOST__/Other.app','',null,1,{}]){const data=structuredClone(missing);data.OwnedPickerUITests.UITargetAppPath=v;inputs.push(JSON.stringify(data))}
  for(const text of inputs)assert.throws(()=>ui705.workspaceUI705BoundDescriptor(text,s.stage),e=>e.message==='OWNED_UI_BUILD_TARGET_BINDING'&&!String(e).includes('PRIVATE_SENTINEL'))
 }finally{s.clean()}
})
test('705 fixed Format1 binding validates only the known staged app and refuses missing file or symlink aliases',()=>{
 const s=descriptorScene705();try{
  const data=descriptorInput705(),app=path.join(s.stage,'OwnedPicker705.app');fs.rmSync(app,{recursive:true});assert.throws(()=>ui705.workspaceUI705BoundDescriptor(JSON.stringify(data),s.stage),/OWNED_UI_BUILD_TARGET_BINDING/)
  fs.writeFileSync(app,'not-a-directory');assert.throws(()=>ui705.workspaceUI705BoundDescriptor(JSON.stringify(data),s.stage),/OWNED_UI_BUILD_TARGET_BINDING/);fs.unlinkSync(app)
  fs.mkdirSync(app,{mode:0o700});const moved=app+'-moved';fs.renameSync(app,moved);fs.symlinkSync(moved,app,process.platform==='win32'?'junction':'dir');assert.throws(()=>ui705.workspaceUI705BoundDescriptor(JSON.stringify(data),s.stage),/OWNED_UI_BUILD_TARGET_BINDING/)
 }finally{s.clean()}
})
test('705 fixed binding final descriptor digest distinguishes the stale row from the recomputed row',()=>{
 const s=descriptorScene705();try{
  const file=s.descriptor,old=fs.readFileSync(file),oldRow={path:'Products/OwnedPickerUI.xctestrun',bytes:old.length,sha256:createHash('sha256').update(old).digest('hex')},data=descriptorInput705();delete data.OwnedPickerUITests.UITargetAppPath
  const bound=Buffer.from(ui705.workspaceUI705BoundDescriptor(JSON.stringify(data),s.stage));fs.writeFileSync(file,bound)
  const actual=(bytes,row)=>bytes.length===row.bytes&&createHash('sha256').update(bytes).digest('hex')===row.sha256
  assert.equal(actual(fs.readFileSync(file),oldRow),false);const row={...oldRow,bytes:bound.length,sha256:createHash('sha256').update(bound).digest('hex')};assert.equal(actual(fs.readFileSync(file),row),true)
 }finally{s.clean()}
})

// The actual retained dialog/production branch is lowered only for inert CPU execution.
const workspaceCpp705=()=>fs.readFileSync(path.join(root,'tests/fixtures/desktop-476/workspace-acceptance.cpp'),'utf8')
function cancelSuffix705(source,options={}){
 const anchor='KillTimer(h.window,476);++panels;pickerNonce.clear();expectedDirectory.Reset();',capture='const auto ownedNonce=p->nonce;',lambda='auto cancelButtonCurrent=[&](){'
 assert.equal(source.split(anchor).length,2);assert.equal(source.split(capture).length,2);assert.equal(source.split(lambda).length,2)
 const start=source.indexOf(anchor),end=source.indexOf('\n}',start),prelude=source.slice(source.indexOf(capture),source.indexOf(' };',source.indexOf(lambda))+3)
 assert.ok(end>start&&prelude.includes('wchar_t buttonClass[16]{};'))
 const lower=text=>text.replace(/\bL"/g,'"').replace(/->/g,'.').replace(/\bconst auto /g,'const ').replace('auto cancelButtonCurrent=[&](){','const cancelButtonCurrent=()=>{').replace('wchar_t buttonClass[16]{};','const buttonClass=[];').replace(/owner==&h/g,'owner===h').replace(/(\d+)u\b/g,'$1').replace(/\bnullptr\b/g,'null')
 const trace=[],h={window:1,generation:7,picker_current:()=>true},p={nonce:'captured',settled:false,dialog:{Get:()=>4}},s={h,p,owner:h,documentGeneration:7,panels:1,cancelPicker:true,dialog:2,button:3,pickerNonce:{clear(){trace.push('NONCE_CLEARED')}},expectedDirectory:{Reset(){}},activeDialog:{Get:()=>4,Close(){assert.fail('obsolete COM Close must not be called')}},KillTimer(){},emit(_,id){trace.push(id);if(options.invalidateAfterMarker)p.settled=true},note(){},fail(){trace.push('FAIL')},d476OwnedDialog705:()=>options.owned!==false,GetDlgItem:()=>3,IDCANCEL:2,IsWindow:()=>true,IsChild:()=>true,GetDlgCtrlID:()=>2,IsWindowVisible:()=>true,IsWindowEnabled:()=>true,GetClassNameW(_,out){out[0]=options.buttonClass??'Button';return 1},lstrcmpiW:(a,b)=>a[0].toLowerCase()===b.toLowerCase()?0:1,GetWindowThreadProcessId:()=>options.thread??1,GetCurrentThreadId:()=>1,SendMessageW(target,message){assert.equal(target,3);assert.equal(message,0xf5);trace.push('IDCANCEL_CLICK')},BM_CLICK:0xf5}
 vm.compileFunction(lower(prelude+'\n'+source.slice(start,end)),Object.keys(s))(...Object.values(s));return trace
}
test('705 actual cancellation clicks only the still-owned real Cancel button after readiness',()=>{
 for(const source of [workspaceCpp705(),workspaceCpp705().replace(/\r?\n/g,'\r\n')]){
  const ok=cancelSuffix705(source)
  assert.ok(ok.indexOf('D476_WS_PICKER_CANCELLED')<ok.indexOf('IDCANCEL_CLICK'));assert.equal(ok.filter(x=>x==='IDCANCEL_CLICK').length,1);assert.equal(ok.includes('FAIL'),false)
  assert.ok(ok.indexOf('NONCE_CLEARED')<ok.indexOf('IDCANCEL_CLICK'),'actual captured nonce survives readiness retirement')
  for(const options of[{owned:false},{buttonClass:'Other'},{thread:2},{invalidateAfterMarker:true}]){const bad=cancelSuffix705(source,options);assert.ok(bad.includes('FAIL'));assert.equal(bad.includes('IDCANCEL_CLICK'),false)}
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
 // A real button click does not itself manufacture a Show return.
 assert.equal(cancelSuffix705(cpp).some(x=>x.startsWith('D476_WS_CANCEL_SHOW_')),false)
 const quiet=[];vm.compileFunction(body,['h','result','settled','current','cancelPicker','HRESULT_FROM_WIN32','ERROR_CANCELLED','FAILED','cancelNote'])({},1223,false,true,false,x=>x,1223,x=>x<0,(_,id)=>quiet.push(id));assert.deepEqual(quiet,[])
})


test('705 actual UI app-state gate uses one observation and refuses all nonrunning states',()=>{
 const source=fs.readFileSync(path.join(root,'tests/fixtures/workspace-ui-705/WorkspacePickerUITests.swift'),'utf8').replace(/\r\n/g,'\n'),a=source.indexOf('  let app=XCUIApplication(url:scene.appBundle)'),b=source.indexOf('  func ready(',a);assert.ok(a>=0&&b>a);const body=source.slice(a,b),decl=/let ([A-Za-z_][A-Za-z0-9_]*)=app\.state/.exec(body),guard=/guard (.+) else\{throw OwnedUI705Error\.refused\}/.exec(body);assert.ok(guard);const expr=guard[1].replace(/\.(runningForeground|runningBackground)\b/g,(_,k)=>JSON.stringify(k)),code=(decl?'const '+decl[1]+'=app.state;':'')+'return Boolean('+expr+')',check=vm.compileFunction(code,['app']);
 for(const states of [['runningBackground','runningForeground'],['runningForeground','runningBackground'],['runningForeground','runningForeground'],['runningBackground','runningBackground'],['notRunning','notRunning'],['runningUnknown','runningUnknown'],['unknown','unknown']]){let calls=0;const app={get state(){assert.ok(calls<states.length,'unbounded state reads');return states[calls++]}};assert.equal(check(app),['runningForeground','runningBackground'].includes(states[0]),JSON.stringify(states));assert.equal(calls,1,'gate is one asynchronous state snapshot')}
})

const descriptorInput705=()=>({OwnedPickerUITests:{TestHostPath:'__TESTROOT__/Debug/OwnedPickerUITests-Runner.app',TestBundlePath:'__TESTHOST__/Contents/PlugIns/OwnedPickerUITests.xctest',UITargetAppPath:'__TESTROOT__/../OwnedPicker705.app'}})
function descriptorScene705(){const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'descriptor-705-'))),stage=path.join(temp,'package'),host=path.join(stage,'Products/Debug/OwnedPickerUITests-Runner.app'),bundle=path.join(host,'Contents/PlugIns/OwnedPickerUITests.xctest'),app=path.join(stage,'OwnedPicker705.app');for(const dir of[bundle,app])fs.mkdirSync(dir,{recursive:true,mode:0o700});const descriptor=path.join(stage,'Products/OwnedPickerUI.xctestrun');fs.writeFileSync(descriptor,'<plist/>',{mode:0o600});return{temp,stage,descriptor,clean(){fs.rmSync(temp,{recursive:true,force:true})}}}
function descriptorFunctions705(overrides={}){const source=fs.readFileSync(path.join(root,'scripts/desktop-workspace-ui-705.mjs'),'utf8').replace(/^import .*\n/gm,'').replace(/^export /gm,''),controlledFS={...(overrides.fs??fs),writeSync(fd,line){assert.equal(fd,1);return overrides.process?.stdout?.write(line)??Buffer.byteLength(line)}},context=vm.createContext({fs,path,createHash,Buffer,TextDecoder,isDeepStrictEqual,...overrides,fs:controlledFS});new vm.Script(source+'\nglobalThis.classify=workspaceUI705DescriptorObservation;globalThis.observe=observeWorkspaceUI705Descriptor;globalThis.bind=bindWorkspaceUI705Descriptor;').runInContext(context);return context}
const plainDescriptor705=value=>JSON.parse(JSON.stringify(value))
test('705 descriptor classifies only fixed v1 v2 targets paths and bounded enum counts',()=>{
 const s=descriptorScene705();try{
  const one=ui705.workspaceUI705DescriptorObservation(JSON.stringify(descriptorInput705()),s.stage);assert.equal(one.status,'OBSERVED');assert.equal(one.format,1);assert.equal(one.expectedTarget,true);assert.equal(one.targetCount,'ONE');assert.equal(one.expectedCount,'ONE');for(const key of['TestHostPath','TestBundlePath','UITargetAppPath'])assert.deepEqual(one[key],{type:'STRING',within:true,exists:true})
  const target={BlueprintName:'OwnedPickerUITests',...descriptorInput705().OwnedPickerUITests},two={__xctestrun_metadata__:{FormatVersion:2},TestConfigurations:[{TestTargets:[target]}]},v2=ui705.workspaceUI705DescriptorObservation(JSON.stringify(two),s.stage);assert.equal(v2.format,2);assert.equal(v2.status,'OBSERVED');assert.equal(v2.expectedTarget,true)
  const duplicate=structuredClone(two);duplicate.TestConfigurations.push({TestTargets:[target]});const ambiguous=ui705.workspaceUI705DescriptorObservation(JSON.stringify(duplicate),s.stage);assert.equal(ambiguous.status,'UNKNOWN');assert.equal(ambiguous.expectedCount,'MULTIPLE');assert.equal(ambiguous.expectedTarget,null);assert.equal(ambiguous.TestHostPath.exists,null)
  const zero=ui705.workspaceUI705DescriptorObservation('{}',s.stage);assert.equal(zero.expectedTarget,false);assert.equal(zero.targetCount,'ZERO');assert.equal(zero.expectedCount,'ZERO')
  const mixed=descriptorInput705();mixed.Other={};const m=ui705.workspaceUI705DescriptorObservation(JSON.stringify(mixed),s.stage);assert.equal(m.targetCount,'MULTIPLE');assert.equal(m.expectedCount,'ONE');assert.equal(m.expectedTarget,true)
  const missing=descriptorInput705();delete missing.OwnedPickerUITests.UITargetAppPath;assert.deepEqual(ui705.workspaceUI705DescriptorObservation(JSON.stringify(missing),s.stage).UITargetAppPath,{type:'MISSING',within:null,exists:null})
  const absent=descriptorInput705();absent.OwnedPickerUITests.TestBundlePath='__TESTROOT__/Debug/absent.xctest';assert.deepEqual(ui705.workspaceUI705DescriptorObservation(JSON.stringify(absent),s.stage).TestBundlePath,{type:'STRING',within:true,exists:false})
 }finally{s.clean()}
})
test('705 descriptor unknown types placeholders and private sentinel are never reflected',()=>{
 const s=descriptorScene705();try{
  const values=['PRIVATE_SENTINEL','{',JSON.stringify({__xctestrun_metadata__:{FormatVersion:true}}),JSON.stringify({__xctestrun_metadata__:{FormatVersion:3}}),JSON.stringify({__xctestrun_metadata__:{FormatVersion:2},TestConfigurations:{PRIVATE_SENTINEL:1}}),JSON.stringify({__xctestrun_metadata__:{FormatVersion:2},TestConfigurations:[{TestTargets:[{BlueprintName:3}]}]}),' '.repeat(65537),'null','[]']
  for(const text of values){const value=ui705.workspaceUI705DescriptorObservation(text,s.stage);assert.equal(value.status,'UNKNOWN');assert.equal(JSON.stringify(value).includes('PRIVATE_SENTINEL'),false)}
  for(const bad of[null,4,true,{},'__PLATFORMS__/PRIVATE_SENTINEL','__TESTHOST__/PRIVATE_SENTINEL','__TESTROOT__PRIVATE_SENTINEL','relative/PRIVATE_SENTINEL','/PRIVATE_SENTINEL\n']){const data=descriptorInput705();data.OwnedPickerUITests.TestHostPath=bad;const value=ui705.workspaceUI705DescriptorObservation(JSON.stringify(data),s.stage);assert.equal(value.status,'UNKNOWN');assert.equal(JSON.stringify(value).includes('PRIVATE_SENTINEL'),false)}
  let getter=0;const hidden={get value(){getter++;throw Error('PRIVATE_SENTINEL')}};assert.equal(ui705.workspaceUI705DescriptorObservation(hidden,s.stage).status,'UNKNOWN');assert.equal(getter,0)
 }finally{s.clean()}
})
test('705 descriptor refuses outside paths and intermediate links before any outside stat or realpath',()=>{
 const stage='/fixed/owned/package',seen=[],stat=kind=>({isDirectory:()=>kind==='dir',isFile:()=>kind==='file',isSymbolicLink:()=>kind==='link'}),fake={lstatSync(file){seen.push(['stat',file]);assert.ok(file===stage||file.startsWith(stage+'/'));if(file===stage+'/Products/link')return stat('link');return stat('dir')},realpathSync(file){seen.push(['real',file]);assert.ok(file===stage||file.startsWith(stage+'/'));return file}},f=descriptorFunctions705({fs:fake})
 const data=descriptorInput705();data.OwnedPickerUITests.TestHostPath='/outside/PRIVATE_SENTINEL';data.OwnedPickerUITests.TestBundlePath='/outside/PRIVATE_SENTINEL';data.OwnedPickerUITests.UITargetAppPath='/outside/PRIVATE_SENTINEL';const outside=f.classify(JSON.stringify(data),stage);assert.equal(outside.TestHostPath.within,false);assert.equal(outside.TestBundlePath.within,false);assert.equal(outside.UITargetAppPath.within,false);assert.deepEqual(seen,[['stat',stage],['real',stage]])
 seen.length=0;const linked=descriptorInput705();linked.OwnedPickerUITests.TestHostPath='__TESTROOT__/link/private.app';linked.OwnedPickerUITests.TestBundlePath='__TESTHOST__/private.xctest';const value=f.classify(JSON.stringify(linked),stage);assert.equal(value.status,'UNKNOWN');assert.equal(seen.some(([op,file])=>op==='real'&&file.includes('/Products/link')),false);assert.equal(seen.some(([,file])=>file.startsWith('/outside')),false)
 const unknown=descriptorFunctions705({fs:{lstatSync(){throw Error('PRIVATE_SENTINEL')}}}).classify(JSON.stringify(descriptorInput705()),stage);assert.equal(unknown.status,'UNKNOWN');assert.equal(JSON.stringify(unknown).includes('PRIVATE_SENTINEL'),false)
})
test('705 actual passive converter and sink failures leave original package bytes and decisions untouched',()=>{
 const s=descriptorScene705();try{
  const bytes=fs.readFileSync(s.descriptor),cases=[{status:65,stdout:Buffer.from('PRIVATE_SENTINEL'),stderr:Buffer.from('PRIVATE_SENTINEL')},{error:Error('PRIVATE_SENTINEL'),status:null,stdout:Buffer.alloc(0)},{status:0,stdout:Buffer.from([255])},{status:0,stdout:Buffer.alloc(65537,65)},{status:0,stdout:Buffer.from('{PRIVATE_SENTINEL')},'throw']
  for(const result of cases){const lines=[],f=descriptorFunctions705({spawnSync(bin,args,opts){assert.equal(bin,'/usr/bin/plutil');assert.deepEqual([...args],['-convert','json','-o','-',s.descriptor]);assert.equal(opts.timeout,5000);assert.equal(opts.maxBuffer,65536);if(result==='throw')throw Error('PRIVATE_SENTINEL');return result},process:{stdout:{write(line){lines.push(line)}}}});assert.doesNotThrow(()=>f.observe(s.stage));assert.equal(lines.length,1);assert.ok(lines[0].startsWith('D705_UI_DESCRIPTOR '));const value=JSON.parse(lines[0].slice('D705_UI_DESCRIPTOR '.length));assert.equal(value.status,'UNKNOWN');assert.equal(lines[0].includes('PRIVATE_SENTINEL'),false);assert.equal(lines[0].includes(s.temp),false);assert.deepEqual(fs.readFileSync(s.descriptor),bytes)}
  const silent=descriptorFunctions705({spawnSync(){return{status:0,stdout:Buffer.from(JSON.stringify(descriptorInput705()))}},process:{stdout:{write(){throw Error('PRIVATE_SENTINEL')}}}});assert.doesNotThrow(()=>silent.observe(s.stage));assert.deepEqual(fs.readFileSync(s.descriptor),bytes)
  const dirLink=descriptorFunctions705({fs:{lstatSync(){return{isDirectory:()=>true,isSymbolicLink:()=>true}}},spawnSync(){assert.fail('must not convert linked package')},process:{stdout:{write(line){assert.equal(JSON.parse(line.slice('D705_UI_DESCRIPTOR '.length)).status,'UNKNOWN')}}}});assert.doesNotThrow(()=>dirLink.observe(s.stage))
 }finally{s.clean()}
})

test('705 actual binding converter fails closed without reflecting native output or mutating signed bundle bytes',()=>{
 for(const failure of ['read-failure','read-malformed','read-invalid-utf8','write-failure','roundtrip-change','proof-io']){
  const s=descriptorScene705();try{
   fs.unlinkSync(s.descriptor);const original=path.join(s.temp,'original.xctestrun'),work=path.join(s.temp,'work');fs.mkdirSync(work,{mode:0o700});fs.writeFileSync(original,'<plist/>',{mode:0o644})
   const appFile=path.join(s.stage,'OwnedPicker705.app/public-signed-byte'),runnerFile=path.join(s.stage,'Products/Debug/OwnedPickerUITests-Runner.app/public-signed-byte');fs.writeFileSync(appFile,'APP_UNCHANGED');fs.writeFileSync(runnerFile,'RUNNER_UNCHANGED')
   const input=descriptorInput705();delete input.OwnedPickerUITests.UITargetAppPath;let calls=0,bound
   const actual=descriptorFunctions705({fs:{...fs,writeFileSync(file,...args){if(failure==='proof-io'&&file===path.join(work,'descriptor-binding-proof.json'))throw Error('PRIVATE_SENTINEL');return fs.writeFileSync(file,...args)}},spawnSync(bin,args,opts){
    assert.equal(bin,'/usr/bin/plutil');assert.equal(opts.timeout,5000);assert.equal(opts.maxBuffer,65536);calls++
    if(calls===1){assert.equal(args[4],original);if(failure==='read-failure')return{status:65,stdout:Buffer.from('PRIVATE_SENTINEL'),stderr:Buffer.from('PRIVATE_SENTINEL')};if(failure==='read-malformed')return{status:0,stdout:Buffer.from('{PRIVATE_SENTINEL')};if(failure==='read-invalid-utf8')return{status:0,stdout:Buffer.from([255])};return{status:0,stdout:Buffer.from(JSON.stringify(input))}}
    if(calls===2){assert.deepEqual([...args],['-convert','xml1','-o','-','-']);bound=JSON.parse(opts.input.toString('utf8'));return failure==='write-failure'?{status:65,stdout:Buffer.from('PRIVATE_SENTINEL')}:{status:0,stdout:Buffer.from('<inert-xml/>')}}
    assert.equal(calls,3);assert.equal(args[4],s.descriptor);return{status:0,stdout:Buffer.from(JSON.stringify(failure==='roundtrip-change'?{...bound,Other:'PRIVATE_SENTINEL'}:bound))}
   }})
   assert.throws(()=>actual.bind(original,{package:s.stage,work}),e=>e.message==='OWNED_UI_BUILD_TARGET_BINDING'&&!String(e).includes('PRIVATE_SENTINEL'))
   assert.equal(fs.readFileSync(original,'utf8'),'<plist/>');assert.equal(fs.readFileSync(appFile,'utf8'),'APP_UNCHANGED');assert.equal(fs.readFileSync(runnerFile,'utf8'),'RUNNER_UNCHANGED');assert.equal(fs.existsSync(path.join(s.stage,'package-manifest.json')),false);assert.ok(calls<=3)
  }finally{s.clean()}
 }
})
test('705 actual binding refuses duplicate final publication and preserves the already inventoried bytes',()=>{
 const s=descriptorScene705();try{
  const original=path.join(s.temp,'original.xctestrun'),work=path.join(s.temp,'work');fs.mkdirSync(work,{mode:0o700});fs.writeFileSync(original,'<plist/>',{mode:0o644});const before=fs.readFileSync(s.descriptor);let calls=0
  const actual=descriptorFunctions705({spawnSync(_,args,opts){calls++;return{status:0,stdout:Buffer.from(args[1]==='json'?JSON.stringify(descriptorInput705()):'<inert-xml/>')}}})
  assert.throws(()=>actual.bind(original,{package:s.stage,work}),/OWNED_UI_BUILD_TARGET_BINDING/);assert.deepEqual(fs.readFileSync(s.descriptor),before);assert.equal(calls,2);assert.equal(fs.existsSync(path.join(work,'descriptor-binding-proof.json')),false)
 }finally{s.clean()}
})

// The fixture owns this input; no claim about a historical runner's actual label.
test('705 generated Mac workspace fixes Choose before presentation and retains exact normal-host inverse',()=>{
 const normal=fs.readFileSync(path.join(root,'src/desktop/native/DesktopHost.swift'),'utf8'),fixture=fs.readFileSync(path.join(root,'tests/fixtures/desktop-476/workspace-acceptance.swift'),'utf8'),form=fs.readFileSync(path.join(root,'tests/fixtures/desktop-476/workspace-form.js'),'utf8'),ui=fs.readFileSync(path.join(root,'tests/fixtures/workspace-ui-705/WorkspacePickerUITests.swift'),'utf8')
 const anchor='p.panel.beginSheetModal(for:owner){',owned='p.panel.prompt="Choose";'+anchor
 assert.equal(normal.split(anchor).length,2);assert.equal(normal.includes('p.panel.prompt='),false)
 for(const eol of ['\n','\r\n']){
  const original=normal.replace(/\r\n/g,'\n').replace(/\n/g,eol),built=desktopWorkspaceFixture('swift',original,fixture,form)
  assert.equal(built.inverse,original);assert.equal(built.source.split(owned).length,2)
  assert.throws(()=>desktopWorkspaceFixture('swift',original.replace(anchor,'MISSING_PICKER_PRESENTATION'),fixture,form),/DESKTOP_WORKSPACE_FIXTURE_ANCHOR/)
  assert.throws(()=>desktopWorkspaceFixture('swift',original+'\n'+anchor,fixture,form),/DESKTOP_WORKSPACE_FIXTURE_ANCHOR/)
 }
 for(const exact of ['label IN %@','["Choose","Open"]','guard chooseCount==1 else','guard chooseHittable else','choose.element.click()','try ready(.second,2)','cancel.element.click()','guard r>0,r<=45 else'])assert.ok(ui.includes(exact),exact)
 assert.doesNotMatch(ui,/\.prompt\s*=|\.launch\(|\.activate\(|\.terminate\(/)
})
