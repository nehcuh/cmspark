import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DESKTOP_WINDOWS_INPUTS, prepareDesktopNodeHeaders, extractDesktopSdk, desktopWindowsCompilePlan } from '../build-desktop-windows.mjs'

test('declared SDK output itself cannot redirect into an unrelated sibling', async () => {
  const owned=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-sdk-output-'))
  const original=globalThis.fetch;let network=0
  try {
    const sibling=path.join(owned,'sibling'),output=path.join(owned,'output');fs.mkdirSync(sibling)
    fs.symlinkSync(sibling,output,process.platform==='win32'?'junction':'dir')
    globalThis.fetch=async()=>{network++;throw Error('unexpected download')}
    await assert.rejects(()=>prepareDesktopNodeHeaders({dest:output}),/DESKTOP_SDK_DIRECTORY/)
    assert.deepEqual(fs.readdirSync(sibling),[]);assert.equal(network,0)
  } finally {globalThis.fetch=original;fs.rmSync(owned,{recursive:true,force:true,maxRetries:3,retryDelay:100})}
})

test('pinned SDK cache corruption refuses before download or extraction', async () => {
  const dest=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-sdk-cache-'))
  const original=globalThis.fetch;let network=0
  try {
    globalThis.fetch=async()=>{network++;throw Error('unexpected download')}
    const cache=path.join(dest,'.desktop-sdk-build');fs.mkdirSync(cache)
    const file=path.join(cache,'headers-'+DESKTOP_WINDOWS_INPUTS.headers.sha256);fs.writeFileSync(file,'corrupted archive')
    const before=fs.readdirSync(cache)
    await assert.rejects(()=>prepareDesktopNodeHeaders({dest}),/DESKTOP_SDK_INTEGRITY/)
    assert.deepEqual(fs.readdirSync(cache),before)
    assert.throws(()=>extractDesktopSdk('headers',Buffer.from('not an archive'),cache),/DESKTOP_SDK_INTEGRITY/)
    assert.deepEqual(fs.readdirSync(cache),before);assert.equal(network,0)
  } finally {globalThis.fetch=original;fs.rmSync(dest,{recursive:true,force:true,maxRetries:3,retryDelay:100})}
})

test('SDK cache rejects a redirected directory and a hardlinked input without changing sibling bytes', async () => {
  const owned=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-sdk-identity-'))
  const original=globalThis.fetch;let network=0
  try {
    globalThis.fetch=async()=>{network++;throw Error('unexpected download')}
    const sibling=path.join(owned,'sibling');fs.mkdirSync(sibling);const marker=path.join(sibling,'marker');fs.writeFileSync(marker,'preserve')
    const linked=path.join(owned,'linked');fs.mkdirSync(linked)
    fs.symlinkSync(sibling,path.join(linked,'.desktop-sdk-build'),process.platform==='win32'?'junction':'dir')
    await assert.rejects(()=>prepareDesktopNodeHeaders({dest:linked}),/DESKTOP_SDK_DIRECTORY/)
    const dest=path.join(owned,'hardlinked'),cache=path.join(dest,'.desktop-sdk-build');fs.mkdirSync(cache,{recursive:true})
    fs.linkSync(marker,path.join(cache,'headers-'+DESKTOP_WINDOWS_INPUTS.headers.sha256))
    await assert.rejects(()=>prepareDesktopNodeHeaders({dest}),/DESKTOP_SDK_FILE_IDENTITY/)
    assert.equal(fs.readFileSync(marker,'utf8'),'preserve');assert.equal(network,0)
  } finally {globalThis.fetch=original;fs.rmSync(owned,{recursive:true,force:true,maxRetries:3,retryDelay:100})}
})

test('Windows compile plan keeps pinned inputs and spaced paths as argv, not shell text', () => {
  const plan=desktopWindowsCompilePlan({cl:'C:\\VS tools\\cl.exe',root:'C:\\owned path\\repo',output:'C:\\owned path\\out',headers:'C:\\headers',generated:'C:\\generated',sdk:'C:\\SDK',nodeLib:'C:\\node.lib'})
  assert.equal(plan.length,2);assert.ok(plan.every(([binary,args])=>binary==='C:\\VS tools\\cl.exe'&&Array.isArray(args)))
  assert.ok(plan[0][1].includes('/DBUILDING_NODE_EXTENSION'));assert.ok(plan[0][1].includes('C:\\node.lib'))
  assert.ok(plan[1][1].includes('C:\\owned path\\repo\\src\\desktop\\native\\DesktopHost.cpp'))
  assert.ok(plan[1][1].includes('C:\\SDK\\build\\native\\x64\\WebView2LoaderStatic.lib'))
  assert.ok(plan[1][1].includes('version.lib'));assert.ok(plan[1][1].includes('/OUT:C:\\owned path\\out\\cmspark-desktop.exe'))
})
