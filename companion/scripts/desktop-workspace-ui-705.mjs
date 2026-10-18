/** Fixed unshipped XCTest acceptance products, built only by hosted macOS native build. */
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
export const WORKSPACE_UI705_ID='com.cmspark.tests.workspace-ui-705.xctrunner'
// Only the unshipped .app variant uses Resources; the bare acceptance binary stays unchanged.
export function workspaceUI705BundleSource(original){
 const bare='executable.deletingLastPathComponent().appendingPathComponent("assets")',bundled='executable.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Resources/assets")'
 if(original.split(bare).length!==2||original.includes(bundled))throw Error('OWNED_UI_BUILD_ASSET_SOURCE')
 const source=original.replace(bare,bundled);return {source,inverse:source.replace(bundled,bare)}
}
export function workspaceUI705Plan(root,dest){
 const fixture=path.join(root,'tests/fixtures/workspace-ui-705'),work=path.join(dest,'generated/workspace-ui-705')
 return {fixture,work,package:path.join(dest,'acceptance/workspace-ui'),commands:[
  ['/usr/bin/swiftc',['-O',path.join(fixture,'OwnedUIProtocol.swift'),path.join(fixture,'OwnerObserver.swift'),path.join(work,'main.swift'),'-framework','AppKit','-o',path.join(work,'owner-observer')]],
  ['/usr/bin/codesign',['--force','--sign','-',path.join(work,'owner-observer')]],
  ['/usr/bin/xcodebuild',['build-for-testing','-project',path.join(fixture,'OwnedPickerUI.xcodeproj'),'-scheme','OwnedPickerUI','-configuration','Debug','-destination','platform=macOS','-derivedDataPath',path.join(work,'DerivedData'),'CODE_SIGN_IDENTITY=-','CODE_SIGNING_ALLOWED=YES']]
 ]}
}
function within(root,file){const rel=path.relative(root,file);return !!rel&&!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep)}
export function buildWorkspaceUI705(root,dest){
 if(process.platform!=='darwin')throw Error('OWNED_UI_BUILD_PLATFORM')
 const plan=workspaceUI705Plan(root,dest),run=(bin,args)=>{const r=spawnSync(bin,args,{stdio:'pipe',encoding:'utf8'});if(r.error||r.status!==0){if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);throw Error('OWNED_UI_BUILD_FAILED')}return r.stdout}
 fs.mkdirSync(plan.work,{recursive:true,mode:0o700});fs.copyFileSync(path.join(plan.fixture,'observer-main.swift'),path.join(plan.work,'main.swift'),fs.constants.COPYFILE_EXCL)
 for(const [bin,args]of plan.commands)run(bin,args)
 fs.mkdirSync(plan.package,{mode:0o700});const rows=[]
 function copy(from,relative,sourceRoot){
  if(!within(plan.package,path.join(plan.package,relative)))throw Error('OWNED_UI_BUILD_PATH')
  const s=fs.lstatSync(from),to=path.join(plan.package,relative)
  if(s.isDirectory()){fs.mkdirSync(to,{recursive:true,mode:0o700});for(const entry of fs.readdirSync(from))copy(path.join(from,entry),path.posix.join(relative,entry),sourceRoot);return}
  fs.mkdirSync(path.dirname(to),{recursive:true,mode:0o700})
  if(s.isSymbolicLink()){const target=fs.readlinkSync(from);if(path.isAbsolute(target)||!within(sourceRoot,fs.realpathSync(from)))throw Error('OWNED_UI_BUILD_LINK');fs.symlinkSync(target,to);rows.push({path:relative,kind:'link',target});return}
  if(!s.isFile()||s.nlink!==1)throw Error('OWNED_UI_BUILD_FILE');const b=fs.readFileSync(from),mode=s.mode&0o777;if(![0o644,0o755,0o600,0o700].includes(mode))throw Error('OWNED_UI_BUILD_MODE');fs.writeFileSync(to,b,{flag:'wx',mode});rows.push({path:relative,kind:'file',bytes:b.length,mode,sha256:createHash('sha256').update(b).digest('hex')})
 }
 const products=path.join(plan.work,'DerivedData/Build/Products'),runner=path.join(products,'Debug/OwnedPickerUITests-Runner.app'),info=path.join(runner,'Contents/Info.plist')
 if(run('/usr/bin/plutil',['-extract','CFBundleIdentifier','raw','-o','-',info]).trim()!==WORKSPACE_UI705_ID||run('/usr/bin/plutil',['-extract','CFBundleExecutable','raw','-o','-',info]).trim()!=='OwnedPickerUITests-Runner')throw Error('OWNED_UI_BUILD_RUNNER_ID')
 const descriptors=fs.readdirSync(products).filter(n=>/^OwnedPickerUI_macosx[^/]*\.xctestrun$/.test(n));if(descriptors.length!==1)throw Error('OWNED_UI_BUILD_TESTRUN')
 // Keep Xcode's signed Runner.framework links and bundles intact; all relative links stay inside Products.
 copy(path.join(products,'Debug'),'Products/Debug',products);copy(path.join(products,descriptors[0]),'Products/OwnedPickerUI.xctestrun',products)
 const app=path.join(plan.package,'OwnedPicker705.app'),mac=path.join(app,'Contents/MacOS');fs.mkdirSync(mac,{recursive:true,mode:0o700})
 fs.copyFileSync(path.join(plan.fixture,'App-Info.plist'),path.join(app,'Contents/Info.plist'),fs.constants.COPYFILE_EXCL)
 const original=fs.readFileSync(path.join(dest,'generated/acceptance-workspace/main.swift'),'utf8'),variant=workspaceUI705BundleSource(original)
 if(variant.inverse!==original)throw Error('OWNED_UI_BUILD_ASSET_SOURCE')
 const appGenerated=path.join(plan.work,'app');fs.mkdirSync(appGenerated,{mode:0o700});const main=path.join(appGenerated,'main.swift')
 fs.writeFileSync(main,variant.source,{flag:'wx',mode:0o600})
 run('/usr/bin/swiftc',['-O',main,path.join(dest,'generated/DesktopCapabilities.swift'),'-framework','AppKit','-framework','WebKit','-framework','CryptoKit','-o',path.join(mac,'cmspark-desktop')])
 const assets=path.join(dest,'acceptance/workspace/assets');fs.cpSync(assets,path.join(app,'Contents/Resources/assets'),{recursive:true,errorOnExist:true,force:false,dereference:false})
 run('/usr/bin/codesign',['--force','--sign','-',app]);run('/usr/bin/codesign',['--verify','--deep','--strict',app])
 // Inventory the fixed newly created app without rewriting its signed bytes.
 function inventory(dir,rel){for(const n of fs.readdirSync(dir)){const file=path.join(dir,n),r=path.posix.join(rel,n),s=fs.lstatSync(file);if(s.isDirectory()){inventory(file,r);continue};if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('OWNED_UI_BUILD_APP_FILE');const b=fs.readFileSync(file);rows.push({path:r,kind:'file',bytes:b.length,mode:s.mode&0o777,sha256:createHash('sha256').update(b).digest('hex')})}}
 inventory(app,'OwnedPicker705.app');copy(path.join(plan.work,'owner-observer'),'owner-observer',plan.work)
 fs.writeFileSync(path.join(plan.package,'package-manifest.json'),JSON.stringify({schema:1,files:rows.sort((a,b)=>a.path.localeCompare(b.path))}),{flag:'wx',mode:0o600})
}
