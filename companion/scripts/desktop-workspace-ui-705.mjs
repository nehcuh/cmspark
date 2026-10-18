/** Fixed unshipped XCTest acceptance products, built only by hosted macOS native build. */
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {isDeepStrictEqual} from 'node:util'
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
// Fixed unshipped Format1 metadata, not permission to launch or replace an app.
export function workspaceUI705BoundDescriptor(text,packageRoot){
 try{
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>65536||typeof packageRoot!=='string'||!path.isAbsolute(packageRoot))throw 0
  const data=JSON.parse(text,(_,v)=>{if(typeof v==='number'&&(!Number.isFinite(v)||Object.is(v,-0)||Number.isInteger(v)&&!Number.isSafeInteger(v)))throw 0;return v}),object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)
  if(!object(data)||Object.keys(data).filter(k=>k!=='__xctestrun_metadata__').join()!=='OwnedPickerUITests'||!object(data.OwnedPickerUITests))throw 0
  if(Object.hasOwn(data,'__xctestrun_metadata__')&&(!object(data.__xctestrun_metadata__)||data.__xctestrun_metadata__.FormatVersion!==1))throw 0
  const target=data.OwnedPickerUITests,literal='__TESTROOT__/../OwnedPicker705.app'
  if(Object.hasOwn(target,'UITargetAppPath')&&target.UITargetAppPath!==literal)throw 0
  const root=fs.lstatSync(packageRoot),app=path.join(packageRoot,'OwnedPicker705.app'),stat=fs.lstatSync(app)
  if(!root.isDirectory()||root.isSymbolicLink()||!stat.isDirectory()||stat.isSymbolicLink()||fs.realpathSync(app)!==path.join(fs.realpathSync(packageRoot),'OwnedPicker705.app'))throw 0
  target.UITargetAppPath=literal;return JSON.stringify(data)
 }catch{throw Error('OWNED_UI_BUILD_TARGET_BINDING')}
}
function bindWorkspaceUI705Descriptor(source,plan){
 try{
 const fail=()=>{throw Error('OWNED_UI_BUILD_TARGET_BINDING')}
 const stat=fs.lstatSync(source);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size<1||stat.size>1048576||![0o644,0o755,0o600,0o700].includes(stat.mode&0o777))fail()
 const original=fs.readFileSync(source)
 const convert=(args,input)=>{const r=spawnSync('/usr/bin/plutil',args,{stdio:'pipe',timeout:5000,maxBuffer:65536,...(input===undefined?{}:{input})});if(r.error||r.status!==0||!Buffer.isBuffer(r.stdout)||r.stdout.length<1||r.stdout.length>65536)fail();return r.stdout}
 const decode=bytes=>{try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{fail()}}
 const bound=workspaceUI705BoundDescriptor(decode(convert(['-convert','json','-o','-',source])),plan.package)
 const final=convert(['-convert','xml1','-o','-','-'],Buffer.from(bound)),file=path.join(plan.package,'Products/OwnedPickerUI.xctestrun')
 fs.writeFileSync(file,final,{flag:'wx',mode:stat.mode&0o777})
 try{if(!isDeepStrictEqual(JSON.parse(decode(convert(['-convert','json','-o','-',file]))),JSON.parse(bound)))fail()}catch{fail()}
 fs.writeFileSync(path.join(plan.work,'descriptor-original.xctestrun'),original,{flag:'wx',mode:0o600})
 fs.writeFileSync(path.join(plan.work,'descriptor-binding-proof.json'),JSON.stringify({schema:1,format:1,expectedTarget:'OwnedPickerUITests',originalBytes:original.length,originalSHA256:createHash('sha256').update(original).digest('hex'),finalBytes:final.length,finalSHA256:createHash('sha256').update(final).digest('hex')}),{flag:'wx',mode:0o600})
 return{path:'Products/OwnedPickerUI.xctestrun',kind:'file',bytes:final.length,mode:stat.mode&0o777,sha256:createHash('sha256').update(final).digest('hex')}
 }catch{throw Error('OWNED_UI_BUILD_TARGET_BINDING')}
}
// Diagnostic only. Unknown descriptors never change build, launch, identity or cleanup.
const descriptorUnknown705=()=>({schema:1,status:'UNKNOWN',format:null,targetCount:'UNKNOWN',expectedTarget:null,expectedCount:'UNKNOWN',TestHostPath:{type:'UNKNOWN',within:null,exists:null},TestBundlePath:{type:'UNKNOWN',within:null,exists:null},UITargetAppPath:{type:'UNKNOWN',within:null,exists:null}})
export function workspaceUI705DescriptorObservation(text,packageRoot){
 const unknown=descriptorUnknown705(),object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),own=(v,k)=>Object.hasOwn(v,k)?v[k]:undefined,count=n=>n===0?'ZERO':n===1?'ONE':'MULTIPLE'
 try{
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>65536||typeof packageRoot!=='string'||!path.isAbsolute(packageRoot))return unknown
  const value=JSON.parse(text);if(!object(value))return unknown
  const metadata=own(value,'__xctestrun_metadata__'),format=metadata===undefined?1:object(metadata)?own(metadata,'FormatVersion'):undefined;if(format!==1&&format!==2)return unknown
  let targets
  if(format===1){const keys=Object.keys(value).filter(k=>k!=='__xctestrun_metadata__');if(keys.some(k=>!object(value[k])))return unknown;targets=keys.map(k=>({name:k,value:value[k]}))}
  else{const configs=own(value,'TestConfigurations');if(!Array.isArray(configs))return unknown;targets=[];for(const config of configs){if(!object(config)||!Array.isArray(own(config,'TestTargets')))return unknown;for(const target of config.TestTargets){if(!object(target)||typeof own(target,'BlueprintName')!=='string')return unknown;targets.push({name:target.BlueprintName,value:target})}}}
  const matches=targets.filter(t=>t.name==='OwnedPickerUITests'),result={...unknown,status:'OBSERVED',format,targetCount:count(targets.length),expectedTarget:matches.length===1,expectedCount:count(matches.length)}
  if(matches.length>1)return{...result,status:'UNKNOWN',expectedTarget:null}
  if(matches.length===0)return result
  // No descriptor-controlled read occurs until lexical containment is established.
  const lexical=path.resolve(packageRoot),rootStat=fs.lstatSync(lexical);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())return unknown
  const canonicalRoot=fs.realpathSync(lexical),inside=(root,file)=>file===root||file.startsWith(root+path.sep),allowed=(root,file)=>inside(path.join(root,'Products'),file)||inside(path.join(root,'OwnedPicker705.app'),file)
  const target=matches[0].value,testRoot=path.join(lexical,'Products')
  function resolve(value,host){
   if(typeof value!=='string'||!value||Buffer.byteLength(value,'utf8')>4096||/[\0\r\n]/.test(value))return
   if(value==='__TESTROOT__'||value.startsWith('__TESTROOT__/'))value=testRoot+value.slice('__TESTROOT__'.length)
   else if(value==='__TESTHOST__'||value.startsWith('__TESTHOST__/')){if(!host)return;value=host+value.slice('__TESTHOST__'.length)}
   if(/__[A-Za-z0-9_]+__/.test(value)||!path.isAbsolute(value))return
   return path.resolve(value)
  }
  const host=resolve(own(target,'TestHostPath'))
  function observe(name){
   const value=own(target,name);if(value===undefined)return{type:'MISSING',within:null,exists:null}
   if(typeof value!=='string')return{type:'OTHER',within:null,exists:null}
   const file=resolve(value,name==='TestHostPath'?undefined:host);if(!file)return{type:'STRING',within:null,exists:null}
   if(!allowed(lexical,file))return{type:'STRING',within:false,exists:null}
   const relative=path.relative(lexical,file),realFile=path.resolve(canonicalRoot,relative);if(!allowed(canonicalRoot,realFile))return unknown[name]
   // Refuse a symlink before realpath, including intermediate links; no outside target probes.
   let current=canonicalRoot
   for(const part of relative.split(path.sep)){current=path.join(current,part);let stat;try{stat=fs.lstatSync(current)}catch(e){if(e&&Object.getOwnPropertyDescriptor(e,'code')?.value==='ENOENT')return{type:'STRING',within:true,exists:false};throw e};if(stat.isSymbolicLink()||(!stat.isDirectory()&&!stat.isFile()))return unknown[name]}
   if(fs.realpathSync(realFile)!==realFile)return unknown[name]
   return{type:'STRING',within:true,exists:true}
  }
  for(const name of['TestHostPath','TestBundlePath','UITargetAppPath'])result[name]=observe(name)
  if(['TestHostPath','TestBundlePath','UITargetAppPath'].some(name=>result[name].type==='UNKNOWN'||result[name].type==='OTHER'||result[name].type==='STRING'&&result[name].within===null))result.status='UNKNOWN'
  return result
 }catch{return unknown}
}
function observeWorkspaceUI705Descriptor(packageRoot){
 let result=descriptorUnknown705()
 try{
  const directory=fs.lstatSync(packageRoot),products=fs.lstatSync(path.join(packageRoot,'Products'));if(!directory.isDirectory()||directory.isSymbolicLink()||!products.isDirectory()||products.isSymbolicLink())throw Error('OWNED_UI_DESCRIPTOR_UNKNOWN')
  const file=path.join(packageRoot,'Products/OwnedPickerUI.xctestrun'),stat=fs.lstatSync(file)
  if(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.size>0&&stat.size<=1048576){
   const converted=spawnSync('/usr/bin/plutil',['-convert','json','-o','-',file],{stdio:'pipe',timeout:5000,maxBuffer:65536})
   if(!converted.error&&converted.status===0&&Buffer.isBuffer(converted.stdout)&&converted.stdout.length<=65536)result=workspaceUI705DescriptorObservation(new TextDecoder('utf-8',{fatal:true}).decode(converted.stdout),packageRoot)
  }
 }catch{}
 try{fs.writeSync(1,'D705_UI_DESCRIPTOR '+JSON.stringify(result)+'\n')}catch{}
}
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
 copy(path.join(products,'Debug'),'Products/Debug',products)
 const app=path.join(plan.package,'OwnedPicker705.app'),mac=path.join(app,'Contents/MacOS');fs.mkdirSync(mac,{recursive:true,mode:0o700})
 fs.copyFileSync(path.join(plan.fixture,'App-Info.plist'),path.join(app,'Contents/Info.plist'),fs.constants.COPYFILE_EXCL)
 const original=fs.readFileSync(path.join(dest,'generated/acceptance-workspace/main.swift'),'utf8'),variant=workspaceUI705BundleSource(original)
 if(variant.inverse!==original)throw Error('OWNED_UI_BUILD_ASSET_SOURCE')
 const appGenerated=path.join(plan.work,'app');fs.mkdirSync(appGenerated,{mode:0o700});const main=path.join(appGenerated,'main.swift')
 fs.writeFileSync(main,variant.source,{flag:'wx',mode:0o600})
 run('/usr/bin/swiftc',['-O',main,path.join(dest,'generated/DesktopCapabilities.swift'),'-framework','AppKit','-framework','WebKit','-framework','CryptoKit','-o',path.join(mac,'cmspark-desktop')])
 const assets=path.join(dest,'acceptance/workspace/assets');fs.cpSync(assets,path.join(app,'Contents/Resources/assets'),{recursive:true,errorOnExist:true,force:false,dereference:false})
 run('/usr/bin/codesign',['--force','--sign','-',app]);run('/usr/bin/codesign',['--verify','--deep','--strict',app])
 rows.push(bindWorkspaceUI705Descriptor(path.join(products,descriptors[0]),plan))
 // Inventory the fixed newly created app without rewriting its signed bytes.
 function inventory(dir,rel){for(const n of fs.readdirSync(dir)){const file=path.join(dir,n),r=path.posix.join(rel,n),s=fs.lstatSync(file);if(s.isDirectory()){inventory(file,r);continue};if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('OWNED_UI_BUILD_APP_FILE');const b=fs.readFileSync(file);rows.push({path:r,kind:'file',bytes:b.length,mode:s.mode&0o777,sha256:createHash('sha256').update(b).digest('hex')})}}
 inventory(app,'OwnedPicker705.app');copy(path.join(plan.work,'owner-observer'),'owner-observer',plan.work)
 fs.writeFileSync(path.join(plan.package,'package-manifest.json'),JSON.stringify({schema:1,files:rows.sort((a,b)=>a.path.localeCompare(b.path))}),{flag:'wx',mode:0o600})
 observeWorkspaceUI705Descriptor(plan.package)
}
