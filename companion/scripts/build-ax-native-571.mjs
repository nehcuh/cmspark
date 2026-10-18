// Hosted macOS only. Compile real host source with a fixed native-only reason field and an unshipped owned target;
// never rewrite product integrity, package the fixture for users, or change TCC.
import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath,pathToFileURL} from 'node:url'
export function ax571BuildPlan(root){
 const dest=path.join(root,'dist/ax-native-571'),source=path.join(root,'src/host-use/darwin'),host=path.join(dest,'cmspark-host'),fixtureBundle=path.join(dest,'OwnedAX571.app'),fixture=path.join(fixtureBundle,'Contents/MacOS/owned-target'),fixtureInfoSource=path.join(root,'tests/fixtures/ax-571/Info.plist'),fixtureInfo=path.join(fixtureBundle,'Contents/Info.plist')
 return {dest,host,fixture,fixtureBundle,fixtureInfoSource,fixtureInfo,commands:[
  ['/usr/bin/swiftc',['-O','-D','CMSPARK_AX571_DIAGNOSTICS',path.join(source,'host.swift'),'-o',host,...['Foundation','ApplicationServices','Vision','Security','Carbon','CoreImage','ImageIO','ScreenCaptureKit'].flatMap(n=>['-framework',n]),'-Xlinker','-sectcreate','-Xlinker','__TEXT','-Xlinker','__info_plist','-Xlinker',path.join(source,'host-Info.plist')]],
  ['/usr/bin/codesign',['--force','--sign','-','--options','runtime','--entitlements',path.join(source,'host.entitlements'),host]],
  ['/usr/bin/codesign',['--verify','--strict',host]],
  ['/usr/bin/swiftc',['-O',path.join(root,'tests/fixtures/ax-571/owned-target.swift'),'-framework','AppKit','-framework','WebKit','-o',fixture]],
  ['/usr/bin/codesign',['--force','--sign','-',fixtureBundle]],
  ['/usr/bin/codesign',['--verify','--strict',fixtureBundle]],
 ]}
}
export function buildAx571(root){
 if(process.platform!=='darwin'||process.version!=='v22.23.2')throw Error('AX571_BUILD_PLATFORM_RUNTIME')
 const plan=ax571BuildPlan(root)
 fs.mkdirSync(plan.dest,{recursive:true});const stat=fs.lstatSync(plan.dest);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('AX571_BUILD_REDIRECT')
 for(const file of [plan.host,plan.fixtureBundle]){if(fs.existsSync(file))throw Error('AX571_BUILD_OUTPUT_ALREADY_EXISTS')}
 const info=fs.lstatSync(plan.fixtureInfoSource);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw Error('AX571_FIXTURE_INFO_IDENTITY')
 fs.mkdirSync(path.dirname(plan.fixture),{recursive:true});fs.copyFileSync(plan.fixtureInfoSource,plan.fixtureInfo,fs.constants.COPYFILE_EXCL)
 for(const [bin,args] of plan.commands){const r=spawnSync(bin,args,{stdio:'inherit'});if(r.error||r.status!==0)throw Error('AX571_BUILD_FAILED')}
 const identity=spawnSync('/usr/bin/codesign',['-dv',plan.host],{encoding:'utf8',maxBuffer:65536});if(identity.error||identity.status!==0||!/^Identifier=com\.cmspark\.agent\r?$/m.test(identity.stderr))throw Error('AX571_BUILD_IDENTITY')
 const fixtureIdentity=spawnSync('/usr/bin/codesign',['-dv',plan.fixtureBundle],{encoding:'utf8',maxBuffer:65536});if(fixtureIdentity.error||fixtureIdentity.status!==0||!/^Identifier=com\.cmspark\.ax571\.owned-target\r?$/m.test(fixtureIdentity.stderr))throw Error('AX571_FIXTURE_BUNDLE_IDENTITY')
 fs.writeFileSync(path.join(plan.dest,'identity.json'),JSON.stringify({schema:1,identifierExpected:true,signatureVerified:true,fixtureBundleVerified:true,fixtureIdentifierExpected:true,route:'DIRECT_CLI_NODE_PARENT',tccResponsibility:'UNKNOWN'})+'\n',{flag:'wx',mode:0o600})
}
const entry=process.argv[1];if(entry&&pathToFileURL(fs.realpathSync(entry)).href===import.meta.url)buildAx571(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'))
