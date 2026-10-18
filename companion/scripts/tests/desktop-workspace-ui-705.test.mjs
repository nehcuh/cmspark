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
