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

// Execute the complete private discovery function with controlled Windows API
// outlets. These are discovery contracts; real MSVC/native execution is CI-only.
const helperSource = fs.readFileSync(new URL('../build-desktop-windows.mjs', import.meta.url), 'utf8')
function loadDiscovery(source) {
  const discovery = source.replace(/\r\n/g, '\n').match(/function toolchain\(\) \{([\s\S]*?)\n\}\nexport async function buildDesktopWindows/)
  assert.ok(discovery, 'one complete production toolchain function')
  return new Function('path', 'process', 'checked', 'fs', discovery[1])
}
const discover = loadDiscovery(helperSource)

function controlledDiscovery(major, override = {}) {
  const installation = override.installation ?? `C:\\Program Files\\Microsoft Visual Studio\\${major}\\Enterprise`
  const tools = override.tools ?? path.win32.join(installation, 'VC', 'Tools', 'MSVC', 'owned-version')
  const commands = [], env = {SystemRoot: 'C:\\Windows', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', PATH: 'OWNED_PATH_MUST_NOT_SELECT_COMPILER'}
  const vcvars = path.win32.join(installation, 'VC', 'Auxiliary', 'Build', 'vcvarsall.bat')
  const cl = path.win32.join(tools, 'bin', 'Hostx64', 'x64', 'cl.exe')
  const checked = (binary, args, options) => {
    commands.push({binary, args, options})
    if (binary.endsWith('vswhere.exe')) {
      assert.equal(binary, 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe')
      assert.deepEqual([...args.slice(0, 2), ...args.slice(3)], ['-latest', '-version', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'])
      const version = args[args.indexOf('-version') + 1].match(/^\[(\d+)\.0,(\d+)\.0\)$/)
      assert.ok(version, 'finite explicit major range')
      return major >= Number(version[1]) && major < Number(version[2]) ? installation : ''
    }
    assert.equal(binary, 'C:\\Windows\\System32\\cmd.exe')
    assert.deepEqual(args, ['/d', '/v:off', '/s', '/c', `"call "${vcvars}" x64 >nul && set"`])
    assert.equal(options.windowsVerbatimArguments, true)
    return `Path=OWNED_CAPTURED_PATH\r\nVCToolsInstallDir=${tools}\r\nINCLUDE=OWNED_INCLUDE\r\nOWNED_UNRELATED=not_imported\r\n`
  }
  const result = (override.discover ?? discover)(path.win32, {env}, checked, {
    existsSync: file => [vcvars, cl].includes(file),
    realpathSync: file => file,
  })
  assert.equal(result.cl, cl)
  assert.equal(result.env.Path, 'OWNED_CAPTURED_PATH')
  assert.equal(Object.hasOwn(result.env, 'PATH'), false)
  assert.equal(Object.hasOwn(result.env, 'OWNED_UNRELATED'), false)
  assert.equal(commands.length, 2, 'only fixed vswhere and vcvars before compiler selection')
  return result
}

for (const major of [17, 18]) {
  test(`installed VS major ${major} discovers the exact component compiler`, () => {
    controlledDiscovery(major)
  })
}
for (const major of [16, 19]) {
  test(`unapproved VS major ${major} cannot select a compiler`, () => {
    assert.throws(() => controlledDiscovery(major), /DESKTOP_WINDOWS_TOOLCHAIN_PATH/)
  })
}
for (const installation of ['relative\\VS', 'C:\\VS"quoted', 'C:\\VS%expanded', 'C:\\VS!expanded', 'C:\\VS\nextra']) {
  test(`toolchain rejects unsafe installation ${JSON.stringify(installation)}`, () => {
    assert.throws(() => controlledDiscovery(17, {installation}), /DESKTOP_WINDOWS_TOOLCHAIN_PATH/)
  })
}
test('selected compiler tools must remain inside the discovered installation', () => {
  assert.throws(() => controlledDiscovery(17, {tools: 'C:\\unrelated\\Tools'}), /DESKTOP_WINDOWS_TOOLCHAIN_PATH/)
})

for (const [name, newline] of [['LF', '\n'], ['CRLF', '\r\n']]) {
  test(`production discovery is complete under ${name} checkout newlines`, () => {
    const source = helperSource.replace(/\r\n/g, '\n').replace(/\n/g, newline)
    const discover = loadDiscovery(source)
    for (const major of [17, 18]) controlledDiscovery(major, {discover})
    for (const major of [16, 19]) assert.throws(() => controlledDiscovery(major, {discover}), /DESKTOP_WINDOWS_TOOLCHAIN_PATH/)
  })
}

test('native phase diagnostics are enabled only by explicit testFixtures compile plan', () => {
  const inputs={cl:'C:\\VS\\cl.exe',root:'C:\\repo',output:'C:\\out',headers:'C:\\headers',generated:'C:\\generated',sdk:'C:\\SDK',nodeLib:'C:\\node.lib'}
  const ordinary=desktopWindowsCompilePlan(inputs),disabled=desktopWindowsCompilePlan({...inputs,testFixtures:false}),diagnostic=desktopWindowsCompilePlan({...inputs,testFixtures:true})
  assert.deepEqual(disabled,ordinary)
  assert.deepEqual(diagnostic[0],ordinary[0],'no launcher/handle/bootstrap change')
  const flag='/DCMSPARK_DESKTOP_TEST_PHASES'
  assert.equal(ordinary[1][1].includes(flag),false)
  assert.equal(diagnostic[1][1].filter(value=>value===flag).length,1)
  assert.deepEqual(diagnostic[1][1].filter(value=>value!==flag),ordinary[1][1])
})
