// Hosted macOS only. Compile the unchanged real host and an unshipped owned target;
// never rewrite the product integrity constant, stage an app, or change TCC.
import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath,pathToFileURL} from 'node:url'
export function ax571BuildPlan(root){
 const dest=path.join(root,'dist/ax-native-571'),source=path.join(root,'src/host-use/darwin'),host=path.join(dest,'cmspark-host'),fixture=path.join(dest,'owned-target')
 return {dest,host,fixture,commands:[
  ['/usr/bin/swiftc',['-O',path.join(source,'host.swift'),'-o',host,...['Foundation','ApplicationServices','Vision','Security','Carbon','CoreImage','ImageIO','ScreenCaptureKit'].flatMap(n=>['-framework',n]),'-Xlinker','-sectcreate','-Xlinker','__TEXT','-Xlinker','__info_plist','-Xlinker',path.join(source,'host-Info.plist')]],
  ['/usr/bin/codesign',['--force','--sign','-','--options','runtime','--entitlements',path.join(source,'host.entitlements'),host]],
  ['/usr/bin/codesign',['--verify','--strict',host]],
  ['/usr/bin/swiftc',['-O',path.join(root,'tests/fixtures/ax-571/owned-target.swift'),'-framework','AppKit','-framework','WebKit','-o',fixture]],
  ['/usr/bin/codesign',['--force','--sign','-',fixture]],
  ['/usr/bin/codesign',['--verify','--strict',fixture]],
 ]}
}
export function buildAx571(root){
 if(process.platform!=='darwin'||process.version!=='v22.23.2')throw Error('AX571_BUILD_PLATFORM_RUNTIME')
 const plan=ax571BuildPlan(root)
 fs.mkdirSync(plan.dest,{recursive:true});const stat=fs.lstatSync(plan.dest);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('AX571_BUILD_REDIRECT')
 for(const file of [plan.host,plan.fixture]){if(fs.existsSync(file))throw Error('AX571_BUILD_OUTPUT_ALREADY_EXISTS')}
 for(const [bin,args] of plan.commands){const r=spawnSync(bin,args,{stdio:'inherit'});if(r.error||r.status!==0)throw Error('AX571_BUILD_FAILED')}
 const identity=spawnSync('/usr/bin/codesign',['-dv',plan.host],{encoding:'utf8',maxBuffer:65536});if(identity.error||identity.status!==0||!/^Identifier=com\.cmspark\.agent\r?$/m.test(identity.stderr))throw Error('AX571_BUILD_IDENTITY')
 fs.writeFileSync(path.join(plan.dest,'identity.json'),JSON.stringify({schema:1,identifierExpected:true,signatureVerified:true,route:'DIRECT_CLI_NODE_PARENT',tccResponsibility:'UNKNOWN'})+'\n',{flag:'wx',mode:0o600})
}
const entry=process.argv[1];if(entry&&pathToFileURL(fs.realpathSync(entry)).href===import.meta.url)buildAx571(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'))
