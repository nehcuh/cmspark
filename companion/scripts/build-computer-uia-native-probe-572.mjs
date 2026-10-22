// Test DLL only. Does not write the normal CPP/DLL, dist, or package payload.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { desktopWindowsToolchain } from './build-desktop-windows.mjs'
import { computerUiaNoFocusCompilePlan } from './build-computer-uia-no-focus.mjs'
import { generateNativeProbe572, probe572 } from './computer-uia-native-probe-572.mjs'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
export function nativeProbeCompilePlan572({cl,root,output}) {
  const [command,args]=computerUiaNoFocusCompilePlan({cl,root,output})
  const original=path.win32.join(root,'src/host-use/win/native/computer-uia-no-focus.cpp')
  const generated=path.win32.join(output,'computer-uia-native-probe-572.cpp')
  const out=`/OUT:${path.win32.join(output,'computer-uia-no-focus.dll')}`
  if(args.filter(value=>value===original).length!==1||args.filter(value=>value===out).length!==1)throw new Error('UIA572_PROBE_BUILD_ANCHOR')
  return [command,args.map(value=>value===original?generated:value===out?`/OUT:${path.win32.join(output,probe572.dll)}`:value)]
}
export function buildNativeProbe572({root:sourceRoot=root,toolchain}={}) {
  if(process.platform!=='win32'||process.arch!=='x64'||process.version!=='v22.23.4')throw new Error('UIA572_PROBE_BUILD_WINDOWS_X64_NODE22_23_4')
  const source=path.join(sourceRoot,'src/host-use/win/native/computer-uia-no-focus.cpp')
  const info=fs.lstatSync(source)
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw new Error('UIA572_PROBE_SOURCE')
  const before=fs.readFileSync(source),generated=generateNativeProbe572(before)
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'cmspark-uia-native-probe-572-'))
  try{
    fs.writeFileSync(path.join(output,'computer-uia-native-probe-572.cpp'),generated,{flag:'wx',mode:0o600})
    const {cl,env}=toolchain??desktopWindowsToolchain()
    const [command,args]=nativeProbeCompilePlan572({cl,root:sourceRoot,output})
    const result=spawnSync(command,args,{env,cwd:output,encoding:'utf8',timeout:120_000,maxBuffer:4*1024*1024})
    if(result.error||result.status!==0)throw new Error('UIA572_PROBE_BUILD_FAILED')
    const dll=path.join(output,probe572.dll),value=fs.lstatSync(dll)
    if(!value.isFile()||value.isSymbolicLink()||value.nlink!==1)throw new Error('UIA572_PROBE_DLL')
    const destination=path.join(sourceRoot,'dist/desktop-native/acceptance/uia572-probe')
    fs.mkdirSync(destination,{recursive:true})
    if(fs.lstatSync(destination).isSymbolicLink())throw new Error('UIA572_PROBE_DESTINATION')
    fs.copyFileSync(dll,path.join(destination,probe572.dll),fs.constants.COPYFILE_EXCL)
    if(!fs.readFileSync(source).equals(before))throw new Error('UIA572_PROBE_SOURCE_DRIFT')
  }finally{fs.rmSync(output,{recursive:true,force:true})}
}
let direct=false
try{direct=!!process.argv[1]&&fs.realpathSync(process.argv[1])===fs.realpathSync(fileURLToPath(import.meta.url))}catch{}
if(direct){if(process.argv.length!==2)throw new Error('UIA572_PROBE_BUILD_ARGS');buildNativeProbe572()}
